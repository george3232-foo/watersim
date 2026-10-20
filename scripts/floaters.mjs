import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);

const out = {};
for (const type of ['apple', 'duck', 'ball', 'pebble']) {
  const res = await page.evaluate(async (type) => {
    const a = window.__pond;
    a.throwables.bodies.length = 0;
    a.selected = type;
    const samples = [];
    let removedAt = null;
    const t0 = performance.now();
    a.throwAt(0.6, 0.1);
    const bodyRef = a.throwables.bodies[a.throwables.bodies.length - 1];
    while (performance.now() - t0 < 7500) {
      await new Promise(r => requestAnimationFrame(r));
      const b = bodyRef;
      const surf = { height: 0, depth: 0 };
      a.sim.sampleSurface(b.pos.x, b.pos.z, surf);
      samples.push({
        t: +((performance.now() - t0) / 1000).toFixed(2),
        y: +b.pos.y.toFixed(3),
        x: +b.pos.x.toFixed(2),
        z: +b.pos.z.toFixed(2),
        vy: +b.vel.y.toFixed(2),
        sub: +b.submerged.toFixed(2),
        eta: +surf.height.toFixed(3),
        above: +(b.pos.y - surf.height).toFixed(3),
        n: a.throwables.bodies.length,
      });
      if (!a.throwables.bodies.includes(b)) { removedAt = +((performance.now() - t0) / 1000).toFixed(2); break; }
    }
    const finals = samples.filter((s, i) => i % 10 === 0).slice(-8);
    return { type, removedAt, last: samples[samples.length - 1], maxVy: Math.max(...samples.map(s => s.vy)), maxAbove: Math.max(...samples.map(s => s.above)), finals };
  }, type);
  out[type] = res;
}
console.log(JSON.stringify({ out, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
