import * as THREE from 'three';

export function surfaceFixture({ height = 0, slopeX = 0, slopeZ = 0, bed = -1.4 } = {}) {
	const impulses = [];
	const displaced = [];
	const surface = { height };
	const hf = {
		height: () => bed,
		inPond: (x, z) => Math.hypot(x, z) < 8,
		waterDepth: (x, z, level = surface.height) => Math.max(0, level - bed),
	};
	const sim = {
		wind: new THREE.Vector2(1, 0),
		windStrength: 0,
		levelOffset: 0,
		sampleSurface(x, z, out = {}) {
			out.height = surface.height + slopeX * x + slopeZ * z;
			out.depth = Math.max(0, out.height - bed);
			return out;
		},
		surfaceAt(x, z) { return this.sampleSurface(x, z); },
		slopeAt: () => ({ x: slopeX, z: slopeZ }),
		addImpulse: (impulse) => impulses.push({ ...impulse }),
		setDisplacedVolume: (volume, dt) => displaced.push({ volume, dt }),
	};
	return { hf, sim, surface, impulses, displaced };
}

export function advance(subject, hz, seconds, start = 0) {
	const frames = Math.round(hz * seconds);
	for (let frame = 1; frame <= frames; frame++) {
		subject.update(1 / hz, start + frame / hz);
	}
}

export function disposeGroup(group) {
	const geometries = new Set();
	const materials = new Set();
	group.traverse((object) => {
		if (object.geometry) geometries.add(object.geometry);
		for (const material of [object.material].flat()) {
			if (material) materials.add(material);
		}
	});
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
}
