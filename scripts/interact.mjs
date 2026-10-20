import { chromium } from 'playwright';
import fs from 'node:fs';

// Drives the real interaction modes: throw a pebble, stir the water, sprinkle
// food. Verifies counts through window.__pond and saves screenshots.

const url = process.env.URL || 'http://localhost:5173/?quality=low';
const out = process.env.OUT || '/tmp/pond-interact.png';
const width = parseInt(process.env.W || '1152', 10);
const height = parseInt(process.env.H || '720', 10);

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const logs = [];
page.on('console', (msg) => {
	const t = msg.type();
	if (t === 'error' || t === 'warning') logs.push(`[${t}] ${msg.text()}`);
});
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

const report = {};
const shot = async (path) => {
	try {
		await page.screenshot({ path, timeout: 120000 });
		console.log('shot', path);
	} catch (e) {
		console.log('shot failed', path, e.message);
	}
};
const stats = () => page.evaluate(() => (window.__pond ? window.__pond.getStats() : null));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
	await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
} catch (e) {
	logs.push('[wait] ready timeout ' + e.message);
}
await page.waitForTimeout(2500);

report.initial = await stats();
console.log('initial', JSON.stringify(report.initial));

// ---- throw a pebble into the middle of the pond ----
await page.mouse.click(width * 0.5, height * 0.62);
await page.waitForTimeout(1800);
report.afterThrow = await stats();
console.log('afterThrow', JSON.stringify(report.afterThrow));

// ---- throw a few more items in throw mode ----
for (const [dx, dy] of [[0.42, 0.6], [0.58, 0.58], [0.5, 0.5]]) {
	await page.mouse.click(width * dx, height * dy);
	await page.waitForTimeout(700);
}
report.afterThrows = await stats();
console.log('afterThrows', JSON.stringify(report.afterThrows));
await shot('/tmp/pond-throws.png');

// ---- switch to touch and stir ----
await page.click('.mode[data-mode="touch"]');
await page.waitForTimeout(300);
await page.mouse.move(width * 0.45, height * 0.6);
await page.mouse.down();
for (let i = 0; i <= 12; i++) {
	await page.mouse.move(width * (0.45 + 0.18 * (i / 12)), height * (0.6 + 0.05 * Math.sin(i / 2)));
	await page.waitForTimeout(40);
}
await page.mouse.up();
await page.waitForTimeout(500);
report.afterStir = await stats();
console.log('afterStir', JSON.stringify(report.afterStir));

// ---- switch to feed and sprinkle ----
await page.click('.mode[data-mode="feed"]');
await page.waitForTimeout(300);
await page.mouse.click(width * 0.5, height * 0.58);
await page.waitForTimeout(2500);
report.afterFeed = await stats();
console.log('afterFeed', JSON.stringify(report.afterFeed));

// ---- let it all settle, then a wide shot ----
await page.waitForTimeout(4000);
report.settled = await stats();
console.log('settled', JSON.stringify(report.settled));
await shot(out);

// ---- night preset check ----
await page.click('.chip[data-preset="night"]');
await page.waitForTimeout(2500);
await shot('/tmp/pond-night.png');

console.log('---logs---');
console.log(logs.slice(0, 40).join('\n'));
fs.writeFileSync('/tmp/pond-interact-logs.txt', logs.join('\n'));
fs.writeFileSync('/tmp/pond-interact-stats.json', JSON.stringify(report, null, 2));
await browser.close();
