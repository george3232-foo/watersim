import * as THREE from 'three';
import { mulberry32, clamp, TAU } from '../core/Noise.js';
import { surfaceHeight, waterColumn } from './WaterCoupling.js';

// Throwable objects with two-way water coupling. Physics is simple but uses
// real units: buoyancy from the submerged fraction of the displaced volume,
// quadratic drag, sloshing torque, splash impulses back into the solver.

const G = 9.81;
const RHO_W = 1000;
export const THROWABLE_FIXED_DT = 1 / 120;
export const THROWABLE_MAX_SUBSTEPS = 12;

function makeBodyGeometry(type, rand) {
	const parts = [];
	const push = (geo, color, metal = 0, rough = 0.6) => {
		const nonIdx = geo.index ? geo.toNonIndexed() : geo;
		const count = nonIdx.attributes.position.count;
		const arr = new Float32Array(count * 3);
		const c = new THREE.Color(color);
		for (let i = 0; i < count; i++) {
			const v = 0.9 + rand() * 0.2;
			arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v;
		}
		nonIdx.setAttribute('color', new THREE.BufferAttribute(arr, 3));
		parts.push(nonIdx);
		void metal; void rough;
		return nonIdx;
	};

	if (type === 'pebble' || type === 'stone') {
		const base = type === 'stone' ? 0.075 : 0.045;
		const g = new THREE.IcosahedronGeometry(base, 1);
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const s = 0.82 + rand() * 0.4;
			p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.8, p.getZ(i) * s);
		}
		g.computeVertexNormals();
		push(g, type === 'stone' ? 0x7d7869 : 0x8a8578);
	} else if (type === 'apple') {
		const g = new THREE.SphereGeometry(0.072, 14, 10);
		g.scale(1, 0.92, 1);
		push(g, 0x9c1f14);
		const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.05, 5, 1);
		stem.translate(0, 0.085, 0);
		push(stem, 0x4a3a20);
	} else if (type === 'duck') {
		const body = new THREE.SphereGeometry(0.09, 16, 12);
		body.scale(1, 0.78, 1.18);
		body.translate(0, -0.012, -0.01);
		push(body, 0xe2b32a);
		const head = new THREE.SphereGeometry(0.052, 14, 10);
		head.translate(0, 0.1, 0.075);
		push(head, 0xe8bd35);
		const beak = new THREE.ConeGeometry(0.022, 0.045, 8);
		beak.rotateX(Math.PI / 2);
		beak.translate(0, 0.092, 0.135);
		push(beak, 0xcc6a1f);
	} else if (type === 'ball') {
		const g = new THREE.SphereGeometry(0.085, 18, 14);
		const p = g.attributes.position;
		const palette = [
			new THREE.Color(0xd8dcd8), new THREE.Color(0xc23a2e),
			new THREE.Color(0xd8dcd8), new THREE.Color(0x2e6fb2),
			new THREE.Color(0xd8dcd8), new THREE.Color(0xd9b12c),
		];
		const arr = new Float32Array(p.count * 3);
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), z = p.getZ(i);
			const a = (Math.atan2(z, x) + Math.PI) / Math.PI * 3;
			const c = palette[Math.min(palette.length - 1, Math.floor(a)) % palette.length];
			const v = 0.92 + rand() * 0.16;
			arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v;
		}
		g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
		parts.push(g);
	} else {
		// leaf
		const g = new THREE.CircleGeometry(0.09, 10, 0.2, TAU - 0.4);
		g.rotateX(-Math.PI / 2);
		const p = g.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), z = p.getZ(i);
			p.setY(i, -Math.abs(x) * 0.12 + (rand() - 0.5) * 0.006);
			p.setX(i, x * 0.8);
			p.setZ(i, z * 1.35);
		}
		g.computeVertexNormals();
		push(g, 0x6d6a24);
	}

	const geo = parts.length > 1
		? mergeParts(parts)
		: parts[0];
	geo.computeBoundingSphere();
	return geo;
}

