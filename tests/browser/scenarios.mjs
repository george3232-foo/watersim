import assert from 'node:assert/strict';
import { openPond, readStats, waitForFrames } from '../../scripts/browser-harness.mjs';

export function assertStats(stats) {
	for (const key of ['fps', 'readback', 'steps', 'triangles', 'calls', 'fish', 'bodies', 'pellets', 'macroSize', 'microSize', 'readbackLatency']) {
		assert.ok(Number.isFinite(stats[key]) && stats[key] >= 0, `getStats().${key} is finite and nonnegative`);
	}
	assert.ok(stats.calls > 1, 'draw calls include more than the final fullscreen pass');
	assert.ok(stats.triangles > 2, 'triangles include scene geometry');
	assert.ok(stats.fish > 0 && stats.steps > 0 && stats.readback > 0);
	assert.equal(stats.hasReadback, true);
	assert.ok(['low', 'medium', 'high'].includes(stats.quality));
	assert.ok(['auto', 'manual'].includes(stats.qualityMode));
	assert.ok(['throw', 'touch', 'feed'].includes(stats.mode));
	assert.ok(stats.type !== undefined, 'existing state-type diagnostic remains available');
	assert.ok(stats.timings && typeof stats.timings === 'object', 'CPU submission timings are exposed');
	const times = Object.values(stats.timings).filter((value) => typeof value === 'number');
	assert.ok(times.length > 0, 'at least one numeric timing is reported');
	assert.ok(times.every((value) => Number.isFinite(value) && value >= 0));
}

export async function assertStartup(session) {
	await openPond(session);
	const { page } = session;
	await page.waitForFunction(() => {
		const stats = window.__pond.getStats();
		return stats.hasReadback && stats.readback > 0 && stats.steps > 0 && stats.calls > 1;
	});
	const methods = await page.evaluate(() => Object.fromEntries([
		'getStats', 'setQuality', 'setTime', 'setRain', 'setMode', 'throwAt', 'feedAt', 'stirAt',
	].map((method) => [method, typeof window.__pond[method]])));
	for (const [method, type] of Object.entries(methods)) assert.equal(type, 'function', `App.${method} is public`);
	const stats = await readStats(page);
	assertStats(stats);
	return stats;
}

// Project genuinely wet world positions with the current camera. Every point
// must hit the canvas itself, so UI overlays cannot accidentally satisfy a click.
export async function waterPath(page, offsets = [{ x: 0, z: 0 }]) {
	const points = await page.evaluate((deltas) => {
		const app = window.__pond;
		const canvas = app.canvas;
		const rect = canvas.getBoundingClientRect();
		app.camera.updateMatrixWorld();
		const candidates = [{ x: 0, z: 0 }];
		for (const radius of [1, 2, 3, 4, 5, 6]) {
			for (let i = 0; i < 32; i++) candidates.push({ x: Math.cos(i * Math.PI / 16) * radius, z: Math.sin(i * Math.PI / 16) * radius });
		}
		for (const candidate of candidates) {
			const path = [];
			for (const delta of deltas) {
				const wx = candidate.x + delta.x, wz = candidate.z + delta.z;
				const height = app.sim.surfaceAt(wx, wz).height;
				if (!app.hf.inPond(wx, wz) || height - app.hf.height(wx, wz) < 0.2) break;
				const ndc = app.camera.position.clone().set(wx, height, wz).project(app.camera);
				const x = rect.left + (ndc.x + 1) * rect.width / 2;
				const y = rect.top + (1 - ndc.y) * rect.height / 2;
				if (Math.abs(ndc.z) > 1 || x < 18 || x > innerWidth - 18 || y < 18 || y > innerHeight - 18) break;
				if (document.elementFromPoint(x, y) !== canvas) break;
				path.push({ x, y, world: { x: wx, z: wz } });
			}
			if (path.length === deltas.length) return path;
		}
		return null;
	}, offsets);
	assert.ok(points, 'an unobscured path over wet water is visible through the current camera');
	return points;
}

export async function assertThrowRelease(page, holdMs = 250) {
	await page.locator('.mode[data-mode="throw"]').click();
	const [point] = await waterPath(page);
	const before = (await readStats(page)).bodies;
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await waitForFrames(page, 2);
	assert.equal((await readStats(page)).bodies, before, 'press starts charging without creating a body');
	if (holdMs > 0) await page.waitForTimeout(holdMs);
	await page.mouse.up();
	await waitForFrames(page, 2);
	assert.equal((await readStats(page)).bodies, before + 1, 'release creates exactly one body');
	return { before, after: await readStats(page), target: point.world };
}

