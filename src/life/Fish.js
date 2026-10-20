import * as THREE from 'three';
import { mulberry32, clamp, lerp, TAU } from '../core/Noise.js';
import { GLSL_NOISE } from '../core/Shaders.js';

// Procedural fish: one instanced geometry per species. The body undulates in
// the vertex shader with a travelling wave; the brain (boids + state machine)
// runs on the CPU and only writes instance matrices and instance colours.

function buildFishGeometry(seed = 1, opts = {}) {
	const rand = mulberry32(seed);
	const S = 16; // rings along the spine
	const R = 12; // segments around the body
	const pos = [];
	const col = [];
	const spine = [];
	const fin = [];
	const idx = [];

	const heightAt = (s) => 0.155 * Math.pow(Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), 0.62)), 0.82);
	const widthAt = (s) => heightAt(s) * 0.62;

	// body: elliptical rings from nose (s=0) to tail (s=1)
	for (let i = 0; i <= S; i++) {
		const s = i / S;
		const z = 0.5 - s;
		const h = heightAt(s), w = widthAt(s);
		// belly errs fatter than the back
		for (let j = 0; j < R; j++) {
			const phi = (j / R) * TAU;
			const sx = Math.sin(phi);
			const cy = Math.cos(phi);
			const belly = 1 + 0.18 * Math.max(0, -cy);
			pos.push(sx * w * belly, cy * h * belly, z);
			col.push(1, 1, 1);
			spine.push(s);
			fin.push(0);
		}
	}
	for (let i = 0; i < S; i++) {
		for (let j = 0; j < R; j++) {
			const a = i * R + j;
			const b = i * R + ((j + 1) % R);
			const c = (i + 1) * R + j;
			const d = (i + 1) * R + ((j + 1) % R);
			idx.push(a, c, b, b, c, d);
		}
	}
	// nose and tail caps
	const nose = pos.length / 3;
	pos.push(0, 0, 0.5); col.push(1, 1, 1); spine.push(0); fin.push(0);
	for (let j = 0; j < R; j++) {
		idx.push(nose, (j + 1) % R, j);
	}
	const tail = pos.length / 3;
	pos.push(0, 0, -0.5); col.push(1, 1, 1); spine.push(1); fin.push(0);
	const base = S * R;
	for (let j = 0; j < R; j++) {
		idx.push(tail, base + j, base + ((j + 1) % R));
	}

	const addQuad = (p0, p1, p2, p3, s0, s1, s2, s3, finType) => {
		const start = pos.length / 3;
		for (const [p, s] of [[p0, s0], [p1, s1], [p2, s2], [p3, s3]]) {
			pos.push(p[0], p[1], p[2]);
			col.push(1, 1, 1);
			spine.push(s);
			fin.push(finType);
		}
		idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
	};

	// caudal fin: a two-lobed vertical fan trailing the tail
	const addTri = (a, b, c, sa, sb, sc, finType) => {
		const start = pos.length / 3;
		for (const [p, s] of [[a, sa], [b, sb], [c, sc]]) {
			pos.push(p[0], p[1], p[2]);
			col.push(1, 1, 1);
			spine.push(s);
			fin.push(finType);
		}
		idx.push(start, start + 1, start + 2);
	};
	for (const sgn of [1, -1]) {
		addTri(
			[0, sgn * 0.026, -0.5], [0, sgn * 0.10, -0.62], [0, sgn * 0.024, -0.70],
			1.0, 1.12, 1.2, 1
		);
		addTri(
			[0, sgn * 0.024, -0.70], [0, sgn * 0.10, -0.62], [0, sgn * 0.15, -0.79],
			1.2, 1.12, 1.35, 1
		);
		addTri(
			[0, sgn * 0.024, -0.70], [0, sgn * 0.15, -0.79], [0, sgn * 0.065, -0.86],
			1.2, 1.35, 1.42, 1
		);
	}
	// dorsal fin
	addQuad(
		[0, heightAt(0.45) * 0.92, 0.06], [0, heightAt(0.2) * 0.9, -0.28],
		[0, heightAt(0.2) * 0.9 + 0.055, -0.24], [0, heightAt(0.45) * 0.92 + 0.075, 0.02],
		0.44, 0.7, 0.7, 0.44, 1
	);
	// anal fin
	addQuad(
		[0, -heightAt(0.68) * 0.85, -0.30], [0, -heightAt(0.85) * 0.8, -0.42],
		[0, -heightAt(0.85) * 0.8 - 0.045, -0.40], [0, -heightAt(0.68) * 0.85 - 0.05, -0.30],
		0.66, 0.82, 0.82, 0.66, 1
	);
	// pectoral fins (flap in the shader)
	for (const side of [-1, 1]) {
		const w = widthAt(0.26);
		addQuad(
			[side * w, -0.01, 0.28], [side * w, -0.02, 0.2],
			[side * (w + 0.115), -0.055, 0.02], [side * (w + 0.09), -0.03, 0.12],
			0.24, 0.3, 0.3, 0.24, 2
		);
	}
	// eyes: two tiny lumps, darkened in the shader
	for (const side of [-1, 1]) {
		const w = widthAt(0.14) * 0.92;
		const eye = new THREE.IcosahedronGeometry(0.023, 1);
		eye.translate(side * w, 0.028, 0.36);
		const p = eye.attributes.position;
		const start = pos.length / 3;
		for (let i = 0; i < p.count; i++) {
			pos.push(p.getX(i), p.getY(i), p.getZ(i));
			col.push(1, 1, 1);
			spine.push(0.14);
			fin.push(3);
		}
		const eIdx = eye.index;
		if (eIdx) {
			for (let i = 0; i < eIdx.count; i++) idx.push(start + eIdx.getX(i));
		} else {
			for (let i = 0; i < p.count; i++) idx.push(start + i);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	geo.setAttribute('aSpine', new THREE.Float32BufferAttribute(spine, 1));
	geo.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	geo.computeBoundingSphere();
	return geo;
}

function patchFishMaterial(material, fish) {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uFishTime = fish.timeUniform;
		shader.uniforms.uBend = { value: material.userData.bend ?? 0.075 };
		shader.uniforms.uSpec = { value: material.userData.spec ?? 0 };

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
attribute float aSpine;
attribute float aFin;
uniform float uFishTime;
uniform float uBend;
varying vec3 vFishP;
varying vec3 vFishN;
varying float vFishFin;
float swFishShear(float s, float seed, float osc, float bend, float t) {
  float dAmp = bend * 1.7 * pow(max(s, 0.3), 0.7);
  return cos(seed * 6.2831 + s * 3.1 - t * (3.4 + osc * 4.2) * 6.2831 * 0.14) * dAmp * 3.1;
}`)
			.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  // yaw the shading normal with the local body-wave shear. This must run
  // before defaultnormal_vertex turns objectNormal into transformedNormal.
  float shear = swFishShear(aSpine, vColor.r, vColor.g, uBend, uFishTime);
  float ca = cos(shear * 0.12), sa = sin(shear * 0.12);
  objectNormal = normalize(vec3(objectNormal.x * ca + objectNormal.z * sa, objectNormal.y, -objectNormal.x * sa + objectNormal.z * ca));
}`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float s = aSpine;
  float seed = vColor.r;
  float osc = vColor.g;
  float wave = sin(seed * 6.2831 + s * 3.1 - uFishTime * (3.4 + osc * 4.2) * 6.2831 * 0.14);
  float amp = uBend * (0.06 + 0.94 * pow(max(s, 0.0), 1.7));
  float lateral = wave * amp;
  // pectorals flap instead of undulating
  if (aFin > 1.5 && aFin < 2.5) {
    float side = sign(position.x + 1e-5);
    transformed.y += sin(uFishTime * 6.9 + seed * 6.2831 + side * 1.2) * 0.05;
  }
  transformed.x += lateral;
  vFishP = transformed;
  vFishN = objectNormal;
  vFishFin = aFin;
}`)

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
varying vec3 vFishP;
varying vec3 vFishN;
varying float vFishFin;
uniform float uSpec;
${GLSL_NOISE}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
{
  float seed = vColor.r;
  float type = vColor.b;
  float belly = 1.0 - smoothstep(-0.09, -0.02, vFishP.y);
  vec3 col;
  if (type < 0.5) {
    // koi: cream base, broad vermilion patches, sumi ink, pale belly
    vec3 base = vec3(0.64, 0.57, 0.44);
    float pat1 = sw_fbm(vFishP.xz * 5.2 + vFishP.y * 2.4 + seed * 47.0);
    float pat2 = sw_fbm(vFishP.zx * 8.0 - vFishP.y * 3.0 - seed * 21.0);
    float orange = smoothstep(0.405, 0.525, pat1);
    float sumi = smoothstep(0.535, 0.625, pat2) * 0.92;
    col = mix(base, vec3(0.86, 0.205, 0.028), orange);
    col = mix(col, vec3(0.038, 0.031, 0.028), sumi);
    col = mix(col, vec3(0.82, 0.73, 0.58), belly * 0.45);
  } else {
    // minnow: olive back, silver flank, pale belly, dark lateral line
    vec3 back = vec3(0.085, 0.10, 0.05) + vec3(seed * 0.03);
    vec3 flank = vec3(0.34, 0.36, 0.31);
    float t = smoothstep(-0.10, 0.10, vFishP.y + sw_noise(vFishP.xz * 14.0 + seed) * 0.03);
    col = mix(flank, back, t);
    col = mix(col, vec3(0.60, 0.61, 0.55), belly * 0.8);
    float line = 1.0 - smoothstep(0.0, 0.022, abs(vFishP.y + 0.01));
    col *= 1.0 - line * 0.35;
  }
  // fins: thin translucent membranes; eyes: dark beads with a glint
  if (vFishFin > 2.5) {
    vec3 n = normalize(vFishN);
    float glint = pow(max(dot(n, normalize(vec3(-0.4, 0.55, 0.75))), 0.0), 18.0);
    col = vec3(0.035, 0.028, 0.022) + vec3(0.35, 0.32, 0.28) * glint;
  } else if (vFishFin > 0.5) {
    col = col * 1.18 + vec3(0.03, 0.028, 0.022);
  }
  diffuseColor.rgb = col;
  // small highlight for wet skin
  float sheen = pow(1.0 - abs(normalize(vFishN).y), 3.0);
  diffuseColor.rgb += vec3(0.05, 0.06, 0.07) * sheen * (0.5 + uSpec);
}`);

		return shader;
	};
	material.customProgramCacheKey = () => 'stillwater-fish-v2';
	return material;
}

