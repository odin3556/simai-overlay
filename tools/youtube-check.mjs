// Docker の中の Chromium にこの拡張機能を読み込み、YouTube で動かしてスクリーンショットを撮る。
// 実行: docker compose run --rm youtube-check
// 環境変数:
//   CALIB="cx,cy,r"  … 層に対する割合でクリックする円（cx は幅、cy と r は高さに対する割合）
//   SEEK=20          … 止めておく再生位置（秒）
//   FIRST=6.1        … 最初のノーツが円に着く再生位置（秒）。そこで「いまが最初のノーツ」を押す
//   SHOTS="10,10.5"  … 追加で撮る再生位置（秒）。映像部分だけを撮る
//   CHECK=8          … 「再生して確かめる」で何秒再生するか。重なりの結果を出す
//   AUTO=1           … 手で合わせず、円の自動検出を確かめる（止めたコマと再生中の両方）
//   FIND=1           … 「再生して自動で探す」で first を探す（FIRST の代わり）
//   SONG=1           … ①「動画のタイトルから」と「探す」を確かめる（OTOGE DB から読む）
//   DRAFT=20         … 「再生して下書きを作る」（BPM は BPM）を 20 秒動かし、下書きを .check/draft.simai に書く
//   VIDEO=https://…  … 動かす動画（なければ OV3RCLOCK 14+）
//   SIMAI=test/fixtures/….simai … 読み込む譜面（なければ OV3RCLOCK 14+）
//   BPM=118          … 下書きの BPM
//   DRAFT_FROM=60    … 下書きを動画のこの秒から作る
import { chromium } from 'playwright';
import fs from 'node:fs';

const REPO = '/repo';
const EXT = `${REPO}/extension`;
const OUT = '/out';
const VIDEO = process.env.VIDEO || 'https://www.youtube.com/watch?v=VjAMhNeq0Nk';
const SIMAI = process.env.SIMAI || 'test/fixtures/ov3rclock_14plus.simai';
const BPM = process.env.BPM || '118';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[check]', ...a);

const ctx = await chromium.launchPersistentContext('/tmp/profile', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1600, height: 900 },
  locale: 'ja-JP',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
log('拡張機能を読み込みました', sw.url());

