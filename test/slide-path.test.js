const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { slidePaths, pointAt, length, INNER } = require('../extension/lib/geometry/slide-path.js');
const { parse } = require('../extension/lib/simai/parse.js');

const slide = (src) => parse(`(120){4}${src},E`).notes.find((n) => n.kind === 'slide');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b}`);
const DEG = Math.PI / 180;
const at = (deg, r = 1) => ({ x: r * Math.sin(deg * DEG), y: -r * Math.cos(deg * DEG) });

test('スライドの形: まっすぐ・中心を通る・折れる', () => {
  near(length(slidePaths(slide('1-5[4:1]'))[0]), 2, 1e-9, '1-5 の長さ');
  const v = slidePaths(slide('3v6[4:1]'))[0];
  assert.deepEqual(v[1], { x: 0, y: 0 });
  near(length(v), 2, 1e-9, '3v6 の長さ');
  const V = slidePaths(slide('4V28[4:1]'))[0];
  near(V[1].x, at(67.5).x, 1e-9, 'V は 2 で折れる');
});

test('スライドの形: ^ は近い方、> < は始点で向きが変わる', () => {
  near(length(slidePaths(slide('2^7[4:1]'))[0]), Math.PI * 0.75, 0.01, '2^7（反時計回りに 135°）');
  const mid = (src) => pointAt(slidePaths(slide(src))[0], 0.5);
  // 1>5: 上半分から > は時計回り → 半分で 3 と 4 の間（右下）
  assert.ok(mid('1>5[4:1]').x > 0.9, '1>5 は右を回る');
  // 5<1: 下半分から < は時計回り → 半分で 7 と 8 の間（左上）
  assert.ok(mid('5<1[4:1]').x < -0.9, '5<1 は左を回る');
  // 3>1: 下半分から > は反時計回り → 2 を通る 90°
  near(length(slidePaths(slide('3>1[4:1]'))[0]), Math.PI / 2, 0.01, '3>1');
  near(length(slidePaths(slide('1>1[4:1]'))[0]), Math.PI * 2, 0.02, '1>1 は 1 周');
});

test('スライドの形: p は半径 0.45 の円を反時計回り（動画の 5p4 と同じく、上を回る）', () => {
  const p = slidePaths(slide('5p4[4:1]'))[0];
  const top = p.reduce((m, q) => (q.y < m.y ? q : m));
  near(top.y, -INNER, 0.01, '一番上');
  // 始点 5 から、まず右へ（4 の側へ）渡る
  assert.ok(p[1].x > 0, '5p4 の 1 歩目は右');
  const q = slidePaths(slide('5q6[4:1]'))[0];
  assert.ok(q[1].x < 0, '5q6 の 1 歩目は左');
});

test('スライドの形: 扇（w）は 3 本、つないだ形は前の終点から続く', () => {
  const w = slidePaths(slide('2w6[4:1]'));
  assert.equal(w.length, 3);
  near(w[0][1].x, at(202.5).x, 1e-9, '5 へ');
  const chain = slidePaths(slide('3-6-1[4:1]'))[0];
  assert.equal(chain.length, 3);
  near(chain[2].x, at(22.5).x, 1e-9, '最後は 1');
});

test('スライドの形: テストの譜面の軌道がすべて形になる', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'ov3rclock_14plus.simai'), 'utf8');
  const slides = parse(src).notes.filter((n) => n.kind === 'slide');
  assert.ok(slides.length >= 91); // 数は星の数（* でつないだ軌道は 1 つに数える）
  for (const s of slides) {
    for (const p of slidePaths(s)) {
      assert.ok(p.length >= 2 && length(p) > 0.3, JSON.stringify(s.segments));
      for (const q of p) assert.ok(Number.isFinite(q.x) && Math.hypot(q.x, q.y) <= 1.0001, JSON.stringify(s.segments));
    }
  }
});

test('スライドの星: 長さの割合で進む', () => {
  const p = slidePaths(slide('1-5[4:1]'))[0];
  const half = pointAt(p, 0.5);
  near(Math.hypot(half.x, half.y), 0, 1e-9, '半分で中心');
  assert.deepEqual([pointAt(p, 0).x, pointAt(p, 1).x], [p[0].x, p[1].x]);
});
