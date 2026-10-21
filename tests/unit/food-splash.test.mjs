import assert from 'node:assert/strict';
import test from 'node:test';
import { Food } from '../../src/life/Food.js';
import { SplashFX } from '../../src/fx/Splash.js';
import { mulberry32 } from '../../src/core/Noise.js';
import { advance, disposeGroup, surfaceFixture } from '../helpers/fixtures.mjs';

test('food pool is bounded and deterministic, and pellets follow the sampled surface', (t) => {
	const fixture = surfaceFixture();
	const foods = [0, 1].map(() => new Food(fixture.hf, fixture.sim, null, { capacity: 7 }));
	for (const food of foods) {
		t.after(() => disposeGroup(food.group));
		food.sprinkle(0, 0, 200, 0.4);
		assert.equal(food.pellets.length, 7);
		assert.equal(new Set(food.pellets.map((pellet) => pellet.slot)).size, 7);
		assert.ok(food.pellets.every((pellet) => pellet.slot >= 0 && pellet.slot < 7));
	}
	assert.deepEqual(foods[0].pellets, foods[1].pellets, 'seeded food placement is reproducible');
	fixture.surface.height = 0.35;
	advance(foods[0], 60, 1);
	for (const pellet of foods[0].pellets) {
		assert.ok([pellet.x, pellet.y, pellet.z].every(Number.isFinite));
		assert.ok(pellet.y > 0.33 && pellet.y < 0.38, 'pellet rides the raised local surface');
	}
});

test('sprinkling on dry land creates neither pellets nor water impulses', (t) => {
	const { hf, sim, impulses } = surfaceFixture({ bed: 0.5 });
	const food = new Food(hf, sim, null);
	t.after(() => disposeGroup(food.group));
	assert.equal(food.sprinkle(0, 0, 20), 0);
	assert.equal(food.pellets.length, 0);
	assert.equal(impulses.length, 0);
});

test('splash rings retain their location and follow changing water height', (t) => {
	t.mock.method(Math, 'random', mulberry32(2701));
	const { sim, surface } = surfaceFixture({ height: 0.12 });
	const splash = new SplashFX({ sim, maxDroplets: 16, maxRings: 4 });
	t.after(() => disposeGroup(splash.group));
	splash.splashAt(0.7, -0.3, 0.18, { type: 'stone', radius: 0.075, vy: -2 });
	advance(splash, 60, 0.2);
	const rings = splash.group.children.filter((child) => child.name.startsWith('splash-ring-') && child.visible);
	assert.ok(rings.length > 0, 'a splash produces visible surface rings');
	const before = rings.map((ring) => ring.position.clone());
	surface.height += 0.27;
	splash.update(1 / 60, 0.2 + 1 / 60);
	for (let i = 0; i < rings.length; i++) {
		assert.equal(rings[i].position.x, before[i].x);
		assert.equal(rings[i].position.z, before[i].z);
		assert.ok(Math.abs(rings[i].position.y - before[i].y - 0.27) < 1e-6);
	}
});

test('splash bursts reuse bounded geometry and expire', (t) => {
	t.mock.method(Math, 'random', mulberry32(73));
	const { sim } = surfaceFixture();
	const splash = new SplashFX({ sim, maxDroplets: 18, maxRings: 3 });
	t.after(() => disposeGroup(splash.group));
	for (let i = 0; i < 40; i++) splash.splashAt(i * 0.01, 0, 0.5, { type: 'stone' });
	advance(splash, 60, 0.1);
	const points = splash.group.getObjectByName('splash-droplets');
	assert.ok(points.geometry.drawRange.count > 0 && points.geometry.drawRange.count <= 18);
	assert.equal(points.geometry.attributes.position.count, 18);
	assert.equal(splash.group.children.filter((child) => child.name.startsWith('splash-ring-')).length, 3);
	advance(splash, 60, 3, 0.1);
	assert.equal(points.geometry.drawRange.count, 0);
	assert.ok(splash.group.children.filter((child) => child.name.startsWith('splash-ring-')).every((ring) => !ring.visible));
});
