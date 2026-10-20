import { chromium } from 'playwright';

// Verification for SplashFX. Uses the real throw path and pauses the app loop at
// a chosen simulation time so the screenshot captures the splash, not its tail.
const browser = await chromium.launch({
	headless: true,
	args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox'],
});

async function runCase({ label, type, x, z, peakDt, outPeak, outLate, outClear }) {
	const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
	page.setDefaultTimeout(180000);
	// Another agent may be editing the project while this test runs; keep the
	// page from being reloaded by Vite's HMR client mid-throw.
	await page.route('**/@vite/client*', (route) => route.fulfill({
		status: 200,
		contentType: 'application/javascript',
		body: 'export const createHotContext = () => ({ on(){}, off(){}, send(){}, accept(){}, dispose(){}, decline(){}, invalidate(){} }); export const injectQuery = (u) => u; export const removeTimestampQuery = (u) => u; export const updateStyle = () => {};',
	}));
	const logs = [];
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
	});
	page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

	await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 180000 });
	await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
	await page.waitForTimeout(900);

	const gpu = await page.evaluate(() => {
		const gl = window.__pond.engine.renderer.getContext();
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
	});

	const state = () => page.evaluate(() => {
		const a = window.__pond;
		if (!a || !a.splash) return { missing: true };
		const sp = a.splash;
		let alive = 0, nan = 0;
		for (let i = 0; i < sp.maxDroplets; i++) {
			if (!sp._alive[i]) continue;
			alive++;
			if (!Number.isFinite(sp._px[i]) || !Number.isFinite(sp._py[i]) || !Number.isFinite(sp._pz[i])) nan++;
		}
		let rings = 0;
		for (const r of sp._rings) if (r.active) rings++;
		return {
			sim: +a.time.toFixed(2),
			alive,
			drawn: sp._particleGeo.drawRange.count,
			rings,
			nan,
			pixelScale: +sp._particleMat.uniforms.uPixelScale.value.toFixed(0),
			bodies: a.throwables.bodies.map((b) => ({ type: b.type, sub: +b.submerged.toFixed(2), y: +b.pos.y.toFixed(2) })),
		};
	});
	const waitSim = async (dt) => {
		const t0 = await page.evaluate(() => window.__pond.time);
		await page.waitForFunction((target) => window.__pond && window.__pond.time >= target, t0 + dt, { timeout: 90000, polling: 50 });
	};
	const pause = () => page.evaluate(() => {
		const a = window.__pond;
		cancelAnimationFrame(a._raf);
		a._raf = 0;
		window.__paused = true;
	});
	const resume = () => page.evaluate(() => {
		const a = window.__pond;
		if (!window.__paused) return;
		window.__paused = false;
		a.last = performance.now();
		a._raf = requestAnimationFrame(a.loop);
	});

	await page.evaluate(({ type, x, z }) => {
		const a = window.__pond;
		a.controls.autoRotate = false;
		a.setThrowable(type);
		a.throwAt(x, z);
	}, { type, x, z });

	// Poll the body into the pond, then wait for the splash hook to emit.
	await page.waitForFunction((type) => {
		const pond = window.__pond;
		if (!pond) return false;
		const b = pond.throwables.bodies.find((x) => x.type === type);
		return b && b.submerged > 0.1;
	}, type, { timeout: 90000, polling: 50 });
	await page.waitForFunction(() => {
		const pond = window.__pond;
		return pond && pond.splash._particleGeo.drawRange.count > 0;
	}, null, { timeout: 30000, polling: 50 });
	const impact = await state();

	await waitSim(peakDt);
	await pause();
	const peak = await state();
	await page.screenshot({ path: outPeak, timeout: 180000 });
	await resume();

	await waitSim(0.65);
	await pause();
	const late = await state();
	await page.screenshot({ path: outLate, timeout: 180000 });
	await resume();

	await waitSim(2.6);
	await pause();
	const clear = await state();
	await page.screenshot({ path: outClear, timeout: 180000 });

	console.log(label, 'gpu', gpu);
	console.log(label, 'impact', JSON.stringify(impact));
	console.log(label, 'peak', JSON.stringify(peak));
	console.log(label, 'late', JSON.stringify(late));
	console.log(label, 'clear', JSON.stringify(clear));
	console.log(label, 'logs', logs.length ? logs.join(' | ') : '(none)');
	await page.close();
	return { peak, clear, logs };
}

await runCase({
	label: 'pebble', type: 'pebble', x: 0.3, z: 0.2, peakDt: 0.32,
	outPeak: '/tmp/splash-after.png',
	outLate: '/tmp/splash-pebble-late.png',
	outClear: '/tmp/splash-clear.png',
});
await runCase({
	label: 'stone', type: 'stone', x: -0.7, z: 0.35, peakDt: 0.34,
	outPeak: '/tmp/splash-large.png',
	outLate: '/tmp/splash-stone-late.png',
	outClear: '/tmp/splash-stone-clear.png',
});
await browser.close();
