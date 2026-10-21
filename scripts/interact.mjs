import assert from 'node:assert/strict';
import { waitForFrames, withBrowserSession } from './browser-harness.mjs';
import { assertControls, assertFormGuards } from '../tests/browser/controls.mjs';
import { assertFeedAndStir, assertPublicActions, assertQualitySwitching, assertStartup, assertThrowCancellation, assertThrowRelease } from '../tests/browser/scenarios.mjs';

// Outcome-based interaction diagnostics reuse the integration test contracts.
// All artifacts use POND_OUTPUT_DIR/--output-dir; screenshot errors are failures.
await withBrowserSession('interact', async (session) => {
	const report = { initial: await assertStartup(session), screenshots: [] };
	report.controls = await assertControls(session.page);
	await assertFormGuards(session.page);
	report.chargedThrow = await assertThrowRelease(session.page, 350);
	report.tap = await assertThrowRelease(session.page, 0);
	await assertThrowCancellation(session.page);
	if (!process.argv.includes('--no-screenshots')) report.screenshots.push(await session.screenshot('interact-throw.png'));
	report.feedAndStir = await assertFeedAndStir(session.page);
	report.publicActions = await assertPublicActions(session.page);
	report.qualitySwitches = await assertQualitySwitching(session.page);
	await waitForFrames(session.page, 3);
	if (!process.argv.includes('--no-screenshots')) report.screenshots.push(await session.screenshot('interact-water.png'));
	await session.page.locator('.chip[data-preset="night"]').click();
	await waitForFrames(session.page, 3);
	report.night = await session.page.evaluate(() => ({ night: window.__pond.sky.state.night, sunY: window.__pond.sky.state.sunDir.y }));
	assert.ok(report.night.night > 0.8 && report.night.sunY < 0);
	if (!process.argv.includes('--no-screenshots')) report.screenshots.push(await session.screenshot('interact-night.png'));
	const reportPath = await session.report('interact.json', report);
	console.log(JSON.stringify({ passed: true, reportPath, bodiesAfterRelease: report.chargedThrow.after.bodies, pelletsAfterFeed: report.feedAndStir.fed.pellets, stirImpulses: report.feedAndStir.stirImpulseCount, screenshots: report.screenshots }, null, 2));
});
