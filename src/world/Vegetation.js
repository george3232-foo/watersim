import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp, lerp, smoothstep, TAU } from '../core/Noise.js';

// A windy blade pair / clump builder. Everything is vertex-coloured ribbons:
// no textures, no alpha, and it still reads as grass at any distance.

function ribbon(height, width, segments, bend, twist, rand, colorBase, colorTip, side = 1) {
	const positions = [];
	const colors = [];
	const uvs = [];
	const indices = [];
	const cb = new THREE.Color(colorBase);
	const ct = new THREE.Color(colorTip);
	const c = new THREE.Color();
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const w = width * (1 - t * 0.94) * (0.55 + 0.45 * (1 - t));
		const y = height * t;
		const x = bend * t * t;
		const z = twist * t * t * t * 0.4;
		positions.push(-w + x, y, z);
		positions.push(w + x, y, z);
		uvs.push(0, t, 1, t);
		c.copy(cb).lerp(ct, Math.pow(t, 1.35));
		const shade = 0.82 + 0.36 * t;
		colors.push(c.r * shade, c.g * shade, c.b * shade);
		colors.push(c.r * shade * 0.9, c.g * shade * 0.9, c.b * shade * 0.9);
	}
	for (let i = 0; i < segments; i++) {
		const a = i * 2;
		if (side > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

function paintFlat(geo, hex, variation, rand) {
	const count = geo.attributes.position.count;
	const arr = new Float32Array(count * 3);
	const c = new THREE.Color(hex);
	for (let i = 0; i < count; i++) {
		const v = 0.85 + rand() * variation;
		arr[i * 3] = c.r * v; arr[i * 3 + 1] = c.g * v; arr[i * 3 + 2] = c.b * v;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	return geo;
}

// Mix seeded samples from 16 shore sectors and two radial bands once. Every
// quality prefix covers the bank instead of keeping a contiguous patch of it.
function spreadGroundDetail(items) {
	const cells = Array.from({ length: 32 }, () => []);
	for (const item of items) {
		const angle = (Math.atan2(item.z, item.x) + TAU) % TAU;
		const sector = Math.min(15, Math.floor(angle / TAU * 16));
		cells[sector * 2 + (Math.hypot(item.x, item.z) >= 12 ? 1 : 0)].push(item);
	}
	for (const cell of cells) {
		cell.forEach((item, i) => { item.detailRank = (i + 0.5) / cell.length; });
	}
	items.sort((a, b) => a.detailRank - b.detailRank);
}

export class Vegetation {
	constructor(heightField) {
		this.hf = heightField;
		this.group = new THREE.Group();
		this.group.name = 'vegetation';
		this.foliage = 1;
		this.uniforms = { uTime: { value: 0 }, uWindPower: { value: 0.4 } };
		this.buildGrass();
		this.buildReeds();
		this.buildFlowers();
		this.group.userData.foliage = {
			factor: 1, grass: this.grass.count, maxGrass: this.grass.count,
			flowers: this.flowers.count, maxFlowers: this.flowers.count, reeds: this.reeds.count,
		};
	}

	windMaterial(opts = {}) {
		const mat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			roughness: 0.92,
			metalness: 0,
			side: THREE.DoubleSide,
			...opts,
		});
		const uniforms = this.uniforms;
		mat.onBeforeCompile = (shader) => {
			shader.uniforms.uTime = uniforms.uTime;
			shader.uniforms.uWindPower = uniforms.uWindPower;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindPower;')
				.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 swIp = instanceMatrix[3].xz;
#else
  vec2 swIp = vec2(0.0);
#endif
  float swGust = 0.72
               + 0.28 * sin(uTime * 0.33 + swIp.x * 0.11 + swIp.y * 0.07)
               + 0.16 * sin(uTime * 0.87 - swIp.y * 0.19);
  float swAmp = (0.55 + uWindPower * 1.75) * swGust;
  float swSway = (sin(uTime * (1.05 + uWindPower * 0.6) + swIp.x * 0.63 + swIp.y * 0.81) * 0.5
               + sin(uTime * 2.31 + swIp.y * 1.71) * 0.22) * swAmp;
  float swBend = transformed.y * transformed.y * 0.13;
  transformed.x += swSway * swBend;
  transformed.z += cos(uTime * 1.02 + swIp.x * 1.13) * 0.42 * swBend * swAmp;
  if (uWindPower > 0.5) {
    float swFlutter = sin(uTime * 7.5 + transformed.y * 9.0 + swIp.x * 3.1 + swIp.y * 2.7);
    transformed.x += swFlutter * uWindPower * transformed.y * 0.012;
  }
`);
		};
		mat.customProgramCacheKey = () => 'stillwater-wind-' + (opts.name || 'veg');
		return mat;
	}

	bladeClump(seed, blades, height, spread, colors) {
		const rand = mulberry32(seed);
		const parts = [];
		for (let i = 0; i < blades; i++) {
			const h = height * (0.62 + rand() * 0.6);
			const w = 0.016 + rand() * 0.016;
			const bend = (rand() - 0.5) * spread * 1.4;
			const twist = (rand() - 0.5) * spread * 1.1;
			const base = colors[(rand() * colors.length) | 0];
			const tip = colors[(rand() * colors.length) | 0];
			const g = ribbon(h, w, 3, bend, twist, rand, base, tip, rand() < 0.5 ? 1 : -1);
			g.translate((rand() - 0.5) * spread * 0.5, 0, (rand() - 0.5) * spread * 0.5);
			g.rotateY(rand() * TAU);
			parts.push(g);
		}
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		return geo;
	}

	buildGrass() {
		const grassColors = [0x4b6824, 0x5c7628, 0x6f8530, 0x899440, 0xa39752];
		const geo = this.bladeClump(31, 7, 0.26, 0.24, grassColors);
		const mat = this.windMaterial({ name: 'grass' });
		const rand = mulberry32(5150);
		const items = [];
		const camAngle = Math.atan2(8.6, 10.6);
		for (let i = 0; i < 5200; i++) {
			const theta = rand() * TAU;
			const R = this.hf.pondRadius(theta);
			const r = R + 0.10 + Math.pow(rand(), 1.5) * (16.4 - R);
			if (r > 16.6) continue;
			const x = Math.cos(theta) * r;
			const z = Math.sin(theta) * r;
			const y = this.hf.height(x, z);
			if (y < -0.015) continue;
			// leave a little breathing room around the camera
			let da = Math.abs(theta - camAngle);
			if (da > Math.PI) da = TAU - da;
			if (da < 0.30 && r > 12.4) continue;
			const scale = 0.62 + rand() * 0.65 + smoothstep(9, 16.4, r) * 0.3;
			items.push({ x, y, z, scale, rot: rand() * TAU, tint: 0.72 + rand() * 0.55 });
		}
		spreadGroundDetail(items);
		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const s = new THREE.Vector3();
		const p = new THREE.Vector3();
		const c = new THREE.Color();
		items.forEach((it, i) => {
			p.set(it.x, it.y - 0.01, it.z);
			q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
			s.set(it.scale, it.scale * (0.85 + (i % 9) * 0.03), it.scale);
			m.compose(p, q, s);
			mesh.setMatrixAt(i, m);
			const warm = it.tint;
			c.setRGB(warm, warm * (0.96 + (i % 3) * 0.02), warm * 0.82);
			mesh.setColorAt(i, c);
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.frustumCulled = false;
		mesh.name = 'grass';
		mesh.userData.maxCount = items.length;
		mesh.userData.detailOrder = 'interleaved-spatial-cells';
		this.grass = mesh;
		this.group.add(mesh);
	}

	buildReeds() {
		const colors = [0x4a5a24, 0x576b28, 0x687a30, 0x7f8038];
		const rand = mulberry32(8181);
		const parts = [];
		for (let i = 0; i < 4; i++) {
			const h = 0.68 + rand() * 0.55;
			const w = 0.013 + rand() * 0.008;
			const g = ribbon(h, w, 4, (rand() - 0.5) * 0.36, (rand() - 0.5) * 0.24, rand, colors[(rand() * colors.length) | 0], 0xa89a48, rand() < 0.5 ? 1 : -1);
			g.translate((rand() - 0.5) * 0.14, 0, (rand() - 0.5) * 0.14);
			parts.push(g);
		}
		// a couple of brown seed heads
		for (let i = 0; i < 2; i++) {
			const head = new THREE.CylinderGeometry(0.014, 0.022, 0.24, 5, 1);
			head.translate((rand() - 0.5) * 0.12, 0.76 + rand() * 0.36, (rand() - 0.5) * 0.12);
			parts.push(paintFlat(head, 0x8f6c34, 0.3, rand));
		}
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		const mat = this.windMaterial({ name: 'reeds' });
		mat.side = THREE.DoubleSide;

		const items = [];
		const rand2 = mulberry32(2024);
		const camAngle = Math.atan2(8.6, 10.6);
		const sunShoreAngle = Math.atan2(-0.223, -0.975) + TAU;
		for (let c = 0; c < 30; c++) {
			const theta = rand2() * TAU;
			let daCam = Math.abs(theta - camAngle);
			if (daCam > Math.PI) daCam = TAU - daCam;
			let daSun = Math.abs(theta - sunShoreAngle);
			if (daSun > Math.PI) daSun = TAU - daSun;
			if (daCam < 0.34) continue;
			if (daSun < 0.22) continue;
			const R = this.hf.pondRadius(theta);
			const r = R - 0.18 + rand2() * 0.55;
			const perClump = 5 + ((rand2() * 13) | 0);
			for (let i = 0; i < perClump; i++) {
				const t = theta + (rand2() - 0.5) * 0.13;
				const rr = r + (rand2() - 0.5) * 0.55;
				const x = Math.cos(t) * rr;
				const z = Math.sin(t) * rr;
				const y = this.hf.height(x, z);
				if (y < -0.25 || y > 0.22) continue;
				const scale = 0.66 + rand2() * 0.6;
				items.push({
					x, y: y - 0.02, z, scale, rot: rand2() * TAU,
					tint: 0.85 + rand2() * 0.45, lean: (rand2() - 0.5) * 0.2,
				});
			}
		}
		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const s = new THREE.Vector3();
		const p = new THREE.Vector3();
		const c = new THREE.Color();
		items.forEach((it, i) => {
			p.set(it.x, it.y, it.z);
			e.set(it.lean, it.rot, it.lean * 0.6);
			q.setFromEuler(e);
			s.set(it.scale, it.scale * (0.9 + (i % 5) * 0.05), it.scale);
			m.compose(p, q, s);
			mesh.setMatrixAt(i, m);
			c.setRGB(it.tint, it.tint * 0.98, it.tint * 0.8);
			mesh.setColorAt(i, c);
		});
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.frustumCulled = false;
		mesh.name = 'reeds';
		mesh.userData.maxCount = items.length;
		mesh.userData.preserveStructure = true;
		this.reeds = mesh;
		this.group.add(mesh);
	}

	buildFlowers() {
		const rand = mulberry32(606);
		const parts = [];
		for (let i = 0; i < 2; i++) {
			const stem = ribbon(0.24 + rand() * 0.12, 0.008, 2, (rand() - 0.5) * 0.08, 0, rand, 0x4a5a24, 0x5c6a2c, 1);
			parts.push(stem.index ? stem.toNonIndexed() : stem);
		}
		const petals = new THREE.IcosahedronGeometry(0.016, 0);
		petals.scale(1.8, 0.7, 1.8);
		petals.translate(0.02, 0.25, -0.01);
		parts.push(paintFlat(petals, 0xc9b45a, 0.45, rand));
		const petals2 = new THREE.IcosahedronGeometry(0.013, 0);
		petals2.scale(1.7, 0.7, 1.7);
		petals2.translate(-0.03, 0.19, 0.02);
		parts.push(paintFlat(petals2, 0xd8c88c, 0.4, rand));
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();

		const mat = this.windMaterial({ name: 'flowers' });
		const items = [];
		const rand2 = mulberry32(1357);
		for (let i = 0; i < 420; i++) {
			const theta = rand2() * TAU;
			const R = this.hf.pondRadius(theta);
			const r = R + 0.6 + Math.pow(rand2(), 1.4) * (15.6 - R);
			if (r > 16.2) continue;
			const x = Math.cos(theta) * r;
			const z = Math.sin(theta) * r;
			const y = this.hf.height(x, z);
			if (y < 0.06) continue;
			items.push({ x, y, z, scale: 0.55 + rand2() * 0.55, rot: rand2() * TAU, tint: 0.8 + rand2() * 0.4 });
		}
		spreadGroundDetail(items);
		const mesh = new THREE.InstancedMesh(geo, mat, items.length);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const s = new THREE.Vector3();
		const p = new THREE.Vector3();
		items.forEach((it, i) => {
			p.set(it.x, it.y, it.z);
			q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
			s.setScalar(it.scale);
			m.compose(p, q, s);
			mesh.setMatrixAt(i, m);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.frustumCulled = false;
		mesh.name = 'flowers';
		mesh.userData.maxCount = items.length;
		mesh.userData.detailOrder = 'interleaved-spatial-cells';
		this.flowers = mesh;
		this.group.add(mesh);
	}

	setQuality(settings = {}) {
		if (Number.isFinite(settings.foliage)) this.foliage = clamp(settings.foliage, 0, 1);
		for (const mesh of [this.grass, this.flowers]) {
			mesh.count = Math.round(mesh.userData.maxCount * this.foliage);
		}
		const counts = this.group.userData.foliage;
		counts.factor = this.foliage;
		counts.grass = this.grass.count;
		counts.flowers = this.flowers.count;
		return this;
	}

	update(dt, time) {
		this.uniforms.uTime.value = time + 31.7;
	}
}
