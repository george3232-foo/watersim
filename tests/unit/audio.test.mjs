import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PondAudio, computeSpatialAudio } from '../../src/audio/Audio.js';

test('spatial audio stays bounded and moves opposite events to opposite sides', () => {
	const listener = { x: 0, y: 2, z: 0, rightX: 1, rightY: 0, rightZ: 0 };
	const left = computeSpatialAudio(listener, -8, 0, {});
	const right = computeSpatialAudio(listener, 8, 0, {});
	assert.ok(left.pan < -0.5 && right.pan > 0.5);
	assert.ok(left.gain > 0 && left.gain <= 1);
	assert.ok(right.gain > 0 && right.gain <= 1);
	assert.equal(computeSpatialAudio(null, 2, 3, {}).pan, 0, 'legacy no-listener events remain centered');
});

test('audio listener fields are exercised only when the optional spatial API exists', () => {
	const audio = new PondAudio();
	if (typeof audio.spatialAt !== 'function') return;
	const camera = new THREE.PerspectiveCamera();
	camera.position.set(3, 2, -4);
	camera.lookAt(0, 0, 0);
	audio.setListener(camera);
	assert.equal(audio.hasListener, true);
	for (const key of ['x', 'y', 'z', 'rightX', 'rightY', 'rightZ']) assert.ok(Number.isFinite(audio.listener[key]));
	for (const event of [[-5, 0], [0, 0], [5, 0]]) {
		const spatial = audio.spatialAt(event[0], event[1]);
		assert.ok(Number.isFinite(spatial.pan) && spatial.pan >= -1 && spatial.pan <= 1);
		assert.ok(Number.isFinite(spatial.gain) && spatial.gain > 0 && spatial.gain <= 1);
		assert.ok(Number.isFinite(spatial.distance) && spatial.distance >= 0);
	}
});
