import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(120000);
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(2500);
for (const d of [0,1,2,3,4,7]) {
  await page.evaluate((d) => { window.__pond.water.uniforms.uDebug.value = d; }, d);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/wdebug-${d}.png` });
}
console.log('done');
await browser.close();
