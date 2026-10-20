import { chromium } from 'playwright';
const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.evaluate(() => {
	const a = window.__pond;
	a.water.mesh.visible = false;
	a.camera.position.set(5.2, 2.4, 4.4);
	a.controls.target.set(0, -0.4, 0);
	a.controls.autoRotate = false;
	a.controls.update();
});
for (const [name, level] of [['zero', 0], ['silt', 100]]) {
	await page.evaluate((l) => { window.__pond.terrain.uniforms.uWaterLevel.value = l; }, level);
	await page.waitForTimeout(700);
	await page.screenshot({ path: `/tmp/bed-${name}.png` });
}
console.log(await page.evaluate(() => {
	const a = window.__pond;
	return {
		level: a.terrain.uniforms.uWaterLevel.value,
		waterVisible: a.water.mesh.visible,
		bedAtCenter: a.hf.height(0, 0),
		bedAt2: a.hf.height(2, 1),
		bedTexel: (() => { const t = a.sim.bedTexture.image.data; return [t[0], t[1], t[2]]; })(),
	};
}));
await browser.close();
