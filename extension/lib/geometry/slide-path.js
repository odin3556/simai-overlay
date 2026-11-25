// スライドの軌道の形（DOM を使わない部分）。
// 座標は判定線の半径を 1 とした「円の中心が 0、右が +x、下が +y」。角度は G.buttonAngle と同じ（真上 0°、時計回り）。
//
// 形（simai の書き方）:
//   -  まっすぐ           ^  円の上を近い方へ        > <  円の上を回る（向きは始点で変わる）
//   v  中心を通る          p q  中心の小さな円を回る   pp qq  大きく回る
//   s z  稲妻形            V  円の上の点で折れる       w  扇（3 本に分かれる）
// p の形は動画（OV3RCLOCK の 5p4）で確かめた: 半径 0.45 の円に接して入り、反時計回りに回って、接して出る。
// pp・qq・s・z は動画で確かめていないので、おおよその形。
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const INNER = 0.45; // p・q で回る円の半径
  const ARC_STEP = 5; // 円の部分を何度ごとの点にするか

  function angleOf(p) {
    return 22.5 + 45 * (p - 1);
  }

  function at(deg, r) {
    return { x: r * Math.sin(deg * DEG), y: -r * Math.cos(deg * DEG) };
  }

  function wrap(p) {
    return ((p - 1 + 8) % 8) + 1;
  }

  // 中心 o・半径 r の円の上を、角度 from から sweep 度（正で時計回り）進む点
  function arc(o, r, from, sweep) {
    const out = [];
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
    for (let i = 0; i <= n; i++) {
      const q = at(from + (sweep * i) / n, r);
      out.push({ x: o.x + q.x, y: o.y + q.y });
    }
    return out;
  }

  const mod360 = (a) => ((a % 360) + 360) % 360;
  const O = { x: 0, y: 0 };

  // 1 つの区切り（形と点）の点の並び。a: 始点の位置、seg: { shape, points }
  function segment(a, seg) {
    const b = seg.points[seg.points.length - 1];
    const A = at(angleOf(a), 1), B = at(angleOf(b), 1);
    const ta = angleOf(a), tb = angleOf(b);
    switch (seg.shape) {
      case '-':
        return [A, B];
      case 'v':
        return [A, O, B];
      case 'V':
        return [A, at(angleOf(seg.points[0]), 1), B];
      case '^': {
        const d = mod360(tb - ta);
        return arc(O, 1, ta, d <= 180 ? d : d - 360);
      }
      case '>':
      case '<': {
        // > は「始点から見て右」: 上半分（1・2・7・8）からは時計回り、下半分（3〜6）からは反時計回り
        const top = a === 1 || a === 2 || a === 7 || a === 8;
        const cw = (seg.shape === '>') === top;
        let d = cw ? mod360(tb - ta) : -mod360(ta - tb);
        if (d === 0) d = cw ? 360 : -360;
        return arc(O, 1, ta, d);
      }
      case 'p':
      case 'q': {
        // 小さな円に接して入り、p は反時計回り・q は時計回りに回って、接して出る
        const al = Math.acos(INNER) / DEG;
        const cw = seg.shape === 'q';
        const t1 = cw ? ta + al : ta - al;
        const t2 = cw ? tb - al : tb + al;
        let d = cw ? mod360(t2 - t1) : -mod360(t1 - t2);
        if (Math.abs(d) < 1) d = cw ? 360 : -360;
        return [A, ...arc(O, INNER, t1, d), B];
      }
      case 'pp':
      case 'qq': {
        // 中心を通る大きな円（中心を始点の横へずらした円）を回る。おおよその形
        const cw = seg.shape === 'qq';
        const oc = at(ta + (cw ? 90 : -90) + 180, 0.25);
        const R = 0.5;
        const start = Math.atan2(A.x - oc.x, -(A.y - oc.y)) / DEG;
        const end = Math.atan2(B.x - oc.x, -(B.y - oc.y)) / DEG;
        let d = cw ? mod360(end - start) : -mod360(start - end);
        if (Math.abs(d) < 30) d += cw ? 360 : -360;
        return [A, ...arc(oc, R, start, d), B];
      }
      case 's':
      case 'z': {
        // 稲妻形: 始点 → 中心の横 → 反対の横 → 終点。おおよその形
        const side = seg.shape === 's' ? -1 : 1;
        const n = at(ta + 90, 1); // 始点→終点の向きに垂直
        const u = { x: -A.x, y: -A.y };
        const p = (along, lat) => ({ x: u.x * along + n.x * lat * side, y: u.y * along + n.y * lat * side });
        return [A, p(0.3, 0.45), p(-0.3, -0.45), B];
      }
      default:
        return [A, B];
    }
  }

  // スライド（parse の kind: 'slide'）の軌道。ふつうは 1 本、扇（w）は 3 本
  function slidePaths(track) {
    if (track.segments.length === 1 && track.segments[0].shape === 'w') {
      const b = track.segments[0].points[0];
      return [wrap(b - 1), b, wrap(b + 1)].map((e) => [at(angleOf(track.start), 1), at(angleOf(e), 1)]);
    }
    let pos = track.start;
    const pts = [];
    for (const seg of track.segments) {
      const part = segment(pos, seg.shape === 'w' ? { shape: '-', points: seg.points } : seg);
      pts.push(...(pts.length ? part.slice(1) : part));
      pos = seg.points[seg.points.length - 1];
    }
    return [pts];
  }

  // 連結スライドの区切りごとの長さ（区切りごとに速さを変えるとき、星の位置を出すのに使う）
  function segmentLengths(track) {
    let pos = track.start;
    return track.segments.map((seg) => {
      const len = length(segment(pos, seg.shape === 'w' ? { shape: '-', points: seg.points } : seg));
      pos = seg.points[seg.points.length - 1];
      return len;
    });
  }

  // 星が動き出してから elapsed 秒のときの、軌道の長さの割合（0〜1）。
  // segTimes（区切りごとの秒）があれば区切りごとの速さ、なければ全体を一定の速さで進む
  function progressAt(track, elapsed, total) {
    if (elapsed <= 0) return 0;
    if (!track.segTimes) return total > 0 ? Math.min(1, elapsed / total) : 1;
    if (!track._segLens) track._segLens = segmentLengths(track);
    const lens = track._segLens;
    const all = lens.reduce((a, b) => a + b, 0) || 1;
    let done = 0, t = elapsed;
    for (let i = 0; i < lens.length; i++) {
      const st = track.segTimes[i] || 0;
      if (t < st) return (done + (lens[i] * t) / st) / all;
      t -= st;
      done += lens[i];
    }
    return 1;
  }

  // 点の並びの長さ
  function length(path) {
    let s = 0;
    for (let i = 1; i < path.length; i++) s += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return s;
  }

  // 始めから長さの割合 f（0〜1）の点と、進む向き（ラジアン、画面の角度）
  function pointAt(path, f) {
    const total = length(path);
    let want = Math.max(0, Math.min(1, f)) * total;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (want <= d || i === path.length - 1) {
        const k = d ? Math.min(1, want / d) : 0;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      want -= d;
    }
    const p = path[0];
    return { x: p.x, y: p.y, dir: 0 };
  }

  const api = { slidePaths, pointAt, length, segmentLengths, progressAt, INNER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimaiSlide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
