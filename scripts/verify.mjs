import assert from 'node:assert/strict';
import { positiveNumber, waitForFrames, withBrowserSession } from './browser-harness.mjs';
import { assertLayout } from '../tests/browser/controls.mjs';
import { assertStartup, measurePond } from '../tests/browser/scenarios.mjs';
import { assertWaterHealth } from '../tests/browser/water-health.mjs';

// Owns a loopback Vite server; no pre-existing dev server is needed.
// POND_OUTPUT_DIR/--output-dir selects all JSON and screenshot artifacts.
// Hardware ANGLE is the default; POND_BROWSER_GPU=swiftshader or --software is
// available for CI. Any failed assertion, timeout, or screenshot exits nonzero.
await withBrowserSession('verify', async (session) => {
	const started = performance.now();
	const initial = await assertStartup(session);
	const loadMs = performance.now() - started;
	const layout = await assertLayout(session.page);
	const measurement = await measurePond(session, positiveNumber(process.env.POND_SAMPLE_MS ?? process.env.WAIT, 2500, 'POND_SAMPLE_MS'));
	const screenshots = [];
	if (!process.argv.includes('--no-screenshots')) screenshots.push(await session.screenshot('verify-day.png'));
	const health = await assertWaterHealth(session.page);
	await session.page.evaluate(() => window.__pond.setTime(22.2));
	await waitForFrames(session.page, 3);
	const night = await session.page.evaluate(() => ({ night: window.__pond.sky.state.night, sunY: window.__pond.sky.state.sunDir.y }));
	assert.ok(night.night > 0.8 && night.sunY < 0, 'night verification observes a below-horizon sun');
	if (!process.argv.includes('--no-screenshots')) screenshots.push(await session.screenshot('verify-night.png'));
	const report = { initial, loadMs, layout, measurement, health, night, screenshots };
	const reportPath = await session.report('verify.json', report);
	console.log(JSON.stringify({ passed: true, reportPath, loadMs, observedFps: measurement.observedFps, simulationSteps: measurement.simulationSteps, wallSeconds: measurement.wallSeconds, relativeVolumeDrift: health.relativeDrift, screenshots }, null, 2));
});
