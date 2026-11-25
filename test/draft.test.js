const test = require('node:test');
const assert = require('node:assert/strict');
const { LaneScanner } = require('../extension/lib/detect/first-detect.js');
const { extractNotes, toSimai, classify } = require('../extension/lib/detect/draft.js');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');
const G = require('../extension/lib/geometry/geometry.js');
const { flowRadius } = require('../extension/lib/geometry/flash.js');

// 動画のコマに似せた画像: BPM 120（1 拍 0.5 秒）、拍 0 が動画の 5 秒
const W = 320, H = 240;
const C = { cx: 160, cy: 120, r: 106 };
const FLOW = { approach: 0.32, appear: 0.25 };
const FRAME = 1 / 60;
const FIRST = 5, BEAT = 0.5;
const RGB = { tap: [255, 90, 170], each: [255, 215, 60], star: [70, 190, 255], break: [255, 130, 30] };

// 譜面: 拍 0 に 1・8 の同時押し、拍 1 に 3 の BREAK、拍 1.5 に 5 の星、拍 2 から 1 拍 2 のホールド、拍 3.25 に 7、
// それと、線 4 にかぶさるスライドの軌道（青い帯、動かない）
const NOTES = [
  { pos: 1, beat: 0, color: 'each' }, { pos: 8, beat: 0, color: 'each' },
  { pos: 3, beat: 1, color: 'break' }, { pos: 5, beat: 1.5, color: 'star' },
  { pos: 2, beat: 2, len: 1, color: 'tap' }, { pos: 7, beat: 3.25, color: 'tap' },
];

function frameAt(tv) {
  const data = new Uint8ClampedArray(W * H * 4);
  const size = C.r * 0.075;
  const shapes = [];
  for (const n of NOTES) {
    const hit = FIRST + n.beat * BEAT;
    const end = hit + (n.len || 0) * BEAT;
    if (tv > end) continue;
    const head = flowRadius(Math.max(0, hit - tv), FLOW);
    if (head == null) continue;
    const deg = G.buttonAngle(n.pos);
    if (n.len) {
      const tk = flowRadius(end - tv, FLOW);
      // 動画のホールドの六角形のように、頭はノーツの位置より前（外）へ、尾は後ろ（中心寄り）へ出す
      shapes.push({ band: true, deg, r1: tk == null ? C.r * FLOW.appear : C.r * tk - size * 1.3, r2: C.r * head + size * 1.3, rgb: RGB[n.color] });
    } else if (hit >= tv) {
      shapes.push({ pt: G.polar(C, deg, C.r * head), rgb: RGB[n.color] });
    }
  }
  const lane4 = G.buttonAngle(4) * Math.PI / 180;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = [5, 5, 5];
      const dx = x - C.cx, dy = y - C.cy;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - C.r) < 1.2) c = [240, 240, 240];
      // スライドの軌道: 線 4 に沿った青い帯
      const along = dx * Math.sin(lane4) - dy * Math.cos(lane4);
      const across = dx * Math.cos(lane4) + dy * Math.sin(lane4);
      if (along > C.r * 0.3 && along < C.r * 0.95 && Math.abs(across) < size * 1.1) c = RGB.star;
      for (const s of shapes) {
        if (s.band) {
          const a = s.deg * Math.PI / 180;
          const al = dx * Math.sin(a) - dy * Math.cos(a);
          const ac = dx * Math.cos(a) + dy * Math.sin(a);
          if (al > s.r1 && al < s.r2 && Math.abs(ac) < size * 1.1) c = s.rgb;
        } else if (Math.abs(Math.hypot(x - s.pt.x, y - s.pt.y) - size) < 2) c = s.rgb;
      }
      data.set([...c, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H };
}

