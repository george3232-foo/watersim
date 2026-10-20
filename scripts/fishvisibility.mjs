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
  a.controls.target.set(0, -0.4, 0);
  a.camera.position.set(2.3, 1.8, 3.0);
  a.controls.update();
  for (let i = 0; i < 8; i++) a.feedAt(0, 0);
});
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/fish-water.png' });
await page.evaluate(() => { const a = window.__pond; a.water.mesh.visible = false; });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/fish-nowater.png' });
const info = await page.evaluate(() => {
  const a = window.__pond;
  return {
    waterMesh: !!a.water.mesh,
    fishGroupVisible: a.fish.group.visible,
    fishVisible: a.fish.fish.slice(0, 4).map(f => ({ y: f.pos.y, meshVisible: f.mesh ? f.mesh.visible : null })),
    materials: a.fish.fish.slice(0, 4).map(f => f.mesh ? { type: f.mesh.material.type, color: f.mesh.material.color?.getHexString(), opacity: f.mesh.material.opacity, transparent: f.mesh.material.transparent } : null),
  };
});
console.log(JSON.stringify({ info, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
