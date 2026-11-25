// タッチセンサーの 34 の区画（A1〜A8, B1〜B8, C1・C2, D1〜D8, E1〜E8）を、点ではなく範囲（多角形）で持つ（DOM を使わない部分）。
// 座標は slide-path.js と同じ: 判定線の半径を 1、円の中心が 0、右が +x、下が +y。角度は真上 0°、時計回り。
//
// 区画の並び（simai 語の譜面書式 https://w.atwiki.jp/simai/pages/1002.html ・ 509.html）:
//   A … ボタンに隣り合う外側の区画（ボタンと同じ角度）
//   B … A と中央の間（ボタンと同じ角度）
//   C … 中央。右が C1、左が C2。タッチは C1・C2 の真ん中に出る
//   D … A 同士の間を埋める外側の小さな区画（ボタンの間の角度、真上が D1）
//   E … D より少し内側で B と隣り合う区画（ボタンの間の角度、真上が E1）
// 区画の形はおおよそ。中心の位置は geometry.js の DEFAULT_TOUCH（HachimiDX の値）に合うようにしてある。
// タッチの輪の比率をパネルで変えたときは、半径をつなぎ目ごとに伸び縮みさせて合わせる（radial）。
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;

  // 区画の境目の半径（標準の比率のとき）
  const R = {
    C: 0.24, // 中央の円
    E_IN: 0.5, // E の内側の角
    E_MID: 0.64, // B と A の境目（E の左右の角）
    E_OUT: 0.78, // E の外側の角 = D の内側の角
    D_MID: 0.88, // D の左右の角
    OUT: 1.02, // A・D の外側
  };
  const E_HALF = 11.5; // E の左右の角の、中心の角度からのずれ（度）
  const D_MID_HALF = 8; // D の左右の角
  const D_OUT_HALF = 5; // D の外側の角
  const ARC_STEP = 3; // 円弧を何度ごとの点にするか

  // 標準の比率（geometry.js の DEFAULT_TOUCH と同じ）
  const BASE = { A: 0.832, B: 0.46, D: 0.881, E: 0.648 };

  function at(deg, r) {
    return { x: r * Math.sin(deg * DEG), y: -r * Math.cos(deg * DEG) };
  }

  function arc(r, from, to) {
    const out = [];
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / ARC_STEP));
    for (let i = 0; i <= n; i++) out.push(at(from + ((to - from) * i) / n, r));
    return out;
  }

  // 半径の伸び縮み: 標準の B・E・A・D の中心を、いまの比率の位置へ（その間はまっすぐつなぐ）
  function radial(ratios) {
    const r = Object.assign({}, BASE, ratios || {});
    const knots = [[0, 0], [BASE.B, r.B], [BASE.E, r.E], [BASE.A, r.A], [BASE.D, r.D]];
    knots.sort((a, b) => a[0] - b[0]);
    const last = knots[knots.length - 1];
    knots.push([R.OUT + 0.2, R.OUT + 0.2 + (last[1] - last[0])]);
    return (v) => {
      for (let i = 1; i < knots.length; i++) {
        const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
        if (v <= x1 || i === knots.length - 1) return y0 + ((v - x0) * (y1 - y0)) / (x1 - x0);
      }
      return v;
    };
  }

  // 標準の比率での区画の一覧
  function baseRegions() {
    const out = [];
    for (let k = 1; k <= 8; k++) {
      const a0 = 45 * (k - 1), a1 = 45 * k; // A・B の左右の境目（ボタン k は a0 と a1 の真ん中）
      // A: 外側の弧 → D(k+1) の左の辺 → E(k+1) の左上の辺 → B との境目の弧 → E(k) の右上の辺 → D(k) の右の辺
      out.push({
        id: `A${k}`, area: 'A', pos: k,
        poly: [
          ...arc(R.OUT, a0 + D_OUT_HALF, a1 - D_OUT_HALF),
          at(a1 - D_MID_HALF, R.D_MID), at(a1, R.E_OUT), at(a1 - E_HALF, R.E_MID),
          ...arc(R.E_MID, a1 - E_HALF, a0 + E_HALF),
          at(a0, R.E_OUT), at(a0 + D_MID_HALF, R.D_MID),
        ],
      });
      // B: 中央との境目の弧 → 境目の線 → E(k+1) の左下の辺 → A との境目の弧 → E(k) の右下の辺 → 境目の線
      out.push({
        id: `B${k}`, area: 'B', pos: k,
        poly: [
          ...arc(R.C, a0, a1),
          at(a1, R.E_IN), at(a1 - E_HALF, R.E_MID),
          ...arc(R.E_MID, a1 - E_HALF, a0 + E_HALF),
          at(a0, R.E_IN),
        ],
      });
      // D・E は角度 a0（真上が 1）
      out.push({ id: `D${k}`, area: 'D', pos: k, poly: [at(a0, R.E_OUT), at(a0 + D_MID_HALF, R.D_MID), at(a0 + D_OUT_HALF, R.OUT), at(a0 - D_OUT_HALF, R.OUT), at(a0 - D_MID_HALF, R.D_MID)] });
      out.push({ id: `E${k}`, area: 'E', pos: k, poly: [at(a0, R.E_IN), at(a0 + E_HALF, R.E_MID), at(a0, R.E_OUT), at(a0 - E_HALF, R.E_MID)] });
    }
    out.push({ id: 'C1', area: 'C', pos: 1, poly: [{ x: 0, y: -R.C }, ...arc(R.C, 0, 180)] });
    out.push({ id: 'C2', area: 'C', pos: 2, poly: [{ x: 0, y: R.C }, ...arc(R.C, 180, 360)] });
    return out;
  }

  const BASE_REGIONS = baseRegions();
  let cache = { key: null, list: null, byId: null };

  // いまの比率での区画の一覧 [{ id, area, pos, poly }]
  function regions(ratios) {
    const key = JSON.stringify(ratios || {});
    if (cache.key === key) return cache.list;
    const f = radial(ratios);
    const list = BASE_REGIONS.map((g) => ({
      id: g.id, area: g.area, pos: g.pos,
      poly: g.poly.map((p) => {
        const r = Math.hypot(p.x, p.y);
        const k = r ? f(r) / r : 1;
        return { x: p.x * k, y: p.y * k };
      }),
    }));
    cache = { key, list, byId: new Map(list.map((g) => [g.id, g])) };
    return list;
  }

  // タッチのノーツの区画。C は C1・C2 の両方（真ん中に出るので、中央の円全体）
  function regionsOfNote(area, pos, ratios) {
    regions(ratios);
    if (area === 'C') return [cache.byId.get('C1'), cache.byId.get('C2')];
    const g = cache.byId.get(`${area}${pos}`);
    return g ? [g] : [];
  }

  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  // 点がどの区画に入るか（id）。どこにも入らなければ null
  function hit(x, y, ratios) {
    for (const g of regions(ratios)) if (inside(g.poly, x, y)) return g.id;
    return null;
  }

  // スライドの軌道（slide-path.js の点の並び）が通る区画を、通る順に。
  // 区画のふちをかすめるだけの所も拾うよう、細かく見る
  function sensorsAlong(path, ratios, pointAt) {
    const out = [];
    const n = 200;
    for (let i = 0; i <= n; i++) {
      const q = pointAt(path, i / n);
      const id = hit(q.x, q.y, ratios);
      if (id && out[out.length - 1] !== id) out.push(id);
    }
    return out;
  }

  // 区画の中の点を、間隔 step（半径に対する割合）で並べる（重なりの確認で画素を見るため）
  function samplePoints(g, step) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of g.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const out = [];
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) if (inside(g.poly, x, y)) out.push({ x, y });
    }
    return out;
  }

  const api = { regions, regionsOfNote, hit, inside, sensorsAlong, samplePoints, R };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiSensors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
