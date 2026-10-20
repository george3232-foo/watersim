import * as THREE from 'three';
import { mulberry32 } from '../core/Noise.js';

// Fish food: tiny pellets scattered on the surface that drift, slowly soak and
// sink, and get picked off by koi. Feeds the fish AI with real targets.

export class Food {
	constructor(heightField, sim, fish, opts = {}) {
		this.hf = heightField;
		this.sim = sim;
		this.fish = fish;
		this.rand = mulberry32(9911);
		this.capacity = opts.capacity ?? 64;
		this.pellets = [];
		this.group = new THREE.Group();
		this.group.name = 'food';

		const geo = new THREE.SphereGeometry(0.013, 7, 5);
		const mat = new THREE.MeshStandardMaterial({ color: 0x8a6728, roughness: 0.72, metalness: 0 });
		this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		const zeros = new THREE.Matrix4().makeScale(0, 0, 0);
		for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, zeros);
		this.mesh.instanceMatrix.needsUpdate = true;
		this.group.add(this.mesh);
	}

	freeSlot() {
		const used = new Set(this.pellets.map((p) => p.slot));
		for (let i = 0; i < this.capacity; i++) if (!used.has(i)) return i;
		const oldest = this.pellets.reduce((a, b) => (a && a.age > b.age ? a : b), null);
		if (oldest) {
			const i = this.pellets.indexOf(oldest);
			this.pellets.splice(i, 1);
			return oldest.slot;
		}
		return 0;
	}

	sprinkle(x, z, count = 8, radius = 0.45) {
		const rand = this.rand;
		let spawned = 0;
		for (let i = 0; i < count; i++) {
			const a = rand() * Math.PI * 2;
			const r = Math.sqrt(rand()) * radius;
			const px = x + Math.cos(a) * r;
			const pz = z + Math.sin(a) * r;
			if (!this.hf.inPond(px, pz)) continue;
			const depth = -this.hf.height(px, pz);
			if (depth < 0.06) continue;
			this.pellets.push({
				slot: this.freeSlot(),
				x: px, z: pz,
				y: 0,
				age: 0,
				sinkAt: 6 + rand() * 7,
				drift: (rand() - 0.5) * 0.02,
				phase: rand() * Math.PI * 2,
				vy: 0,
				bitten: false,
			});
			spawned++;
		}
		// a soft patter on the surface
		if (spawned) {
			this.sim.addImpulse({
				x, z, radius: radius + 0.3,
				amp: -0.004 * Math.min(spawned, 10),
				foam: 0.02,
				microScale: 1.5,
			});
		}
		return spawned;
	}

	update(dt, time) {
		if (dt <= 0) return;
		const sim = this.sim;
		const surf = { height: 0, depth: 0 };
		const wind = sim.wind;

		for (let i = this.pellets.length - 1; i >= 0; i--) {
			const p = this.pellets[i];
			p.age += dt;

			sim.sampleSurface(p.x, p.z, surf);
			const depthHere = -this.hf.height(p.x, p.z);

			// drift a touch with the wind while floating
			p.x += (p.drift + wind.x * sim.windStrength * 0.015) * dt;
			p.z += (p.drift + wind.y * sim.windStrength * 0.015) * dt;

			if (p.age > p.sinkAt) {
				// soaked: slowly submerges and drops through the water column
				p.vy -= 0.06 * dt;
				p.y = Math.max(p.y + p.vy * dt, -depthHere - 0.2);
			} else {
				// ride the surface with a tiny bob
				const target = surf.height + 0.010 + Math.sin(time * 2.1 + p.phase) * 0.004;
				p.y += (target - p.y) * Math.min(1, dt * 6);
			}

			// koi nibble when a pellet is close to the surface
			if (!p.bitten && this.fish && p.y > -0.06) {
				const took = this.fish.nibbleAt ? this.fish.nibbleAt(p.x, p.z) : false;
				if (took) {
					p.bitten = true;
					sim.addImpulse({ x: p.x, z: p.z, radius: 0.16, amp: -0.006, foam: 0.06, microScale: 1.6 });
					this.pellets.splice(i, 1);
					continue;
				}
			}
			if (p.y < -depthHere - 0.15) {
				this.pellets.splice(i, 1);
				continue;
			}
		}

		// write matrices
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const s = new THREE.Vector3(1, 1, 1);
		const v = new THREE.Vector3();
		const zeros = new THREE.Matrix4().makeScale(0, 0, 0);
		for (let i = 0; i < this.capacity; i++) {
			const p = this.pellets.find((x) => x.slot === i);
			if (p) {
				v.set(p.x, p.y, p.z);
				m.compose(v, q, s);
			} else {
				m.copy(zeros);
			}
			this.mesh.setMatrixAt(i, m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}
