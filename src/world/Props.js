import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D, mulberry32, clamp, lerp, smoothstep, TAU } from '../core/Noise.js';

// Hand-placed furniture for the pond: timber jetty with a hanging lantern,
// shoreline rocks, driftwood, and lily pads that ride the real wave field.
export class Props {
	constructor(heightField) {
		this.hf = heightField;
		this.noise = new Noise2D(4242);
		this.group = new THREE.Group();
		this.group.name = 'props';
		this.lanternPoint = null;
		this.pads = [];
		this.padFlowers = [];

		// jetty axis: passes through the hero lantern position (-2.4, 6.8)
		this.jettyAngle = Math.atan2(6.8, -2.4);
		this.buildJetty();
		this.buildRocks();
		this.buildDriftwood();
		this.buildLilyPads();
	}

	// per-vertex tint baked into a geometry's colors
	tint(input, color, rand, variation = 0.2) {
		const geo = input.index ? input.toNonIndexed() : input;
		const count = geo.attributes.position.count;
		const arr = new Float32Array(count * 3);
		const c = new THREE.Color();
		const p = geo.attributes.position;
		for (let i = 0; i < count; i++) {
			let v = 0.86 + (rand ? rand() : 0.5) * variation;
			// darker toward the ground for wood and rock
			if (color.userData?.groundFade) {
				const t = clamp(p.getY(i) / 2, 0, 1);
				v *= lerp(0.72, 1.0, t);
			}
			c.copy(color).multiplyScalar(v);
			arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
		}
		geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
		return geo;
	}

	// -- jetty ----------------------------------------------------------------

