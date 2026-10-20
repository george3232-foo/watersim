import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('PE ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
await page.waitForTimeout(3000);
for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  await page.evaluate((v) => { window.__pond.water.uniforms.uDebug.value = v; }, d);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/dbg-${d}.png` });
}
console.log(errors.slice(0, 20));
await browser.close();