function mergeParts(parts) {
	// minimal merge: concatenate and offset indices
	let pos = [], col = [], idx = [], base = 0;
	for (const g of parts) {
		const p = g.attributes.position, c = g.attributes.color;
		for (let i = 0; i < p.count; i++) {
			pos.push(p.getX(i), p.getY(i), p.getZ(i));
			col.push(c.getX(i), c.getY(i), c.getZ(i));
		}
		if (g.index) {
			for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
		} else {
			for (let i = 0; i < p.count; i++) idx.push(base + i);
		}
		base += p.count;
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	out.setIndex(idx);
	out.computeVertexNormals();
	return out;
}

const TYPES = {
	pebble: { density: 2.6, radius: 0.045, height: 0.07, drag: 0.62, restitution: 0.34, floatTorque: 0.4, metal: 0.0, rough: 0.95 },
	stone: { density: 2.7, radius: 0.075, height: 0.11, drag: 0.6, restitution: 0.3, floatTorque: 0.3, metal: 0.0, rough: 0.95 },
	apple: { density: 0.75, radius: 0.073, height: 0.145, drag: 0.72, restitution: 0.38, floatTorque: 1.4, metal: 0.0, rough: 0.42 },
	duck: { density: 0.32, radius: 0.105, height: 0.17, drag: 0.9, restitution: 0.42, floatTorque: 2.2, metal: 0.0, rough: 0.55 },
	ball: { density: 0.14, radius: 0.085, height: 0.17, drag: 0.7, restitution: 0.6, floatTorque: 0.8, metal: 0.0, rough: 0.38 },
	leaf: { density: 0.22, radius: 0.09, height: 0.012, drag: 2.4, restitution: 0.05, floatTorque: 2.6, metal: 0.0, rough: 0.62 },
};

export class Throwables {
	constructor(hf, sim, opts = {}) {
		this.hf = hf;
		this.sim = sim;
		this.rand = mulberry32(4401);
		this.group = new THREE.Group();
		this.group.name = 'throwables';
		this.bodies = [];
		this.splashHook = opts.onSplash || null;
		this.capacity = Number.isFinite(opts.capacity) ? clamp(Math.floor(opts.capacity), 1, 256) : 12;
		this.fixedDt = THROWABLE_FIXED_DT;
		this.maxSubsteps = THROWABLE_MAX_SUBSTEPS;
		this.accumulator = 0;
		this.metrics = { steps: 0, totalSteps: 0, droppedTime: 0, displacedVolume: 0 };
		this._slots = {};
		this._surface = { height: 0, depth: 0, bed: 0 };
		this._slopeSample = { height: 0, depth: 0 };
		this._slope = new THREE.Vector2();
		this._normal = new THREE.Vector3();
		this._up = new THREE.Vector3();
		this._align = new THREE.Vector3();
		this._axis = new THREE.Vector3();
		this._deltaQuat = new THREE.Quaternion();
		this._matrix = new THREE.Matrix4();
		this._scale = new THREE.Vector3(1, 1, 1);
		this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
		this._types = Object.keys(TYPES);

		this.meshes = {};
		for (const name of this._types) {
			this._slots[name] = new Array(this.capacity).fill(null);
			const cfg = TYPES[name];
			const geo = makeBodyGeometry(name, mulberry32(97 + name.length * 13));
			const mat = new THREE.MeshStandardMaterial({
				vertexColors: true, roughness: cfg.rough, metalness: cfg.metal,
			});
			const mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
			mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			mesh.receiveShadow = false;
			const zeros = new THREE.Matrix4().makeScale(0, 0, 0);
			for (let i = 0; i < this.capacity; i++) mesh.setMatrixAt(i, zeros);
			mesh.instanceMatrix.needsUpdate = true;
			mesh.name = `throw-${name}`;
			this.group.add(mesh);
			this.meshes[name] = mesh;
		}
	}

	freeSlot(name) {
		const slots = this._slots[name];
		let oldest = slots[0];
		for (let i = 0; i < this.capacity; i++) {
			if (!slots[i]) return i;
			if (slots[i].born < oldest.born) oldest = slots[i];
		}
		return oldest.slot;
	}

	spawn(typeName, pos, vel, spin = 0.5) {
		const cfg = TYPES[typeName];
		if (!cfg || !pos || !vel || ![pos.x, pos.y, pos.z, vel.x, vel.y, vel.z].every(Number.isFinite)) return null;
		spin = Number.isFinite(spin) ? clamp(spin, 0, 8) : 0.5;
		const rand = this.rand;
		const slot = this.freeSlot(typeName);
		// kick out any previous occupant of the slot
		const previous = this._slots[typeName][slot];
		if (previous) this.removeBody(previous);
		const volume = Math.PI * cfg.radius * cfg.radius * cfg.height * (typeName === 'pebble' ? 0.55 : 0.62);

		const b = {
			type: typeName, cfg, slot,
			volume, mass: cfg.density * RHO_W * volume,
			pos: pos.clone(),
			vel: vel.clone(),
			quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * TAU, rand() * TAU, rand() * TAU)),
			angVel: new THREE.Vector3((rand() - 0.5) * 4 * spin, (rand() - 0.5) * 4 * spin, (rand() - 0.5) * 4 * spin),
			submerged: 0,
			surfaceHeight: 0,
			entryVy: 0,
			impactVy: 0,
			cool: 0,
			rippleT: rand() * 0.3,
			awake: true,
			born: performance.now(),
			rest: 0,
		};
		this.bodies.push(b);
		this._slots[typeName][slot] = b;
		return b;
	}

	removeBody(b) {
		const i = this.bodies.indexOf(b);
		if (i >= 0) this.bodies.splice(i, 1);
		if (this._slots[b.type][b.slot] === b) this._slots[b.type][b.slot] = null;
	}

	update(dt, time) {
		if (!Number.isFinite(dt) || dt <= 0) return;
		const budget = this.fixedDt * this.maxSubsteps;
		const pending = this.accumulator + dt;
		this.accumulator = Math.min(pending, budget);
		this.metrics.droppedTime += Math.max(0, pending - budget);
		let steps = 0;
		while (this.accumulator + 1e-10 >= this.fixedDt && steps < this.maxSubsteps) {
			this._fixedStep(this.fixedDt);
			this.accumulator = Math.max(0, this.accumulator - this.fixedDt);
			steps++;
		}
		this.metrics.steps = steps;
		this.metrics.totalSteps += steps;

		// Report once per render frame, even if it contained no fixed step. This
		// is volume in m³, not mass or an extra impulse in the gradient solver.
		let displacedVolume = 0;
		for (const b of this.bodies) {
			waterColumn(this.hf, this.sim, b.pos.x, b.pos.z, this._surface);
			b.surfaceHeight = this._surface.height;
			b.submerged = this._submerged(b, this._surface);
			displacedVolume += b.volume * b.submerged;
		}
		this.metrics.displacedVolume = displacedVolume;
		if (this.sim.setDisplacedVolume) this.sim.setDisplacedVolume(displacedVolume, dt);
		this._writeMatrices();
	}

	_submerged(b, surf) {
		if (surf.depth <= 0.02) return 0;
		const bottom = Math.max(surf.bed, b.pos.y - b.cfg.height * 0.5);
		return clamp((Math.min(surf.height, b.pos.y + b.cfg.height * 0.5) - bottom) / b.cfg.height, 0, 1);
	}

	_sampleSlope(x, z) {
		const eps = 0.25;
		const out = this._slopeSample;
		const hx = surfaceHeight(this.sim, x + eps, z, out) - surfaceHeight(this.sim, x - eps, z, out);
		const hz = surfaceHeight(this.sim, x, z + eps, out) - surfaceHeight(this.sim, x, z - eps, out);
		// Readback noise/shore discontinuities must not create unbounded flow.
		this._slope.set(clamp(hx / (2 * eps), -0.75, 0.75), clamp(hz / (2 * eps), -0.75, 0.75));
		return this._slope;
	}

	_fixedStep(dt) {
		const hf = this.hf;
		const sim = this.sim;
		const surf = this._surface;

		for (let bi = this.bodies.length - 1; bi >= 0; bi--) {
			const b = this.bodies[bi];
			const cfg = b.cfg;

			if (!Number.isFinite(b.pos.lengthSq() + b.vel.lengthSq() + b.angVel.lengthSq() + b.quat.lengthSq()) || Math.hypot(b.pos.x, b.pos.z) > 16 || b.pos.y < -2.4) {
				this.removeBody(b);
				continue;
			}

			waterColumn(hf, sim, b.pos.x, b.pos.z, surf);
			const halfH = cfg.height * 0.5;
			const sub = this._submerged(b, surf);
			const entryVy = b.vel.y;
			b.cool = Math.max(0, b.cool - dt);
			const { volume, mass } = b;

			// gravity + Archimedes buoyancy
			let fy = -mass * G;
			if (sub > 0) fy += RHO_W * G * volume * sub;
			b.vel.y += (fy / mass) * dt;

			// Quadratic drag integrated implicitly. Explicit Euler here is
			// unstable for light floaters: at 20 fps a fast entry can reverse
			// the velocity in a single step and launch a duck out of the pond.
			const slope = this._sampleSlope(b.pos.x, b.pos.z);
			const flowX = sub > 0 ? -slope.x * 1.2 : 0, flowZ = sub > 0 ? -slope.y * 1.2 : 0;
			const rvx = b.vel.x - flowX, rvz = b.vel.z - flowZ, rvy = b.vel.y;
			const relV = Math.hypot(rvx, rvy, rvz);
			// hydrodynamic drag only acts on the submerged part; in air keep a
			// negligible aerodynamic term so free flight stays ballistic.
			const immersedArea = Math.PI * cfg.radius * cfg.radius * sub * 2.2;
			const airArea = Math.PI * cfg.radius * cfg.radius;
			const dragCoef = 0.5 * (RHO_W * cfg.drag * immersedArea + 1.2 * 0.47 * airArea);
			// A small implicit viscous term damps the final bob instead of letting
			// quadratic drag approach zero at equilibrium indefinitely.
			const damp = 1 / (1 + ((dragCoef / mass) * relV + 1.6 * sub / cfg.density) * dt);
			b.vel.x = flowX + rvx * damp;
			b.vel.y = rvy * damp;
			b.vel.z = flowZ + rvz * damp;

			// integrate linear
			b.pos.x += b.vel.x * dt;
			b.pos.y += b.vel.y * dt;
			b.pos.z += b.vel.z * dt;

			// ground/bed collision: this covers both the pond bed and the bank
			waterColumn(hf, sim, b.pos.x, b.pos.z, surf);
			const restY = surf.bed + halfH;
			if (b.pos.y < restY) {
				b.pos.y = restY;
				if (b.vel.y < 0) {
					b.vel.y = Math.abs(b.vel.y) > 0.5 ? -b.vel.y * cfg.restitution : 0;
				}
				b.vel.x *= Math.exp(-4.5 * dt);
				b.vel.z *= Math.exp(-4.5 * dt);
				b.angVel.multiplyScalar(Math.exp(-3.0 * dt));
			}

			const nextSub = this._submerged(b, surf);
			b.surfaceHeight = surf.height;
			b.submerged = nextSub;
			// Detect first contact after moving, including a thin leaf crossing
			// the surface in one step. The existing two-argument hook is retained.
			if (sub <= 0.02 && nextSub > 0.02 && entryVy < -0.35 && b.cool <= 0) {
				b.entryVy = entryVy;
				b.impactVy = entryVy;
				b.cool = 0.18;
				const impact = clamp(mass * -entryVy * 0.35, 0.002, 0.5);
				const softness = b.type === 'leaf' ? 0.15 : (cfg.density < 1 ? 0.65 : 1);
				sim.addImpulse({
					x: b.pos.x, z: b.pos.z,
					radius: cfg.radius * (b.type === 'stone' ? 3.8 : 3.0) + 0.04,
					amp: -Math.min(0.14, 0.012 + impact * 0.30) * softness,
					flowX: b.vel.x * 0.4, flowZ: b.vel.z * 0.4,
					flowStrength: clamp(impact * 1.4, 0, 0.5) * softness,
					foam: clamp(0.12 + impact * 0.9, 0, 0.7) * softness,
					microScale: b.type === 'leaf' ? 0.7 : 1.7,
				});
				if (this.splashHook) this.splashHook(b, impact, {
					type: b.type, radius: cfg.radius, vy: entryVy, height: surf.height,
				});
			}

			// Align local up with the sampled water normal. Angle-axis feedback
			// also rights an upside-down floater; torque and spin are bounded.
			if (nextSub > 0.02 && cfg.density < 1.0) {
				const localSlope = this._sampleSlope(b.pos.x, b.pos.z);
				const normal = this._normal.set(-localSlope.x, 1, -localSlope.y).normalize();
				const up = this._up.set(0, 1, 0).applyQuaternion(b.quat);
				const align = this._align.crossVectors(up, normal);
				const sine = align.length();
				const cosine = clamp(up.dot(normal), -1, 1);
				if (sine > 1e-6) align.multiplyScalar(Math.atan2(sine, cosine) / sine);
				else align.set(cosine < 0 ? Math.PI : 0, 0, 0);
				align.multiplyScalar(cfg.floatTorque * nextSub * 9).clampLength(0, 12);
				b.angVel.addScaledVector(align, dt);
			}

			// air/water angular damping
			b.angVel.multiplyScalar(Math.exp(-(nextSub > 0.02 ? 2.6 : 0.35) * dt)).clampLength(0, 12);

			// small tangential ripple while adrift on the surface
			if (nextSub > 0.2 && nextSub < 0.9) {
				b.rippleT -= dt;
				const sp = Math.hypot(b.vel.x, b.vel.z);
				if (b.rippleT <= 0 && sp > 0.05) {
					b.rippleT = 0.22 + this.rand() * 0.25;
					sim.addImpulse({
						x: b.pos.x, z: b.pos.z,
						radius: cfg.radius * 2.2 + 0.04,
						amp: -0.0028 * (0.5 + Math.min(sp, 2)),
						foam: 0.0,
						microScale: 1.2,
					});
				}
			}

			// integrate rotation
			if (b.angVel.lengthSq() > 1e-6) {
				const ang = b.angVel.length() * dt;
				this._axis.copy(b.angVel).normalize();
				this._deltaQuat.setFromAxisAngle(this._axis, ang);
				b.quat.premultiply(this._deltaQuat).normalize();
			}

			// wind nudge for the leaf
			if (b.type === 'leaf' && nextSub > 0) {
				const strength = Number.isFinite(sim.windStrength) ? clamp(sim.windStrength, 0, 1) : 0;
				b.vel.x += (Number.isFinite(sim.wind?.x) ? sim.wind.x : 0) * strength * 0.6 * dt;
				b.vel.z += (Number.isFinite(sim.wind?.y) ? sim.wind.y : 0) * strength * 0.6 * dt;
			}
		}
	}

	_writeMatrices() {
		const m = this._matrix;
		for (const name of this._types) {
			const mesh = this.meshes[name];
			const slots = this._slots[name];
			for (let i = 0; i < this.capacity; i++) {
				const b = slots[i];
				if (b) m.compose(b.pos, b.quat, this._scale);
				else m.copy(this._zeroMatrix);
				mesh.setMatrixAt(i, m);
			}
			mesh.instanceMatrix.needsUpdate = true;
		}
	}
}
