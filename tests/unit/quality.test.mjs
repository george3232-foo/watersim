import assert from 'node:assert/strict';
import test from 'node:test';
import { QUALITY_PRESETS, QualityController } from '../../src/core/Quality.js';

const tiers = ['low', 'medium', 'high'];
const numericKeys = [
	'scale', 'maxDpr', 'macroSize', 'microSize', 'waterRes',
	'reflectionScale', 'reflectionInterval', 'shadowSize', 'foliage',
];

function updateFor(controller, fps, seconds, dt = 0.1) {
	const transitions = [];
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		const previous = controller.tier;
		const changed = controller.update(typeof fps === 'function' ? fps(i) : fps, dt);
		assert.equal(changed, controller.tier !== previous, 'update reports a concrete tier change only');
		assert.ok(tiers.includes(controller.tier));
		assert.deepEqual(controller.settings, QUALITY_PRESETS[controller.tier]);
		if (changed) transitions.push({ from: previous, to: controller.tier, time: i * dt });
	}
	return transitions;
}

test('quality presets expose real, ordered work budgets', () => {
	for (const tier of tiers) {
		const preset = QUALITY_PRESETS[tier];
		assert.ok(preset, `${tier} preset is present`);
		for (const key of numericKeys) {
			assert.ok(Number.isFinite(preset[key]) && preset[key] > 0, `${tier}.${key} is positive and finite`);
		}
		assert.equal(typeof preset.bloom, 'boolean');
		for (const key of ['macroSize', 'microSize', 'waterRes', 'shadowSize', 'reflectionInterval']) {
			assert.ok(Number.isInteger(preset[key]), `${tier}.${key} is an integer`);
		}
	}
	for (const key of ['scale', 'macroSize', 'microSize', 'waterRes', 'shadowSize', 'reflectionScale']) {
		assert.ok(QUALITY_PRESETS.low[key] < QUALITY_PRESETS.medium[key], `${key}: low does less work`);
		assert.ok(QUALITY_PRESETS.medium[key] < QUALITY_PRESETS.high[key], `${key}: medium does less work`);
	}
	assert.ok(QUALITY_PRESETS.low.reflectionInterval > QUALITY_PRESETS.high.reflectionInterval);
	assert.equal(QUALITY_PRESETS.low.bloom, false);
});

test('quality defaults and explicit selections keep mode, tier, and settings in sync', () => {
	const controller = new QualityController();
	assert.equal(controller.mode, 'auto');
	assert.equal(controller.tier, 'high');
	assert.deepEqual(controller.settings, QUALITY_PRESETS.high);
	assert.equal(new QualityController('auto', 'medium').tier, 'medium');
	for (const tier of ['low', 'high', 'medium', 'low']) {
		controller.setMode(tier);
		assert.equal(controller.mode, tier);
		assert.equal(controller.tier, tier);
		assert.deepEqual(controller.settings, QUALITY_PRESETS[tier]);
		assert.deepEqual(updateFor(controller, 8, 30), [], 'manual quality ignores sustained low FPS');
		assert.deepEqual(updateFor(controller, 120, 30), [], 'manual quality ignores sustained high FPS');
	}
	controller.setMode('auto');
	assert.equal(controller.mode, 'auto');
	assert.ok(tiers.includes(controller.tier));
});

test('auto quality warms up, downgrades on sustained load, and recovers without bouncing', () => {
	const controller = new QualityController('auto', 'high');
	assert.deepEqual(updateFor(controller, 8, 0.5), [], 'startup is not an immediate downgrade');
	const down = updateFor(controller, 8, 90);
	assert.equal(controller.tier, 'low', 'sustained overload eventually reaches low');
	assert.ok(down.length > 0 && down.length <= 2);
	for (const change of down) assert.ok(tiers.indexOf(change.to) < tiers.indexOf(change.from));
	const up = updateFor(controller, 120, 180);
	assert.equal(controller.tier, 'high', 'sustained headroom eventually recovers');
	assert.ok(up.length > 0 && up.length <= 2);
	for (const change of up) assert.ok(tiers.indexOf(change.to) > tiers.indexOf(change.from));
});

test('brief FPS dips and near-target jitter do not oscillate quality', () => {
	const controller = new QualityController('auto', 'high');
	updateFor(controller, 60, 20);
	assert.deepEqual(updateFor(controller, (i) => i % 30 < 2 ? 12 : 60, 30), [], 'isolated dips are not sustained load');
	const jitter = new QualityController('auto', 'medium');
	const changes = updateFor(jitter, (i) => [48, 54, 60, 52][i % 4], 90);
	assert.ok(changes.length <= 2, 'near-target noise cannot repeatedly change quality');
	const directions = changes.map(({ from, to }) => Math.sign(tiers.indexOf(to) - tiers.indexOf(from)));
	assert.ok(directions.every((direction) => direction === directions[0]), 'no alternating up/down decisions');
});
