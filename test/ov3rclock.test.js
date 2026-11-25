// T1（ノーツ数）と T2（時刻の計算）を OV3RCLOCK 14+ で確かめる。
// 実行: docker compose run --rm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline, beatToSec, positionAt } = require('../extension/lib/simai/timing.js');

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'ov3rclock_14plus.simai'), 'utf8');
const parsed = parse(text);

test('T1: 公式のノーツ数と一致する', () => {
  assert.deepEqual(parsed.counts, { total: 927, tap: 685, hold: 40, slide: 91, touch: 24, break: 87 });
});

test('未対応の記法の警告が出ない', () => {
  assert.deepEqual(parsed.warnings, []);
});

test('T2: 終わりの E は 272 拍目（69 小節目の頭）・約 138.3 秒', () => {
  // 設計書の「69 小節（276 拍）・約 140.3 秒」は、69 小節目を丸ごと数えた値。
  // E は 69 小節目の頭にあるので、譜面の長さは 272 拍になる。
  const tl = buildTimeline(parsed);
  assert.equal(parsed.endBeat, 272);
  assert.ok(Math.abs(tl.endTime - (272 * 60) / 118) < 0.001);
  // 最後のノーツ（{96}6b,5b,4b,3b）は 64 小節目。そのあと {2},{1},,,, の休みが約 18 拍続く
  assert.equal(parsed.notes[parsed.notes.length - 1].measure, 64);
});

test('T2: 先頭の数個を手計算と比べる（差 1 ミリ秒以内）', () => {
  const tl = buildTimeline(parsed);
  const beat = 60 / 118; // 1 拍の秒
  const step = beat / 6; // {24} のカンマ 1 つ
  // {24}18,,,24,,24,,,6,57,,,1-5[8:1]/8-4[8:1]
  const expect = [
    [0, 1], [0, 8],
    [3 * step, 2], [3 * step, 4],
    [5 * step, 2], [5 * step, 4],
    [8 * step, 6],
    [9 * step, 5], [9 * step, 7],
  ];
  const taps = tl.events.filter((e) => e.kind === 'tap').slice(0, expect.length);
  taps.forEach((e, i) => {
    assert.equal(e.pos, expect[i][1]);
    assert.ok(Math.abs(e.time - expect[i][0]) < 0.001, `${i}: ${e.time} vs ${expect[i][0]}`);
  });
});

test('ホールドの長さ [n:m] = m×4÷n 拍', () => {
  const tl = buildTimeline(parsed);
  const h = tl.events.find((e) => e.kind === 'hold'); // 7hx[2:1]
  assert.equal(h.pos, 7);
  assert.equal(h.isEx, true);
  assert.ok(Math.abs(h.endTime - h.time - 2 * (60 / 118)) < 1e-9);
});

test('同じ始点のスライド 2 本は、星 1 つと軌道 2 つ', () => {
  const p = parse('(120){4}1^4[8:1]*-5[8:1],E');
  assert.deepEqual(p.counts, { total: 3, tap: 1, hold: 0, slide: 2, touch: 0, break: 0 });
});

test('BREAK は星か軌道の片方に付く', () => {
  assert.deepEqual(parse('(120){4}2b-6[12:1],E').counts, { total: 2, tap: 0, hold: 0, slide: 1, touch: 0, break: 1 });
  assert.deepEqual(parse('(120){4}8p3[4:1]b,E').counts, { total: 2, tap: 1, hold: 0, slide: 0, touch: 0, break: 1 });
});

test('タッチの E3 と終わりの E を区別する', () => {
  const p = parse('(120){8}E3,E1,E,1');
  assert.equal(p.counts.touch, 2);
  assert.equal(p.endBeat, 1);
});

test('途中の BPM 変更', () => {
  const p = parse('(120){4}1,2,(60)3,4,E');
  const tl = buildTimeline(p);
  assert.deepEqual(tl.events.map((e) => e.time), [0, 0.5, 1, 2]);
  assert.equal(beatToSec(tl.tempoMap, 4), 3);
  assert.deepEqual(positionAt(tl.tempoMap, 2), { beat: 3, measure: 1, beatInMeasure: 3 });
});

test('未対応の記法は警告を出す', () => {
  const p = parse('(120){4}1h[2],2-5[4],E');
  assert.equal(p.warnings.length, 2);
});

test('同時押し: 同じ時刻に軌道以外のノーツが 2 つ以上', () => {
  const tl = buildTimeline(parse('(120){4}18,3,4/5-1[4:1],A1/6,E'));
  const each = tl.events.map((e) => `${e.kind}${e.pos ?? e.start}:${e.isEach}`);
  assert.deepEqual(each, ['tap1:true', 'tap8:true', 'tap3:false', 'tap4:true', 'tap5:true', 'slide5:false', 'touch1:true', 'tap6:true']);
});
