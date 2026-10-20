import { chromium } from 'playwright';

const url = 'http://localhost:5173/?quality=low';
const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
await page.evaluate(() => document.querySelector('.chip[data-preset="rain"]')?.click());
await page.waitForTimeout(3000);

const shots = [
	['rings-off', () => { window.__pond.rainFx.ringMesh.visible = false; }],
	['rain-off', () => { window.__pond.rainFx.group.visible = false; }],
	['rain-on-rings-on', () => { window.__pond.rainFx.group.visible = true; window.__pond.rainFx.ringMesh.visible = true; }],
];
for (const [name, fn] of shots) {
	await page.evaluate(fn);
	await page.waitForTimeout(700);
	await page.screenshot({ path: `/tmp/storm-${name}.png` });
}

// force a lightning flash and grab it immediately
await page.evaluate(() => {
	const app = window.__pond;
	app.sky.flash = 1.0;
});
await page.waitForTimeout(60);
await page.screenshot({ path: '/tmp/storm-flash.png' });
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
