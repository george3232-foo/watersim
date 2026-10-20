import { chromium } from 'playwright';

// Splash FX verification: real GPU, real throw path, screenshots at impact and
// after everything has faded. Run with `node scripts/splashtest.mjs`.
const url = 'http://localhost:5173/?quality=low';

const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const logs = [];
page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1200);

const gpu = await page.evaluate(() => {
	const gl = window.__pond.engine.renderer.getContext();
	const ext = gl.getExtension('WEBGL_debug_renderer_info');
	return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log('gpu', gpu);

const splashState = () => page.evaluate(() => {
	const a = window.__pond;
	if (!a || !a.splash) return { missing: true };
	const sp = a.splash;
	let nan = 0;
	let alive = 0;
	for (let i = 0; i < sp.maxDroplets; i++) {
		if (!sp._alive[i]) continue;
		alive++;
		if (!Number.isFinite(sp._px[i]) || !Number.isFinite(sp._py[i]) || !Number.isFinite(sp._pz[i])) nan++;
	}
	let rings = 0;
	for (const r of sp._rings) if (r.active) rings++;
	const b = a.throwables.bodies;
	return {
		sim: +a.time.toFixed(2),
		alive,
		drawn: sp._particleGeo.drawRange.count,
		rings,
		nan,
		bodies: b.map((x) => ({ type: x.type, sub: +x.submerged.toFixed(2), y: +x.pos.y.toFixed(2) })),
	};
});

async function waitForSim(dt) {
	const t0 = await page.evaluate(() => window.__pond.time);
	await page.waitForFunction((target) => window.__pond && window.__pond.time >= target, t0 + dt, { timeout: 60000, polling: 100 });
}

const throwAndShoot = async (label, type, x, z, path) => {
	await page.evaluate(({ type, x, z }) => {
		const a = window.__pond;
		a.setThrowable(type);
		a.controls.autoRotate = false;
		a.throwAt(x, z);
	}, { type, x, z });
	// Requirement: poll the body into the water.
	await page.waitForFunction((type) => {
		const pond = window.__pond;
		if (!pond) return false;
		const b = pond.throwables.bodies.find((x) => x.type === type);
		return b && b.submerged > 0.1;
	}, type, { timeout: 60000, polling: 50 });
	// The hook fires on the frame that crosses the 0.25 submerged threshold.
	await page.waitForFunction(() => window.__pond && window.__pond.splash._particleGeo.drawRange.count > 0, null, { timeout: 30000, polling: 50 });
	const impact = await splashState();
	await waitForSim(0.26);
	const peak = await splashState();
	await page.screenshot({ path, timeout: 180000 });
	console.log(label, 'impact', JSON.stringify(impact), 'peak', JSON.stringify(peak));
	const late = `/tmp/splash-${label}-late.png`;
	await waitForSim(0.55);
	console.log(label, 'late', JSON.stringify(await splashState()));
	await page.screenshot({ path: late, timeout: 180000 });
	return peak;
};

await throwAndShoot('pebble', 'pebble', 0.3, 0.2, '/tmp/splash-after.png');
await waitForSim(1.2);

await throwAndShoot('stone', 'stone', -0.7, 0.35, '/tmp/splash-large.png');

const duringLarge = await splashState();
console.log('large+late', JSON.stringify(duringLarge));

// after everything should be gone
await waitForSim(2.5);
const after = await splashState();
console.log('after', JSON.stringify(after));
await page.screenshot({ path: '/tmp/splash-clear.png', timeout: 180000 });

console.log('logs', logs.length ? logs.join(' | ') : '(none)');
await browser.close();
