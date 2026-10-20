import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(2000);
const before = await page.evaluate(() => {
  const a = window.__pond;
  return { readback: a.sim.readbackCount, pending: a.sim.pending.length, steps: a.sim.stepsThisFrame, macro: a.sim.macroIndex, micro: a.sim.microIndex };
});
await page.evaluate(() => {
  const a = window.__pond;
  for (let i = 0; i < 10; i++) a.sim.addImpulse({ x: 1 + i * 0.1, z: 0.5, radius: 0.25, amp: -0.03, flowX: 1, flowZ: 0, flowStrength: 0.3, foam: 0.1, microScale: 1.2 });
});
await page.waitForTimeout(100);
const during = await page.evaluate(() => ({ pending: window.__pond.sim.pending.length, readback: window.__pond.sim.readbackCount }));
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const a = window.__pond;
  return { readback: a.sim.readbackCount, pending: a.sim.pending.length, steps: a.sim.stepsThisFrame, surf: a.sim.surfaceAt(0, 0) };
});
await page.evaluate(() => window.__pond.throwAt(0.4, 0.2));
await page.waitForTimeout(2600);
const thrown = await page.evaluate(() => {
  const a = window.__pond;
  const b = a.throwables.bodies[0];
  return { n: a.throwables.bodies.length, y: b ? +b.pos.y.toFixed(3) : null, submerged: b ? b.submerged : null, velY: b ? +b.vel.y.toFixed(3) : null };
});
console.log({ before, during, after, thrown, errors });
await browser.close();
