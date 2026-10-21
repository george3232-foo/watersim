import assert from 'node:assert/strict';
import { readStats, waitForFrames } from '../../scripts/browser-harness.mjs';

async function setSlider(page, selector, value) {
	await page.locator(selector).evaluate((element, next) => {
		element.value = String(next);
		element.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}

async function blur(page) {
	await page.evaluate(() => document.activeElement?.blur());
}

function shortcutState(page) {
	return page.evaluate(() => ({
		muted: window.__pond.audio.muted,
		rain: window.__pond.sim.rain,
		mode: window.__pond.getStats().mode,
		photo: document.body.classList.contains('photo'),
		help: !document.getElementById('help').classList.contains('hidden'),
	}));
}

async function soundState(page) {
	return page.locator('#sound-btn').evaluate((button) => ({
		text: button.textContent, label: button.getAttribute('aria-label'),
		pressed: button.getAttribute('aria-pressed'), title: button.title, className: button.className,
	}));
}

export async function ensureConditionsOpen(page) {
	if (await page.locator('#conditions').evaluate((element) => element.classList.contains('collapsed'))) {
		await page.locator('#conditions-toggle').click();
	}
}

export async function assertControls(page) {
	await ensureConditionsOpen(page);
	const original = await shortcutState(page);
	const originalSound = await soundState(page);
	await page.locator('#sound-btn').click();
	assert.equal((await shortcutState(page)).muted, !original.muted, 'sound button toggles mute');
	assert.notDeepEqual(await soundState(page), originalSound, 'sound button exposes the changed state');
	await blur(page);
	await page.keyboard.press('m');
	assert.equal((await shortcutState(page)).muted, original.muted, 'M and the button share mute state');
	assert.deepEqual(await soundState(page), originalSound, 'M resynchronizes the sound button');
	await page.evaluate(() => window.__pond.setRain(0));
	await page.keyboard.press('r');
	const rain = await page.evaluate(() => window.__pond.sim.rain);
	assert.ok(rain > 0, 'R changes rain');
	assert.ok(Math.abs(Number(await page.locator('#rain-slider').inputValue()) - rain) < 0.011);
	assert.equal((await page.locator('#rain-out').textContent()).trim(), `${Math.round(rain * 100)}%`);
	await setSlider(page, '#rain-slider', 0.25);
	assert.ok(Math.abs((await shortcutState(page)).rain - 0.25) < 1e-6);
	await setSlider(page, '#wind-slider', 0.33);
	assert.ok(Math.abs(await page.evaluate(() => window.__pond.sim.windStrength) - 0.33) < 1e-6);
	assert.equal((await page.locator('#wind-out').textContent()).trim(), '33%');

	await setSlider(page, '#time-slider', 22.2);
	const night = await page.evaluate(() => ({ night: window.__pond.sky.state.night, y: window.__pond.sky.state.sunDir.y }));
	assert.ok(night.night > 0.8 && night.y < 0, '22.2 h is genuinely night');
	await setSlider(page, '#time-slider', 12);
	const noon = await page.evaluate(() => ({ night: window.__pond.sky.state.night, y: window.__pond.sky.state.sunDir.y }));
	assert.ok(noon.night < 0.2 && noon.y > 0, 'noon is genuinely day');
	const presets = [];
	for (const preset of ['golden', 'dawn', 'overcast', 'rain', 'night']) {
		await page.locator(`.chip[data-preset="${preset}"]`).click();
		const state = await page.evaluate(() => ({ hour: window.__pond.sky.hour, wind: window.__pond.sim.windStrength, rain: window.__pond.sim.rain }));
		assert.ok(Object.values(state).every(Number.isFinite));
		assert.equal(Number(await page.locator('#time-slider').inputValue()), state.hour);
		assert.ok(Math.abs(Number(await page.locator('#rain-slider').inputValue()) - state.rain) < 0.011);
		presets.push(state);
	}
	assert.equal(new Set(presets.map((preset) => JSON.stringify(preset))).size, 5, 'weather presets have distinct observed conditions');
	await page.locator('.chip[data-preset="golden"]').click();

	const hints = [];
	const bodies = (await readStats(page)).bodies;
	for (const [mode, hint] of [['throw', /throw|charge/i], ['touch', /touch|stir|drag/i], ['feed', /feed|food|scatter/i]]) {
		await page.locator(`.mode[data-mode="${mode}"]`).click();
		assert.equal((await readStats(page)).mode, mode);
		assert.equal((await readStats(page)).bodies, bodies, 'changing modes does not create a body');
		const text = (await page.locator('#hint').textContent()).trim();
		assert.match(text, hint);
		hints.push(text);
	}
	assert.equal(new Set(hints).size, 3, 'each mode has an appropriate hint');
	await blur(page);
	for (const [key, mode] of [['1', 'throw'], ['2', 'touch'], ['3', 'feed']]) {
		await page.keyboard.press(key);
		assert.equal((await readStats(page)).mode, mode);
	}
	await page.locator('.mode[data-mode="throw"]').click();
	for (const name of ['stone', 'apple', 'duck', 'ball', 'leaf', 'pebble']) {
		await page.locator(`.throwable[data-object="${name}"]`).click();
		assert.equal(await page.evaluate(() => window.__pond.selected), name);
	}
	await blur(page);
	await page.keyboard.press('p');
	await page.waitForFunction(() => {
		const button = document.getElementById('photo-exit');
		return document.body.classList.contains('photo') && Number(getComputedStyle(button).opacity) > 0.9 && getComputedStyle(button).pointerEvents !== 'none';
	});
	await page.locator('#photo-exit').click();
	assert.equal((await shortcutState(page)).photo, false, 'clicking the photo exit restores the UI');
	await blur(page);
	await page.keyboard.press('p');
	await page.keyboard.press('Escape');
	assert.equal((await shortcutState(page)).photo, false, 'Escape exits photo mode');
	await page.locator('#help-btn').click();
	assert.equal((await shortcutState(page)).help, true);
	await page.keyboard.press('Escape');
	assert.equal((await shortcutState(page)).help, false, 'Escape closes help');
	await page.locator('#help-btn').click();
	await page.locator('#help-close').click();
	assert.equal((await shortcutState(page)).help, false, 'help close button works');
	await page.locator('#conditions-toggle').click();
	assert.equal(await page.locator('#conditions .panel-body').evaluate((element) => getComputedStyle(element).display), 'none');
	await ensureConditionsOpen(page);
	return { night, noon, presets, hints };
}

export async function assertFormGuards(page) {
	await ensureConditionsOpen(page);
	await page.evaluate(() => {
		const textarea = document.createElement('textarea');
		textarea.id = 'verification-textarea';
		textarea.setAttribute('aria-label', 'Verification text entry');
		textarea.style.cssText = 'position:fixed;left:0;top:0;z-index:100;width:100px;height:30px';
		document.body.appendChild(textarea);
	});
	try {
		for (const selector of ['#time-slider', '#quality-select', '#verification-textarea']) {
			await page.locator(selector).focus();
			const before = await shortcutState(page);
			for (const key of ['m', 'r', 'p', 'h', '1', '2', '3']) await page.keyboard.press(key);
			assert.deepEqual(await shortcutState(page), before, `shortcuts ignore focused ${selector}`);
		}
	} finally {
		await page.locator('#verification-textarea').evaluate((element) => element.remove());
		await blur(page);
	}
	const beforeRepeat = await shortcutState(page);
	await page.evaluate(() => {
		for (const key of ['m', 'r', 'p', 'h']) window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true }));
	});
	assert.deepEqual(await shortcutState(page), beforeRepeat, 'repeated keydown does not retoggle controls');
}

