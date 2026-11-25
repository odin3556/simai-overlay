// 下書きの simai と、元の譜面の simai を比べる（どちらも拍 0 が同じ動画の時刻であること）。
// 実行: docker compose run --rm test node tools/compare-draft.js .check/draft.simai test/fixtures/ov3rclock_14plus.simai
// 比べるのは、下書きの最後のノーツまでの、タップ・ホールド（星・BREAK の印も見る）。スライドの軌道とタッチは数えない。
const fs = require('node:fs');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');

const TOL = 0.03; // 秒。これ以内なら同じノーツ
const [draftPath, refPath] = process.argv.slice(2);
const notes = (path) => buildTimeline(parse(fs.readFileSync(path, 'utf8'))).events.filter((e) => (e.kind === 'tap' || e.kind === 'hold') && e.pos >= 1 && e.pos <= 8);
const draft = notes(draftPath);
const until = draft.length ? draft[draft.length - 1].time + TOL : 0;
const ref = notes(refPath).filter((e) => e.time <= until);

const used = new Set();
let found = 0, kind = 0, brk = 0, star = 0, holdLen = 0, holds = 0;
const missed = [];
for (const r of ref) {
  const d = draft.find((x) => !used.has(x) && x.pos === r.pos && Math.abs(x.time - r.time) <= TOL);
  if (!d) { missed.push(r); continue; }
  used.add(d);
  found++;
  if (d.kind === r.kind) kind++;
  if (d.isBreak === r.isBreak) brk++;
  if (!!d.star === !!r.star) star++;
  if (r.kind === 'hold' && d.kind === 'hold') {
    holds++;
    if (Math.abs((d.endTime - d.time) - (r.endTime - r.time)) <= 0.06) holdLen++;
  }
}
const extra = draft.filter((x) => !used.has(x));
const pct = (a, b) => `${a} / ${b}（${b ? Math.round((100 * a) / b) : 0}%）`;
console.log(`比べた範囲: 0〜${until.toFixed(2)} 秒（拍 0 から）`);
console.log(`元の譜面のノーツを拾えた: ${pct(found, ref.length)}`);
console.log(`余計に拾った: ${extra.length}`);
console.log(`拾えたもののうち、タップ / ホールドが合う: ${pct(kind, found)}、BREAK が合う: ${pct(brk, found)}、星が合う: ${pct(star, found)}、ホールドの長さが合う: ${pct(holdLen, holds)}`);
const fmt = (e) => `${e.time.toFixed(3)}秒 ${e.kind}${e.pos}${e.isBreak ? 'b' : ''}${e.star ? '$' : ''}`;
console.log('拾えなかった（最初の 15）:', missed.slice(0, 15).map(fmt).join(', '));
console.log('余計（最初の 15）:', extra.slice(0, 15).map(fmt).join(', '));
