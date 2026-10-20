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
  a.controls.target.set(0, -0.2, 0);
  a.camera.position.set(3.6, 2.0, 4.4);
  a.controls.update();
  for (let i = 0; i < 6; i++) a.feedAt(0.2, 0.1);
});
await page.waitForTimeout(3200);
const pre = await page.evaluate(() => window.__pond.fish.fish.slice(0, 6).map(f => ({ x: +f.pos.x.toFixed(2), z: +f.pos.z.toFixed(2), state: f.state })));
await page.evaluate(() => window.__pond.throwAt(0.2, 0.1));
let alive = 0, waited = 0, shot = false;
while (waited < 7000) {
  await page.waitForTimeout(70);
  waited += 70;
  alive = await page.evaluate(() => {
    const a = window.__pond;
    let n = 0;
    for (let i = 0; i < a.splash._alive.length; i++) n += a.splash._alive[i];
    return n;
  });
  if (alive > 0) {
    await page.screenshot({ path: '/tmp/throw-splash.png' });
    shot = true;
    break;
  }
}
await page.waitForTimeout(700);
const post = await page.evaluate(() => {
  const a = window.__pond;
  const near = a.fish.fish.slice(0, 6).map(f => ({ x: +f.pos.x.toFixed(2), z: +f.pos.z.toFixed(2), y: +f.pos.y.toFixed(2), state: f.state }));
  let rings = 0;
  for (const r of a.splash._rings) if (r.active) rings++;
  return { near, rings, bodies: a.throwables.bodies.length };
});
console.log(JSON.stringify({ pre, impact: { alive, waited, shot }, post, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
