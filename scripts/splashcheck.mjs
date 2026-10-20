import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const a = window.__pond;
  a.controls.autoRotate = false;
  a.controls.target.set(0, 0.2, 0);
  a.camera.position.set(4.6, 2.0, 5.2);
  a.controls.update();
  a.throwAt(0.3, 0.1);
});
let peak = 0, rings = 0, waited = 0;
while (waited < 6000) {
  const st = await page.evaluate(() => {
    const a = window.__pond;
    let alive = 0;
    for (let i = 0; i < a.splash._alive.length; i++) alive += a.splash._alive[i];
    let ringAlive = 0;
    for (const r of a.splash._rings) if (r.active) ringAlive++;
    const b = a.throwables.bodies[0];
    return { alive, rings: ringAlive, bodies: a.throwables.bodies.length, y: b ? b.pos.y : null, submerged: b ? b.submerged : null };
  });
  peak = Math.max(peak, st.alive);
  rings = Math.max(rings, st.rings);
  if (st.alive > 0) {
    await page.screenshot({ path: '/tmp/splash-check.png' });
    console.log('shot at', waited, st);
    break;
  }
  await page.waitForTimeout(80);
  waited += 80;
}
const after = await page.evaluate(() => {
  const a = window.__pond;
  let alive = 0;
  for (let i = 0; i < a.splash._alive.length; i++) alive += a.splash._alive[i];
  const b = a.throwables.bodies[0];
  return { alive, bodies: a.throwables.bodies.length, y: b ? +b.pos.y.toFixed(3) : null, submerged: b ? b.submerged : null };
});
await page.waitForTimeout(1200);
const end = await page.evaluate(() => {
  const a = window.__pond;
  let alive = 0;
  for (let i = 0; i < a.splash._alive.length; i++) alive += a.splash._alive[i];
  return { alive, bodies: a.throwables.bodies.length };
});
console.log(JSON.stringify({ peak, rings, after, end, errors: errors.slice(0, 20) }, null, 2));
await browser.close();
