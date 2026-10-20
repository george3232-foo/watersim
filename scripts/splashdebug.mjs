import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180000);
page.on('console', (m) => { if (m.type() !== 'debug') console.log('console', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('navigated', f.url()); });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
console.log('ready');
await page.evaluate(() => {
	const a = window.__pond;
	a.controls.autoRotate = false;
	window.__calls = [];
	window.__hookCalls = [];
	const origAt = a.splash.splashAt.bind(a.splash);
	a.splash.splashAt = (...args) => { window.__calls.push(args.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))); return origAt(...args); };
	const origHook = a.throwables.splashHook;
	a.throwables.splashHook = (b, impact) => { window.__hookCalls.push({ type: b.type, impact, vy: b.vel.y, sub: b.submerged }); return origHook(b, impact); };
	window.__err = null;
	window.addEventListener('error', (e) => { window.__err = String(e.message); });
	a.throwAt(0.3, 0.2);
});
for (let i = 0; i < 30; i++) {
	await page.waitForTimeout(1000);
	const s = await page.evaluate(() => {
		const a = window.__pond;
		if (!a) return { missing: true };
		const sp = a.splash;
		return {
			sim: +a.time.toFixed(2), frame: a.frame,
			calls: window.__calls.length, hook: window.__hookCalls.length,
			lastHook: window.__hookCalls.at(-1) ?? null,
			draw: sp._particleGeo.drawRange.count,
			err: window.__err,
			bodies: a.throwables.bodies.map((b) => ({ t: b.type, sub: +b.submerged.toFixed(2), vy: +b.vel.y.toFixed(2), y: +b.pos.y.toFixed(2), x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2) })),
		};
	});
	console.log(i, JSON.stringify(s));
	if (s.calls > 0) {
		await page.screenshot({ path: '/tmp/splash-debug2.png' });
		break;
	}
}
console.log('final splash', await page.evaluate(() => {
	const sp = window.__pond.splash;
	let alive = 0;
	for (let i = 0; i < sp.maxDroplets; i++) alive += sp._alive[i];
	return { alive, draw: sp._particleGeo.drawRange.count, rings: sp._rings.filter((r) => r.active).length, calls: window.__calls, hooks: window.__hookCalls };
}));
await browser.close();
