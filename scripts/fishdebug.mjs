import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const a = window.__pond;
  a.controls.autoRotate = false;
  a.controls.target.set(0, -0.35, 0);
  a.camera.position.set(2.9, 2.1, 3.7);
  a.controls.update();
  for (let i = 0; i < 8; i++) a.feedAt(0, 0);
});
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/fish-debug-base.png' });
for (const d of [6, 4, 3, 8]) {
  await page.evaluate((v) => { window.__pond.water.uniforms.uDebug.value = v; }, d);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/fish-debug-${d}.png` });
}
await browser.close();
