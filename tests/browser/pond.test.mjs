import assert from 'node:assert/strict';
import test from 'node:test';
import { withBrowserSession, waitForFrames } from '../../scripts/browser-harness.mjs';
import { assertControls, assertFormGuards, assertLayout, ensureConditionsOpen } from './controls.mjs';
import { assertFeedAndStir, assertPublicActions, assertQualitySwitching, assertResizePreservesActors, assertStartup, assertThrowCancellation, assertThrowRelease, waterPath } from './scenarios.mjs';
import { assertWaterHealth } from './water-health.mjs';

test('startup, controls, lighting, and form-safe shortcuts work together', { timeout: 360000 }, async () => {
	await withBrowserSession('desktop-controls', async (session) => {
		const initial = await assertStartup(session);
		const controls = await assertControls(session.page);
		await assertFormGuards(session.page);
		const layouts = [];
		for (const viewport of [{ width: 1280, height: 800 }, { width: 900, height: 700 }]) {
			await session.page.setViewportSize(viewport);
			layouts.push(await assertLayout(session.page));
		}
		await session.report('desktop-controls.json', { initial, controls, layouts });
	});
});

test('charge/release/cancel, feed/stir, public actions, and live quality switching preserve actors', { timeout: 360000 }, async () => {
	await withBrowserSession('pointer-and-quality', async (session) => {
		await assertStartup(session);
		const charged = await assertThrowRelease(session.page, 300);
		const tap = await assertThrowRelease(session.page, 0);
		await assertThrowCancellation(session.page);
		const interaction = await assertFeedAndStir(session.page);
		const publicActions = await assertPublicActions(session.page);
		const quality = await assertQualitySwitching(session.page);
		await session.report('pointer-and-quality.json', { charged, tap, interaction, publicActions, quality });
	});
});

test('short unforced water run stays finite with sensible mass drift', { timeout: 360000 }, async () => {
	await withBrowserSession('water-health', async (session) => {
		await assertStartup(session);
		await session.report('water-health.json', await assertWaterHealth(session.page));
	});
});

test('320–390px layouts and touch cancellation do not accidentally throw', { timeout: 360000 }, async () => {
	await withBrowserSession('mobile-touch', async (session) => {
		await assertStartup(session);
		const layouts = [];
		for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
			await session.page.setViewportSize(viewport);
			layouts.push(await assertLayout(session.page));
		}
		await ensureConditionsOpen(session.page);
		await session.page.locator('#quality-select').selectOption('low');
		await waitForFrames(session.page, 4);
		const actors = await assertPublicActions(session.page);
		const resizedActors = [];
		for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
			resizedActors.push(await assertResizePreservesActors(session.page, viewport));
		}
		await session.page.locator('.mode[data-mode="throw"]').click();
		const points = await waterPath(session.page, [{ x: 0, z: 0 }, { x: 0.8, z: 0.4 }]);
		const before = await session.page.evaluate(() => window.__pond.getStats().bodies);
		const cdp = await session.context.newCDPSession(session.page);
		try {
			const first = { x: points[0].x, y: points[0].y, id: 1 };
			const second = { x: points[1].x, y: points[1].y, id: 2 };
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
			assert.equal(await session.page.evaluate(() => window.__pond.getStats().bodies), before, 'single touch starts a charge');
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await waitForFrames(session.page, 2);
			assert.equal(await session.page.evaluate(() => window.__pond.getStats().bodies), before, 'a two-finger gesture cancels the pending throw');
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
			await waitForFrames(session.page, 2);
			assert.equal(await session.page.evaluate(() => window.__pond.getStats().bodies), before, 'touchcancel creates no body');
		} finally {
			await cdp.detach();
		}
		await session.report('mobile-touch.json', { layouts, actors, resizedActors, bodiesAfterCancellation: before });
	}, { viewport: { width: 390, height: 844 }, hasTouch: true });
});
