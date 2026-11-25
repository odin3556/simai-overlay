// 動画からスライドの軌道（形・終点・流れる時間）を推定する（DOM を使わない部分）。
//
// 星を叩いてから動き出すまでの 1 拍は、軌道の矢印がすべて出ている。その間のコマで、星の位置から出る候補
// （形 × 終点）の線の上の点がどれだけ色付きで光っているかを見る。星が動き出すと、通り過ぎた矢印から消えていくので、
// 「この形・この長さならこう消えるはず」とも照らし合わせ、一番合う候補を選ぶ。
// 流れる時間は、軌道の後半の矢印が全部消えたコマの時刻から出す。
//
// 見るのは色の付いた点だけ（矢印は水色・黄・橙）。円の上を回る軌道は判定線（白）の上を通るので、白い点を数えると
// どの候補も光って見えてしまう。同じ理由で、判定線より少し内側（半径 0.96）を見る。
// チエルカ／エソテリカ EXPERT の 37 本（答えの始点を使って）で、形と終点 34 本・長さ 27 本（両方 24 本）が当たった。
// 長さは長めに外れやすい（1/2 拍を 1〜3/2 拍と出す）。同時に出ている別のスライドの矢印が残っていると、消えた時刻が遅く出るため。
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const SL = isNode ? require('../geometry/slide-path.js') : root.SimaiSlide;

  const SHAPES = ['-', '<', '>', 'v', 'p', 'q', 'pp', 'qq', 's', 'z'];
  const SIMPLE = { '-': 0, '<': 1, '>': 1, v: 2, p: 3, q: 3, pp: 4, qq: 4, s: 4, z: 4 }; // 複雑な形ほど大きい
  const POINTS = 16; // 1 本の軌道で見る点の数（始点の星に重ならないよう、長さの 12〜95% の所）
  const FS = [];
  for (let i = 0; i < POINTS; i++) FS.push(0.12 + (0.83 * i) / (POINTS - 1));
  const MAX_R = 0.96; // 判定線（白）を避けて見る半径
  const DURS = [0.5, 1, 1.5, 2, 3]; // 流れる時間の候補（拍）
  const FADE = 0.03; // 星が通り過ぎてから矢印が消えるまでの秒
  const PENALTY = 0.04; // 形の複雑さ 1 段ごとに引く点（まっすぐ・外周の方がずっと多い）
  const TIE = 0.01; // これだけの差は同じとみなし、簡単な形・長い軌道を選ぶ
  const GONE_PAD = 0.05; // 後半が全部消えた時刻（拍）に足す分（星の大きさ）
  const LIT_A = 0.6; // 待ちの間にこれだけのコマで光っていた点だけを、消え方を見るのに使う
  const MIN_LIT = 0.25; // 待ちの間、選んだ軌道の点がこれだけ光っていなければスライドとみなさない

  // 始点 p ごとの候補: [{ shape, end, len, pts（POINTS 点、判定線の半径 1 の座標）}]
  const CANDS = {};
  for (let p = 1; p <= 8; p++) {
    CANDS[p] = [];
    for (const shape of SHAPES) {
      for (let end = 1; end <= 8; end++) {
        if (end === p && shape !== '<' && shape !== '>') continue;
        const path = SL.slidePaths({ start: p, segments: [{ shape, points: [end] }] })[0];
        const pts = FS.map((f) => {
          const q = SL.pointAt(path, f);
          const r = Math.hypot(q.x, q.y);
          const k = r > MAX_R ? MAX_R / r : 1;
          return { x: q.x * k, y: q.y * k };
        });
        CANDS[p].push({ shape, end, len: SL.length(path), pts });
      }
    }
  }

  // 色の付いた明るい点か（白は数えない）
  function colored(data, w, h, x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;
    const i = (yi * w + xi) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b > 90 && Math.max(r, g, b) - Math.min(r, g, b) > 60;
  }

  class SlideScanner {
    constructor() {
      this.reset();
    }

    reset() {
      this.recs = []; // { tv, bits: { p → Uint16Array（候補ごとの 16 点の光り方）} }
      this.lastTv = null;
    }

    // img: { data, width, height }、c: 円（img の画素）、tv: 動画の時刻
    addFrame(img, c, tv) {
      if (this.lastTv != null && tv <= this.lastTv) return;
      this.lastTv = tv;
      const bits = {};
      for (let p = 1; p <= 8; p++) {
        const list = CANDS[p];
        const out = new Uint16Array(list.length);
        for (let i = 0; i < list.length; i++) {
          let b = 0;
          const pts = list[i].pts;
          for (let j = 0; j < POINTS; j++) if (colored(img.data, img.width, img.height, c.cx + c.r * pts[j].x, c.cy + c.r * pts[j].y)) b |= 1 << j;
          out[i] = b;
        }
        bits[p] = out;
      }
      this.recs.push({ tv, bits });
    }

    // 時刻 from〜to のコマ
    framesBetween(from, to) {
      let lo = 0, hi = this.recs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.recs[mid].tv < from) lo = mid + 1; else hi = mid;
      }
      const out = [];
      for (let i = lo; i < this.recs.length && this.recs[i].tv <= to; i++) out.push(this.recs[i]);
      return out;
    }

    // 位置 p の星を動画の時刻 t に叩いたときのスライド。beat: 1 拍の秒。
    // 返り値: { shape, end, beats（流れる時間の拍）, score } か、軌道が見えなければ null
    detect(p, t, beat) {
      const frames = this.framesBetween(t + 0.03, t + beat * (1 + DURS[DURS.length - 1]) + 0.15);
      const waiting = frames.filter((f) => f.tv - t < beat - 0.03);
      if (waiting.length < 2) return null;
      const list = CANDS[p];
      let best = null;
      const scored = [];
      for (let i = 0; i < list.length; i++) {
        // 待ちの間は全部光り、動き出したら長さ D で手前から消える、と照らし合わせる
        let top = -1;
        for (const db of DURS) {
          const D = db * beat;
          let agree = 0, n = 0;
          for (const f of frames) {
            const dt = f.tv - t;
            if (dt > beat + D + 0.12) break;
            const b = f.bits[p][i];
            for (let j = 0; j < POINTS; j++) {
              const lit = (b >> j) & 1;
              const want = dt < beat + FS[j] * D + FADE ? 1 : 0;
              if (lit === want) agree++;
              n++;
            }
          }
          if (n) top = Math.max(top, agree / n);
        }
        const k = list[i];
        const adj = top - PENALTY * SIMPLE[k.shape];
        scored.push({ i, k, adj });
        if (!best || adj > best.adj) best = { i, k, adj };
      }
      // 差の小さい候補は、簡単な形・長い軌道を選ぶ（短い円弧は長い円弧の一部なので、同じだけ光る）
      const near = scored.filter((s) => s.adj >= best.adj - TIE)
        .sort((a, b) => SIMPLE[a.k.shape] - SIMPLE[b.k.shape] || b.k.len - a.k.len || b.adj - a.adj);
      const pick = near[0];
      // 待ちの間に光っていない軌道は、スライドではない
      const litWait = waiting.reduce((s, f) => s + popcount(f.bits[p][pick.i]), 0) / (POINTS * waiting.length);
      if (litWait < MIN_LIT) return null;
      return { shape: pick.k.shape, end: pick.k.end, beats: this.duration(p, t, beat, pick.i, frames, waiting), score: pick.adj };
    }

    // 流れる時間（拍）: 後半の矢印が全部消えたコマの時刻から。出なければ、点ごとに消えた時刻の中央値から
    duration(p, t, beat, i, frames, waiting) {
      const good = [];
      for (let j = 0; j < POINTS; j++) {
        const lit = waiting.filter((f) => (f.bits[p][i] >> j) & 1).length / waiting.length;
        if (lit >= LIT_A) good.push(j);
      }
      const late = good.filter((j) => FS[j] >= 0.5);
      let prev = null;
      for (const f of frames) {
        const dt = (f.tv - t) / beat;
        if (dt < 1) { prev = dt; continue; }
        if (late.length && late.every((j) => !((f.bits[p][i] >> j) & 1))) {
          const gone = prev != null && prev >= 1 ? (prev + dt) / 2 : dt;
          return snapBeats((gone - 1 + GONE_PAD) / FS[POINTS - 1]);
        }
        prev = dt;
      }
      const est = [];
      for (const j of good) {
        if (FS[j] < 0.35) continue;
        const after = frames.filter((f) => f.tv - t >= beat);
        for (let k = 0; k + 1 < after.length; k++) {
          if (!((after[k].bits[p][i] >> j) & 1) && !((after[k + 1].bits[p][i] >> j) & 1)) {
            est.push(((after[k].tv - t) / beat - 1) / FS[j]);
            break;
          }
        }
      }
      if (!est.length) return 1;
      est.sort((a, b) => a - b);
      return snapBeats(est[est.length >> 1]);
    }
  }

  function popcount(x) {
    let n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  function snapBeats(d) {
    return DURS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
  }

  // 流れる時間（拍）を simai の長さに: 1 拍 → [4:1]、1/2 拍 → [8:1]、3 拍 → [4:3]
  function durationText(beats) {
    if (Number.isInteger(beats)) return `[4:${beats}]`;
    if (Number.isInteger(beats * 2)) return `[8:${beats * 2}]`;
    return `[16:${Math.round(beats * 4)}]`;
  }

  // 下書きの星（color 'star' か star の印）にスライドを付ける。n.slide = { shape, end, beats, text（'-5[8:1]' の部分）}
  // 返り値: 付けた数
  function attachSlides(notes, scanner, beat) {
    let n = 0;
    for (const note of notes) {
      if (note.kind !== 'tap' || (note.color !== 'star' && !note.star)) continue;
      const s = scanner.detect(note.pos, note.time, beat);
      if (!s) continue;
      note.slide = Object.assign(s, { text: `${s.shape}${s.end}${durationText(s.beats)}` });
      n++;
    }
    return n;
  }

  const api = { SlideScanner, CANDS, FS, durationText, snapBeats, attachSlides };
  if (isNode) module.exports = api;
  else root.SimaiSlideDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
