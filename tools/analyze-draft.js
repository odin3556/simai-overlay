// 下書きと答えのずれを種類ごとに数える（compare-draft.js より細かく）。
// 実行: docker compose run --rm test node tools/analyze-draft.js 下書き.simai 答え.simai
const fs = require('node:fs');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');

const TOL = 0.03;
const load = (path) => buildTimeline(parse(fs.readFileSync(path, 'utf8'))).events.filter((e) => (e.kind === 'tap' || e.kind === 'hold') && e.pos >= 1 && e.pos <= 8);
const [draftPath, refPath] = process.argv.slice(2);
const draft = load(draftPath), ref = load(refPath);

// 拍 0（first）が答えとずれていても中身を比べられるよう、一番よく重なるずれ（1 ms 刻み、±30 秒）を探して下書きを動かす
let align = { off: 0, n: -1 };
for (let ms = -30000; ms <= 30000; ms++) {
  const off = ms / 1000;
  let n = 0;
  for (const d of draft) if (ref.some((r) => r.pos === d.pos && Math.abs(r.time - d.time - off) <= 0.015)) n++;
  if (n > align.n || (n === align.n && Math.abs(off) < Math.abs(align.off))) align = { off, n };
}
if (Math.abs(align.off) > 0.03) {
  console.log(`拍 0 が答えと ${align.off.toFixed(3)} 秒（${(align.off * 205 / 60).toFixed(2)} 拍 @205）ずれていたので、合わせて比べる`);
  for (const d of draft) { d.time += align.off; if (d.endTime != null) d.endTime += align.off; }
}

// 時刻のずれの平均（同じ線で一番近いもの）
const diffs = [];
for (const d of draft) {
  const r = ref.filter((x) => x.pos === d.pos).sort((a, b) => Math.abs(a.time - d.time) - Math.abs(b.time - d.time))[0];
  if (r && Math.abs(r.time - d.time) <= TOL) diffs.push(d.time - r.time);
}
diffs.sort((a, b) => a - b);
console.log(`時刻のずれ（下書き − 答え）: 中央値 ${(diffs[diffs.length >> 1] * 1000).toFixed(1)} ms、${diffs.length} 個`);

const used = new Set();
const missed = [];
for (const r of ref) {
  const d = draft.find((x) => !used.has(x) && x.pos === r.pos && Math.abs(x.time - r.time) <= TOL);
  if (d) { used.add(d); r.got = d; } else missed.push(r);
}
const extra = draft.filter((x) => !used.has(x));
const holdAsTap = ref.filter((r) => r.got && r.kind === 'hold' && r.got.kind === 'tap').length;
const holds = ref.filter((r) => r.kind === 'hold');
console.log(`答えのホールド ${holds.length}: ホールドとして拾えた ${holds.filter((r) => r.got && r.got.kind === 'hold').length}、タップになった ${holdAsTap}`);
const tail = extra.filter((d) => ref.some((r) => r.kind === 'hold' && r.pos === d.pos && Math.abs(r.endTime - d.time) <= TOL + 0.03));
console.log(`余計 ${extra.length}: うちホールドの尾の所 ${tail.length}`);
const near = extra.filter((d) => !tail.includes(d) && ref.some((r) => r.pos === d.pos && Math.abs(r.time - d.time) <= 0.08));
console.log(`  そのほか、同じ線の答えのノーツから 0.08 秒以内 ${near.length}`);
const rest = extra.filter((d) => !tail.includes(d) && !near.includes(d));
const fmt = (e) => `${e.time.toFixed(3)}:${e.kind === 'hold' ? 'h' : ''}${e.pos}${e.isBreak ? 'b' : ''}${e.star ? '$' : ''}${e.isEx ? 'x' : ''}`;
console.log(`  残り ${rest.length}:`, rest.map(fmt).join(' '));
// 拾えなかったものを、ノーツの空白（2 秒以上何も拾っていない所）と、それ以外に分ける
const gaps = [];
for (let i = 1; i < draft.length; i++) if (draft[i].time - draft[i - 1].time > 2) gaps.push([draft[i - 1].time, draft[i].time]);
const inGap = missed.filter((r) => gaps.some(([a, b]) => r.time > a + TOL && r.time < b - TOL));
console.log(`拾えなかった ${missed.length}: 下書きが空白の所（${gaps.map(([a, b]) => `${a.toFixed(1)}〜${b.toFixed(1)} 秒`).join('、')}）${inGap.length}`);
const other = missed.filter((r) => !inGap.includes(r));
console.log(`  それ以外 ${other.length}:`, other.map(fmt).join(' '));
