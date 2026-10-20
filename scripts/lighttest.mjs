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
await page.waitForTimeout(2000);
const shot = async (name) => {
	await page.waitForTimeout(600);
	await page.screenshot({ path: `/tmp/light-${name}.png` });
	console.log('shot', name);
};

await shot('base');
await page.evaluate(() => { window.__pond.sky.sun.castShadow = false; });
await shot('noshadow');
await page.evaluate(() => {
	const s = window.__pond.sky;
	s.sun.castShadow = true;
	s.hemi.intensity *= 2.2;
	s.fill.intensity *= 2.0;
});
await shot('fill');
await page.evaluate(() => {
	window.__pond.engine.finalMat.uniforms.uExposure.value = 1.35;
});
await shot('exposed');
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