const page = ctx.pages()[0] || (await ctx.newPage());
page.on('console', (m) => { if (m.type() === 'error') log('console error:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => log('page error:', e.message));
await page.goto(VIDEO, { waitUntil: 'domcontentloaded' });

// 同意画面が出たら「すべて拒否」
for (const label of ['すべて拒否', 'Reject all']) {
  const b = page.getByRole('button', { name: label });
  if (await b.count()) { await b.first().click(); log('同意画面を拒否しました'); break; }
}

await page.waitForSelector('#movie_player video', { timeout: 30000 });
for (let i = 0; i < 120; i++) {
  const ad = await page.evaluate(() => document.querySelector('#movie_player')?.classList.contains('ad-showing'));
  if (!ad) break;
  if (i === 0) log('広告中…');
  const skip = page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern');
  if (await skip.count()) await skip.first().click().catch(() => {});
  await sleep(1000);
}
const info = await page.evaluate(() => {
  const v = document.querySelector('#movie_player video');
  return { title: document.title, duration: v.duration, w: v.videoWidth, h: v.videoHeight };
});
log('動画', JSON.stringify(info));

const seek = Number(process.env.SEEK || 20);
async function waitAd() {
  for (let i = 0; i < 120; i++) {
    const ad = await page.evaluate(() => document.querySelector('#movie_player')?.classList.contains('ad-showing'));
    if (!ad) return;
    if (i === 0) log('広告中…');
    const skip = page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern');
    if (await skip.count()) await skip.first().click().catch(() => {});
    await sleep(1000);
  }
}

async function seekTo(t) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitAd();
    // 途中で広告が入ると seeked が来ないので、10 秒で諦めてやり直す
    const ok = await page.evaluate((t) => {
      const v = document.querySelector('#movie_player video');
      v.pause();
      return new Promise((r) => {
        v.addEventListener('seeked', () => r(true), { once: true });
        v.currentTime = t;
        setTimeout(() => r(false), 10000);
      });
    }, t);
    await sleep(800);
    const now = await page.evaluate(() => document.querySelector('#movie_player video').currentTime);
    if (ok && Math.abs(now - t) < 0.05) return;
    log(`シークをやり直します（${t} 秒、いま ${now.toFixed(3)} 秒）`);
  }
}
await seekTo(seek);

// アイコンを押したのと同じ: background から toggle を送る
await sw.evaluate(async () => {
  // tabs 権限がないので URL では探せない。全部のタブに送り、届かないタブは無視する
  for (const t of await chrome.tabs.query({})) await chrome.tabs.sendMessage(t.id, { type: 'toggle' }).catch(() => {});
});
await page.waitForSelector('.simai-panel', { timeout: 5000 });
log('層とパネルが出ました');

await page.fill('.simai-p-text', fs.readFileSync(`${REPO}/${SIMAI}`, 'utf8'));
await page.getByRole('button', { name: '読み込む' }).click();
log('数の表示:', await page.locator('.simai-p-counts:not(.simai-p-song-info)').innerText());
log('警告:', JSON.stringify(await page.locator('.simai-p-warn li').allInnerTexts()));

if (process.env.SONG) {
  // ①「動画のタイトルから」で曲を選び、出た曲の情報と ⑥ の BPM を読む（OTOGE DB から読む）
  await page.getByRole('button', { name: '動画のタイトルから' }).click();
  for (let i = 0; i < 30 && !(await page.locator('.simai-p-song-info').innerText()); i++) await sleep(500);
  log('曲:', (await page.locator('.simai-p-song-info').innerText()).replace(/\n/g, ' ｜ '));
  log('曲の知らせ:', await page.locator('.simai-p-song-status').innerText());
  log('BPM の欄:', await page.locator('.simai-panel input[placeholder="空なら自動"]').inputValue());
  await page.getByPlaceholder('曲名・読み・アーティスト').fill('clock');
  await page.getByRole('button', { name: '探す', exact: true }).click();
  await sleep(1000);
  log('「clock」で探した:', await page.locator('.simai-p-song-status').innerText(), '/', (await page.locator('.simai-panel select').first().locator('option').allInnerTexts()).slice(0, 5).join(' ; '));
  await page.locator('.simai-panel').screenshot({ path: `${OUT}/0-song.png` });
  // 下書きなどで使うので、動画の曲に選び直す
  await page.getByRole('button', { name: '動画のタイトルから' }).click();
  await sleep(500);
}

const layer = page.locator('canvas.simai-overlay-layer');
const box = await layer.boundingBox();
log('層の位置と大きさ', JSON.stringify(box));

async function circleStatus() {
  for (let i = 0; i < 40; i++) {
    const s = await page.locator('.simai-p-calib-status').innerText();
    if (s && !s.includes('探しています')) return s;
    await sleep(500);
  }
  return '(時間切れ)';
}

if (process.env.AUTO) {
  // 新しい動画なので、開いたときに自動で探している（止まったコマ 1 枚で）
  log('自動検出（止めたコマ）:', await circleStatus());
  await page.screenshot({ path: `${OUT}/2-auto-paused.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  // 再生しながら「自動で探す」（何コマか重ねる）
  await page.evaluate(() => document.querySelector('#movie_player video').play());
  await sleep(1500);
  await page.getByRole('button', { name: '自動で探す', exact: true }).click();
  await sleep(300);
  log('自動検出（再生中）:', await circleStatus());
  await page.evaluate(() => document.querySelector('#movie_player video').pause());
  await page.screenshot({ path: `${OUT}/2-auto-playing.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
} else {
  const [cx, cy, r] = (process.env.CALIB || '0.5,0.5,0.4').split(',').map(Number);
  await page.getByRole('button', { name: '手で合わせる' }).click();
  await page.mouse.click(box.x + cx * box.width, box.y + cy * box.height);
  await page.mouse.click(box.x + cx * box.width, box.y + (cy - r) * box.height);
  await sleep(300);
  await page.screenshot({ path: `${OUT}/1-calib.png` });
  await page.keyboard.press('Enter');
  log('位置合わせ:', await page.evaluate(() => 'ok'));
}

if (process.env.FIRST || process.env.SHOTS || process.env.FIND || process.env.DRAFT) {
  if (process.env.FIND) {
    // 「再生して自動で探す」を押し、ボタンが元に戻る（探し終える）まで待つ
    await page.evaluate(() => document.documentElement.setAttribute('data-simai-debug', ''));
    await page.getByRole('button', { name: '▶ 再生して自動で探す' }).click();
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      if (await page.getByRole('button', { name: '▶ 再生して自動で探す' }).count()) break;
    }
    log('自動で探した結果:', await page.locator('.simai-p-first-status').innerText());
    log('first:', await page.locator('.simai-p-mono').first().innerText());
    log('くわしく:', await page.evaluate(() => document.documentElement.getAttribute('data-simai-find')));
  } else if (process.env.FIRST) {
    // パネルの「いまが最初のノーツ」は、その時点の再生位置を使う。ここでは FIRST に合わせて止めて押す
    await seekTo(Number(process.env.FIRST));
    await page.getByRole('button', { name: 'いまが最初のノーツ' }).click();
    log('first:', await page.locator('.simai-p-mono').first().innerText());
  }
  // 円と点のガイドを消す（「細かい設定」の中にあって見えないので、直接外す）
  await page.evaluate(() => {
    const box = [...document.querySelectorAll('.simai-panel label')].find((l) => l.textContent.includes('円と点のガイド'))?.querySelector('input');
    if (box && box.checked) { box.checked = false; box.dispatchEvent(new Event('change')); }
  });
  if (process.env.CHECK) {
    // 「再生して確かめる」を押して CHECK 秒再生し、結果を読む
    await page.evaluate(() => document.documentElement.setAttribute('data-simai-debug', ''));
    await page.getByRole('button', { name: '▶ 再生して確かめる' }).click();
    const secs = Number(process.env.CHECK);
    for (let i = 1; i <= secs; i++) {
      await sleep(1000);
      if (i === Math.ceil(secs / 2)) await page.screenshot({ path: `${OUT}/3-check.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    }
    await page.getByRole('button', { name: '■ 止める' }).click();
    await sleep(300);
    log('重なり:', await page.locator('.simai-p-score').innerText(), '/', await page.locator('.simai-p-advice').innerText());
    const dbg = await page.evaluate(() => document.documentElement.getAttribute('data-simai-debug'));
    if (dbg) fs.writeFileSync(`${OUT}/check-debug.json`, dbg);
  }
  if (process.env.DRAFT) {
    // 「再生して下書きを作る」を BPM で押し、DRAFT 秒たったら止めて、下書きを .check/draft.simai に書く
    await page.evaluate(() => document.documentElement.setAttribute('data-simai-debug', ''));
    await page.locator('.simai-panel input[placeholder="空なら自動"]').fill(BPM);
    await page.getByRole('button', { name: '▶ 再生して下書きを作る' }).click();
    // DRAFT_RATE=0.25 などで再生を遅くする（Docker の中の Chromium は重く、1 秒に 10 コマほどしか数えられないため）
    // DRAFT_FROM=60 … 動画の 60 秒から下書きを作る（途中の区間だけを調べるとき）
    if (process.env.DRAFT_FROM) { await sleep(500); await page.evaluate((t) => { document.querySelector('#movie_player video').currentTime = t; }, Number(process.env.DRAFT_FROM)); }
    if (process.env.DRAFT_RATE) await page.evaluate((r) => { document.querySelector('#movie_player video').playbackRate = r; }, Number(process.env.DRAFT_RATE));
    await sleep(Number(process.env.DRAFT) * 1000);
    await page.getByRole('button', { name: '■ 止めて下書きにする' }).click();
    await sleep(1000);
    log('下書き:', await page.locator('.simai-p-draft-status').innerText());
    const dbg = JSON.parse((await page.evaluate(() => document.documentElement.getAttribute('data-simai-draft'))) || '{}');
    log('コマ', dbg.frames, '使った', dbg.used, '明るくて捨てた', dbg.skipped, 'ずれ', dbg.shift);
    if (dbg.text) fs.writeFileSync(`${OUT}/draft.simai`, dbg.text);
  }
  // DUMP="10,10.5" … 動画のコマそのもの（層なし、動画の大きさ）を .check/f-10.000.png に書く
  for (const t of (process.env.DUMP || '').split(',').filter(Boolean).map(Number)) {
    await seekTo(t);
    const url = await page.evaluate(() => {
      const v = document.querySelector('#movie_player video');
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return c.toDataURL('image/png');
    });
    fs.writeFileSync(`${OUT}/f-${t.toFixed(3)}.png`, Buffer.from(url.split(',')[1], 'base64'));
    log(`コマ ${t} 秒`);
  }
  for (const t of (process.env.SHOTS || '').split(',').filter(Boolean).map(Number)) {
    await seekTo(t);
    const pos = await page.locator('.simai-p-mono').nth(1).innerText();
    await page.screenshot({ path: `${OUT}/t-${t.toFixed(3)}.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    log(`撮影 ${t} 秒（${pos}）`);
  }
}

await ctx.close();
