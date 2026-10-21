import * as THREE from 'three';
import { mulberry32, clamp } from '../core/Noise.js';
import { waterColumn } from './WaterCoupling.js';

// Fish food: tiny pellets scattered on the surface that drift, slowly soak and
// sink, and get picked off by koi. Feeds the fish AI with real targets.

export class Food {
	constructor(heightField, sim, fish, opts = {}) {
		this.hf = heightField;
		this.sim = sim;
		this.fish = fish;
		this.rand = mulberry32(9911);
		this.capacity = Number.isFinite(opts.capacity) ? clamp(Math.floor(opts.capacity), 1, 256) : 64;
		this.pellets = [];
		this._slots = new Array(this.capacity).fill(null);
		this._surface = { height: 0, depth: 0, bed: 0 };
		this._matrix = new THREE.Matrix4();
		this._quaternion = new THREE.Quaternion();
		this._scale = new THREE.Vector3(1, 1, 1);
		this._position = new THREE.Vector3();
		this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
		this._time = 0;
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
		let oldest = this._slots[0];
		for (let i = 0; i < this.capacity; i++) {
			const p = this._slots[i];
			if (!p) return i;
			if (p.age > oldest.age) oldest = p;
		}
		this._removeAt(this.pellets.indexOf(oldest));
		return oldest.slot;
	}

	_removeAt(i) {
		this._slots[this.pellets[i].slot] = null;
		this.pellets.splice(i, 1);
	}

	sprinkle(x, z, count = 8, radius = 0.45) {
		if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
		count = Number.isFinite(count) ? clamp(Math.floor(count), 0, this.capacity) : 0;
		radius = Number.isFinite(radius) ? clamp(radius, 0, 4) : 0.45;
		const rand = this.rand;
		let spawned = 0;
		for (let i = 0; i < count; i++) {
			const a = rand() * Math.PI * 2;
			const r = Math.sqrt(rand()) * radius;
			const px = x + Math.cos(a) * r;
			const pz = z + Math.sin(a) * r;
			if (!this.hf.inPond(px, pz)) continue;
			const surf = waterColumn(this.hf, this.sim, px, pz, this._surface);
			if (surf.depth < 0.06) continue;
			const pellet = {
				slot: this.freeSlot(),
				x: px, z: pz,
				y: surf.height + 0.010,
				age: 0,
				sinkAt: 6 + rand() * 7,
				drift: (rand() - 0.5) * 0.02,
				phase: rand() * Math.PI * 2,
				vy: 0,
				bitten: false,
			};
			this.pellets.push(pellet);
			this._slots[pellet.slot] = pellet;
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
		if (!Number.isFinite(dt) || dt <= 0) return;
		dt = Math.min(dt, 0.1);
		this._time = Number.isFinite(time) ? time : this._time + dt;
		const sim = this.sim;
		const surf = this._surface;
		const strength = Number.isFinite(sim.windStrength) ? clamp(sim.windStrength, 0, 1) : 0;
		const windX = Number.isFinite(sim.wind?.x) ? sim.wind.x * strength : 0;
		const windZ = Number.isFinite(sim.wind?.y) ? sim.wind.y * strength : 0;

		for (let i = this.pellets.length - 1; i >= 0; i--) {
			const p = this.pellets[i];
			p.age += dt;

			// drift a touch with the wind while floating
			p.x += (p.drift + windX * 0.015) * dt;
			p.z += (p.drift + windZ * 0.015) * dt;
			waterColumn(this.hf, sim, p.x, p.z, surf);
			if (surf.depth < 0.02 || p.age > 30 || !Number.isFinite(p.x + p.y + p.z)) {
				this._removeAt(i);
				continue;
			}

			if (p.age > p.sinkAt) {
				// soaked: slowly submerges and drops through the water column
				p.vy -= 0.06 * dt;
				p.y = Math.min(surf.height + 0.014, p.y + p.vy * dt);
			} else {
				// ride the surface with a tiny bob
				const target = surf.height + 0.010 + Math.sin(this._time * 2.1 + p.phase) * 0.004;
				p.y = Math.max(surf.height + 0.004, p.y + (target - p.y) * (1 - Math.exp(-dt * 6)));
			}

			// koi nibble when a pellet is close to the surface
			if (!p.bitten && this.fish && p.y > surf.height - 0.06 && p.y < surf.height + 0.08) {
				const took = this.fish.nibbleAt ? this.fish.nibbleAt(p.x, p.z) : false;
				if (took) {
					p.bitten = true;
					sim.addImpulse({ x: p.x, z: p.z, radius: 0.16, amp: -0.006, foam: 0.06, microScale: 1.6 });
					this._removeAt(i);
					continue;
				}
			}
			if (p.y <= surf.bed + 0.01) {
				this._removeAt(i);
				continue;
			}
		}

		// write matrices
		const m = this._matrix;
		const v = this._position;
		for (let i = 0; i < this.capacity; i++) {
			const p = this._slots[i];
			if (p) {
				v.set(p.x, p.y, p.z);
				m.compose(v, this._quaternion, this._scale);
			} else {
				m.copy(this._zeroMatrix);
			}
			this.mesh.setMatrixAt(i, m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}
