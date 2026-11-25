// simai 語の譜面書式（https://w.atwiki.jp/simai/pages/1002.html ・ 509.html）の例が読めるか
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');
const S = require('../extension/lib/geometry/slide-path.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const tl = (src) => buildTimeline(parse(src));
const ok = (src) => assert.deepEqual(parse(src).warnings, [], src);

test('{#秒} の刻み', () => {
  ok('(120){#0.35}1,2,3,E');
  const e = tl('(120){#0.35}1,2,3,E').events;
  near(e[1].time, 0.35, '2 つ目');
  near(e[2].time, 0.7, '3 つ目');
  // {n} に戻すと、拍の刻みに戻る
  near(tl('(120){#0.35}1,{4}2,3,E').events[2].time, 0.35 + 0.5, '{4} に戻す');
});

test('ホールドの長さ: [#秒]・[bpm#n:m]・省略は [1280:1]', () => {
  ok('(120){4}4h[#5.678],E');
  const e = tl('(120){4}4h[#5.678],4h[150#2:1],3h,E').events;
  near(e[0].endTime - e[0].time, 5.678, '[#5.678]');
  near(e[1].endTime - e[1].time, 0.8, '[150#2:1]');
  near(e[2].endTime - e[2].time, (4 / 1280) * 0.5, '3h');
});

test('BREAK・EX の印はどの順でもよい', () => {
  for (const src of ['5hb[2:1]', '5bh[2:1]', '7bxh[2:1]', '3hx[2:1]', '5bx', '1x$', '1$b']) ok(`(120){4}${src},E`);
  const n = parse('(120){4}7bxh[2:1],E').notes[0];
  assert.equal(n.kind, 'hold');
  assert.ok(n.isBreak && n.isEx);
});

test('スライドの待ち時間と長さの書き方', () => {
  const at = (src) => tl(`(120){4}${src},E`).events.find((e) => e.kind === 'slide');
  let s = at('1-4[160#8:3]');
  near(s.slideStart, 60 / 160, '[160#8:3] の待ち'); near(s.endTime - s.slideStart, 1.5 * (60 / 160), '[160#8:3] の長さ');
  s = at('1-4[160#2]');
  near(s.slideStart, 60 / 160, '[160#2] の待ち'); near(s.endTime - s.slideStart, 2, '[160#2] の長さ');
  s = at('1-4[3##1.5]');
  near(s.slideStart, 3, '[3##1.5] の待ち'); near(s.endTime - s.slideStart, 1.5, '[3##1.5] の長さ');
  s = at('1-4[3##8:3]');
  near(s.endTime - s.slideStart, 0.75, '[3##8:3] の長さ');
  s = at('1-4[3##160#8:3]');
  near(s.slideStart, 3, '[3##160#8:3] の待ち'); near(s.endTime - s.slideStart, 1.5 * (60 / 160), '[3##160#8:3] の長さ');
  s = at('1-4[8:3]b');
  assert.ok(s.isBreak);
});

test('連結スライド: まとめて長さ / 区切りごとに長さ', () => {
  ok('(120){4}1-4q7-2[1:2],E');
  ok('(120){4}1-4[2:1]q7[2:1]-2[1:1],E');
  const s = tl('(120){4}1-4[2:1]q7[2:1]-2[1:1],E').events.find((e) => e.kind === 'slide');
  assert.equal(s.segments.length, 3);
  assert.deepEqual(s.segTimes, [1, 1, 2]);
  near(s.endTime - s.slideStart, 4, '全体');
  // 1 つ目の区切り（1 秒）が終わった所で、星は 1-4 の終わりにいる
  const lens = S.segmentLengths(s);
  near(S.progressAt(s, 1, 4), lens[0] / lens.reduce((a, b) => a + b), '1 秒後');
  // 区切りの一部にだけ長さを書くのは誤り
  assert.ok(parse('(120){4}1-4[2:1]q7-2[1:1],E').warnings.length > 0);
});

test('同始点スライドは EACH（星も軌道も黄色）', () => {
  const e = tl('(120){4}1-4[4:3]*-6[8:5],E').events;
  assert.ok(e.find((x) => x.kind === 'tap').isEach);
  assert.ok(e.filter((x) => x.kind === 'slide').every((x) => x.eachSlide));
  assert.equal(tl('(120){4}1-4[4:3],E').events[0].isEach, false);
});

test('星形: $ は回らない星、$$ は回る星、スライドの始点は回る星、@ は丸いタップ', () => {
  const head = (src) => parse(`(120){4}${src},E`).notes[0];
  assert.deepEqual([head('1$').star, head('1$').spin], [true, false]);
  assert.deepEqual([head('1$$').star, head('1$$').spin], [true, true]);
  assert.deepEqual([head('1-5[8:1]').star, head('1-5[8:1]').slideHead], [true, true]);
  assert.equal(head('1@-5[8:1]').star, false);
  assert.equal(parse('(120){4}1@-5[8:1],E').notes.length, 2);
});

test('星なしスライド ? と !', () => {
  for (const m of ['?', '!']) {
    const p = parse(`(120){4}1${m}-5[2:1],E`);
    assert.deepEqual(p.notes.map((n) => n.kind), ['slide']);
    assert.equal(p.notes[0].starMode, m);
  }
});

test('疑似 EACH: ` の後ろは 0.001 秒ずつ遅れ、EACH にならない', () => {
  const e = tl('(120){4}1`2`3/4,E').events;
  assert.deepEqual(e.map((x) => x.pos), [1, 2, 3, 4]);
  near(e[1].time, 0.001, '2'); near(e[2].time, 0.002, '3'); near(e[3].time, 0.002, '4');
  assert.deepEqual(e.map((x) => x.isEach), [false, false, true, true]);
});

test('タッチ: C = C1 = C2、花火 f、Chf[1:1] と Cfh[1:1]、E1h[4:3]', () => {
  ok('(120){4}E2,E8,E4,E6,C,C1,C2,B7f,E');
  for (const src of ['Chf[1:2]', 'Cfh[1:2]', 'Ch[4:3]', 'E1h[4:3]', 'Ch']) ok(`(120){4}${src},E`);
  const n = parse('(120){4}Chf[1:1],E').notes[0];
  assert.equal(n.kind, 'touchHold');
  assert.ok(n.firework);
  near(n.hold.beats, 4, 'Chf[1:1]');
  // タッチホールドは HOLD に数える
  assert.deepEqual(parse('(120){4}Ch[1:1],B1,E').counts, { total: 2, tap: 0, hold: 1, slide: 0, touch: 1, break: 0 });
});

test('TAP 同士の EACH は 12 と書ける', () => {
  const e = tl('(120){4}12,E').events;
  assert.ok(e.every((x) => x.isEach));
});

test('下書き（OV3RCLOCK EXPERT の $ 付き）が警告なしで読める', () => {
  ok('(118){8}2$,7$,{24}3b/7bh[48:13],1b/8b,{8},3bh[16:1]/6bh[16:1],E');
});
