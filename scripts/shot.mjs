import { chromium } from 'playwright';
import fs from 'node:fs';

const preset = process.env.PRESET || 'rain';
const url = process.env.URL || 'http://localhost:5173/?quality=low';
const out = process.env.OUT || `/tmp/pond-${preset}.png`;
const width = parseInt(process.env.W || '1152', 10);
const height = parseInt(process.env.H || '720', 10);
const wait = parseInt(process.env.WAIT || '4500', 10);

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => {
	const t = msg.type();
	if (t === 'error' || t === 'warning') logs.push(`[${t}] ${msg.text()}`);
});
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
	await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
} catch (e) {
	logs.push('[wait] ready timeout ' + e.message);
}
await page.waitForTimeout(1200);
if (preset !== 'none') {
	await page.evaluate((p) => {
		document.querySelector(`.chip[data-preset="${p}"]`)?.click();
	}, preset);
}
await page.waitForTimeout(wait);
const stats = await page.evaluate(() => (window.__pond ? window.__pond.getStats() : null)).catch((e) => ({ err: e.message }));
const env = await page.evaluate(() => {
	const app = window.__pond?.app || window.__pond;
	if (!app) return null;
	return {
		rain: app.sim?.rain,
		wind: app.sim?.windStrength,
		storm: app.sky?.storm,
		flash: app.sky?.flash,
		sun: app.sky?.sun?.intensity,
		hemi: app.sky?.hemi?.intensity,
		fog: app.sky?.scene?.fog?.density,
		rainVisible: app.rainFx?.group?.visible,
		rainCount: app.rainFx?.streaks?.geometry?.instanceCount,
	};
});
console.log('stats', JSON.stringify(stats, null, 2));
console.log('env', JSON.stringify(env, null, 2));
console.log(logs.slice(0, 40).join('\n'));
fs.writeFileSync('/tmp/pond-logs.txt', logs.join('\n'));
try {
	await page.screenshot({ path: out, timeout: 120000 });
	console.log('shot saved', out);
} catch (e) {
	console.log('screenshot failed', e.message);
}
await browser.close();
