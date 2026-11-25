// 最初のノーツの自動検出: 再生中の動画のコマから、8 本の線を流れてくるノーツを見つけ、first（譜面の時刻 0 が動画の何秒か）を決める（DOM を使わない部分）。
//
// コマごとに、8 本の線の上を細かく（叩く 0.08〜0.23 秒前の場所を 0.01 秒おきに）見て、覚えておく。
// 「線 p で動画の時刻 H に叩くノーツ」があれば、H の 0.23〜0.08 秒前のどのコマでも、
// そのコマの時刻から H までの秒数に当たる場所が光っている。止まっている光る物は、一部のコマでしか合わない。
// コマが飛んでも（重い PC）、見る場所が細かいので、残ったコマでノーツの真上の点が見つかる。
//
// - firstNote(): 一番早いノーツの時刻（simai がなくても使える）
// - matchChart(): simai のノーツと照らし合わせ、一番よく合う first を探す（最初のノーツを見誤っても強い）
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('../geometry/geometry.js') : root.SimaiGeometry;
  const F = isNode ? require('../geometry/flash.js') : root.SimaiFlash;
  const V = isNode ? require('./verify.js') : root.SimaiVerify;

  const L_FROM = 0.08, L_TO = 0.23, L_STEP = 0.01; // 叩くまでの秒。この間を細かく見る
  const LEFTS = [];
  for (let L = L_FROM; L <= L_TO + 1e-9; L += L_STEP) LEFTS.push(+L.toFixed(3));
  const TOL = 0.006; // 叩く時刻の許し幅（秒）。見る場所の間隔の半分より少し広く
  const BIN = 1 / 120; // 叩く時刻を探す刻み（秒）
  const LIT = 0.4; // ノーツの輪郭の点のうち、これだけ光っていれば「ある」
  const MIN_FRAMES = 2; // 1 つの時刻を、これだけのコマで見ていないと決めない
  const AGREE = 0.8; // 見たコマのうち、この割合で光っていれば「流れてくるノーツ」
  const BRIGHT = 0.3; // 線の上の見る点のうち、これより多く光っているコマは譜面の画面ではない
  const NEAR = 6; // 「動いて見えるか」で比べる前後の場所（L の番号で ±6 = ±0.06 秒。動画のタップの輪は太いので離して比べる）
  const LIT_MOVING = 0.3; // 動いて見える分（m）は前後を引いて小さくなるので、低めで「ある」とする
  const LIT_BLUE = 0.1; // 青い点の動いて見える分（bm）。星の縁は細いので、36 点のうち 1 割で「ある」とする

  class LaneScanner {
    constructor() {
      this.reset();
    }

    reset() {
      this.recs = []; // 使ったコマ: { tv, s（線 × L ごとの光った割合）}。時刻順
      this.lefts = null; // 最初のコマで決める（途中でハイスピを変えても混ざらないように）
      this.lastTv = null;
      this.frames = 0;
      this.skipped = 0; // 明るい画面で使わなかったコマ
    }

    // img: { data, width, height }（動画のコマ）、c: 円（img の画素）、tv: 動画の時刻、flow: { approach, appear }
    addFrame(img, c, tv, flow) {
      if (this.lastTv != null && tv <= this.lastTv) return; // 同じコマを 2 回数えない
      this.lastTv = tv;
      this.frames++;
      // ハイスピが速いときは、現れたばかりの小さいノーツを見ないように L を絞る
      if (!this.lefts) this.lefts = LEFTS.filter((L) => L <= flow.approach * 0.85);
      const K = this.lefts.length;
      if (!K) return;
      const size = c.r * 0.075;
      const s = new Float32Array(8 * K);
      const h = new Float32Array(8 * K); // ホールドの胴（線に垂直な左右の辺）の光り方
      const bl = new Float32Array(8 * K); // 青い点の割合（星の縁）
      const col = new Uint8Array(8 * K * 3); // 光った点のうち色の濃い点の平均の色（下書きでノーツの種類を見分ける）
      let total = 0;
      for (let p = 1; p <= 8; p++) {
        const deg = G.buttonAngle(p);
        for (let k = 0; k < K; k++) {
          const i = (p - 1) * K + k;
          const rr = c.r * F.flowRadius(this.lefts[k], flow);
          const pt = G.polar(c, deg, rr);
          const v = sampleColored(img, pt, size, col, i * 3);
          s[i] = v;
          h[i] = V.sampleHold(img, c, deg, rr, size);
          bl[i] = sampleBlue(img, pt, size);
          total += v;
        }
      }
      // 曲の始まる前の明るい画面（タイトルなど）は、どこも光って見えるので使わない
      if (total / s.length > BRIGHT) { this.skipped++; return; }
      // 動いて見える所だけ: 前後（±NEAR）の場所の暗い方を引く。大きな光（叩いたときの演出）や、線に重なる軌道は消える。
      // ホールドの頭は、前が暗く後ろが胴なので残る。
      // 星は、自分のスライドの軌道（水色の矢印の帯）の上を流れてくると m では消えるが、縁の青い点は帯にないので bm で残る
      this.recs.push({ tv, s, m: moving(s, K), h, b: bl, bm: moving(bl, K), col });
    }

    // 線 p で時刻 hit に叩くノーツの色: 見たコマごとに一番よく光った点の色を平均する。{ r, g, b } か、色の濃い点がなければ null
    colorAt(p, hit) {
      const K = this.lefts.length;
      const Lmin = this.lefts[0], Lmax = this.lefts[K - 1];
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = lowerBound(this.recs, hit - Lmax - TOL); i < this.recs.length; i++) {
        const rec = this.recs[i];
        const left = hit - rec.tv;
        if (left < Lmin - TOL) break;
        let best = -1, bi = -1;
        for (let k = 0; k < K; k++) {
          const j = (p - 1) * K + k;
          if (Math.abs(this.lefts[k] - left) <= TOL && rec.s[j] > best) { best = rec.s[j]; bi = j; }
        }
        if (bi < 0 || best < 0.15) continue; // ホールドの頭は中が空いていて光る点が少ないので、低めで見る
        const q = bi * 3;
        if (!rec.col[q] && !rec.col[q + 1] && !rec.col[q + 2]) continue;
        r += rec.col[q]; g += rec.col[q + 1]; b += rec.col[q + 2]; n++;
      }
      return n ? { r: r / n, g: g / n, b: b / n } : null;
    }

    // 見終えた叩く時刻の範囲（どの L でも見ている）
    span() {
      if (!this.recs.length || !this.lefts.length) return null;
      const lo = this.recs[0].tv + this.lefts[this.lefts.length - 1];
      const hi = this.recs[this.recs.length - 1].tv + this.lefts[0];
      return hi > lo ? { lo, hi } : null;
    }

    // 線 p（1〜8）で、動画の時刻 hit に叩くノーツがありそうな度合い。
    // hit を見られるコマ（hit の 0.23〜0.08 秒前）ごとに、hit に当たる場所の光り方を出し、LIT で 1 に切って平均する。
    // key: 's' 光り方、'm' 動いて見える分（前後の場所の暗い方を引いた値）、'h' ホールドの胴、'bm' 青い点の動いて見える分
    // mean: 0〜1、agree: 光ったコマの割合、n: 見たコマの数
    evidence(p, hit, key = 's') {
      const K = this.lefts.length;
      const Lmin = this.lefts[0], Lmax = this.lefts[K - 1];
      let sum = 0, agree = 0, n = 0;
      for (let i = lowerBound(this.recs, hit - Lmax - TOL); i < this.recs.length; i++) {
        const r = this.recs[i];
        const left = hit - r.tv;
        if (left < Lmin - TOL) break;
        let m = -1;
        for (let k = 0; k < K; k++) {
          if (Math.abs(this.lefts[k] - left) <= TOL) m = Math.max(m, r[key][(p - 1) * K + k]);
        }
        if (m < 0) continue;
        const lit = key === 'm' ? LIT_MOVING : key === 'bm' ? LIT_BLUE : LIT;
        sum += Math.min(1, m / lit);
        if (m >= lit) agree++;
        n++;
      }
      return { mean: n ? sum / n : 0, agree: n ? agree / n : 0, n };
    }

    found(p, t, key) {
      const ev = this.evidence(p, t, key);
      return ev.n >= MIN_FRAMES && ev.agree >= AGREE;
    }

    // 一番早いノーツ: { time（動画の時刻）, lanes（その時刻の線）}。まだなければ null
    firstNote() {
      const s = this.span();
      if (!s) return null;
      for (let b = Math.ceil(s.lo / BIN); b * BIN <= s.hi; b++) {
        const t = b * BIN;
        const lanes = [];
        for (let p = 1; p <= 8; p++) if (this.found(p, t)) lanes.push(p);
        if (!lanes.length) continue;
        // ノーツには大きさがあるので、少しの間ずっと光る。その間で一番強い所（同じなら真ん中）を叩く時刻にする
        const tops = [];
        let best = -1;
        for (let tk = t; tk <= Math.min(s.hi, t + 0.05); tk += BIN) {
          let sc = 0;
          for (const p of lanes) sc += this.evidence(p, tk).mean;
          if (sc > best + 1e-9) { best = sc; tops.length = 0; }
          if (Math.abs(sc - best) <= 1e-9) tops.push(tk);
        }
        const time = tops[(tops.length - 1) >> 1];
        const at = [];
        for (let p = 1; p <= 8; p++) if (this.found(p, time)) at.push(p);
        return { time, lanes: at.length ? at : lanes };
      }
      return null;
    }

    // simai のノーツ（events: 時刻順、time は譜面の秒）と照らし合わせて first を探す。
    // 見始めたのが最初のノーツより前であること（「再生して自動で探す」は動画の頭から見る）。
    // frame: 1 コマの秒数。返り値: { first, score, runnerUp, checked, sure }。まだ見ていなければ null
    matchChart(events, frame) {
      const s = this.span();
      if (!s) return null;
      const notes = events.filter((e) => (e.kind === 'tap' || e.kind === 'hold') && e.pos >= 1 && e.pos <= 8);
      if (!notes.length) return null;
      const t0 = notes[0].time;
      const scores = [];
      let bestI = -1;
      // first の候補: 最初のノーツが見た範囲の中に来るもの
      for (let first = s.lo - t0; first <= s.hi - t0; first += BIN) {
        let sum = 0, n = 0;
        for (const e of notes) {
          const hit = first + e.time;
          if (hit > s.hi) break;
          sum += this.evidence(e.pos, hit).mean;
          n++;
        }
        scores.push({ first, mean: sum / n, n });
        if (bestI < 0 || scores[scores.length - 1].mean > scores[bestI].mean + 1e-9) bestI = scores.length - 1;
      }
      if (bestI < 0) return null;
      // 一番よい所が平らに続くときは、その真ん中
      let a = bestI, z = bestI;
      while (z + 1 < scores.length && Math.abs(scores[z + 1].mean - scores[bestI].mean) <= 1e-9) z++;
      while (a > 0 && Math.abs(scores[a - 1].mean - scores[bestI].mean) <= 1e-9) a--;
      const best = scores[(a + z) >> 1];
      // ほかの候補（3 コマより離れたもの）の一番よいもの。同じ形の繰り返しで取り違えていないかを見る
      let runnerUp = 0;
      for (const sc of scores) {
        if (Math.abs(sc.first - best.first) > 3 * frame) runnerUp = Math.max(runnerUp, sc.mean);
      }
      const sure = best.n >= 8 && best.mean >= 0.3 && best.mean - runnerUp >= 0.1;
      return { first: best.first, score: best.mean, runnerUp, checked: best.n, sure };
    }
  }

  // V.sampleNote と同じ点（ノーツの輪郭あたり 2 つの半径 × 12 方向）で光った割合を返し、
  // 光った点のうち色の濃い点（白い縁を除く）の平均の色を out[o..o+2] に書く
  function sampleColored(img, pt, size, out, o) {
    const { data, width: w, height: h } = img;
    let lit = 0, n = 0, r = 0, g = 0, b = 0, cn = 0;
    for (const k of [0.85, 1.05]) {
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        n++;
        if (!V.noteLike(data, w, h, pt.x + size * k * Math.cos(a), pt.y + size * k * Math.sin(a))) continue;
        lit++;
        const p = (((pt.y + size * k * Math.sin(a)) | 0) * w + ((pt.x + size * k * Math.cos(a)) | 0)) * 4;
        const R = data[p], G2 = data[p + 1], B = data[p + 2];
        if (Math.max(R, G2, B) - Math.min(R, G2, B) > 60) { r += R; g += G2; b += B; cn++; }
      }
    }
    if (cn) { out[o] = r / cn; out[o + 1] = g / cn; out[o + 2] = b / cn; }
    return lit / n;
  }

  // 中心 pt のまわり（3 つの半径 × 12 方向）で、青い点（色相 195〜260）の割合。
  // 星の縁は青（199〜219）、スライドの軌道の帯は水色（175〜181）なので、帯の上の星もこれで見える（チエルカ／エソテリカで測った）
  function sampleBlue(img, pt, size) {
    const { data, width: w, height: h } = img;
    let blue = 0, n = 0;
    for (const k of [0.5, 0.85, 1.05]) {
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const x = (pt.x + size * k * Math.cos(a)) | 0, y = (pt.y + size * k * Math.sin(a)) | 0;
        n++;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = (y * w + x) * 4;
        const R = data[p], G2 = data[p + 1], B = data[p + 2];
        const mx = Math.max(R, G2, B), mn = Math.min(R, G2, B);
        if (0.299 * R + 0.587 * G2 + 0.114 * B <= 80 || mx - mn < 40 || mx !== B) continue;
        const hue = 60 * ((R - G2) / (mx - mn) + 4);
        if (hue >= 195 && hue <= 260) blue++;
      }
    }
    return blue / n;
  }

  // 動いて見える所だけ: 同じ線で前後（±NEAR）の場所の暗い方を引く
  function moving(s, K) {
    const m = new Float32Array(s.length);
    for (let p = 0; p < 8; p++) {
      for (let k = 0; k < K; k++) {
        const i = p * K + k;
        const a = k - NEAR >= 0 ? s[i - NEAR] : null;
        const b = k + NEAR < K ? s[i + NEAR] : null;
        const low = a == null ? b : b == null ? a : Math.min(a, b);
        m[i] = Math.max(0, s[i] - (low || 0));
      }
    }
    return m;
  }

  // recs のうち tv >= t になる最初の番号
  function lowerBound(recs, t) {
    let lo = 0, hi = recs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (recs[mid].tv < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  const api = { LaneScanner, LEFTS };
  if (isNode) module.exports = api;
  else root.SimaiFirstDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
