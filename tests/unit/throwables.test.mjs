import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Throwables } from '../../src/life/Throwables.js';
import { advance, disposeGroup, surfaceFixture } from '../helpers/fixtures.mjs';

function makeThrowables(t, options = {}, surfaceOptions = {}) {
	const fixture = surfaceFixture(surfaceOptions);
	const throwables = new Throwables(fixture.hf, fixture.sim, options);
	t.after(() => disposeGroup(throwables.group));
	return { ...fixture, throwables };
}

function assertFiniteBody(body) {
	assert.ok(body.pos.toArray().every(Number.isFinite), 'finite position');
	assert.ok(body.vel.toArray().every(Number.isFinite), 'finite velocity');
	assert.ok(body.quat.toArray().every(Number.isFinite), 'finite rotation');
	assert.ok(Math.abs(body.quat.length() - 1) < 1e-6, 'normalized rotation');
	assert.ok(body.submerged >= 0 && body.submerged <= 1, 'bounded submerged fraction');
}

for (const type of ['pebble', 'duck']) {
	test(`${type} reaches the same state over equal simulated time at 30/60/120 Hz`, (t) => {
		const results = [30, 60, 120].map((hz) => {
			const { throwables } = makeThrowables(t);
			const body = throwables.spawn(type, new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0.7, -1.2, 0.2), 0.3);
			advance(throwables, hz, 1);
			assert.equal(throwables.bodies.length, 1);
			assertFiniteBody(body);
			return body;
		});
		for (const body of results.slice(1)) {
			assert.ok(body.pos.distanceTo(results[0].pos) < 1e-5, 'fixed-step positions agree');
			assert.ok(body.vel.distanceTo(results[0].vel) < 1e-5, 'fixed-step velocities agree');
			assert.ok(1 - Math.abs(body.quat.dot(results[0].quat)) < 1e-6, 'fixed-step rotations agree');
		}
	});
}

test('throwables bound catch-up after a stalled frame', (t) => {
	const { throwables } = makeThrowables(t);
	const body = throwables.spawn('pebble', new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0);
	throwables.update(5, 5);
	assertFiniteBody(body);
	assert.ok(body.pos.y > 0, 'one stalled frame does not integrate five seconds of gravity');
});

test('floaters settle, follow local slope, and report positive bounded displacement', (t) => {
	const slopeX = 0.1, slopeZ = -0.06;
	const { throwables, displaced } = makeThrowables(t, {}, { slopeX, slopeZ });
	const body = throwables.spawn('duck', new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(), 0);
	body.quat.identity();
	advance(throwables, 60, 12);
	assertFiniteBody(body);
	assert.ok(Math.abs(body.pos.y) < 0.5, 'floater remains near the surface');
	assert.ok(body.vel.length() < 0.5, 'floater settles without gaining energy');
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.quat);
	const normal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
	assert.ok(up.dot(normal) > 0.99, 'local up approaches the sampled water normal');
	assert.ok(up.x < -0.02 && up.z > 0.01, 'orientation follows the slope rather than world-up');
	assert.ok(displaced.some(({ volume }) => volume > 0), 'submerged objects displace water');
	for (const { volume, dt } of displaced) {
		assert.ok(Number.isFinite(volume) && volume >= 0 && volume < 0.1);
		assert.ok(Number.isFinite(dt) && dt > 0);
	}
});

test('dense objects sink while light objects remain at the surface', (t) => {
	const { throwables } = makeThrowables(t);
	const stone = throwables.spawn('stone', new THREE.Vector3(-0.5, 0.1, 0), new THREE.Vector3(), 0);
	const ball = throwables.spawn('ball', new THREE.Vector3(0.5, 0.1, 0), new THREE.Vector3(), 0);
	advance(throwables, 60, 8);
	assertFiniteBody(stone);
	assertFiniteBody(ball);
	assert.ok(stone.pos.y < -1, 'stone settles on the bed');
	assert.ok(ball.pos.y > -0.1 && ball.pos.y < 0.3, 'ball floats');
});

test('recycling a full throwable pool keeps unique bounded instance slots', (t) => {
	const capacity = 3;
	const { throwables } = makeThrowables(t, { capacity });
	for (const type of ['pebble', 'duck']) {
		for (let i = 0; i < 30; i++) {
			throwables.spawn(type, new THREE.Vector3(i * 0.01, 1, 0), new THREE.Vector3(), 0);
		}
		const bodies = throwables.bodies.filter((body) => body.type === type);
		assert.equal(bodies.length, capacity);
		assert.equal(new Set(bodies.map((body) => body.slot)).size, capacity);
		assert.ok(bodies.every((body) => body.slot >= 0 && body.slot < capacity));
	}
	assert.equal(throwables.bodies.length, capacity * 2);
});
