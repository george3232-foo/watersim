import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const setup = await page.evaluate(() => {
  const a = window.__pond;
  a.__splashCalls = 0;
  const orig = a.splash.splashAt.bind(a.splash);
  a.splash.splashAt = (...args) => { a.__splashCalls++; a.__lastSplash = args.slice(0, 3); return orig(...args); };
  a.__impactFlags = [];
  const origHook = a.throwables.splashHook;
  a.throwables.splashHook = (b, impact) => { a.__impactFlags.push({ impact, y: b.pos.y, vy: b.vel.y }); return origHook(b, impact); };
  return {
    hasSplash: !!a.splash,
    hasHook: !!a.throwables.splashHook,
    cap: a.splash._alive.length,
    splashScene: a.water.scene.children.includes(a.splash.group),
  };
});
await page.evaluate(() => window.__pond.throwAt(0.3, 0.1));
const samples = [];
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(60);
  const s = await page.evaluate(() => {
    const a = window.__pond;
    let alive = 0;
    for (let i = 0; i < a.splash._alive.length; i++) alive += a.splash._alive[i];
    const b = a.throwables.bodies[0];
    return { t: +a.time.toFixed(2), alive, calls: a.__splashCalls, flags: a.__impactFlags.slice(-1), y: b ? +b.pos.y.toFixed(2) : null, vy: b ? +b.vel.y.toFixed(2) : null, sub: b ? +b.submerged.toFixed(2) : null };
  });
  samples.push(s);
  if (s.calls > 0) break;
}
console.log(JSON.stringify({ setup, samples, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
