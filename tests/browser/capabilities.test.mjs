import assert from 'node:assert/strict';
import test from 'node:test';
import { navigate, waitForPond, withBrowserSession } from '../../scripts/browser-harness.mjs';
import { assertStats } from './scenarios.mjs';
import { assertWaterHealth } from './water-health.mjs';

// Only hide capabilities; never claim an extension the underlying GPU lacks.
// This makes half-only emulation safe on native float-capable WebGL2 devices.
function blockFloatExtensions(mode) {
	const blocked = mode === 'none'
		? ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'OES_texture_half_float_linear']
		: ['EXT_color_buffer_float', 'OES_texture_float_linear'];
	window.__pondCapabilityProbe = [];
	for (const prototype of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
		if (!prototype) continue;
		const getExtension = prototype.getExtension;
		const getSupportedExtensions = prototype.getSupportedExtensions;
		prototype.getExtension = function (name) {
			if (blocked.includes(name)) {
				window.__pondCapabilityProbe.push(name);
				return null;
			}
			return getExtension.call(this, name);
		};
		prototype.getSupportedExtensions = function () {
			return (getSupportedExtensions.call(this) || []).filter((name) => !blocked.includes(name));
		};
	}
}

async function assertUnsupported(page) {
	await page.waitForFunction(() => {
		const candidates = [...document.querySelectorAll('[role="alert"], [aria-live]')];
		return candidates.some((element) => {
			const style = getComputedStyle(element);
			return style.display !== 'none' && Number(style.opacity) > 0 && /webgl|unsupported|float|device|graphics/i.test(element.textContent);
		});
	});
	const state = await page.evaluate(() => {
		const loading = document.getElementById('loading');
		const style = loading && getComputedStyle(loading);
		return {
			appAbsent: !window.__pond,
			loaderSettled: !loading || style.display === 'none' || style.pointerEvents === 'none'
				|| loading.getAttribute('aria-busy') === 'false'
				|| !!loading.querySelector('[role="alert"], [aria-live]')
				|| loading.matches('[role="alert"], [aria-live]'),
			busy: document.querySelectorAll('[aria-busy="true"]').length,
			blocked: window.__pondCapabilityProbe,
		};
	});
	assert.equal(state.appAbsent, true, 'unsupported devices do not expose an invalid running App');
	assert.equal(state.loaderSettled, true, 'unsupported devices settle into an error rather than an endless loader');
	assert.equal(state.busy, 0);
	assert.ok(state.blocked.includes('EXT_color_buffer_float'), 'the capability guard was actually exercised');
	return state;
}

test('no float render targets produces an accessible settled unsupported-device state', { timeout: 180000 }, async () => {
	await withBrowserSession('unsupported-float', async (session) => {
		await session.page.addInitScript(blockFloatExtensions, 'none');
		const response = await navigate(session, `${session.baseURL}/?quality=low`);
		assert.ok(response.ok());
		await session.report('unsupported-float.json', await assertUnsupported(session.page));
	});
});

test('half-only capabilities either run a finite half-float solver or explain native lack of support', { timeout: 240000 }, async (t) => {
	await withBrowserSession('half-float', async (session) => {
		await session.page.addInitScript(blockFloatExtensions, 'half');
		await navigate(session, `${session.baseURL}/?quality=low`);
		await session.page.waitForFunction(() => window.__pond?.ready || [...document.querySelectorAll('[role="alert"], [aria-live]')].some((element) => /webgl|unsupported|float|device|graphics/i.test(element.textContent)));
		if (!await session.page.evaluate(() => !!window.__pond?.ready)) {
			const unsupported = await assertUnsupported(session.page);
			t.diagnostic('The native GPU exposes no half-float render-target extension after masking full float; its accessible unsupported path was asserted.');
			await session.report('half-float.json', { outcome: 'native half-float unavailable', unsupported });
			return;
		}
		await waitForPond(session);
		await session.page.waitForFunction(() => window.__pond.getStats().hasReadback);
		const state = await session.page.evaluate(() => {
			const app = window.__pond;
			return { stats: app.getStats(), macroType: app.sim.macroRT[app.sim.macroIndex].texture.type, halfType: 1016, byteType: 1009 };
		});
		assert.equal(state.macroType, state.halfType, 'a supported half-only path uses signed half-float state');
		assert.notEqual(state.macroType, state.byteType);
		assertStats(state.stats);
		const health = await assertWaterHealth(session.page, 60);
		await session.report('half-float.json', { outcome: 'supported half-float', ...state, health });
	});
});
