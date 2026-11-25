// 重なりの確認: 再生中の動画のコマを見て、simai のノーツがある「はずの場所」に動画のノーツがあるかを数える（DOM を使わない部分）。
// あわせて、first を ±RANGE コマずらした場合も同時に数え、一番よく重なるずれを探す。
//
// 見るのは、タップ・星・ホールドの頭が、円へ流れてくる途中（叩く 0.26〜0.06 秒前）だけ。
// 叩く瞬間は白い判定線の上に乗るので、ノーツがなくても明るく見えてしまうため。
//
// タッチ・タッチホールドとスライドは、点ではなくセンサーの区画（sensors.js）の範囲で見る:
//   タッチ   … 叩く少し前（三角が寄りきる頃）に、その区画の中で、ノーツの位置の近くが光っているか
//   スライド … 星が動いている間、星がいるはずの区画の中で、星の位置の近くが光っているか
// これらはずれ探しには使わず、タップとは別に数える。
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const T = isNode ? require('../simai/timing.js') : root.SimaiTiming;
  const G = isNode ? require('../geometry/geometry.js') : root.SimaiGeometry;
  const F = isNode ? require('../geometry/flash.js') : root.SimaiFlash;
  // manifest では slide-path.js・sensors.js が後に読まれるので、使うときに探す
  const SN = () => (isNode ? require('../geometry/sensors.js') : root.SimaiSensors);
  const SL = () => (isNode ? require('../geometry/slide-path.js') : root.SimaiSlide);

  const RANGE = 15; // 調べるずれ（±コマ）
  const WINDOW = { from: 0.06, to: 0.26 }; // 叩くまでの秒。この間だけ見る
  const MATCH = 0.3; // ノーツの周りの点のうち、これだけ光っていれば「ある」
  const TOUCH_WINDOW = { from: 0.02, to: 0.15 }; // タッチ: 叩くまでの秒
  const AREA_NEAR = 0.16; // 区画の中で、ノーツ（星）の位置からこの距離（半径に対する割合）までを見る
  const AREA_STEP = 0.02; // 区画の中の点の間隔
  const AREA_MATCH = 0.12; // 見た点のうち、これだけ光っていれば「ある」（三角・星の輪郭は細いので低め）

  // 区画 regs の中で、点 q（半径 1 の座標）から AREA_NEAR までの点の、光っている割合
  function sampleArea(img, c, regs, q) {
    let lit = 0, n = 0;
    for (const g of regs) {
      if (!g._pts) g._pts = SN().samplePoints(g, AREA_STEP);
      for (const p of g._pts) {
        if (Math.hypot(p.x - q.x, p.y - q.y) > AREA_NEAR) continue;
        lit += noteLike(img.data, img.width, img.height, c.cx + p.x * c.r, c.cy + p.y * c.r);
        n++;
      }
    }
    return n ? lit / n : null;
  }

  // ノーツらしい画素: 色が濃くて明るい（ピンク・黄・青・橙）か、とても明るい（白）
  function noteLike(data, w, h, x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    const p = (yi * w + xi) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return (luma > 100 && chroma > 60) || luma > 190 ? 1 : 0;
  }

  // 中心 pt のノーツの輪郭あたり（2 つの半径 × 12 方向）で、光っている点の割合（0〜1）
  function sampleNote(img, pt, size) {
    let lit = 0, n = 0;
    for (const k of [0.85, 1.05]) {
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        lit += noteLike(img.data, img.width, img.height, pt.x + size * k * Math.cos(a), pt.y + size * k * Math.sin(a));
        n++;
      }
    }
    return lit / n;
  }

  // ホールドの頭: 細長い六角形なので、頭のすぐ後ろの左右の辺（判定線へ向かう線に垂直な向き）で見る
  function sampleHold(img, c, deg, rHead, size) {
    const a = (deg * Math.PI) / 180;
    let lit = 0, n = 0;
    for (const back of [0.1, 0.4, 0.7]) {
      const q = G.polar(c, deg, rHead - back * size);
      for (const side of [-1.05, -0.85, 0.85, 1.05]) {
        lit += noteLike(img.data, img.width, img.height, q.x + side * size * Math.cos(a), q.y + side * size * Math.sin(a));
        n++;
      }
    }
    return lit / n;
  }

  function isTarget(e) {
    return (e.kind === 'tap' || e.kind === 'hold') && e.pos >= 1 && e.pos <= 8;
  }

  class Checker {
    constructor() {
      this.reset();
    }

    reset() {
      this.sum = new Float64Array(2 * RANGE + 1);
      this.cnt = new Uint32Array(2 * RANGE + 1);
      this.notes = new Map(); // ノーツ → { lit, n }（いまの first のまま）
      this.areas = new Map(); // タッチ・スライド → { lit, n }（区画の範囲で見たもの）
      this.lastT = null;
    }

    _addArea(e, s) {
      if (s == null) return;
      const m = this.areas.get(e) || { lit: 0, n: 0 };
      m.lit += s;
      m.n++;
      this.areas.set(e, m);
    }

    // タッチ・タッチホールドとスライドを、センサーの区画の範囲で見る
    addAreaFrame(img, c, t, flow, events, ratios) {
      const unit = { cx: 0, cy: 0, r: 1 };
      const tTo = Math.min(TOUCH_WINDOW.to, (flow.touchApproach || 0.3) * 0.85);
      for (const e of T.eventsBetween(events, t + TOUCH_WINDOW.from, t + tTo)) {
        if (e.kind !== 'touch' && e.kind !== 'touchHold') continue;
        this._addArea(e, sampleArea(img, c, SN().regionsOfNote(e.area, e.pos, ratios), G.touchPoint(unit, e.area, e.pos, ratios)));
      }
      // 動いている星（長いスライドもあるので、10 秒前に叩いたものまで見る）
      for (const e of T.eventsBetween(events, t - 10, t)) {
        if (e.kind !== 'slide' || t < e.slideStart || t > e.endTime) continue;
        const S = SL();
        if (!e._paths) e._paths = S.slidePaths(e);
        const f = S.progressAt(e, t - e.slideStart, e.endTime - e.slideStart);
        let sum = 0, k = 0;
        for (const path of e._paths) {
          const q = S.pointAt(path, f);
          const id = SN().hit(q.x, q.y, ratios);
          if (!id) continue;
          const s = sampleArea(img, c, SN().regions(ratios).filter((g) => g.id === id), q);
          if (s != null) { sum += s; k++; }
        }
        if (k) this._addArea(e, sum / k);
      }
    }

    // img: { data, width, height }（動画のコマ）、c: 円（img の画素）、t: 譜面の時刻（動画の時刻 − first）
    // frame: 1 コマの秒数、flow: { approach, appear }、events: 時刻順のノーツ一覧
    // ratios: タッチの輪の比率（区画の範囲を決める）
    addFrame(img, c, t, frame, flow, events, ratios) {
      if (this.lastT === t) return; // 同じコマを 2 回数えない
      this.lastT = t;
      this.addAreaFrame(img, c, t, flow, events, ratios);
      const to = Math.min(WINDOW.to, flow.approach * 0.85);
      const size = c.r * 0.075;
      const span = RANGE * frame;
      for (const e of T.eventsBetween(events, t + WINDOW.from - span, t + to + span)) {
        if (!isTarget(e)) continue;
        const deg = G.buttonAngle(e.pos);
        const hold = e.kind === 'hold';
        for (let d = -RANGE; d <= RANGE; d++) {
          // ホールドは胴が長く、ずらしても胴に当たってしまうので、ずれ探しには使わない（重なったかだけ見る）
          if (hold && d !== 0) continue;
          // 「本当の first は first + d コマ」なら、譜面の時刻は t − d コマ
          const left = e.time - (t - d * frame);
          if (left < WINDOW.from || left > to) continue;
          const rHead = c.r * F.flowRadius(left, flow);
          const s = hold ? sampleHold(img, c, deg, rHead, size) : sampleNote(img, G.polar(c, deg, rHead), size);
          this.sum[d + RANGE] += s;
          this.cnt[d + RANGE]++;
          if (d === 0) {
            const m = this.notes.get(e) || { lit: 0, n: 0 };
            m.lit += s;
            m.n++;
            this.notes.set(e, m);
          }
        }
      }
    }

    // そのノーツが動画と重なったか。まだ見ていなければ null
    verdict(e) {
      const area = this.areas.get(e);
      if (area) return area.n < 2 ? null : area.lit / area.n >= AREA_MATCH;
      const m = this.notes.get(e);
      if (!m || m.n < 2) return null;
      return m.lit / m.n >= MATCH;
    }

    // まとめ: { checked, matched, best（直すとよいコマ数）, sure（はっきりしているか） }
    result() {
      let checked = 0, matched = 0;
      for (const m of this.notes.values()) {
        if (m.n < 2) continue;
        checked++;
        if (m.lit / m.n >= MATCH) matched++;
      }
      const means = [];
      let best = 0, bestMean = -1;
      for (let i = 0; i < this.sum.length; i++) {
        const mean = this.cnt[i] ? this.sum[i] / this.cnt[i] : 0;
        means.push(mean);
        if (mean > bestMean + 1e-9 || (Math.abs(mean - bestMean) <= 1e-9 && Math.abs(i - RANGE) < Math.abs(best))) {
          bestMean = mean;
          best = i - RANGE;
        }
      }
      const sorted = means.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      // 一番よいずれが、ほかのずれよりはっきり良いときだけ「おすすめ」にする
      const sure = checked >= 8 && bestMean > 0.2 && bestMean - median > 0.08;
      // タッチ・スライド（区画の範囲で見たもの）は別に数える
      const touch = { checked: 0, matched: 0 }, slide = { checked: 0, matched: 0 };
      for (const [e, m] of this.areas) {
        if (m.n < 2) continue;
        const o = e.kind === 'slide' ? slide : touch;
        o.checked++;
        if (m.lit / m.n >= AREA_MATCH) o.matched++;
      }
      return { checked, matched, best, sure, bestMean, here: means[RANGE], touch, slide };
    }
  }

  const api = { Checker, sampleNote, sampleHold, sampleArea, noteLike, RANGE, WINDOW, AREA_MATCH };
  if (isNode) module.exports = api;
  else root.SimaiVerify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
