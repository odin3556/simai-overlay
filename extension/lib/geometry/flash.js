// 叩く時刻と今の時刻から、光り方を決める（DOM を使わない部分）。
(function (root) {
  'use strict';

  // 光らせる時間の幅（設計書の初期値）
  const DEFAULT_FLASH = {
    preFrames: 3, // 予告: 叩く 3 コマ前から、薄い輪郭だけ
    hitFrames: 0.5, // 本光り: 叩く時刻の ±0.5 コマ
    afterSec: 0.2, // 残像: 叩いたあと 0.2 秒で消える
  };

  // dt = 今の時刻 − 叩く時刻（秒）、frame = 1 コマの秒数
  // 返り値: null（描かない）または { phase: 'pre' | 'hit' | 'after', alpha }
  function flashPhase(dt, frame, cfg) {
    const c = cfg || DEFAULT_FLASH;
    const hit = c.hitFrames * frame;
    if (dt < -c.preFrames * frame) return null;
    if (dt < -hit) {
      // 予告は近づくほど少し濃く
      const k = 1 - (-dt - hit) / (c.preFrames * frame - hit);
      return { phase: 'pre', alpha: 0.25 + 0.35 * k };
    }
    if (dt <= hit) return { phase: 'hit', alpha: 1 };
    if (dt <= hit + c.afterSec) return { phase: 'after', alpha: 0.8 * (1 - (dt - hit) / c.afterSec) };
    return null;
  }

  // 描画のために、今の時刻の前後で調べる範囲（秒）。
  function lookaround(frame, cfg) {
    const c = cfg || DEFAULT_FLASH;
    return { before: c.hitFrames * frame + c.afterSec, after: c.preFrames * frame };
  }

  // 連続するコマの時刻の差から、1 コマの長さを推定する。
  // 落ちたコマ（2 コマ分の差）が混ざるので、小さいほうから 1/4 の位置の値を使う。
  function estimateFrame(diffs, fallback) {
    const d = diffs.filter((x) => x > 0.004 && x < 0.1).sort((a, b) => a - b);
    if (d.length < 10) return fallback;
    return d[Math.floor(d.length / 4)];
  }

  // 流れてくるノーツ。中心寄りの輪（appear × 半径）に現れ、approach 秒かけて一定の速さで円まで進む。
  // 数値は HachimiDX（github.com/ck2739046/HachimiDX）が調べたゲームの値を使う:
  //   1080p で、ノーツは中心から 120px に現れ 480px（判定線）まで進む → appear = 120 / 480
  //   円まで進む秒数 = 4 拍 ÷ (OptionNotespeed / 60)、OptionNotespeed = ハイスピ × 100 + 100
  // OV3RCLOCK の動画はハイスピ 6.5（0.32 秒）で、コマから測った値と合う。
  const DEFAULT_FLOW = { speed: 6.5, touchSpeed: 6.5, appear: 120 / 480 };

  function tapApproach(speed) {
    return 240 / Math.round(speed * 100 + 100);
  }

  // タッチのハイスピ → OptionTouchspeed（ゲームの表。HachimiDX の estimate_touch_speed.py より）
  const TOUCH_SPEED = {
    1: 175, 1.25: 183, 1.5: 200, 1.75: 212, 2: 225, 2.25: 237, 2.5: 250, 2.75: 262,
    3: 275, 3.25: 283, 3.5: 300, 3.75: 312, 4: 325, 4.25: 337, 4.5: 350, 4.75: 375,
    5: 400, 5.25: 425, 5.5: 450, 5.75: 475, 6: 500, 6.25: 525, 6.5: 550, 6.75: 575,
    7: 600, 7.25: 625, 7.5: 650, 7.75: 675, 8: 700, 8.25: 725, 8.5: 750, 8.75: 775,
    9: 800, 9.25: 825, 9.5: 850, 9.75: 875, 10: 900,
  };

  function touchApproach(speed) {
    const s = Math.min(10, Math.max(1, Math.round(speed * 4) / 4));
    return 240 / TOUCH_SPEED[s];
  }

  // タッチの三角が寄ってくる進み方（時間の進み 0〜1 → 位置の進み 0〜1）。
  // 終わり近くで速くなる。HachimiDX が動画から当てはめた式。
  function touchEase(x) {
    const y = 3.5 * x ** 4 - 3.75 * x ** 3 + 1.45 * x ** 2 - 0.05 * x + 0.0005;
    return Math.min(1, Math.max(0, y));
  }

  // 叩くまでの秒 left から、中心からの距離（半径に対する割合）。現れる前は null。
  function flowRadius(left, flow) {
    const f = flow || { approach: tapApproach(DEFAULT_FLOW.speed), appear: DEFAULT_FLOW.appear };
    if (left > f.approach) return null;
    if (left <= 0) return 1;
    return 1 - (left / f.approach) * (1 - f.appear);
  }

  const api = { DEFAULT_FLASH, DEFAULT_FLOW, flashPhase, lookaround, estimateFrame, flowRadius, tapApproach, touchApproach, touchEase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiFlash = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
