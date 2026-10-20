import { chromium } from 'playwright';

const browser = await chromium.launch({
	headless: true,
	args: [
		'--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox',
	],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });

const waitSim = async (sec) => page.waitForFunction(
	(t) => window.__pond.time >= t, 
	(await page.evaluate(() => window.__pond.time)) + sec,
	{ timeout: 180000, polling: 100 },
);

const dump = (tag) => page.evaluate((tag) => {
	const a = window.__pond;
	return {
		tag,
		frame: a.frame,
		time: +a.time.toFixed(3),
		bodies: a.throwables.bodies.map((b) => ({
			x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), vy: +b.vel.y.toFixed(2),
			sub: +b.submerged.toFixed(2),
		})),
		steps: a.sim.totalSteps,
		readback: a.sim.readbackCount,
	};
}, tag);

await waitSim(0.3);
console.log('A', JSON.stringify(await dump('loaded')));
await page.evaluate(() => window.__pond.throwAt(0.5, 0.2));
await waitSim(0.3);
console.log('B', JSON.stringify(await dump('t+0.3')));
await waitSim(0.5);
console.log('C', JSON.stringify(await dump('t+0.8')));
await waitSim(1.0);
console.log('D', JSON.stringify(await dump('t+1.8')));
await waitSim(1.5);
console.log('E', JSON.stringify(await dump('t+3.3')));
console.log('logs', logs.join(' | '));
await page.screenshot({ path: '/tmp/diag3.png', timeout: 180000 });
await browser.close();
