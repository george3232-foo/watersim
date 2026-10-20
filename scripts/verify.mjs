import { chromium } from 'playwright';
import fs from 'node:fs';

const url = process.env.URL || 'http://localhost:5173/?quality=low';
const out = process.env.OUT || '/tmp/pond.png';
const width = parseInt(process.env.W || '1280', 10);
const height = parseInt(process.env.H || '800', 10);
const wait = parseInt(process.env.WAIT || '4000', 10);

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
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
	await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
} catch (e) {
	logs.push('[wait] ready timeout ' + e.message);
}
await page.waitForTimeout(wait);
const stats = await page.evaluate(() => (window.__pond ? window.__pond.getStats() : null)).catch((e) => ({ err: e.message }));
console.log('stats', JSON.stringify(stats, null, 2));
console.log('loadMs', Date.now() - t0);
console.log(logs.slice(0, 30).join('\n'));
fs.writeFileSync('/tmp/pond-logs.txt', logs.join('\n'));
fs.writeFileSync('/tmp/pond-stats.json', JSON.stringify(stats, null, 2));
try {
	await page.screenshot({ path: out, timeout: 120000 });
	console.log('shot saved', out);
} catch (e) {
	console.log('screenshot failed', e.message);
}
await browser.close();
