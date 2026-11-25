// 位置と光り方の計算を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { contentRect, circleToPx, circleFromPx, buttonPoint, touchPoint } = require('../extension/lib/geometry/geometry.js');
const { flashPhase, estimateFrame, flowRadius, tapApproach, touchApproach, touchEase } = require('../extension/lib/geometry/flash.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('設計書の計算例: 中心 (1000, 460)、半径 410 で白い点と数 px 以内', () => {
  const c = { cx: 1000, cy: 460, r: 410 };
  const seen = { 1: [1155, 80], 2: [1378, 303], 3: [1378, 617], 4: [1155, 837] };
  for (const [p, [x, y]] of Object.entries(seen)) {
    const pt = buttonPoint(c, Number(p));
    near(pt.x, x, 3, `位置${p} x`);
    near(pt.y, y, 3, `位置${p} y`);
  }
});

test('位置 1 は真上の少し右、時計回りに 2〜8', () => {
  const c = { cx: 0, cy: 0, r: 1 };
  const p1 = buttonPoint(c, 1);
  const p8 = buttonPoint(c, 8);
  assert.ok(p1.x > 0 && p1.y < 0);
  assert.ok(p8.x < 0 && p8.y < 0);
  near(p1.x, -p8.x, 1e-12, '1 と 8 は左右対称');
});

test('黒帯を除いた映像の範囲', () => {
  // 横長の枠に 16:9 → 左右に黒帯
  assert.deepEqual(contentRect({ width: 2000, height: 900 }, 1280, 720), { x: 200, y: 0, w: 1600, h: 900 });
  // 縦長の枠 → 上下に黒帯
  assert.deepEqual(contentRect({ width: 1600, height: 1000 }, 1280, 720), { x: 0, y: 50, w: 1600, h: 900 });
});

test('円の割合は、画面の大きさを変えても同じ場所を指す', () => {
  const calib = circleFromPx({ cx: 640, cy: 360, r: 300 }, 1280, 720);
  assert.deepEqual(circleToPx(calib, 1920, 1080), { cx: 960, cy: 540, r: 450 });
});

test('タッチ: C は中心、A1 はボタン 1 と同じ角度、D1 は真上', () => {
  const c = { cx: 0, cy: 0, r: 100 };
  assert.deepEqual(touchPoint(c, 'C', null), { x: 0, y: 0 });
  const a1 = touchPoint(c, 'A', 1);
  const b1 = buttonPoint(c, 1);
  near(a1.x / b1.x, 0.832, 1e-9, 'A1 は外側の輪');
  const d1 = touchPoint(c, 'D', 1);
  near(d1.x, 0, 1e-9, 'D1 x');
  near(d1.y, -88.1, 1e-9, 'D1 y');
});

// HachimiDX の 1080p の座標（中心 540,540、判定線の半径 480）と比べる
test('タッチ: 初期値の位置が HachimiDX の座標と 3px 以内', () => {
  const c = { cx: 540, cy: 540, r: 480 };
  const ref = { A1: [693, 171], A4: [692, 910], B1: [624, 336], B6: [335, 626], D1: [540, 117], D3: [963, 542], E1: [540, 229], E8: [319, 321] };
  for (const [key, [x, y]] of Object.entries(ref)) {
    const p = touchPoint(c, key[0], Number(key[1]));
    assert.ok(Math.hypot(p.x - x, p.y - y) < 3, `${key}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  }
});

test('光り方: 予告 → 本光り → 残像 → 消える', () => {
  const f = 1 / 60;
  assert.equal(flashPhase(-4 * f, f), null);
  assert.equal(flashPhase(-2 * f, f).phase, 'pre');
  assert.equal(flashPhase(-0.4 * f, f).phase, 'hit');
  assert.equal(flashPhase(0.4 * f, f).phase, 'hit');
  assert.equal(flashPhase(0.1, f).phase, 'after');
  assert.equal(flashPhase(0.25, f), null);
});

test('1 コマの長さの推定: 落ちたコマが混ざっても 60fps', () => {
  const diffs = [];
  for (let i = 0; i < 50; i++) diffs.push(i % 7 === 0 ? 2 / 60 : 1 / 60);
  near(estimateFrame(diffs, 0), 1 / 60, 1e-9, 'frame');
  assert.equal(estimateFrame([0.016], 0.5), 0.5);
});

test('流れるノーツ: 現れる輪から一定の速さで円まで進む', () => {
  const flow = { approach: 0.32, appear: 0.3 };
  assert.equal(flowRadius(0.33, flow), null);
  near(flowRadius(0.32, flow), 0.3, 1e-9, '現れた瞬間');
  near(flowRadius(0.16, flow), 0.65, 1e-9, '半分');
  assert.equal(flowRadius(0, flow), 1);
  assert.equal(flowRadius(-0.1, flow), 1);
  // 動画から測った速さ: 0.2 秒で約 0.45 半径
  near(flowRadius(0, flow) - flowRadius(0.2, flow), 0.44, 0.02, '速さ');
});

test('ハイスピ: ゲームの式で秒に直す', () => {
  near(tapApproach(6.5), 0.32, 1e-9, 'タップ 6.5 は 0.32 秒（OV3RCLOCK の動画で測った値）');
  near(tapApproach(6.25), 240 / 725, 1e-9, 'タップ 6.25');
  near(touchApproach(6.5), 240 / 550, 1e-9, 'タッチ 6.5');
  near(touchApproach(1.1), 240 / 175, 1e-9, '0.25 刻みに丸める');
  assert.equal(touchEase(0), 0.0005);
  assert.equal(touchEase(1), 1);
  assert.ok(touchEase(0.5) < 0.5, '終わり近くで速くなる');
});
