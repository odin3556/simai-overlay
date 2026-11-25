// 動画からタッチ（A〜E のセンサー）とタッチホールド（C）を拾う（DOM を使わない部分）。
//
// 動画のタッチは、センサーの位置を中心に、画面の上下左右の 4 つの三角と真ん中の小さな点で描かれる。
// 叩く 0.5 秒ほど前から 0.1 秒前まで、上下左右（中心から判定線の半径の 0.06・0.08 倍）は光り、斜めは暗い。
// 叩く直前に三角が寄って内側に入り、叩いた瞬間に一面が光る（斜めも光る）。
// そこで「上下左右の 8 点のうち 7 点以上が光り、斜めの 4 点は 1 点まで」が TOUCH_MIN 秒以上続く所をタッチとし、
// その終わりの TOUCH_PAD 秒後を叩く時刻にする。タップの輪や軌道の帯は斜めも光るので、これで分けられる。
//
// 中央（C）は画面の真ん中の表示と重なり、上下左右が全部光るのは最後の 0.15 秒ほどなので、短くてもよい。
// C のタッチホールドは、叩く前の三角が見えず、押している間ずっと上下左右と斜めが光る（ホールドの塗り）。
// その続く間をタッチホールドにする。ほかのセンサーでは、軌道の帯でも同じように光るので見ない。
// チエルカ／エソテリカ EXPERT（タッチのハイスピ 6.5）で、タッチ 16 個すべてと C のタッチホールド 1 個を拾い、
// 余計に拾ったのは曲が終わったあとの 1 個だけだった。
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('../geometry/geometry.js') : root.SimaiGeometry;

  const NEAR = [0.06, 0.08]; // 上下左右の点の、中心からの距離（判定線の半径に対する割合）
  const DIAG = 0.06; // 斜めの点の距離
  const AX_MIN = 7; // 上下左右の 8 点のうち、これだけ光っていれば三角がある
  const DIAG_MAX = 1; // 斜めの 4 点のうち、これまでなら暗いとみなす（ほかのノーツが 1 点かかることがある）
  const TOUCH_MIN = 0.25; // タッチ: これだけ続けば（秒）
  const C_MIN = 0.12; // 中央のタッチ: これだけ続けば
  const TOUCH_PAD = 0.1; // 続いた終わりから叩く時刻まで（秒。タッチのハイスピ 6.5 で測った）
  const HOLD_DIAG_MIN = 3; // C のタッチホールド: 斜めもこれだけ光る
  const HOLD_MIN = 0.3; // C のタッチホールド: これだけ続けば
  const GAP = 0.08; // これより短い途切れは、同じ続きとみなす

  // 13 点の並び: 上下左右 × 2 つの距離（0〜7）、斜め 4 点（8〜11）、真ん中（12）
  const OFF = [];
  for (const d of NEAR) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) OFF.push([dx * d, dy * d]);
  for (const [dx, dy] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) OFF.push([(dx * DIAG) / Math.SQRT2, (dy * DIAG) / Math.SQRT2]);
  OFF.push([0, 0]);

  const SENSORS = [];
  for (const area of ['A', 'B', 'D', 'E']) for (let pos = 1; pos <= 8; pos++) SENSORS.push({ area, pos });
  SENSORS.push({ area: 'C', pos: null });

  function colored(data, w, h, x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return false;
    const i = (yi * w + xi) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b > 90 && Math.max(r, g, b) - Math.min(r, g, b) > 60;
  }

  function popcount(x) {
    let n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  class TouchScanner {
    constructor() {
      this.reset();
    }

    reset() {
      this.recs = []; // { tv, bits: Uint16Array（センサーごとの 13 点の光り方）}
      this.lastTv = null;
    }

    // img: { data, width, height }、c: 円（img の画素）、tv: 動画の時刻、ratios: タッチの輪の比率（なければ標準）
    addFrame(img, c, tv, ratios) {
      if (this.lastTv != null && tv <= this.lastTv) return;
      this.lastTv = tv;
      const bits = new Uint16Array(SENSORS.length);
      for (let i = 0; i < SENSORS.length; i++) {
        const s = SENSORS[i];
        const pt = G.touchPoint(c, s.area, s.pos, ratios);
        let b = 0;
        for (let j = 0; j < OFF.length; j++) {
          if (colored(img.data, img.width, img.height, pt.x + c.r * OFF[j][0], pt.y + c.r * OFF[j][1])) b |= 1 << j;
        }
        bits[i] = b;
      }
      this.recs.push({ tv, bits });
    }

    // センサー i で test が続く区間 [{ a, z }]（minLen 秒以上）
    runs(i, test, minLen) {
      const out = [];
      let a = null, z = null;
      const flush = () => {
        if (a != null && z - a >= minLen) out.push({ a, z });
        a = z = null;
      };
      for (const r of this.recs) {
        if (!test(r.bits[i])) continue;
        if (a != null && r.tv - z > GAP) flush();
        if (a == null) a = r.tv;
        z = r.tv;
      }
      flush();
      return out;
    }

    // 返り値: [{ kind: 'touch', area, pos, time } | { kind: 'touchHold', area: 'C', pos: null, time, end }]（時刻順）
    extract() {
      const notes = [];
      const touchLike = (b) => popcount(b & 0xff) >= AX_MIN && popcount((b >> 8) & 0xf) <= DIAG_MAX;
      for (let i = 0; i < SENSORS.length; i++) {
        const s = SENSORS[i];
        for (const r of this.runs(i, touchLike, s.area === 'C' ? C_MIN : TOUCH_MIN)) {
          notes.push({ kind: 'touch', area: s.area, pos: s.pos, time: r.z + TOUCH_PAD });
        }
      }
      const c = SENSORS.length - 1;
      const holding = (b) => popcount(b & 0xff) >= AX_MIN && popcount((b >> 8) & 0xf) >= HOLD_DIAG_MIN;
      for (const r of this.runs(c, holding, HOLD_MIN)) notes.push({ kind: 'touchHold', area: 'C', pos: null, time: r.a, end: r.z });
      return notes.sort((x, y) => x.time - y.time);
    }
  }

  const api = { TouchScanner, SENSORS, OFF };
  if (isNode) module.exports = api;
  else root.SimaiTouchDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
