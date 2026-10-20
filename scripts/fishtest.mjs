import { chromium } from 'playwright';

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.evaluate(() => {
	const a = window.__pond;
	a.setTime(18.6);
	a.sky.hemi.intensity = 1.2;
	a.sky.fill.intensity = 1.1;
	a.water.mesh.visible = false;
	a.controls.autoRotate = false;
	// close, high view of the pond centre
	a.camera.position.set(5.2, 2.4, 4.4);
	a.controls.target.set(0, -0.4, 0);
	a.controls.update();
});
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/fish-nowater.png' });
console.log('fish', await page.evaluate(() => {
	const a = window.__pond;
	return {
		n: a.fish.fish.length,
		sample: a.fish.fish.slice(0, 6).map((f) => ({
			kind: f.kind, x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2), depth: +f.depth.toFixed(2),
		})),
	};
}));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
