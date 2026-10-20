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
await page.evaluate(() => {
	window.__hb = 0;
	window.__hbLast = performance.now();
	const tick = (t) => { window.__hb++; window.__hbLast = t; requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
});
await page.waitForTimeout(800);

const dump = (tag) => page.evaluate((tag) => {
	const a = window.__pond;
	return {
		tag,
		now: +performance.now().toFixed(0),
		raf: a._raf,
		hb: window.__hb,
		frame: a.frame,
		time: +a.time.toFixed(3),
		vis: document.visibilityState,
		hidden: document.hidden,
		bodies: a.throwables.bodies.map((b) => ({
			x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), vy: +b.vel.y.toFixed(2),
		})),
		stats: a.getStats(),
	};
}, tag);

console.log('A', JSON.stringify(await dump('loaded')));
await page.waitForTimeout(2000);
console.log('B', JSON.stringify(await dump('after2s')));
await page.evaluate(() => window.__pond.throwAt(0.5, 0.2));
await page.waitForTimeout(500);
console.log('C', JSON.stringify(await dump('throw+0.5s')));
await page.screenshot({ path: '/tmp/diag2-a.png', timeout: 120000 });
console.log('D', JSON.stringify(await dump('afterShot')));
await page.waitForTimeout(1200);
console.log('E', JSON.stringify(await dump('shot+1.2s')));
await page.screenshot({ path: '/tmp/diag2-b.png', timeout: 120000 });
console.log('F', JSON.stringify(await dump('afterShot2')));
console.log('logs', logs.join(' | '));
await browser.close();