export async function assertThrowCancellation(page) {
	for (const cancellation of ['Escape', 'pointercancel', 'mode']) {
		await page.locator('.mode[data-mode="throw"]').click();
		const [point] = await waterPath(page);
		const before = (await readStats(page)).bodies;
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		assert.equal((await readStats(page)).bodies, before);
		if (cancellation === 'Escape') await page.keyboard.press('Escape');
		if (cancellation === 'pointercancel') {
			await page.locator('#scene').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 });
		}
		if (cancellation === 'mode') await page.evaluate(() => window.__pond.setMode('touch'));
		await page.mouse.up();
		await waitForFrames(page, 2);
		assert.equal((await readStats(page)).bodies, before, `${cancellation} cancels the charge without throwing`);
	}
}

async function recordImpulses(page, action) {
	await page.evaluate(() => {
		const sim = window.__pond.sim;
		window.__pondImpulseProbe = { original: sim.addImpulse, impulses: [] };
		sim.addImpulse = function (impulse) {
			window.__pondImpulseProbe.impulses.push({ ...impulse });
			return window.__pondImpulseProbe.original.call(this, impulse);
		};
	});
	try {
		await action();
		return await page.evaluate(() => window.__pondImpulseProbe.impulses);
	} finally {
		await page.evaluate(() => {
			window.__pond.sim.addImpulse = window.__pondImpulseProbe.original;
			delete window.__pondImpulseProbe;
		});
	}
}

export async function assertFeedAndStir(page) {
	await page.locator('.mode[data-mode="feed"]').click();
	const [point] = await waterPath(page);
	const before = await readStats(page);
	await page.mouse.click(point.x, point.y);
	const fed = await readStats(page);
	assert.ok(fed.pellets > before.pellets, 'feeding on visible water creates pellets');
	assert.equal(fed.bodies, before.bodies, 'feeding does not throw an object');
	await page.locator('.mode[data-mode="touch"]').click();
	const path = await waterPath(page, Array.from({ length: 9 }, (_, i) => ({ x: i * 0.13, z: Math.sin(i / 3) * 0.2 })));
	const impulses = await recordImpulses(page, async () => {
		await page.mouse.move(path[0].x, path[0].y);
		await page.mouse.down();
		for (const point of path.slice(1)) await page.mouse.move(point.x, point.y);
		await page.mouse.up();
	});
	assert.ok(impulses.length > 0, 'dragging through water submits impulses');
	assert.ok(impulses.length <= 128, 'a short stir has bounded impulse work');
	for (const impulse of impulses) {
		for (const key of ['x', 'z', 'radius', 'amp']) assert.ok(Number.isFinite(impulse[key]), `stir ${key} is finite`);
		assert.ok(impulse.radius > 0 && Math.abs(impulse.amp) <= 1);
	}
	assert.equal((await readStats(page)).bodies, before.bodies, 'stirring does not throw an object');
	return { fed, stirImpulseCount: impulses.length };
}

export async function assertQualitySwitching(page) {
	const options = await page.locator('#quality-select option').evaluateAll((elements) => elements.map((option) => option.value).sort());
	assert.deepEqual(options, ['auto', 'high', 'low', 'medium']);
	const report = [];
	for (const [tier, macroSize, microSize] of [['low', 128, 256], ['medium', 192, 384], ['low', 128, 256]]) {
		// Compare references synchronously, before a pellet can be eaten or a body
		// can naturally leave the pool on a later animation frame.
		const result = await page.evaluate((mode) => {
			const app = window.__pond;
			const pools = [app.fish.fish, app.throwables.bodies, app.food.pellets];
			const actors = pools.map((pool) => [...pool]);
			const positions = app.throwables.bodies.map((body) => body.pos.toArray());
			app.setQuality(mode);
			return {
				stats: app.getStats(),
				preserved: [app.fish.fish, app.throwables.bodies, app.food.pellets].every((pool, index) => pool.length === actors[index].length && pool.every((actor, j) => actor === actors[index][j])),
				positions, afterPositions: app.throwables.bodies.map((body) => body.pos.toArray()),
			};
		}, tier);
		assert.ok(result.preserved, `${tier} preserves existing fish, bodies, and pellets`);
		assert.deepEqual(result.afterPositions, result.positions, 'quality changes do not teleport bodies');
		assert.equal(result.stats.quality, tier);
		assert.equal(result.stats.qualityMode, 'manual');
		assert.equal(result.stats.macroSize, macroSize);
		assert.equal(result.stats.microSize, microSize);
		assert.equal(await page.locator('#quality-select').inputValue(), tier);
		await page.waitForFunction((previous) => {
			const stats = window.__pond.getStats();
			return stats.hasReadback && stats.readback > previous;
		}, result.stats.readback);
		const heights = await page.evaluate(() => Array.from(window.__pond.sim.readbackHeights));
		assert.ok(heights.length > 0 && heights.every(Number.isFinite), 'fresh readback remains finite after reallocating solver targets');
		report.push(await readStats(page));
	}
	await page.locator('#quality-select').selectOption('auto');
	assert.equal((await readStats(page)).qualityMode, 'auto');
	await page.locator('#quality-select').selectOption('low');
	assert.equal((await readStats(page)).qualityMode, 'manual');
	return report;
}

