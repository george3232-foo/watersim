import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('PE ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const rows = await page.evaluate(async () => {
  const a = window.__pond;
  a.throwables.bodies.length = 0;
  a.selected = 'leaf';
  a.throwAt(0.2, 0.1);
  const b = a.throwables.bodies[0];
  const rows = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    await new Promise(r => requestAnimationFrame(r));
    if (!a.throwables.bodies.includes(b)) { rows.push({ gone: true, t: +((performance.now() - t0) / 1000).toFixed(2) }); break; }
    const s = { height: 0, depth: 0 };
    a.sim.sampleSurface(b.pos.x, b.pos.z, s);
    const bed = a.hf.height(b.pos.x, b.pos.z);
    rows.push({
      t: +((performance.now() - t0) / 1000).toFixed(2),
      y: +b.pos.y.toFixed(3), vy: +b.vel.y.toFixed(2), sub: +b.submerged.toFixed(2),
      eta: +s.height.toFixed(3), bed: +bed.toFixed(3),
      hasWater: (s.height - bed) > 0.02,
      x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2),
    });
  }
  return rows;
});
console.log(JSON.stringify(rows.filter((r, i) => i % 10 === 0).slice(-30), null, 2));
console.log('errors', errors.slice(0, 10));
await browser.close();
