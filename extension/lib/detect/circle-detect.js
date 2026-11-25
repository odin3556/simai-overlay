// 動画のコマから、白い判定線（円）を探す（DOM を使わない部分）。
// 考え方は HachimiDX の detect_circle.py を参考にした（コードは使っていない）:
//   明るさで白い点だけを残し、大きさの決まった丸を探し、何コマか見て確かめる。
// ここでは「中心の候補ごとに、白い点の中心からの距離を数え、細い輪になる半径」を探す。
(function (root) {
  'use strict';

  // 白い点（明るくて、色の偏りが小さい）だけを 1 にする。data は RGBA の並び
  function whiteMask(data, w, h, opt) {
    const o = Object.assign({ minLuma: 170, maxChroma: 70 }, opt);
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (0.299 * r + 0.587 * g + 0.114 * b >= o.minLuma && mx - mn <= o.maxChroma) mask[i] = 1;
    }
    return mask;
  }

  // 白い点の割合。譜面の画面（黒地に細い判定線とノーツ）なら数 %。曲の始まる前の明るい画面だと大きい
  function whiteRatio(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return n / mask.length;
  }

  // 何コマかの白い点を重ねる。動くノーツは消え、動かない判定線だけが残る
  function combineMasks(masks, minRatio) {
    if (masks.length === 1) return masks[0];
    const need = Math.max(1, Math.ceil(masks.length * (minRatio == null ? 0.6 : minRatio)));
    const out = new Uint8Array(masks[0].length);
    for (let i = 0; i < out.length; i++) {
      let n = 0;
      for (const m of masks) n += m[i];
      if (n >= need) out[i] = 1;
    }
    return out;
  }

  // 白い点の座標を取り出す。多すぎるときは間引く
  function collectPoints(mask, w, h, limit) {
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    const stride = Math.max(1, Math.ceil(count / limit));
    const xs = [], ys = [];
    let k = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x] && k++ % stride === 0) { xs.push(x + 0.5); ys.push(y + 0.5); }
      }
    }
    return { xs, ys, count };
  }

  // 中心の候補を step 刻みで動かし、距離の数え上げで「細い輪」が一番はっきりする中心と半径を探す
  function searchCenter(pts, area, rMin, rMax, step, bin, win) {
    const nb = Math.ceil((rMax - rMin) / bin) + 1;
    const hist = new Float32Array(nb);
    const half = win >> 1;
    let best = null;
    for (let cy = area.y0; cy <= area.y1; cy += step) {
      for (let cx = area.x0; cx <= area.x1; cx += step) {
        hist.fill(0);
        for (let i = 0; i < pts.xs.length; i++) {
          const d = Math.hypot(pts.xs[i] - cx, pts.ys[i] - cy);
          if (d >= rMin && d < rMax) hist[((d - rMin) / bin) | 0]++;
        }
        let sum = 0;
        for (let j = 0; j < win && j < nb; j++) sum += hist[j];
        for (let j = half; j < nb - half; j++) {
          if (j > half) sum += hist[j + half] - hist[j - half - 1];
          const r = rMin + (j + 0.5) * bin;
          const score = sum / r; // 大きい円ほど点が多いので、周の長さで割る
          if (!best || score > best.score) best = { cx, cy, r, score };
        }
      }
    }
    return best;
  }

  // 輪の近くの点だけで、円を最小二乗で当てはめ直す（x² + y² + Dx + Ey + F = 0）
  function refineFit(pts, c, tol) {
    let cur = c;
    for (let it = 0; it < 4; it++) {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
      for (let i = 0; i < pts.xs.length; i++) {
        const x = pts.xs[i], y = pts.ys[i];
        if (Math.abs(Math.hypot(x - cur.cx, y - cur.cy) - cur.r) > tol) continue;
        const z = x * x + y * y;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
      }
      if (n < 20) return cur;
      // [sxx sxy sx; sxy syy sy; sx sy n] [D E F]ᵀ = −[sxz syz sz]ᵀ
      const s = solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], [-sxz, -syz, -sz]);
      if (!s) return cur;
      const cx = -s[0] / 2, cy = -s[1] / 2;
      const r2 = cx * cx + cy * cy - s[2];
      if (!(r2 > 0)) return cur;
      cur = { cx, cy, r: Math.sqrt(r2), score: cur.score };
    }
    return cur;
  }

  function solve3(a, b) {
    const m = a.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      if (Math.abs(m[p][c]) < 1e-12) return null;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = m[r][c] / m[c][c];
        for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
      }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }

  // 円の周のうち、白い点がある角度の割合（0〜1）
  function coverage(pts, c, tol, bins) {
    const seen = new Uint8Array(bins);
    for (let i = 0; i < pts.xs.length; i++) {
      const dx = pts.xs[i] - c.cx, dy = pts.ys[i] - c.cy;
      if (Math.abs(Math.hypot(dx, dy) - c.r) > tol) continue;
      seen[Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * bins) % bins] = 1;
    }
    let n = 0;
    for (const v of seen) n += v;
    return n / bins;
  }

  // mask（w × h）から判定線を探す。見つかれば { cx, cy, r, coverage }（画素）、なければ null
  //   半径は短い辺の 25〜55%、中心は画面の真ん中 50% の範囲（HachimiDX と同じ考え方）
  function detectRing(mask, w, h, opt) {
    const o = Object.assign({ rMin: 0.25, rMax: 0.55, centerRange: 0.25, minCoverage: 0.6, maxPoints: 5000 }, opt);
    const size = Math.min(w, h);
    const pts = collectPoints(mask, w, h, o.maxPoints);
    if (pts.xs.length < 100) return null;
    const rMin = size * o.rMin, rMax = size * o.rMax;

    const coarse = Math.max(2, Math.round(size / 80));
    const area = {
      x0: Math.round(w * (0.5 - o.centerRange)), x1: Math.round(w * (0.5 + o.centerRange)),
      y0: Math.round(h * (0.5 - o.centerRange)), y1: Math.round(h * (0.5 + o.centerRange)),
    };
    let best = searchCenter(pts, area, rMin, rMax, coarse, 2, 5);
    if (!best) return null;
    best = searchCenter(pts, { x0: best.cx - coarse, x1: best.cx + coarse, y0: best.cy - coarse, y1: best.cy + coarse }, rMin, rMax, 1, 1, 3);
    best = refineFit(pts, best, Math.max(2, size / 150));
    const cov = coverage(pts, best, Math.max(1.5, size / 200), 120);
    if (cov < o.minCoverage) return null;
    return { cx: best.cx, cy: best.cy, r: best.r, coverage: cov };
  }

  const api = { whiteMask, whiteRatio, combineMasks, detectRing };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiCircleDetect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
