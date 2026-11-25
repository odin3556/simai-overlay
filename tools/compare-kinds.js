// 下書きと答えを、ノーツの種類ごとに時刻で比べる。拍 0 のずれは自動で合わせる（ボタンのノーツで一番よく重なるずれ）。
// 実行: docker compose run --rm test node tools/compare-kinds.js 下書き.simai 答え.simai
const fs = require('node:fs');
const { parse } = require('../extension/lib/simai/parse.js');
const { buildTimeline } = require('../extension/lib/simai/timing.js');

const load = (f) => buildTimeline(parse(fs.readFileSync(f, 'utf8'))).events;
const [dp, rp] = process.argv.slice(2);
const d = load(dp), r = load(rp);
const key = (e) => (e.kind === 'touch' || e.kind === 'touchHold' ? e.area + (e.pos || '') : String(e.pos ?? e.start));
const btn = (e) => (e.kind === 'tap' || e.kind === 'hold') && e.pos >= 1 && e.pos <= 8;

// 線ごとに 10 ms のマスへ入れておき、ずれを 2 ms 刻みで探す
const grid = new Set();
for (const x of r.filter(btn)) for (let k = -2; k <= 2; k++) grid.add(x.pos * 1e7 + Math.round(x.time * 100) + k);
let best = { off: 0, n: -1 };
for (let ms = -30000; ms <= 30000; ms += 2) {
  let n = 0;
  for (const e of d) if (btn(e) && grid.has(e.pos * 1e7 + Math.round((e.time + ms / 1000) * 100))) n++;
  if (n > best.n) best = { off: ms / 1000, n };
}
console.log(`拍 0 のずれ ${best.off} 秒（合わせて比べる）`);
for (const e of d) { e.time += best.off; if (e.endTime != null) e.endTime += best.off; }

function cmp(name, tol, f) {
  const a = r.filter(f), b = d.filter(f), used = new Set();
  let ok = 0;
  for (const x of a) {
    const m = b.find((e) => !used.has(e) && key(e) === key(x) && Math.abs(e.time - x.time) <= tol);
    if (m) { used.add(m); ok++; }
  }
  console.log(`${name}: 答え ${a.length}・拾えた ${ok}（${a.length ? Math.round((100 * ok) / a.length) : 0}%）・下書き ${b.length}・余計 ${b.length - ok}`);
}
cmp('タップ・ホールド（ボタン）', 0.03, btn);
cmp('  うちホールド', 0.03, (e) => btn(e) && e.kind === 'hold');
cmp('  うち BREAK', 0.03, (e) => btn(e) && e.isBreak);
cmp('タッチ', 0.05, (e) => e.kind === 'touch');
cmp('タッチホールド', 0.06, (e) => e.kind === 'touchHold');
cmp('スライド（始点と時刻）', 0.03, (e) => e.kind === 'slide');
const sl = r.filter((e) => e.kind === 'slide'), ds = d.filter((e) => e.kind === 'slide');
let same = 0;
for (const x of sl) {
  const m = ds.find((e) => e.start === x.start && Math.abs(e.time - x.time) <= 0.03);
  if (m && m.end === x.end && m.segments.map((s) => s.shape).join() === x.segments.map((s) => s.shape).join()) same++;
}
console.log(`スライドの形と終点まで一致: ${same} / ${sl.length}`);
console.log(`答えの EX ${r.filter((e) => btn(e) && e.isEx).length}（下書きは EX を書かない）`);
