import { chromium } from 'playwright';

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1800);
await page.evaluate(() => {
	const s = window.__pond.sky;
	s.hemi.intensity *= 1.8;
	s.fill.intensity *= 1.6;
	window.__pond.engine.finalMat.uniforms.uExposure.value = 1.12;
});
for (const h of [17.6, 18.1, 18.5, 18.9, 19.15, 19.45]) {
	await page.evaluate((hh) => window.__pond.setTime(hh), h);
	await page.waitForTimeout(700);
	const info = await page.evaluate(() => {
		const a = window.__pond;
		return { sunY: +a.sky.state.sunDir.y.toFixed(3), sunInt: +a.sky.state.sunIntensity.toFixed(2) };
	});
	await page.screenshot({ path: `/tmp/time-${h}.png` });
	console.log(h, JSON.stringify(info));
}
await browser.close();
