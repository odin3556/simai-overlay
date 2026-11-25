const test = require('node:test');
const assert = require('node:assert/strict');
const { whiteMask, combineMasks, detectRing } = require('../extension/lib/detect/circle-detect.js');

// 外部出力の動画に似せたコマ: 黒地に白い判定線（細い輪）と 8 つの白い点、青い背景の丸、白いノーツ
function makeFrame(w, h, ring, notes) {
  const data = new Uint8ClampedArray(w * h * 4);
  const dots = [];
  for (let p = 0; p < 8; p++) {
    const a = ((22.5 + 45 * p) * Math.PI) / 180;
    dots.push([ring.cx + ring.r * Math.sin(a), ring.cy - ring.r * Math.cos(a)]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = Math.hypot(px - ring.cx, py - ring.cy);
      let c = [8, 8, 8];
      if (d < ring.r * 1.12) c = [20, 50, 90]; // 背景の画像（青）
      if (Math.abs(d - ring.r) < ring.width / 2) c = [240, 240, 240];
      for (const [dx, dy] of dots) if (Math.hypot(px - dx, py - dy) < ring.r * 0.025) c = [255, 255, 255];
      for (const n of notes) if (Math.hypot(px - n.x, py - n.y) < n.s) c = [250, 250, 250];
      data.set([...c, 255], (y * w + x) * 4);
    }
  }
  return data;
}

const W = 640, H = 360;
const RING = { cx: 322.3, cy: 178.6, r: 160.2, width: 2.2 };

test('円の自動検出: 1 コマから白い判定線を見つける（0.5px 以内）', () => {
  const notes = [{ x: 300, y: 120, s: 9 }, { x: 420, y: 230, s: 12 }];
  const mask = whiteMask(makeFrame(W, H, RING, notes), W, H);
  const c = detectRing(mask, W, H);
  assert.ok(c, '見つからない');
  assert.ok(Math.abs(c.cx - RING.cx) < 0.5, `cx ${c.cx}`);
  assert.ok(Math.abs(c.cy - RING.cy) < 0.5, `cy ${c.cy}`);
  assert.ok(Math.abs(c.r - RING.r) < 0.5, `r ${c.r}`);
  assert.ok(c.coverage > 0.9);
});

test('円の自動検出: 何コマか重ねると、動くノーツが消えて判定線だけ残る', () => {
  const masks = [];
  for (let i = 0; i < 5; i++) {
    const notes = [{ x: 260 + 20 * i, y: 180, s: 14 }, { x: 322, y: 60 + 25 * i, s: 14 }];
    masks.push(whiteMask(makeFrame(W, H, RING, notes), W, H));
  }
  const mask = combineMasks(masks, 0.6);
  let notePixels = 0;
  for (let i = 0; i < 5; i++) notePixels += mask[180 * W + 260 + 20 * i];
  assert.equal(notePixels, 0, 'ノーツが残っている');
  const c = detectRing(mask, W, H);
  assert.ok(c && Math.abs(c.r - RING.r) < 0.5);
});

test('円の自動検出: 輪がないコマでは null', () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([10, 10, 10, 255], i * 4);
  // 白い四角だけ
  for (let y = 100; y < 160; y++) for (let x = 200; x < 300; x++) data.set([255, 255, 255, 255], (y * W + x) * 4);
  assert.equal(detectRing(whiteMask(data, W, H), W, H), null);
});