export async function assertResizePreservesActors(page, viewport) {
	const before = await page.evaluate(() => {
		const app = window.__pond;
		const vectors = (items) => items.map((item) => item.pos?.toArray?.() || [item.x, item.y, item.z]);
		return {
			fish: vectors(app.fish.fish), bodies: vectors(app.throwables.bodies), pellets: app.food.pellets.map((pellet) => [pellet.x, pellet.y, pellet.z]),
			readback: app.sim.readbackCount,
		};
	});
	await page.setViewportSize(viewport);
	const immediate = await page.evaluate(() => {
		const app = window.__pond;
		const vectors = (items) => items.map((item) => item.pos?.toArray?.() || [item.x, item.y, item.z]);
		return {
			fish: vectors(app.fish.fish), bodies: vectors(app.throwables.bodies), pellets: app.food.pellets.map((pellet) => [pellet.x, pellet.y, pellet.z]),
		};
	});
	await waitForFrames(page, 4);
	await page.waitForFunction((previous) => window.__pond.sim.hasReadback && window.__pond.sim.readbackCount > previous, before.readback);
	const after = await page.evaluate(() => {
		const app = window.__pond;
		const vectors = (items) => items.map((item) => item.pos?.toArray?.() || [item.x, item.y, item.z]);
		return {
			fish: vectors(app.fish.fish), bodies: vectors(app.throwables.bodies), pellets: app.food.pellets.map((pellet) => [pellet.x, pellet.y, pellet.z]),
			readback: app.sim.readbackCount, heights: Array.from(app.sim.readbackHeights),
		};
	});
	assert.equal(after.fish.length, before.fish.length, `resize at ${viewport.width}px preserves fish`);
	assert.equal(after.bodies.length, before.bodies.length, `resize at ${viewport.width}px preserves bodies`);
	assert.equal(after.pellets.length, before.pellets.length, `resize at ${viewport.width}px preserves pellets`);
	// A resize does not pause the live simulation; actors may advance between
	// the resize event and this assertion. The quality-switch test above checks
	// synchronous no-teleport behavior; this test checks resize-time finiteness
	// and identity/count preservation instead.
	for (const [name, beforePositions, afterPositions] of [['fish', before.fish, immediate.fish], ['bodies', before.bodies, immediate.bodies], ['pellets', before.pellets, immediate.pellets]]) {
		for (let i = 0; i < beforePositions.length; i++) {
			assert.ok(afterPositions[i]?.every(Number.isFinite), `${name} positions remain finite after resize`);
		}
	}
	assert.ok(after.heights.length > 0 && after.heights.every(Number.isFinite), 'resize keeps water readback finite');
	return { viewport, before, immediate, after };
}

export async function assertPublicActions(page) {
	const [target] = await waterPath(page);
	const observed = await page.evaluate(({ x, z }) => {
		const app = window.__pond;
		const before = app.getStats();
		app.throwAt(x, z, 0.6);
		app.feedAt(x, z);
		const after = app.getStats();
		return { before, after };
	}, target.world);
	assert.equal(observed.after.bodies, observed.before.bodies + 1, 'public throwAt creates one body');
	assert.ok(observed.after.pellets > observed.before.pellets, 'public feedAt creates food');
	const impulses = await recordImpulses(page, () => page.evaluate(({ x, z }) => window.__pond.stirAt(x, z, 1, -0.5, 0.2), target.world));
	assert.ok(impulses.length > 0, 'public stirAt submits a real solver impulse');
	assert.ok(impulses.every((impulse) => [impulse.x, impulse.z, impulse.radius, impulse.amp].every(Number.isFinite)));
	return { ...observed, stirImpulseCount: impulses.length };
}

export async function measurePond(session, durationMs = 2500) {
	await waitForFrames(session.page, 5);
	const sample = () => session.page.evaluate(() => ({
		stats: window.__pond.getStats(), frame: window.__pond.frame, time: window.__pond.time,
		hour: window.__pond.sky.hour, rain: window.__pond.sim.rain, wind: window.__pond.sim.windStrength,
	}));
	const before = await sample();
	const start = performance.now();
	await session.page.waitForTimeout(durationMs);
	const after = await sample();
	const wallSeconds = (performance.now() - start) / 1000;
	assertStats(after.stats);
	assert.ok(after.frame > before.frame, 'rendering progresses during the measurement');
	assert.ok(after.stats.steps > before.stats.steps, 'simulation work progresses during the measurement');
	assert.ok(after.stats.readback > before.stats.readback, 'readbacks continue completing');
	return {
		before, after, wallSeconds, viewport: session.page.viewportSize(), gpu: session.gpu, runtime: session.runtime,
		observedFps: (after.frame - before.frame) / wallSeconds,
		simulationSteps: after.stats.steps - before.stats.steps,
		simulatedSeconds: (after.stats.steps - before.stats.steps) / 120,
		worldSeconds: after.time - before.time,
	};
}
