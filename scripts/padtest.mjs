import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => {
  const a = window.__pond;
  return { n: a.props.pads.length, pads: a.props.pads.map(p => ({x:+p.x.toFixed(2),z:+p.z.toFixed(2),s:+p.size.toFixed(2)})) };
}));
await page.evaluate(() => {
  const a = window.__pond;
  const p = a.props.pads[0];
  const r = Math.hypot(p.x,p.z);
  a.camera.position.set(p.x*1.8+1.2, 3.2, p.z*1.8+1.2);
  a.controls.target.set(p.x, 0, p.z);
  a.controls.autoRotate=false;
  a.controls.update();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/pads-close.png' });
await browser.close();
