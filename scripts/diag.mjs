import { chromium } from 'playwright';

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);

const dump = () => page.evaluate(() => {
	const a = window.__pond;
	return {
		mode: a.mode,
		time: a.time,
		bodies: a.throwables.bodies.map((b) => ({
			type: b.type, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2),
			vy: +b.vel.y.toFixed(2), sub: +b.submerged.toFixed(2), slot: b.slot,
		})),
	};
});

console.log('before', JSON.stringify(await dump()));
await page.evaluate(() => window.__pond.throwAt(0.5, 0.2));
await page.waitForTimeout(250);
console.log('t250', JSON.stringify(await dump()));
await page.waitForTimeout(750);
console.log('t1000', JSON.stringify(await dump()));
await page.waitForTimeout(1500);
console.log('t2500', JSON.stringify(await dump()));
await page.waitForTimeout(2500);
console.log('t5000', JSON.stringify(await dump()));
console.log('logs', logs.join(' | '));
await browser.close();
