const test = require('node:test');
const assert = require('node:assert/strict');
const { SlideScanner, durationText, attachSlides } = require('../extension/lib/detect/slide-detect.js');
const SL = require('../extension/lib/geometry/slide-path.js');

// 動画のコマに似せた画像: 白い判定線と、水色の矢印の帯（スライドの軌道）。
// 帯は叩く時刻 HIT の 0.3 秒前から出て、1 拍待ってから、星が通り過ぎた所から消えていく
const W = 320, H = 240;
const C = { cx: 160, cy: 120, r: 106 };
const BEAT = 0.5; // BPM 120
const HIT = 5;
const CYAN = [60, 210, 220];

function frameAt(tv, slides) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([5, 5, 5, 255], i * 4);
  const put = (x, y, rgb) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < H) data.set([...rgb, 255], (yi * W + xi) * 4);
  };
  // 判定線
  for (let a = 0; a < 360; a += 0.25) put(C.cx + C.r * Math.sin((a * Math.PI) / 180), C.cy - C.r * Math.cos((a * Math.PI) / 180), [240, 240, 240]);
  for (const s of slides) {
    if (tv < HIT - 0.3) continue;
    const path = SL.slidePaths({ start: s.start, segments: [{ shape: s.shape, points: [s.end] }] })[0];
    const from = Math.max(0, (tv - HIT - BEAT) / (s.beats * BEAT)); // ここより手前は星が通り過ぎて消えた
    if (from >= 1) continue;
    for (let f = from; f <= 1; f += 0.002) {
      const q = SL.pointAt(path, f);
      const rr = Math.min(0.96, Math.hypot(q.x, q.y)) / (Math.hypot(q.x, q.y) || 1);
      for (let w = -5; w <= 5; w++) {
        const nx = -Math.sin(q.dir), ny = Math.cos(q.dir);
        put(C.cx + C.r * q.x * rr + nx * w, C.cy + C.r * q.y * rr + ny * w, CYAN);
      }
    }
  }
  return { data, width: W, height: H };
}

function scan(slides) {
  const s = new SlideScanner();
  for (let tv = HIT - 0.4; tv < HIT + 3; tv += 1 / 30) s.addFrame(frameAt(tv, slides), C, tv);
  return s;
}

test('スライド: まっすぐ 1-5 を 1/2 拍で流れる軌道を当てる', () => {
  const r = scan([{ start: 1, shape: '-', end: 5, beats: 0.5 }]).detect(1, HIT, BEAT);
  assert.deepEqual([r.shape, r.end, r.beats], ['-', 5, 0.5]);
});

test('スライド: 外周を回る 8<5 を 1 拍で流れる軌道を当てる（判定線の白には惑わされない）', () => {
  const r = scan([{ start: 8, shape: '<', end: 5, beats: 1 }]).detect(8, HIT, BEAT);
  assert.deepEqual([r.shape, r.end, r.beats], ['<', 5, 1]);
});

test('スライド: 軌道が出ていなければ null', () => {
  assert.equal(scan([]).detect(3, HIT, BEAT), null);
});

test('スライド: 長さの書き方と、下書きの星に付ける', () => {
  assert.equal(durationText(1), '[4:1]');
  assert.equal(durationText(0.5), '[8:1]');
  assert.equal(durationText(3), '[4:3]');
  assert.equal(durationText(1.5), '[8:3]');
  const notes = [{ pos: 1, time: HIT, kind: 'tap', color: 'star' }, { pos: 3, time: HIT, kind: 'tap', color: 'tap' }];
  assert.equal(attachSlides(notes, scan([{ start: 1, shape: '-', end: 5, beats: 0.5 }]), BEAT), 1);
  assert.equal(notes[0].slide.text, '-5[8:1]');
  assert.equal(notes[1].slide, undefined, 'ふつうのタップには付けない');
});
