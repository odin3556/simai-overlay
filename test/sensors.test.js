const test = require('node:test');
const assert = require('node:assert/strict');
const SN = require('../extension/lib/geometry/sensors.js');
const G = require('../extension/lib/geometry/geometry.js');
const { parse } = require('../extension/lib/simai/parse.js');
const S = require('../extension/lib/geometry/slide-path.js');

const unit = { cx: 0, cy: 0, r: 1 };

test('センサーは 34 区画', () => {
  assert.equal(SN.regions().length, 34);
});

test('タッチの位置（geometry の点）は、その名前の区画の中にある', () => {
  for (const area of ['A', 'B', 'D', 'E']) {
    for (let p = 1; p <= 8; p++) {
      const q = G.touchPoint(unit, area, p);
      assert.equal(SN.hit(q.x, q.y), `${area}${p}`, `${area}${p}`);
    }
  }
  assert.equal(SN.hit(0.05, 0), 'C1'); // 右が C1
  assert.equal(SN.hit(-0.05, 0), 'C2');
});

test('区画は重ならない（格子の点がたかだか 1 つの区画に入る）', () => {
  for (let y = -1; y <= 1; y += 0.037) {
    for (let x = -1; x <= 1; x += 0.037) {
      const n = SN.regions().filter((g) => SN.inside(g.poly, x, y)).length;
      assert.ok(n <= 1, `(${x.toFixed(2)}, ${y.toFixed(2)}) は ${n} 区画`);
    }
  }
});

test('タッチの輪の比率を変えると、区画もついてくる', () => {
  const ratios = { A: 0.8, B: 0.5, D: 0.86, E: 0.66 };
  for (const area of ['A', 'B', 'D', 'E']) {
    const q = G.touchPoint(unit, area, 2, ratios);
    assert.equal(SN.hit(q.x, q.y, ratios), `${area}2`);
  }
});

test('スライドが通る区画: 1-5 は A1 から中央を通って A5', () => {
  const track = parse('(120){4}1-5[4:1],E').notes.find((n) => n.kind === 'slide');
  const ids = SN.sensorsAlong(S.slidePaths(track)[0], undefined, S.pointAt);
  assert.equal(ids[0], 'A1');
  assert.equal(ids[ids.length - 1], 'A5');
  assert.ok(ids.includes('B1') && ids.includes('B5'));
  assert.ok(ids.includes('C1') || ids.includes('C2'));
});
