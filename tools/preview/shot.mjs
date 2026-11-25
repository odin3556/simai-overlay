// tools/preview/index.html（動画を使わないページ）を開いて、パネルと動画の左上の表示を撮る。
// 実行: docker compose run --rm --entrypoint node youtube-check /repo/tools/preview/shot.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await page.goto('file:///repo/tools/preview/index.html');
await page.waitForFunction(() => document.title === 'ok' || document.title === 'パネルの見た目', null, { timeout: 5000 });
console.log('title:', await page.title());
await page.screenshot({ path: '/out/preview.png' });
await browser.close();