export class Fish {
	constructor(heightField, sim, opts = {}) {
		this.hf = heightField;
		this.sim = sim;
		this.rand = mulberry32(6021);
		this.group = new THREE.Group();
		this.group.name = 'fish';
		this.timeUniform = { value: 0 };
		this.events = [];
		this.fish = [];
		this.meshes = {};
		this._steer = new THREE.Vector3();
		this._toTarget = new THREE.Vector3();
		this._dir = new THREE.Vector3();

		this.makeSpecies('koi', {
			count: opts.koi ?? 6,
			length: [0.42, 0.54],
			geometry: buildFishGeometry(11, { caudal: 0.34 }),
			bend: 0.075,
			speed: [0.22, 0.62],
			depth: [0.28, 0.62],
			castShadow: false,
		});
		this.makeSpecies('minnow', {
			count: opts.minnow ?? 24,
			length: [0.07, 0.105],
			geometry: buildFishGeometry(23, { caudal: 0.3 }),
			bend: 0.10,
			speed: [0.14, 0.5],
			depth: [0.14, 0.5],
			castShadow: false,
		});

		this.pondCenter = new THREE.Vector2(0, 0);
	}

	makeSpecies(name, cfg) {
		const mat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			roughness: name === 'koi' ? 0.42 : 0.3,
			metalness: name === 'minnow' ? 0.25 : 0.05,
			side: THREE.DoubleSide,
		});
		mat.userData.bend = cfg.bend;
		mat.userData.spec = name === 'minnow' ? 0.6 : 0.2;
		patchFishMaterial(mat, this);

		const mesh = new THREE.InstancedMesh(cfg.geometry, mat, cfg.count);
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.frustumCulled = false;
		mesh.castShadow = !!cfg.castShadow;
		mesh.receiveShadow = false;
		mesh.name = `fish-${name}`;
		this.group.add(mesh);
		this.meshes[name] = mesh;

		const species = { name, cfg, mesh, list: [] };
		this.species = this.species || [];
		this.species.push(species);
		for (let i = 0; i < cfg.count; i++) {
			const f = this.spawnOne(species);
			species.list.push(f);
			this.fish.push(f);
		}
		// seed instance colours before the first compile so USE_INSTANCING_COLOR
		// is baked into the program
		const c = new THREE.Color();
		const koi = name === 'koi';
		species.list.forEach((f, i) => {
			c.setRGB(f.seed, clamp(f.osc * 0.5, 0, 1), koi ? 0.2 : 0.8);
			mesh.setColorAt(i, c);
		});
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		return species;
	}

	pickSpawn(depthMin, depthMax) {
		const rand = this.rand;
		for (let tries = 0; tries < 60; tries++) {
			const a = rand() * TAU;
			const R = this.hf.pondRadius(a);
			const r = Math.sqrt(rand()) * (R - 0.8);
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			const d = -this.hf.height(x, z);
			if (d > depthMin && d < depthMax) return { x, z, d };
		}
		return { x: 0, z: 0, d: 0.6 };
	}

	spawnOne(species) {
		const rand = this.rand;
		const cfg = species.cfg;
		const koi = species.name === 'koi';
		const spawn = this.pickSpawn(cfg.depth[0], cfg.depth[1]);
		const heading = rand() * TAU;
		const len = lerp(cfg.length[0], cfg.length[1], rand());
		const speed = lerp(cfg.speed[0], cfg.speed[1], rand() * 0.6);
		const f = {
			species,
			pos: new THREE.Vector3(spawn.x, -spawn.d + 0.1, spawn.z),
			vel: new THREE.Vector3(Math.sin(heading) * speed, 0, Math.cos(heading) * speed),
			len,
			seed: rand(),
			osc: koi ? 0.35 + rand() * 0.2 : 0.7 + rand() * 0.3,
			lenScaleY: 0.92 + rand() * 0.2,
			state: 'calm',
			stateT: 0,
			wanderT: 0,
			target: new THREE.Vector3(spawn.x, 0, spawn.z),
			desiredDepth: spawn.d * 0.8,
			speedNorm: 0.5,
			yaw: heading,
			pitch: 0,
			roll: 0,
			rippleT: rand() * 1.0,
			lastImpulse: -10,
		};
		return f;
	}

	// Player interactions: startle fish near an impact, or drop food they will
	// come up to inspect.
	startle(x, z, strength = 1) {
		this.events.push({ type: 'startle', x, z, strength, t: performance.now() / 1000 });
	}
	feed(x, z) {
		this.events.push({ type: 'feed', x, z, strength: 1, t: performance.now() / 1000 });
	}
	// A koi close enough to the surface snaps a morsel up.
	nibbleAt(x, z) {
		for (const f of this.fish) {
			if (f.species.name !== 'koi') continue;
			const d = Math.hypot(f.pos.x - x, f.pos.z - z);
			if (d < 0.34 && f.pos.y > -0.24) {
				f.state = 'feed';
				f.stateT = 1.0 + this.rand() * 1.4;
				f.target.set(x, 0, z);
				f.desiredDepth = 0.07;
				f.rippleT = 0;
				return true;
			}
		}
		return false;
	}

	drainEvents() {
		for (const ev of this.events) {
			for (const f of this.fish) {
				const dx = f.pos.x - ev.x, dz = f.pos.z - ev.z;
				const d = Math.hypot(dx, dz);
				if (ev.type === 'startle') {
					const radius = 2.4 + ev.strength * 2.2;
					if (d < radius) {
						f.state = 'dart';
						f.stateT = 0.5 + this.rand() * 0.7;
						const inv = 1 / (d + 0.05);
						f.target.set(f.pos.x + dx * inv * 3.5, 0, f.pos.z + dz * inv * 3.5);
						f.desiredDepth = Math.min(0.62, 0.28 + this.rand() * 0.3);
					}
				} else if (ev.type === 'feed' && f.species.name === 'koi') {
					if (d < 6.5) {
						f.state = 'feed';
						f.stateT = 6 + this.rand() * 3;
						f.target.set(ev.x, 0, ev.z);
						f.desiredDepth = 0.08;
					}
				}
			}
		}
		this.events.length = 0;
	}

	update(dt, time) {
		this.timeUniform.value = time;
		if (dt <= 0) return;
		this.drainEvents();

		const hf = this.hf;
		const sim = this.sim;
		const rand = this.rand;

		for (const f of this.fish) {
			const cfg = f.species.cfg;
			f.stateT -= dt;
			f.wanderT -= dt;

			// ---- state machine ----
			if (f.stateT <= 0) {
				if (f.state === 'dart' || f.state === 'feed') {
					f.state = 'calm';
					f.stateT = 1.5 + rand() * 3;
				}
			}
			if (f.state === 'calm' && f.wanderT <= 0) {
				f.wanderT = 2.5 + rand() * 4.5;
				const a = rand() * TAU;
				const R = hf.pondRadius(a);
				const r = Math.sqrt(rand()) * Math.max(0.6, R - 1.0);
				f.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
				if (f.species.name === 'koi') f.desiredDepth = lerp(cfg.depth[0], cfg.depth[1], rand());
			}

			// ---- steering ----
			const steer = this._steer.set(0, 0, 0);
			const toTarget = this._toTarget.set(f.target.x - f.pos.x, 0, f.target.z - f.pos.z);
			const distT = toTarget.length();
			if (distT > 0.001) toTarget.multiplyScalar(1 / distT);
			const curSpeed = Math.hypot(f.vel.x, f.vel.z) || 0.001;
			const dir = this._dir.set(f.vel.x / curSpeed, 0, f.vel.z / curSpeed);

			let cruise = f.state === 'dart' ? cfg.speed[1] * 1.9 : (f.state === 'feed' ? cfg.speed[0] * 1.2 : lerp(cfg.speed[0], cfg.speed[1] * 0.55, f.speedNorm));
			if (distT < 0.3) cruise *= 0.35;
			steer.x += (toTarget.x * cruise - f.vel.x) * 1.6;
			steer.z += (toTarget.z * cruise - f.vel.z) * 1.6;

			// separation / alignment / cohesion with neighbours
			let alignX = 0, alignZ = 0, cohX = 0, cohZ = 0, n = 0;
			const sepR = f.len * 2.6;
			for (const o of f.species.list) {
				if (o === f) continue;
				const dx = f.pos.x - o.pos.x, dz = f.pos.z - o.pos.z;
				const d2 = dx * dx + dz * dz;
				const nearR = f.species.name === 'minnow' ? 0.55 : 1.1;
				if (d2 < sepR * sepR && d2 > 1e-6) {
					const d = Math.sqrt(d2);
					const w = (1 - d / sepR);
					steer.x += dx / d * w * (f.state === 'dart' ? 2.4 : 0.9);
					steer.z += dz / d * w * (f.state === 'dart' ? 2.4 : 0.9);
				}
				if (f.species.name === 'minnow' && d2 < nearR * nearR) {
					alignX += o.vel.x; alignZ += o.vel.z;
					cohX += o.pos.x; cohZ += o.pos.z;
					n++;
				}
			}
			if (n > 0) {
				const in_ = 1 / n;
				steer.x += (alignX * in_ - f.vel.x) * 0.55 + (cohX * in_ - f.pos.x) * 0.32;
				steer.z += (alignZ * in_ - f.vel.z) * 0.55 + (cohZ * in_ - f.pos.z) * 0.32;
			}

			// shoreline avoidance: probe ahead and push inward
			const probeX = f.pos.x + dir.x * (0.6 + f.len * 1.5);
			const probeZ = f.pos.z + dir.z * (0.6 + f.len * 1.5);
			const depthAhead = -hf.height(probeX, probeZ);
			if (depthAhead < 0.16) {
				const inward = 1.0 / (Math.max(f.pos.x, 0.001) ** 2 + f.pos.z ** 2 + 1e-6);
				const push = (0.16 - depthAhead) * 9 + 1.2;
				steer.x -= f.pos.x * inward ** 0.5 * push * 0.5;
				steer.z -= f.pos.z * inward ** 0.5 * push * 0.5;
				// also aim back toward the middle
				steer.x += -f.pos.x / (Math.hypot(f.pos.x, f.pos.z) + 0.001) * push * 0.6;
				steer.z += -f.pos.z / (Math.hypot(f.pos.x, f.pos.z) + 0.001) * push * 0.6;
			}
			// hard clamp inside the pond
			const rNow = Math.hypot(f.pos.x, f.pos.z);
			const Rmax = hf.pondRadius(Math.atan2(f.pos.z, f.pos.x)) - 0.45 - f.len;
			if (rNow > Rmax) {
				const inv = 1 / rNow;
				steer.x += -f.pos.x * inv * (rNow - Rmax) * 14;
				steer.z += -f.pos.z * inv * (rNow - Rmax) * 14;
			}

			// ---- integrate ----
			const accel = f.state === 'dart' ? 5.5 : 2.4;
			f.vel.x += steer.x * accel * dt;
			f.vel.z += steer.z * accel * dt;
			const sp = Math.hypot(f.vel.x, f.vel.z);
			const maxSp = f.state === 'dart' ? cfg.speed[1] * 2.0 : cfg.speed[1];
			if (sp > maxSp) { f.vel.x *= maxSp / sp; f.vel.z *= maxSp / sp; }
			if (sp < 0.02 && f.state !== 'dart') { f.vel.x += Math.sin(f.seed * 10 + time) * 0.02; f.vel.z += Math.cos(f.seed * 10 + time) * 0.02; }

			f.pos.x += f.vel.x * dt;
			f.pos.z += f.vel.z * dt;

			// vertical: spring toward desired depth, but respect the bed
			const depthHere = -hf.height(f.pos.x, f.pos.z);
			const maxY = -0.05;
			const minY = Math.max(-depthHere + 0.10, -1.2);
			let desY = -f.desiredDepth;
			if (f.state === 'feed') desY = -0.07;
			desY = clamp(desY, minY, maxY);
			f.vel.y += (desY - f.pos.y) * 2.4 * dt;
			f.vel.y *= Math.exp(-3.2 * dt);
			f.pos.y += f.vel.y * dt;

			// ---- orientation ----
			const spd3 = f.vel.length() || 0.001;
			const targetYaw = Math.atan2(f.vel.x, f.vel.z);
			let dYaw = targetYaw - f.yaw;
			while (dYaw > Math.PI) dYaw -= TAU;
			while (dYaw < -Math.PI) dYaw += TAU;
			const yawRate = clamp(dYaw, -6 * dt, 6 * dt) * (f.state === 'dart' ? 1.6 : 1.0);
			f.yaw += yawRate;
			f.pitch = lerp(f.pitch, -Math.asin(clamp(f.vel.y / spd3, -0.7, 0.7)), Math.min(1, dt * 4));
			f.roll = lerp(f.roll, clamp(-yawRate / Math.max(dt, 1e-4) * 0.07, -0.5, 0.5), Math.min(1, dt * 3));

			// tail speed follows effort
			const spNorm = clamp(spd3 / (cfg.speed[1] * 1.6), 0, 1);
			f.speedNorm = lerp(f.speedNorm, 0.22 + spNorm * 0.95, Math.min(1, dt * 2.5));
			f.osc = lerp(f.osc, 0.3 + spNorm * 0.75, Math.min(1, dt * 3));

			// ---- ripples when close to the surface ----
			if (f.pos.y > -0.16) {
				f.rippleT -= dt;
				if (f.rippleT <= 0) {
					f.rippleT = f.species.name === 'koi' ? 0.28 + rand() * 0.5 : 0.5 + rand() * 0.8;
					sim.addImpulse({
						x: f.pos.x, z: f.pos.z,
						radius: f.species.name === 'koi' ? 0.24 : 0.13,
						amp: f.species.name === 'koi' ? -0.008 : -0.0035,
						foam: 0.02,
						microScale: 1.3,
					});
				}
			}
		}

		// ---- write instance matrices / colours ----
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const e = new THREE.Euler();
		const sc = new THREE.Vector3();
		const p = new THREE.Vector3();
		const c = new THREE.Color();
		for (const species of this.species) {
			species.list.forEach((f, i) => {
				p.copy(f.pos);
				e.set(f.pitch, f.yaw, f.roll, 'YXZ');
				q.setFromEuler(e);
				sc.set(f.len, f.len * f.lenScaleY, f.len);
				m.compose(p, q, sc);
				species.mesh.setMatrixAt(i, m);
				// (seed, tail speed, species type) packed in the instance colour
				c.setRGB(f.seed, clamp(f.osc * 0.5, 0, 1), species.name === 'koi' ? 0.2 : 0.8);
				species.mesh.setColorAt(i, c);
			});
			species.mesh.instanceMatrix.needsUpdate = true;
			if (species.mesh.instanceColor) species.mesh.instanceColor.needsUpdate = true;
		}
	}
}
