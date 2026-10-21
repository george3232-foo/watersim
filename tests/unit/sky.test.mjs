import assert from 'node:assert/strict';
import test from 'node:test';
import { Sky } from '../../src/world/Sky.js';

// Solar geometry has no renderer or DOM dependency; do not construct PMREM here.
const sky = Object.create(Sky.prototype);

test('solar direction stays finite and normalized over the entire day', () => {
	for (let minute = 0; minute <= 24 * 60; minute += 5) {
		const direction = sky.sunDirection(minute / 60);
		assert.ok(direction.toArray().every(Number.isFinite), `finite at ${minute / 60} h`);
		assert.ok(Math.abs(direction.length() - 1) < 1e-10);
	}
});

test('noon is above the horizon and 22.2 h is below it', () => {
	assert.ok(sky.sunDirection(12).y > 0.5);
	assert.ok(sky.sunDirection(22.2).y < 0);
	assert.ok(sky.sunDirection(0).y < 0);
});

test('the solar path is continuous at sunrise, sunset, and midnight', () => {
	for (const hour of [6, 20]) {
		assert.ok(sky.sunDirection(hour - 0.0001).distanceTo(sky.sunDirection(hour + 0.0001)) < 0.002);
	}
	assert.ok(sky.sunDirection(24 - 0.0001).distanceTo(sky.sunDirection(0.0001)) < 0.002);
	assert.ok(sky.sunDirection(0).distanceTo(sky.sunDirection(24)) < 1e-10, '24 h wraps to midnight');
});
