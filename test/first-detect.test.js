const test = require('node:test');
const assert = require('node:assert/strict');
const { LaneScanner } = require('../extension/lib/detect/first-detect.js');
const G = require('../extension/lib/geometry/geometry.js');
const { flowRadius } = require('../extension/lib/geometry/flash.js');

// 動画のコマに似せた画像: 黒地に白い判定線、流れてくるピンクの輪（ノーツ）。
// 邪魔物として、線 3 の上に止まっている明るい点を置く
const W = 320, H = 240;
const C = { cx: 160, cy: 120, r: 106 };
const FLOW = { approach: 0.32, appear: 0.25 };
const FRAME = 1 / 60;
const STILL = G.polar(C, G.buttonAngle(3), C.r * 0.6);

function events() {
  const out = [{ kind: 'tap', pos: 1, time: 0 }, { kind: 'tap', pos: 8, time: 0 }];
  for (let i = 1; i < 30; i++) out.push({ kind: i % 5 === 4 ? 'hold' : 'tap', pos: (i * 3) % 8 + 1, time: i * 0.25 });
  out.push({ kind: 'touch', area: 'C', pos: null, time: 1.1 });
  return out.sort((a, b) => a.time - b.time);
}

function frameAt(chartT, evs) {
  const data = new Uint8ClampedArray(W * H * 4);
  const notes = [];
  for (const e of evs) {
    if (e.kind === 'touch' || e.time < chartT) continue;
    const k = flowRadius(e.time - chartT, FLOW);
    if (k != null) notes.push(G.polar(C, G.buttonAngle(e.pos), C.r * k));
  }
  const size = C.r * 0.075;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = [5, 5, 5];
      if (Math.abs(Math.hypot(x - C.cx, y - C.cy) - C.r) < 1.2) c = [240, 240, 240];
      if (Math.hypot(x - STILL.x, y - STILL.y) < size * 1.3) c = [250, 250, 250];
      for (const p of notes) if (Math.abs(Math.hypot(x - p.x, y - p.y) - size) < 2) c = [255, 80, 170];
      data.set([...c, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H };
}

// 動画の頭（3 秒）から until 秒まで見る。最初のノーツは動画の trueFirst 秒
function scan(trueFirst, until) {
  const evs = events();
  const s = new LaneScanner();
  for (let v = 3; v < until; v += FRAME) s.addFrame(frameAt(v - trueFirst, evs), C, v, FLOW);
  return { s, evs };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b}`);

test('最初のノーツ: 止まった光る点にはだまされず、最初のノーツの時刻と線（1 と 8）を見つける', () => {
  const { s } = scan(5.3, 6.2);
  const fn = s.firstNote(FRAME);
  assert.ok(fn);
  near(fn.time, 5.3, FRAME, '時刻');
  assert.deepEqual(fn.lanes, [1, 8]);
});

test('最初のノーツ: ノーツが来る前だけなら見つからない', () => {
  assert.equal(scan(5.3, 5.2).s.firstNote(FRAME), null);
});

test('譜面と照らし合わせる: first を 1 コマ以内で見つけ、はっきりしている', () => {
  const { s, evs } = scan(5.3, 8.5);
  const m = s.matchChart(evs, FRAME);
  assert.ok(m.checked >= 8, `checked ${m.checked}`);
  near(m.first, 5.3, FRAME, 'first');
  assert.ok(m.sure, JSON.stringify(m));
});

test('最初のノーツ: 曲の始まる前の明るい画面（どこも白い）は使わない', () => {
  const evs = events();
  const s = new LaneScanner();
  const white = { data: new Uint8ClampedArray(W * H * 4).fill(235), width: W, height: H };
  for (let v = 3; v < 4.5; v += FRAME) s.addFrame(white, C, v, FLOW);
  for (let v = 4.5; v < 6.2; v += FRAME) s.addFrame(frameAt(v - 5.3, evs), C, v, FLOW);
  assert.ok(s.skipped > 80, `skipped ${s.skipped}`);
  near(s.firstNote(FRAME).time, 5.3, FRAME, '時刻');
});

test('最初のノーツ: コマが飛んでも（3 コマに 1 つしか数えられなくても）見つける', () => {
  const evs = events();
  const s = new LaneScanner();
  for (let v = 4.5; v < 6.2; v += 3 * FRAME) s.addFrame(frameAt(v - 5.3, evs), C, v, FLOW);
  const fn = s.firstNote(FRAME);
  near(fn.time, 5.3, 2 * FRAME, '時刻');
  assert.deepEqual(fn.lanes, [1, 8]);
});
