import { chromium } from 'playwright';
const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.evaluate(() => {
	const a = window.__pond;
	a.water.mesh.visible = false;
	a.camera.position.set(5.2, 2.4, 4.4);
	a.controls.target.set(0, -0.4, 0);
	a.controls.autoRotate = false;
	a.controls.update();
	a.terrain.uniforms.uWaterLevel.value = 100;
});
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/terrain-test1.png' });
console.log('level100', await page.evaluate(() => ({
	level: window.__pond.terrain.uniforms.uWaterLevel.value,
	color: window.__pond.terrain.material.color.getHexString(),
	hasMap: !!window.__pond.terrain.material.map,
	progKey: window.__pond.terrain.material.customProgramCacheKey(),
})));
await page.evaluate(() => { window.__pond.terrain.uniforms.uWaterLevel.value = -100; });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/terrain-test2.png' });
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
