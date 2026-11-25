const test = require('node:test');
const assert = require('node:assert/strict');
const { TouchScanner } = require('../extension/lib/detect/touch-detect.js');
const { toSimai } = require('../extension/lib/detect/draft.js');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');
const G = require('../extension/lib/geometry/geometry.js');

// 動画のコマに似せた画像: タッチは、センサーの位置の上下左右の黄色い三角と真ん中の点。
// 叩く 0.5 秒前から 0.06 秒前まで出て、叩いた瞬間（0.06 秒間）は一面が光る。
// C のタッチホールドは、押している間ずっと上下左右と斜めが光る
const W = 320, H = 240;
const C = { cx: 160, cy: 120, r: 106 };
const YELLOW = [250, 220, 60];

function frameAt(tv, touches, holds) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([5, 5, 5, 255], i * 4);
  const box = (x, y, half) => {
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const xi = Math.round(x + dx), yi = Math.round(y + dy);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) data.set([...YELLOW, 255], (yi * W + xi) * 4);
    }
  };
  for (const t of touches) {
    const p = G.touchPoint(C, t.area, t.pos);
    const left = t.time - tv;
    if (left > 0.06 && left < 0.5) {
      const d = C.r * 0.07;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) box(p.x + dx * d, p.y + dy * d, 2);
      box(p.x, p.y, 1);
    } else if (left <= 0 && left > -0.06) box(p.x, p.y, Math.round(C.r * 0.1));
  }
  for (const h of holds) {
    if (tv >= h.time && tv <= h.end) box(C.cx, C.cy, Math.round(C.r * 0.1));
  }
  return { data, width: W, height: H };
}

const TOUCHES = [{ area: 'E', pos: 4, time: 5 }, { area: 'E', pos: 6, time: 5 }, { area: 'B', pos: 4, time: 5.5 }];
const HOLDS = [{ time: 6.5, end: 7.1 }];

function scan(step) {
  const s = new TouchScanner();
  for (let tv = 4; tv < 7.5; tv += step) s.addFrame(frameAt(tv, TOUCHES, HOLDS), C, tv);
  return s.extract();
}

test('タッチ: 上下左右の三角が続く所をタッチにし、C で一面が続く所をタッチホールドにする', () => {
  const got = scan(1 / 30);
  const touch = got.filter((n) => n.kind === 'touch');
  assert.deepEqual(touch.map((n) => `${n.area}${n.pos}`), ['E4', 'E6', 'B4']);
  for (const n of touch) assert.ok(Math.abs(n.time - TOUCHES.find((t) => t.area === n.area && t.pos === n.pos).time) <= 0.05, `${n.area}${n.pos} の時刻 ${n.time}`);
  const hold = got.filter((n) => n.kind === 'touchHold');
  assert.equal(hold.length, 1);
  assert.ok(Math.abs(hold[0].time - 6.5) <= 0.05 && Math.abs(hold[0].end - 7.1) <= 0.05, `${hold[0].time}〜${hold[0].end}`);
});

test('タッチ: 何も出ていなければ拾わない', () => {
  const s = new TouchScanner();
  for (let tv = 4; tv < 6; tv += 1 / 30) s.addFrame(frameAt(tv, [], []), C, tv);
  assert.deepEqual(s.extract(), []);
});

test('タッチ: simai にすると E4/E6 や Ch[..] と書く', () => {
  const notes = [
    { kind: 'tap', pos: 1, time: 5, color: 'tap' },
    { kind: 'touch', area: 'E', pos: 4, time: 5.5 }, { kind: 'touch', area: 'E', pos: 6, time: 5.5 },
    { kind: 'touchHold', area: 'C', pos: null, time: 6, end: 6.5 },
  ];
  const { text } = toSimai(notes, 120, 5);
  assert.match(text, /E4\/E6/);
  assert.match(text, /Ch\[4:1\]/);
  const ev = buildTimeline(parse(text)).events.map((e) => `${e.kind}${e.area || ''}${e.pos || ''}`);
  assert.deepEqual(ev, ['tap1', 'touchE4', 'touchE6', 'touchHoldC']);
});
