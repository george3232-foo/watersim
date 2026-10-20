import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
	const a = window.__pond;
	a.scene.children.forEach((c) => { if (c !== a.splash.group) c.visible = false; });
	a.water.mesh.visible = false;
	a.scene.background = null;
	a.controls.autoRotate = false;
	a.camera.position.set(2.4, 1.45, 2.4);
	a.controls.target.set(0, 0.16, 0);
	a.controls.update();
	a.engine.finalMat.uniforms.uBloom.value = 0.0;
	a.engine.finalMat.uniforms.uExposure.value = 1.0;
	a.splash.splashAt(0, 0, 0.5, { radius: 0.075, vy: -8 });
});
await page.waitForFunction(() => window.__pond.splash._particleGeo.drawRange.count > 0, null, { timeout: 20000, polling: 50 });
const state = () => page.evaluate(() => {
	const a = window.__pond;
	const sp = a.splash;
	let alive = 0, minY = 99, maxY = -99, minX = 99, maxX = -99, maxSize = 0;
	for (let i = 0; i < sp.maxDroplets; i++) if (sp._alive[i]) {
		alive++;
		minY = Math.min(minY, sp._py[i]); maxY = Math.max(maxY, sp._py[i]);
		minX = Math.min(minX, sp._px[i]); maxX = Math.max(maxX, sp._px[i]);
		maxSize = Math.max(maxSize, sp._size[i]);
	}
	return {
		t: +a.time.toFixed(2), alive, draw: sp._particleGeo.drawRange.count,
		minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), spread: +(maxX - minX).toFixed(3),
		maxSize: +maxSize.toFixed(3),
		rings: sp._rings.filter((r) => r.active).map((r) => ({ r: +r.mat.uniforms.uRadius.value.toFixed(2), a: +r.mat.uniforms.uAlpha.value.toFixed(2), y: r.y })),
		pixelScale: sp._particleMat.uniforms.uPixelScale.value,
	};
});
const t0 = await page.evaluate(() => window.__pond.time);
for (const dt of [0.02, 0.12, 0.28, 0.5]) {
	await page.waitForFunction((target) => window.__pond.time >= target, t0 + dt, { timeout: 30000, polling: 50 });
	console.log('dt', dt, JSON.stringify(await state()));
	await page.screenshot({ path: `/tmp/splash-iso-${String(dt).replace('.', '')}.png` });
}
console.log('logs', logs.length ? logs.join(' | ') : '(none)');
await browser.close();
