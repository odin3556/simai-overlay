const test = require('node:test');
const assert = require('node:assert/strict');
const { Checker } = require('../extension/lib/detect/verify.js');
const G = require('../extension/lib/geometry/geometry.js');
const { flowRadius } = require('../extension/lib/geometry/flash.js');

// 動画のコマに似せた画像: 黒地に白い判定線、流れてくるピンクの輪（ノーツ）
const W = 320, H = 240;
const C = { cx: 160, cy: 120, r: 106 };
const FLOW = { approach: 0.32, appear: 0.25 };
const FRAME = 1 / 60;

function events() {
  const out = [];
  for (let i = 0; i < 40; i++) out.push({ kind: i % 5 === 4 ? 'hold' : 'tap', pos: (i * 3) % 8 + 1, time: 1 + i * 0.2 });
  out.push({ kind: 'touch', area: 'C', pos: null, time: 2.1 });
  return out.sort((a, b) => a.time - b.time);
}

function frameAt(chartT, evs) {
  const data = new Uint8ClampedArray(W * H * 4);
  const notes = [];
  for (const e of evs) {
    if (e.kind === 'touch') continue;
    const k = flowRadius(e.time - chartT, FLOW);
    if (k == null || e.time < chartT) continue;
    notes.push(G.polar(C, G.buttonAngle(e.pos), C.r * k));
  }
  const size = C.r * 0.075;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = [5, 5, 5];
      if (Math.abs(Math.hypot(x - C.cx, y - C.cy) - C.r) < 1.2) c = [240, 240, 240];
      for (const p of notes) if (Math.abs(Math.hypot(x - p.x, y - p.y) - size) < 2) c = [255, 80, 170];
      data.set([...c, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H };
}

// first を本当の値より shift コマ早く（小さく）して確かめる。直すべきずれは +shift コマ
function run(shift) {
  const evs = events();
  const checker = new Checker();
  const trueFirst = 5;
  const first = trueFirst - shift * FRAME;
  for (let v = 5.6; v < 9.5; v += FRAME) checker.addFrame(frameAt(v - trueFirst, evs), C, v - first, FRAME, FLOW, evs);
  return { checker, evs, res: checker.result() };
}

test('重なりの確認: first が合っていれば、ほとんどのノーツが重なり、ずれ 0', () => {
  const { res } = run(0);
  assert.ok(res.checked >= 15, `checked ${res.checked}`);
  assert.ok(res.matched / res.checked > 0.9, `matched ${res.matched}/${res.checked}`);
  assert.equal(res.best, 0);
  assert.ok(res.sure);
});

test('重なりの確認: first が 4 コマ早すぎると、重なりが減り「+4 コマ」を勧める', () => {
  const { res } = run(4);
  assert.ok(res.matched / res.checked < 0.5, `matched ${res.matched}/${res.checked}`);
  assert.equal(res.best, 4);
  assert.ok(res.sure);
});

test('重なりの確認: first が 7 コマ遅すぎると「−7 コマ」を勧める', () => {
  assert.equal(run(-7).res.best, -7);
});

test('重なりの確認: タッチは区画の範囲で別に数え、ノーツごとの判定が出る', () => {
  const { checker, evs, res } = run(0);
  // このコマにはタッチを描いていないので「重ならなかった」
  assert.equal(checker.verdict(evs.find((e) => e.kind === 'touch')), false);
  assert.deepEqual(res.touch, { checked: 1, matched: 0 });
  assert.equal(checker.verdict(evs.find((e) => e.kind === 'tap' && e.time > 1.5)), true);
});

test('重なりの確認: タッチは点から少しずれても、同じ区画の中なら重なったとみなす', () => {
  const { sampleArea, AREA_MATCH } = require('../extension/lib/detect/verify.js');
  const SN = require('../extension/lib/geometry/sensors.js');
  const e = { area: 'B', pos: 3 };
  const pt = G.touchPoint(C, e.area, e.pos); // 区画の中心
  const off = { x: pt.x + C.r * 0.06, y: pt.y + C.r * 0.04 }; // 動画のノーツが少しずれていた
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = Math.abs(Math.hypot(x - off.x, y - off.y) - C.r * 0.05) < 2;
    data.set(on ? [80, 190, 255, 255] : [5, 5, 5, 255], (y * W + x) * 4);
  }
  const img = { data, width: W, height: H };
  const unit = G.touchPoint({ cx: 0, cy: 0, r: 1 }, e.area, e.pos);
  assert.ok(sampleArea(img, C, SN.regionsOfNote('B', 3), unit) >= AREA_MATCH);
  assert.ok(sampleArea(img, C, SN.regionsOfNote('B', 6), G.touchPoint({ cx: 0, cy: 0, r: 1 }, 'B', 6)) < AREA_MATCH);
});