export async function assertLayout(page) {
	await ensureConditionsOpen(page);
	await waitForFrames(page, 2);
	const layout = await page.evaluate(() => {
		const selectors = ['.mode', '.throwable', '#conditions-toggle', '#time-slider', '#wind-slider', '#rain-slider', '#quality-select', '#sound-btn', '#help-btn'];
		return {
			width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
			cameraAspect: window.__pond.camera.aspect,
			canvas: { width: window.__pond.canvas.width, height: window.__pond.canvas.height },
			controls: selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element) => {
				const rect = element.getBoundingClientRect();
				const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
				return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, reachable: hit === element || element.contains(hit) };
			})),
		};
	});
	assert.ok(layout.scrollWidth <= layout.width + 1, 'layout has no horizontal overflow');
	assert.ok(Math.abs(layout.cameraAspect - layout.width / layout.height) < 0.001, 'camera follows the resized viewport');
	assert.ok(layout.canvas.width > 0 && layout.canvas.height > 0);
	assert.ok(layout.controls.length >= 16, 'all expected control groups are present');
	for (const control of layout.controls) {
		assert.ok(control.width > 0 && control.height > 0, `${control.selector} has a usable box`);
		assert.ok(control.x >= -1 && control.y >= -1 && control.x + control.width <= layout.width + 1 && control.y + control.height <= layout.height + 1, `${control.selector} stays in the viewport at ${layout.width}px`);
		assert.ok(control.reachable, `${control.selector} is not covered by another control at ${layout.width}px`);
	}
	return layout;
}
