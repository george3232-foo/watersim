import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const a = window.__pond;
  a.controls.autoRotate = false;
  a.controls.target.set(0, -0.1, 0);
  a.camera.position.set(3.4, 1.9, 4.2);
  a.controls.update();
});
for (const [type, x, z] of [['apple', 0.7, 0.4], ['duck', -0.7, 0.3], ['ball', 0.1, 1.1], ['leaf', 1.0, -0.5]]) {
  await page.evaluate(({ type, x, z }) => {
    const a = window.__pond;
    a.selected = type;
    a.throwAt(x, z);
  }, { type, x, z });
  await page.waitForTimeout(4500);
}
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/floaters.png' });
const info = await page.evaluate(() => {
  const a = window.__pond;
  return a.throwables.bodies.map(b => {
    const s = { height: 0, depth: 0 };
    a.sim.sampleSurface(b.pos.x, b.pos.z, s);
    return { type: b.type, x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), y: +b.pos.y.toFixed(3), eta: +s.height.toFixed(3), above: +(b.pos.y - s.height).toFixed(3), sub: +b.submerged.toFixed(2) };
  });
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