	buildJetty() {
		const rand = mulberry32(555);
		const ux = Math.cos(this.jettyAngle);
		const uz = Math.sin(this.jettyAngle);
		const rShore = this.hf.pondRadius(this.jettyAngle);
		const rStart = Math.min(rShore + 1.35, 8.2); // on the bank
		const rEnd = rShore - 3.3; // over the water

		const shoreY = this.hf.height(ux * rStart, uz * rStart);
		const deckY0 = Math.max(0.46, shoreY + 0.16);
		const deckY1 = 0.40;
		const width = 1.62;

		const parts = [];
		const wood = new THREE.Color(0x6d5a41);
		const beam = new THREE.Color(0x5a4936);
		wood.userData = { groundFade: false };

		const segLen = rStart - rEnd;
		const deckYAt = (r) => lerp(deckY0, deckY1, clamp((rStart - r) / segLen, 0, 1));
		const put = (geo, x, y, z, rotY = 0) => {
			if (rotY) geo.rotateY(rotY);
			geo.translate(x, y, z);
			parts.push(geo);
		};

		// crossing deck planks (planks run across the jetty, slight irregularity)
		const plankW = 0.148;
		const gap = 0.02;
		for (let r = rStart - 0.25; r > rEnd; r -= plankW + gap) {
			const y = deckYAt(r);
			const px = ux * r, pz = uz * r;
			const cover = 1 + (rand() - 0.5) * 0.06;
			const plank = new THREE.BoxGeometry(width * cover, 0.052, plankW * (0.94 + rand() * 0.1));
			const rot = -(this.jettyAngle + Math.PI / 2) + (rand() - 0.5) * 0.02;
			put(this.tint(plank, wood, rand, 0.34), px, y, pz, rot);
		}

		// two stringers under the planks (long axis along the jetty, tilted)
		const slope = Math.atan2(deckY0 - deckY1, segLen);
		for (const side of [-1, 1]) {
			const off = side * (width * 0.5 - 0.12);
			const ox = -uz * off, oz = ux * off;
			const len = segLen + 0.3;
			const mid = (rStart + rEnd) * 0.5;
			const beam1 = new THREE.BoxGeometry(len, 0.14, 0.09);
			beam1.rotateZ(slope);
			beam1.rotateY(-this.jettyAngle);
			put(this.tint(beam1, beam, rand, 0.2),
				ux * mid + ox, deckYAt(mid) - 0.1, uz * mid + oz);
		}

		// piles down into the bed, pairs at three stations
		const stations = [rEnd + 0.25, (rStart + rEnd) * 0.5, rStart - 0.35];
		for (const r of stations) {
			for (const side of [-1, 1]) {
				const off = side * (width * 0.5 + 0.02);
				const px = ux * r - uz * off;
				const pz = uz * r + ux * off;
				const bedY = this.hf.height(px, pz);
				const top = deckYAt(r) + 0.32;
				const bottom = Math.min(bedY - 0.42, -0.25);
				const h = top - bottom;
				const post = new THREE.CylinderGeometry(0.085, 0.095, h, 7, 1);
				post.translate(0, h / 2, 0);
				put(this.tint(post, beam, rand, 0.24), px, bottom, pz);
			}
		}

		// handrail posts on the bank side (a place to lean and watch fish)
		for (const r of [rStart - 0.5, rStart - 1.5]) {
			for (const side of [-1, 1]) {
				const off = side * (width * 0.5 + 0.02);
				const px = ux * r - uz * off;
				const pz = uz * r + ux * off;
				const y = deckYAt(r);
				const rail = new THREE.CylinderGeometry(0.055, 0.06, 1.05, 6, 1);
				rail.translate(0, 0.55, 0);
				put(this.tint(rail, wood, rand, 0.3), px, y, pz);
			}
		}
		// rail top bar
		const railR = rStart - 0.55;
		const railTop = deckYAt(railR) + 1.0;
		for (const side of [-1, 1]) {
			const off = side * (width * 0.5 + 0.02);
			const ox = -uz * off, oz = ux * off;
			const bar = new THREE.CylinderGeometry(0.045, 0.045, 1.15, 6, 1);
			bar.rotateX(Math.PI / 2);
			bar.rotateY(Math.PI / 2 - this.jettyAngle);
			put(this.tint(bar, wood, rand, 0.26),
				ux * (railR - 0.5) + ox, railTop, uz * (railR - 0.5) + oz);
		}

		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
		this.jetty = new THREE.Mesh(geo, mat);
		this.jetty.castShadow = true;
		this.jetty.receiveShadow = true;
		this.jetty.name = 'jetty';
		this.group.add(this.jetty);

		// hanging lantern under the arm at the bank end
		const lanternX = -2.4, lanternZ = 6.8;
		const lx = Math.hypot(lanternX, lanternZ);
		const lDeckY = deckYAt(Math.min(lx, rStart));
		const lantern = new THREE.Group();
		const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 1.62, 7), mat);
		post.position.y = 0.81;
		lantern.add(post);
		const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 6), mat);
		arm.rotation.z = Math.PI / 2;
		arm.position.set(0.18, 1.6, 0);
		lantern.add(arm);
		// lantern body: dark frame + warm glass
		const frameMat = new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 0.55, metalness: 0.35 });
		const glassMat = new THREE.MeshStandardMaterial({
			color: 0x2a1b08, roughness: 0.35,
			emissive: 0xffb45a, emissiveIntensity: 2.6,
		});
		const cage = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, 0.17), glassMat);
		cage.position.set(0.4, 1.44, 0);
		lantern.add(cage);
		const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 4), frameMat);
		cap.position.set(0.4, 1.59, 0);
		cap.rotation.y = Math.PI / 4;
		lantern.add(cap);
		const base = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.13), frameMat);
		base.position.set(0.4, 1.33, 0);
		lantern.add(base);
		// hang it from the arm
		lantern.userData.glow = glassMat;
		lantern.position.set(lanternX, lDeckY, lanternZ);
		// face the pond: rotate so the arm (local +X) points to the centre
		const faceAngle = Math.atan2(lanternZ, -lanternX);
		lantern.rotation.y = faceAngle;
		this.lantern = lantern;
		// cage sits at local (0.4, 1.44, 0)
		this.lanternPoint = new THREE.Vector3(
			lanternX + Math.cos(faceAngle) * 0.4,
			lDeckY + 1.44,
			lanternZ - Math.sin(faceAngle) * 0.4
		);
		this.group.add(lantern);

		this.jettyInfo = { rStart, rEnd, deckYAt, angle: this.jettyAngle };
	}

	// -- rocks ----------------------------------------------------------------

	rockGeometry(seed) {
		const rand = mulberry32(seed);
		let geo = new THREE.IcosahedronGeometry(1, 2);
		const p = geo.attributes.position;
		const nz = new Noise2D(seed + 5);
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
			const n = 1
				+ 0.34 * nz.fbm(x * 1.8 + 3, y * 1.8 - 2, 3, 2.1, 0.5)
				+ 0.2 * nz.noise(x * 3.4, z * 3.4 + y * 2.1);
			p.setXYZ(i, x * n, y * (n * 0.78 - 0.04), z * n);
		}
		geo.computeVertexNormals();
		const grey = new THREE.Color(0x8a8478);
		grey.userData = { groundFade: true };
		geo = this.tint(geo, grey, rand, 0.34);
		// mottled patches so the stones are not flat slabs
		const col = geo.attributes.color;
		const pos = geo.attributes.position;
		for (let i = 0; i < col.count; i++) {
			const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
			const patch = 0.82 + 0.24 * nz.fbm(x * 2.6 + 7, z * 2.6 + y * 3.1 - 4, 3, 2.0, 0.55);
			col.setXYZ(i, col.getX(i) * patch * (0.98 + 0.06 * y), col.getY(i) * patch, col.getZ(i) * patch * (0.94 + 0.05 * y));
		}
		return geo;
	}

	buildRocks() {
		const rand = mulberry32(1618);
		const geo = this.rockGeometry(99);
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });

		const items = [];
		const count = 96;
		for (let i = 0; i < count; i++) {
			const theta = rand() * TAU;
			// bias toward the waterline
			const R = this.hf.pondRadius(theta);
			const r = R + (rand() * 2 - 0.9) * (0.5 + rand());
			const x = Math.cos(theta) * r;
			const z = Math.sin(theta) * r;
			const y = this.hf.height(x, z);
			if (y > 1.1 || y < -0.75) continue;
			// keep clear of the jetty walkway
			if (this.jettyInfo) {
				const d = Math.hypot(x + 2.4, z - 6.8);
				if (d < 1.6) continue;
			}
			const big = rand() < 0.06;
			const s = big ? 0.32 + rand() * 0.26 : 0.10 + rand() * 0.2;
			items.push({
				x, y, z, s,
				sy: s * (0.68 + rand() * 0.36),
				rotY: rand() * TAU,
				rotX: (rand() - 0.5) * 0.4,
				tint: 0.74 + rand() * 0.34,
				wet: clamp(1 - (y + 0.15) * 2.2, 0, 1),
			});
		}

		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const sc = new THREE.Vector3();
		const pos = new THREE.Vector3();
		const c = new THREE.Color();
		items.forEach((it, i) => {
			pos.set(it.x, it.y + it.sy * 0.12 - 0.14, it.z);
			e.set(it.rotX, it.rotY, (Math.random() - 0.5) * 0.2);
			q.setFromEuler(e);
			sc.set(it.s * (0.85 + (i % 5) * 0.07), it.sy, it.s * (0.9 + (i % 3) * 0.06));
			m.compose(pos, q, sc);
			mesh.setMatrixAt(i, m);
			// wet stones near the waterline read darker; barely cooler, never blue
			const t = it.tint * lerp(1.0, 0.62, it.wet);
			c.setRGB(t, t * (1 - it.wet * 0.01), t * (1 + it.wet * 0.045));
			mesh.setColorAt(i, c);
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.name = 'shore-rocks';
		this.group.add(mesh);
	}

	// -- driftwood ------------------------------------------------------------

	logGeometry(seed, length = 2.4, radius = 0.13) {
		const rand = mulberry32(seed);
		const parts = [];
		const bark = new THREE.Color(0x8a7a63);
		bark.userData = { groundFade: false };

		const segs = 4;
		let px = 0, py = 0, pz = 0;
		for (let i = 0; i < segs; i++) {
			const r0 = radius * (1 - i / segs * 0.45);
			const r1 = radius * (1 - (i + 1) / segs * 0.45);
			const len = length / segs;
			const cyl = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
			cyl.rotateZ(Math.PI / 2);
			const sag = Math.sin(i / segs * Math.PI) * 0.05;
			cyl.translate(px + len / 2, py + (rand() - 0.5) * 0.03, pz + sag);
			parts.push(this.tint(cyl, bark, rand, 0.4));
			px += len * (0.96 + rand() * 0.08);
			py += (rand() - 0.35) * 0.05;
			pz += sag * 0.4;
		}
		// broken stubs
		for (let i = 0; i < 3; i++) {
			const stub = new THREE.CylinderGeometry(0.02, 0.045, 0.3 + rand() * 0.3, 5, 1);
			stub.translate(0, 0.2, 0);
			stub.rotateZ((rand() - 0.5) * 1.8);
			stub.rotateY(rand() * TAU);
			stub.translate(0.3 + rand() * (length - 0.6), py + 0.05, (rand() - 0.5) * 0.1);
			parts.push(this.tint(stub, bark, rand, 0.36));
		}
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		return geo;
	}

	buildDriftwood() {
		const rand = mulberry32(909);
		const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.0 });
		const spots = [
			{ x: 4.6, z: 3.4, len: 2.6, rad: 0.14, rotY: 0.9, sink: 0.04 },
			{ x: -5.6, z: -1.2, len: 2.1, rad: 0.12, rotY: 2.4, sink: 0.02 },
			{ x: 1.6, z: -5.9, len: 1.7, rad: 0.1, rotY: 4.6, sink: 0.05 },
			{ x: -1.2, z: 5.6, len: 1.5, rad: 0.09, rotY: 5.5, sink: 0.03 },
		];
		this.driftwood = new THREE.Group();
		this.driftwood.name = 'driftwood';
		for (let i = 0; i < spots.length; i++) {
			const s = spots[i];
			const geo = this.logGeometry(700 + i * 13, s.len, s.rad);
			const mesh = new THREE.Mesh(geo, mat);
			const y = this.hf.height(s.x, s.z);
			mesh.position.set(s.x, y + s.rad * 0.55 - s.sink, s.z);
			mesh.rotation.y = s.rotY;
			mesh.rotation.z = (rand() - 0.5) * 0.16;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			this.driftwood.add(mesh);
		}
		this.group.add(this.driftwood);
	}

	// -- lily pads ------------------------------------------------------------

	padGeometry(seed = 7) {
		const rand = mulberry32(seed);
		// circle with a pac-man notch for the stem
		const gap = 0.62;
		const geo = new THREE.CircleGeometry(1, 18, gap * 0.5, TAU - gap);
		geo.rotateX(-Math.PI / 2);
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), z = p.getZ(i);
			const r = Math.hypot(x, z);
			// gentle cupping: the middle dips, the rim lifts slightly
			const cup = r * r * 0.09 - r * 0.02;
			p.setY(i, cup);
			// irregular rim
			if (r > 0.7) {
				const wob = 1 + (rand() - 0.5) * 0.14;
				p.setX(i, x * wob);
				p.setZ(i, z * wob);
			}
		}
		geo.computeVertexNormals();
		geo.computeBoundingSphere();
		return geo;
	}

	buildLilyPads() {
		const rand = mulberry32(2024);
		this.padGeo = this.padGeometry(11);
		this.padMat = new THREE.MeshStandardMaterial({
			vertexColors: false, roughness: 0.62, metalness: 0.0,
			color: 0xffffff,
			side: THREE.DoubleSide,
		});

		// Calm shallow shelves, seeded from angles around the pond. Each cluster
		// sits inside the shoreline; individual pads are only kept where there is
		// enough water under them for the stem to disappear.
		const clusterAngles = [0.62, 0.98, 1.55, 2.35, 3.15, 3.85, 4.55, 5.3, 5.85];
		const clusters = [];
		for (const a of clusterAngles) {
			const R = this.hf.pondRadius(a);
			const inset = 0.8 + rand() * 0.75;
			clusters.push({
				x: Math.cos(a) * (R - inset),
				z: Math.sin(a) * (R - inset),
				r: 1.0 + rand() * 0.9,
				n: 8 + Math.floor(rand() * 6),
				large: a === 0.62 || a === 0.98,
			});
		}
		for (const c of clusters) {
			for (let i = 0; i < c.n; i++) {
				const ang = rand() * TAU;
				const rr = Math.pow(rand(), 0.62) * c.r;
				const x = c.x + Math.cos(ang) * rr;
				const z = c.z + Math.sin(ang) * rr;
				const depth = -this.hf.height(x, z);
				if (depth < 0.10 || depth > 1.0) continue;
				if (!this.hf.inPond(x, z)) continue;
				this.pads.push({
					x, z,
					size: (c.large ? 0.20 : 0.15) + rand() * (c.large ? 0.12 : 0.09),
					phase: rand() * TAU,
					spin: rand() * TAU,
					tint: rand(),
				});
			}
		}
		// a couple of hero pads close to the default camera side, so the pond
		// reads as a living surface even in the wide establishing shot
		for (const [a, inset, size] of [[0.62, 0.72, 0.34], [0.78, 0.9, 0.29], [0.9, 0.8, 0.26], [0.45, 1.0, 0.24]]) {
			const R = this.hf.pondRadius(a);
			const x = Math.cos(a) * (R - inset);
			const z = Math.sin(a) * (R - inset);
			const depth = -this.hf.height(x, z);
			if (depth > 0.08 && depth < 1.0) {
				this.pads.push({ x, z, size, phase: rand() * TAU, spin: rand() * TAU, tint: rand() });
			}
		}

		const mesh = new THREE.InstancedMesh(this.padGeo, this.padMat, this.pads.length);
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.name = 'lily-pads';
		this.group.add(mesh);
		this.padMesh = mesh;
		this.padColor = new THREE.Color();

		// a few water-lily flowers on the pads
		const flowerRand = mulberry32(31337);
		const petalMats = [
			new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.5, side: THREE.DoubleSide }),
			new THREE.MeshStandardMaterial({ color: 0xf0c7d8, roughness: 0.5, side: THREE.DoubleSide }),
		];
		const coreMat = new THREE.MeshStandardMaterial({ color: 0xe8c84a, roughness: 0.6, emissive: 0x3a2a04, emissiveIntensity: 0.6 });
		for (let i = 0; i < 5 && i < this.pads.length; i++) {
			const idx = Math.floor(flowerRand() * this.pads.length);
			const pad = this.pads[idx];
			const flower = new THREE.Group();
			const petalGeo = new THREE.CircleGeometry(0.07, 7, 0.4, TAU - 0.8);
			const petal = new THREE.Mesh(petalGeo, petalMats[i % 2]);
			for (let k = 0; k < 7; k++) {
				const m = petal.clone();
				const a = (k / 7) * TAU;
				m.position.set(Math.cos(a) * 0.045, 0.012, Math.sin(a) * 0.045);
				m.rotation.set(-Math.PI / 2 + 0.5, 0, a);
				flower.add(m);
			}
			const core = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), coreMat);
			core.position.y = 0.03;
			flower.add(core);
			this.padFlowers.push({ flower, pad });
			this.group.add(flower);
		}
	}

	// ride the simulated surface (call after sim.update)
	update(dt, time, sim) {
		if (!sim || !this.padMesh || !this.pads.length) return;
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const n = new THREE.Vector3();
		const sc = new THREE.Vector3();
		const pos = new THREE.Vector3();
		const s = { height: 0, depth: 0 };
		for (let i = 0; i < this.pads.length; i++) {
			const pad = this.pads[i];
			sim.sampleSurface(pad.x, pad.z, s);
			const bob = Math.sin(time * 1.6 + pad.phase) * 0.008;
			const nrm = sim.surfaceAt ? this.surfaceNormal(sim, pad.x, pad.z, n) : n.set(0, 1, 0);
			pos.set(pad.x, s.height + 0.012 + bob, pad.z);
			q.setFromUnitVectors(up, nrm);
			sc.set(pad.size, pad.size, pad.size);
			m.compose(pos, q, sc);
			this.padMesh.setMatrixAt(i, m);
			const t = pad.tint;
			this.padColor.setRGB(lerp(0.16, 0.36, t), lerp(0.30, 0.47, t), lerp(0.10, 0.16, t));
			this.padMesh.setColorAt(i, this.padColor);
		}
		this.padMesh.instanceMatrix.needsUpdate = true;
		if (this.padMesh.instanceColor) this.padMesh.instanceColor.needsUpdate = true;

		for (const pf of this.padFlowers) {
			const s2 = sim.sampleSurface(pf.pad.x, pf.pad.z, { height: 0, depth: 0 });
			pf.flower.position.set(pf.pad.x, s2.height + pf.pad.size * 0.05 + 0.015, pf.pad.z);
			pf.flower.rotation.z = Math.sin(time * 1.3 + pf.pad.phase) * 0.04;
		}
	}

	surfaceNormal(sim, x, z, out) {
		const eps = 0.22;
		const hL = sim.sampleSurface(x - eps, z, { height: 0, depth: 0 }).height;
		const hR = sim.sampleSurface(x + eps, z, { height: 0, depth: 0 }).height;
		const hD = sim.sampleSurface(x, z - eps, { height: 0, depth: 0 }).height;
		const hU = sim.sampleSurface(x, z + eps, { height: 0, depth: 0 }).height;
		out.set(-(hR - hL) / (2 * eps), 1, -(hU - hD) / (2 * eps));
		return out.normalize();
	}
}
