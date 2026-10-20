import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push('PE ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.chip[data-preset="rain"]')?.click());
await page.waitForTimeout(3000);
await page.evaluate(() => {
	const a = window.__pond;
	a.controls.autoRotate = false;
	a.camera.position.set(5.2, 2.0, 7.2);
	a.controls.target.set(0, 0.0, 0);
	a.controls.update();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/storm-close.png' });
await page.evaluate(() => { window.__pond.water.uniforms.uDebug.value = 8; });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/storm-close-ndv.png' });
await page.evaluate(() => { window.__pond.water.uniforms.uDebug.value = 7; });
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/storm-close-norm.png' });
const info = await page.evaluate(() => {
	const a = window.__pond;
	return {
		wind: a.sim.windStrength,
		macro: a.sim.macroTexture?.image ? 'tex' : 'tex',
		node: (() => { const s = a.sim; return { level: s.levelOffset, rain: s.rain, steps: s.totalSteps, windX: s.wind.x, windZ: s.wind.y }; })(),
	};
});
console.log(info, errs.slice(0, 10));
await browser.close();
