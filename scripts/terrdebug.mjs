import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.evaluate(() => {
  const a = window.__pond;
  a.water.mesh.visible = false;
  a.camera.position.set(5.2, 2.4, 4.4);
  a.controls.target.set(0, -0.4, 0);
  a.controls.autoRotate = false;
  a.controls.update();
});
for (const d of [0,1,2,3]) {
  await page.evaluate((d) => { window.__pond.terrain.uniforms.uDebug.value = d; }, d);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/terrdebug-${d}.png` });
}
console.log('done');
await browser.close();
