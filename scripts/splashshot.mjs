import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const a = window.__pond;
  a.controls.autoRotate = false;
  a.controls.target.set(0, 0.2, 0);
  a.camera.position.set(4.6, 2.0, 5.2);
  a.controls.update();
  a.throwAt(0.3, 0.1);
});
await page.waitForTimeout(2700);
await page.screenshot({ path: '/tmp/splash-live.png' });
const st = await page.evaluate(() => {
  const a = window.__pond;
  let alive = 0;
  for (let i = 0; i < a.splash._alive.length; i++) alive += a.splash._alive[i];
  let rings = 0;
  for (const r of a.splash._rings) if (r.active) rings++;
  return { alive, rings, bodies: a.throwables.bodies.length, errors: [] };
});
console.log(st, errors.slice(0, 10));
await browser.close();
