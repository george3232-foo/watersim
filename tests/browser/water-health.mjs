import assert from 'node:assert/strict';

export async function assertWaterHealth(page, steps = 120) {
	const health = await page.evaluate(async (stepCount) => {
		const app = window.__pond;
		const sim = app.sim;
		const renderer = app.engine.renderer;
		cancelAnimationFrame(app._raf);
		const previous = { wind: sim.windStrength, angle: Math.atan2(sim.wind.y, sim.wind.x), rain: sim.rain };
		const waitForReadback = async () => {
			const started = performance.now();
			while (sim.reading) {
				if (performance.now() - started > 30000) throw new Error('Water-health readback did not finish');
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		};
		try {
			await waitForReadback();
			sim.setWind(0, 0);
			sim.setRain(0);
			sim.levelOffset = 0;
			sim.pending.length = 0;
			sim.init();
			const bed = sim.bedTexture.image;
			if (!bed?.data || !bed.width || !bed.height) throw new Error('CPU bed texels are required for a meaningful volume measurement');
			const decodeBed = (index) => bed.data[index];
			const texel = (x, y) => decodeBed((Math.max(0, Math.min(bed.height - 1, y)) * bed.width + Math.max(0, Math.min(bed.width - 1, x))) * 4);
			const bedAt = (u, v) => {
				// Match the actual uploaded texture and filter, not an analytic height
				// at a different grid or an incorrectly indexed macro-sized bed array.
				if (sim.bedTexture.magFilter !== 1006) return texel(Math.floor(u * bed.width), Math.floor(v * bed.height));
				const x = u * bed.width - 0.5, y = v * bed.height - 0.5;
				const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
				return (texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx) * (1 - fy)
					+ (texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx) * fy;
			};
			const snapshot = async () => {
				await waitForReadback();
				const previousCount = sim.readbackCount;
				sim.updateReadback();
				await waitForReadback();
				if (!sim.hasReadback || sim.readbackCount <= previousCount) throw new Error('Water-health check requires a fresh successful RGBA8 mirror readback');
				const target = sim.macroRT[sim.macroIndex];
				const fullFloat = target.texture.type === 1015 && renderer.extensions.has('EXT_color_buffer_float');
				let heights, n, allChannelsFinite;
				if (fullFloat) {
					// Float32Array readback is valid for a full-float macro target only.
					// Never issue it against HalfFloatType, even on a float-capable GPU.
					n = target.width;
					const rgba = new Float32Array(n * n * 4);
					renderer.readRenderTargetPixels(target, 0, 0, n, n, rgba);
					allChannelsFinite = rgba.every(Number.isFinite);
					heights = Array.from({ length: n * n }, (_, i) => rgba[i * 4]);
				} else {
					n = sim.readbackRT.width;
					heights = Array.from(sim.readbackHeights);
					allChannelsFinite = heights.every(Number.isFinite);
				}
				let volume = 0, wetMaxAbsHeight = 0, wetCells = 0;
				for (let y = 0; y < n; y++) {
					for (let x = 0; x < n; x++) {
						const eta = heights[y * n + x];
						const bottom = bedAt((x + 0.5) / n, (y + 0.5) / n);
						if (!Number.isFinite(bottom)) throw new Error('Nonfinite CPU bed texel');
						volume += Math.max(0, eta - bottom) * (sim.domain / n) ** 2;
						if (bottom < -0.1) {
							wetCells++;
							wetMaxAbsHeight = Math.max(wetMaxAbsHeight, Math.abs(eta));
						}
					}
				}
				return {
					method: fullFloat ? 'full-float macro RGBA' : '128px quantized RGBA8 CPU mirror',
					targetType: target.texture.type, macroFloatType: sim.macroFloatType,
					grid: n, allChannelsFinite, volume, wetMaxAbsHeight, wetCells,
					steps: sim.totalSteps, readback: sim.readbackCount, readbackLatency: sim.readbackLatency,
				};
			};
			const before = await snapshot();
			const started = performance.now();
			for (let step = 1; step <= stepCount; step++) sim.update(1 / 120, step / 120);
			const after = await snapshot();
			return { before, after, requestedSteps: stepCount, simulatedSeconds: stepCount / 120, wallMs: performance.now() - started };
		} finally {
			renderer.setRenderTarget(null);
			sim.setWind(previous.wind, previous.angle);
			sim.setRain(previous.rain);
			app.last = performance.now();
			app._raf = requestAnimationFrame(app.loop);
		}
	}, steps);
	for (const snapshot of [health.before, health.after]) {
		assert.equal(snapshot.allChannelsFinite, true, `${snapshot.method}: finite solver data`);
		assert.ok(Number.isFinite(snapshot.volume) && snapshot.volume > 1, 'pond contains a sensible positive water volume');
		assert.ok(snapshot.wetCells > 100, 'volume measurement samples the wet basin');
		assert.ok(snapshot.wetMaxAbsHeight < 0.05, 'unforced wet-cell heights remain close to rest, including on half-float hardware');
		assert.ok(Number.isFinite(snapshot.readbackLatency) && snapshot.readbackLatency >= 0);
	}
	assert.ok(health.after.steps - health.before.steps >= steps - 1, 'the requested simulation work actually ran');
	const relativeDrift = Math.abs(health.after.volume - health.before.volume) / health.before.volume;
	assert.ok(relativeDrift < 0.01, `short unforced volume drift is below 1%, observed ${(relativeDrift * 100).toFixed(4)}%`);
	return { ...health, relativeDrift };
}
