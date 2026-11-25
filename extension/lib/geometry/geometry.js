// 画面上の位置の計算（DOM を使わない部分）。Node のテストからも読む。
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;

  // video 要素の中で、実際に映像が出ている範囲（黒帯を除く）。object-fit: contain と同じ計算。
  //   el … 要素の大きさ { width, height }、vw / vh … 動画の元の大きさ
  // 返り値は要素の左上からの { x, y, w, h }。
  function contentRect(el, vw, vh) {
    if (!vw || !vh) return { x: 0, y: 0, w: el.width, h: el.height };
    const scale = Math.min(el.width / vw, el.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (el.width - w) / 2, y: (el.height - h) / 2, w, h };
  }

  // 円の設定は、映像部分に対する割合で持つ。
  //   cx … 幅に対する割合、cy と r … 高さに対する割合
  // 全画面・シアター・ウインドウを切り替えても、同じ割合なら同じ場所になる。
  function circleToPx(calib, w, h) {
    return { cx: calib.cx * w, cy: calib.cy * h, r: calib.r * h };
  }

  function circleFromPx(px, w, h) {
    return { cx: px.cx / w, cy: px.cy / h, r: px.r / h };
  }

  // 真上から時計回りの角度（度）と半径から、画面の座標。画面は下向きに y が増える。
  function polar(c, deg, radius) {
    return { x: c.cx + radius * Math.sin(deg * DEG), y: c.cy - radius * Math.cos(deg * DEG) };
  }

  // 外側のボタン 1〜8。位置 p の角度 = 22.5° + 45° × (p − 1)
  function buttonAngle(p) {
    return 22.5 + 45 * (p - 1);
  }

  function buttonPoint(c, p) {
    return polar(c, buttonAngle(p), c.r);
  }

  // タッチの位置。A・B … ボタンと同じ角度、D・E … ボタンの間（真上が 1）
  // 比率は HachimiDX の get_touch_areas（1080p の座標、判定線の半径 480px）から出した値:
  //   A1 (693,171) → 400/480、B1 (624,336) → 221/480、D1 (540,117) → 423/480、E1 (540,229) → 311/480
  const DEFAULT_TOUCH = { A: 0.832, B: 0.46, D: 0.881, E: 0.648 };
  // 以前の初期値（D・E が違っていた）。保存された設定がこれと同じなら、新しい初期値に置き換える
  const OLD_DEFAULT_TOUCH = { A: 0.83, B: 0.46, D: 0.83, E: 0.46 };

  function touchPoint(c, area, pos, ratios) {
    if (area === 'C') return { x: c.cx, y: c.cy };
    const k = (ratios || DEFAULT_TOUCH)[area];
    const deg = area === 'A' || area === 'B' ? buttonAngle(pos) : 45 * (pos - 1);
    return polar(c, deg, c.r * k);
  }

  const api = { contentRect, circleToPx, circleFromPx, polar, buttonAngle, buttonPoint, touchPoint, DEFAULT_TOUCH, OLD_DEFAULT_TOUCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
