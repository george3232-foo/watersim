import * as THREE from 'three';
import { mulberry32, clamp, TAU } from '../core/Noise.js';

// Throwable objects with two-way water coupling. Physics is simple but uses
// real units: buoyancy from the submerged fraction of the displaced volume,
// quadratic drag, sloshing torque, splash impulses back into the solver.

const G = 9.81;
const RHO_W = 1000;

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
		this.capacity = opts.capacity ?? 12;

		this.meshes = {};
		for (const name of Object.keys(TYPES)) {
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
		const used = new Set(this.bodies.filter((b) => b.type === name).map((b) => b.slot));
		for (let i = 0; i < this.capacity; i++) if (!used.has(i)) return i;
		// recycle the oldest
		const oldest = this.bodies.filter((b) => b.type === name).sort((a, b) => a.born - b.born)[0];
		if (oldest) return oldest.slot;
		return 0;
	}

	spawn(typeName, pos, vel, spin = 0.5) {
		const cfg = TYPES[typeName];
		if (!cfg) return null;
		const rand = this.rand;
		const slot = this.freeSlot(typeName);
		// kick out any previous occupant of the slot
		const prevIdx = this.bodies.findIndex((b) => b.type === typeName && b.slot === slot);
		if (prevIdx >= 0) this.bodies.splice(prevIdx, 1);

		const b = {
			type: typeName, cfg, slot,
			pos: pos.clone(),
			vel: vel.clone(),
			quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * TAU, rand() * TAU, rand() * TAU)),
			angVel: new THREE.Vector3((rand() - 0.5) * 4 * spin, (rand() - 0.5) * 4 * spin, (rand() - 0.5) * 4 * spin),
			submerged: 0,
			cool: 0,
			rippleT: rand() * 0.3,
			awake: true,
			born: performance.now(),
			rest: 0,
		};
		this.bodies.push(b);
		return b;
	}

	removeBody(b) {
		const i = this.bodies.indexOf(b);
		if (i >= 0) this.bodies.splice(i, 1);
	}

	update(dt, time) {
		if (dt <= 0) return;
		const hf = this.hf;
		const sim = this.sim;
		const up = new THREE.Vector3(0, 1, 0);
		const tmp = new THREE.Vector3();
		const surf = { height: 0, depth: 0 };

		for (let bi = this.bodies.length - 1; bi >= 0; bi--) {
			const b = this.bodies[bi];
			const cfg = b.cfg;

			// out of play: drifted far away or too old
			if (Math.hypot(b.pos.x, b.pos.z) > 16 || b.pos.y < -2.4) {
				this.removeBody(b);
				continue;
			}

			sim.sampleSurface(b.pos.x, b.pos.z, surf);
			const eta = surf.height;
			const bed = hf.height(b.pos.x, b.pos.z);
			const halfH = cfg.height * 0.5;
			const bottom = b.pos.y - halfH;
			const topY = b.pos.y + halfH;
			// there is a water column here only inside the pond
			const hasWater = (eta - bed) > 0.02;

			// submerged fraction of the object's volume (flat-plate approximation)
			let sub = 0;
			if (hasWater && eta > bottom) {
				sub = clamp((Math.min(eta, topY) - bottom) / cfg.height, 0, 1);
			}
			const wasSub = b.submerged;
			b.submerged = sub;

			// splash on entry
			const volume = (Math.PI * cfg.radius * cfg.radius * cfg.height) * (b.type === 'pebble' ? 0.55 : 0.62);
			const mass = cfg.density * RHO_W * volume;
			if (wasSub < 0.12 && sub > 0.25 && b.vel.y < -0.35) {
				const impact = clamp(mass * -b.vel.y * 0.35, 0.002, 0.5);
				const amp = -clamp(0.012 + impact * 0.30, 0, 0.14);
				sim.addImpulse({
					x: b.pos.x, z: b.pos.z,
					radius: cfg.radius * 3.4 + 0.05,
					amp,
					flowX: b.vel.x * 0.4, flowZ: b.vel.z * 0.4,
					flowStrength: clamp(impact * 1.4, 0, 0.5),
					foam: clamp(0.12 + impact * 0.9, 0, 0.7),
					microScale: 1.7,
				});
				if (this.splashHook) this.splashHook(b, impact);
			}

			const inWater = sub > 0.02;

			// gravity + Archimedes buoyancy
			let fy = -mass * G;
			if (sub > 0) fy += RHO_W * G * volume * sub;
			b.vel.y += (fy / mass) * dt;

			// Quadratic drag integrated implicitly. Explicit Euler here is
			// unstable for light floaters: at 20 fps a fast entry can reverse
			// the velocity in a single step and launch a duck out of the pond.
			const slope = sim.slopeAt(b.pos.x, b.pos.z, 0.3);
			const flowX = -slope.x * 1.2, flowZ = -slope.z * 1.2;
			const rvx = b.vel.x - flowX, rvz = b.vel.z - flowZ, rvy = b.vel.y;
			const relV = Math.hypot(rvx, rvy, rvz);
			// hydrodynamic drag only acts on the submerged part; in air keep a
			// negligible aerodynamic term so free flight stays ballistic.
			const immersedArea = Math.PI * cfg.radius * cfg.radius * sub * 2.2;
			const airArea = Math.PI * cfg.radius * cfg.radius;
			const dragCoef = 0.5 * (RHO_W * cfg.drag * immersedArea + 1.2 * 0.47 * airArea);
			const damp = 1 / (1 + (dragCoef / mass) * relV * dt);
			b.vel.x = flowX + rvx * damp;
			b.vel.y = rvy * damp;
			b.vel.z = flowZ + rvz * damp;

			// integrate linear
			b.pos.x += b.vel.x * dt;
			b.pos.y += b.vel.y * dt;
			b.pos.z += b.vel.z * dt;

			// ground/bed collision: this covers both the pond bed and the bank
			const restY = bed + halfH * 0.62;
			if (b.pos.y < restY) {
				b.pos.y = restY;
				if (b.vel.y < 0) {
					b.vel.y = Math.abs(b.vel.y) > 0.5 ? -b.vel.y * cfg.restitution : 0;
				}
				b.vel.x *= Math.exp(-4.5 * dt);
				b.vel.z *= Math.exp(-4.5 * dt);
				b.angVel.multiplyScalar(Math.exp(-3.0 * dt));
			}

			// sloshing / float torque: bodies align their local up with world up
			if (sub > 0.15 && cfg.density < 1.0) {
				tmp.set(0, 1, 0).applyQuaternion(b.quat);
				const align = new THREE.Vector3().crossVectors(tmp, up).multiplyScalar(cfg.floatTorque * sub);
				b.angVel.addScaledVector(align, dt * 9.0);
			}

			// air/water angular damping
			b.angVel.multiplyScalar(Math.exp(-(inWater ? 2.6 : 0.35) * dt));

			// small tangential ripple while adrift on the surface
			if (sub > 0.2 && sub < 0.9) {
				b.rippleT -= dt;
				const sp = Math.hypot(b.vel.x, b.vel.z);
				if (b.rippleT <= 0 && sp > 0.05) {
					b.rippleT = 0.22 + this.rand() * 0.25;
					sim.addImpulse({
						x: b.pos.x, z: b.pos.z,
						radius: cfg.radius * 2.2 + 0.04,
						amp: -0.0028 * (0.5 + sp),
						foam: 0.0,
						microScale: 1.2,
					});
				}
			}

			// integrate rotation
			if (b.angVel.lengthSq() > 1e-6) {
				const ang = b.angVel.length() * dt;
				tmp.copy(b.angVel).normalize();
				const dq = new THREE.Quaternion().setFromAxisAngle(tmp, ang);
				b.quat.premultiply(dq).normalize();
			}

			// wind nudge for the leaf
			if (b.type === 'leaf' && sub > 0.3) {
				b.vel.x += sim.wind.x * sim.windStrength * 0.6 * dt;
				b.vel.z += sim.wind.y * sim.windStrength * 0.6 * dt;
			}
		}

		// write matrices
		const m = new THREE.Matrix4();
		const sc = new THREE.Vector3();
		for (const name of Object.keys(this.meshes)) {
			const mesh = this.meshes[name];
			let dirty = false;
			const used = this.bodies.filter((b) => b.type === name);
			const zeros = new THREE.Matrix4().makeScale(0, 0, 0);
			for (let i = 0; i < this.capacity; i++) {
				const b = used.find((x) => x.slot === i);
				if (b) {
					sc.set(1, 1, 1);
					m.compose(b.pos, b.quat, sc);
				} else {
					m.copy(zeros);
				}
				mesh.setMatrixAt(i, m);
				dirty = true;
			}
			if (dirty) mesh.instanceMatrix.needsUpdate = true;
		}
	}
}
