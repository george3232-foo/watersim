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
  a.controls.target.set(0, -0.35, 0);
  a.camera.position.set(2.9, 2.1, 3.7);
  a.controls.update();
  a.setMode('feed');
});
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.__pond.feedAt(0, 0));
  await page.waitForTimeout(200);
}
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/feed-fish2.png' });
const st = await page.evaluate(() => {
  const a = window.__pond;
  const fish = a.fish.fish.map(f => ({ x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2), len: +f.len.toFixed(2), state: f.state, depth: +f.desiredDepth.toFixed(2) }));
  return {
    fish: fish.slice(0, 20),
    near: fish.filter(f => Math.hypot(f.x, f.z) < 2.5).length,
    nearSurface: fish.filter(f => f.y > -0.35).length,
    minY: Math.min(...fish.map(f => f.y)),
    maxY: Math.max(...fish.map(f => f.y)),
    pellets: a.food.pellets.length,
  };
});
console.log(JSON.stringify({ st, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