function scan(step) {
  const s = new LaneScanner();
  for (let v = 4.5; v < 7.3; v += step) s.addFrame(frameAt(v), C, v, FLOW);
  return s;
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} と ${b}`);

test('下書き: 色から種類を見分ける', () => {
  const c = (rgb) => classify({ r: rgb[0], g: rgb[1], b: rgb[2] });
  assert.equal(c(RGB.tap), 'tap');
  assert.equal(c(RGB.each), 'each');
  assert.equal(c(RGB.star), 'star');
  assert.equal(c(RGB.break), 'break');
  assert.equal(classify(null), 'tap');
});

test('下書き: ノーツを拾い、タップ・ホールド・星・BREAK を見分け、青い軌道は捨てる', () => {
  const notes = extractNotes(scan(FRAME));
  const got = notes.map((n) => `${n.pos}${n.kind === 'hold' ? 'h' : ''}:${n.color}`);
  assert.deepEqual(got, ['1:each', '8:each', '3:break', '5:star', '2h:tap', '7:tap']);
  near(notes[0].time, FIRST, FRAME, '1 の時刻');
  const hold = notes.find((n) => n.kind === 'hold');
  near(hold.time, FIRST + 2 * BEAT, 2 * FRAME, 'ホールドの頭');
  near(hold.end, FIRST + 3 * BEAT, 3 * FRAME, 'ホールドの尾');
});

test('下書き: simai にすると、拍の位置と長さが元の譜面と同じになる', () => {
  const { text, count } = toSimai(extractNotes(scan(FRAME)), 120, FIRST);
  assert.equal(count, 6);
  const tl = buildTimeline(parse(text));
  const got = tl.events.map((e) => `${e.kind}${e.pos}@${(e.time / BEAT).toFixed(2)}${e.kind === 'hold' ? `~${((e.endTime - e.time) / BEAT).toFixed(2)}` : ''}${e.isBreak ? 'b' : ''}${e.star ? '$' : ''}`);
  assert.deepEqual(got, ['tap1@0.00', 'tap8@0.00', 'tap3@1.00b', 'tap5@1.50$', 'hold2@2.00~1.00', 'tap7@3.25'], text);
});

test('下書き: コマが飛んでも（3 コマに 1 つ）同じ simai になる', () => {
  const a = toSimai(extractNotes(scan(FRAME)), 120, FIRST).text;
  const b = toSimai(extractNotes(scan(3 * FRAME)), 120, FIRST).text;
  assert.equal(b, a);
});

// チエルカ／エソテリカ EXPERT（205 BPM）。動画から作った下書きは、拾った時刻が first から約 20 ms 早く、
// 1/12 拍（24 ms）で丸めると同時押しや 8 分が 1/48 ずつ離れて書かれていた
test('下書き: 拾った時刻がまとめてずれていても、拍の格子に合わせて書く（205 BPM）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ref = buildTimeline(parse(fs.readFileSync(path.join(__dirname, 'fixtures/answer_205_expert.simai'), 'utf8')))
    .events.filter((e) => e.kind === 'tap' && e.pos >= 1 && e.pos <= 8);
  const first = 3;
  let seed = 1;
  const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01; // ±5 ms
  const notes = ref.map((e) => ({ pos: e.pos, time: first + e.time - 0.02 + jitter(), kind: 'tap', color: 'tap' }));
  const { text, shift } = toSimai(notes, 205, first);
  near(shift, -0.02, 0.004, 'ずれ');
  const got = buildTimeline(parse(text)).events;
  assert.equal(got.length, ref.length);
  let off = 0;
  for (const e of got) if (!ref.some((r) => r.pos === e.pos && Math.abs(r.time - e.time) < 0.005)) off++;
  assert.equal(off, 0, '答えと同じ拍に乗らなかったノーツの数');
});

// チエルカ／エソテリカ: 曲が始まる 8.5 秒前（タイトル画面）に 1 つ拾い、それを拍 0 にして全体の丸めがずれた
test('下書き: 曲の前と後にぽつんと拾ったノーツは捨て、続くノーツはそのまま', () => {
  const { dropStrays } = require('../extension/lib/detect/draft.js');
  const tap = (pos, time) => ({ pos, time, kind: 'tap', color: 'tap' });
  const song = [tap(2, 10.38), tap(8, 10.38), tap(7, 10.53), tap(7, 10.67), tap(5, 10.82), tap(6, 11.11)];
  const r = dropStrays([tap(3, 1.86), ...song, tap(3, 16.2)]);
  assert.equal(r.dropped, 1);
  assert.equal(r.droppedEnd, 1);
  assert.deepEqual(r.notes, song);
  assert.equal(dropStrays(song).dropped + dropStrays(song).droppedEnd, 0, '続いているときは捨てない');
  const few = [tap(1, 1), tap(2, 5)];
  assert.deepEqual(dropStrays(few), { notes: few, dropped: 0, droppedEnd: 0 }, 'どこにも続かないときは何も捨てない');
});

// 曲の情報に BPM がないとき（魔法仕掛けのファンタジアは OTOGE DB で空欄だった）は、拾ったノーツの時刻から推定する
test('下書き: ノーツの時刻から BPM を推定する（8 分ばかりでも半分の BPM にしない）', () => {
  const { estimateBpm } = require('../extension/lib/detect/draft.js');
  const fs = require('node:fs');
  const path = require('node:path');
  const ev = buildTimeline(parse(fs.readFileSync(path.join(__dirname, 'fixtures/answer_205_expert.simai'), 'utf8'))).events.filter((e) => e.kind !== 'slide');
  let seed = 11;
  const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.016; // ±8 ms
  const notes = ev.map((e) => ({ time: 3.7 + e.time + jitter() }));
  assert.equal(estimateBpm(notes).bpm, 205);
  assert.equal(estimateBpm(notes.slice(0, 5)), null, 'ノーツが少なければ推定しない');
});
