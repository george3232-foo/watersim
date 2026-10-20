import * as THREE from 'three';
import { mulberry32, clamp } from '../core/Noise.js';

const STREAK_COUNT = 4200;
const RING_COUNT = 170;

// Rain is split into two layers:
//  - a camera-centred volume of instanced ribbons with wind-slanted fall
//  - a small pool of expanding impact rings that ride the actual water surface
// Both live in a separate scene rendered after the water, so streaks do not
// punch holes in the water's manual depth test.
export class RainFX {
	constructor(camera, hf, sim, opts = {}) {
		this.camera = camera;
		this.hf = hf;
		this.sim = sim;
		this.group = new THREE.Group();
		this.group.name = 'rain';

		this.time = 0;
		this.rand = mulberry32(8123);
		this.wind = new THREE.Vector2(1, 0.3);
		this.windStrength = 0.4;
		this.rain = 0;
		this.flash = 0;
		this.night = 0;

		this.buildStreaks();
		this.buildRings();
	}

	buildStreaks() {
		const geo = new THREE.InstancedBufferGeometry();
		const corners = new Float32Array([
			-0.5, 0, 0, 0.5, 0, 0,
			-0.5, 1, 0, 0.5, 1, 0,
		]);
		geo.setAttribute('position', new THREE.BufferAttribute(corners, 3));
		geo.setIndex([0, 1, 2, 2, 1, 3]);

		const rand = this.rand;
		const offsets = new Float32Array(STREAK_COUNT * 3);
		const speeds = new Float32Array(STREAK_COUNT);
		const lengths = new Float32Array(STREAK_COUNT);
		const widths = new Float32Array(STREAK_COUNT);
		const alphas = new Float32Array(STREAK_COUNT);
		const seeds = new Float32Array(STREAK_COUNT);
		const R = 15.5;
		for (let i = 0; i < STREAK_COUNT; i++) {
			const a = rand() * Math.PI * 2;
			const r = Math.sqrt(rand()) * R;
			offsets[i * 3] = Math.cos(a) * r;
			offsets[i * 3 + 1] = rand() * 12;
			offsets[i * 3 + 2] = Math.sin(a) * r;
			speeds[i] = 9 + rand() * 7.5;
			lengths[i] = 0.15 + rand() * 0.24;
			widths[i] = 0.0035 + rand() * 0.0075;
			alphas[i] = 0.12 + rand() * 0.22;
			seeds[i] = rand();
		}
		geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
		geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
		geo.setAttribute('aLength', new THREE.InstancedBufferAttribute(lengths, 1));
		geo.setAttribute('aWidth', new THREE.InstancedBufferAttribute(widths, 1));
		geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphas, 1));
		geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
		geo.instanceCount = STREAK_COUNT;

		this.streakUniforms = {
			uTime: { value: 0 },
			uRain: { value: 0 },
			uWind: { value: new THREE.Vector2(1, 0.3) },
			uHeight: { value: 12 },
			uRadius: { value: 15.5 },
			uColor: { value: new THREE.Color(0x9fb3c4) },
			uFlash: { value: 0 },
			uNight: { value: 0 },
		};

		const mat = new THREE.ShaderMaterial({
			uniforms: this.streakUniforms,
			vertexShader: /* glsl */`
				uniform float uTime, uRain, uHeight, uRadius, uFlash, uNight;
				uniform vec2 uWind;
				attribute vec3 aOffset;
				attribute float aSpeed, aLength, aWidth, aAlpha, aSeed;
				varying float vAlpha;
				varying vec2 vUv;
				void main(){
					float y = mod(aOffset.y - uTime * aSpeed, uHeight);
					vec3 p = vec3(aOffset.x, y, aOffset.z);
					p.xz += uWind * (uHeight - y) * 0.075;
					vec4 mv = modelViewMatrix * vec4(p, 1.0);
					vec3 fall = normalize(vec3(uWind.x * 0.8, -1.0, uWind.y * 0.8));
					vec3 axis = normalize((modelViewMatrix * vec4(fall, 0.0)).xyz);
					vec3 side = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
					mv.xyz += axis * (position.y - 0.5) * aLength + side * position.x * aWidth;
					gl_Position = projectionMatrix * mv;
					vUv = vec2(position.x + 0.5, position.y);
					float edge = 1.0 - smoothstep(uRadius * 0.52, uRadius, length(p.xz));
					float near = smoothstep(2.2, 5.0, -mv.z);
					float density = step(aSeed, uRain * 1.18);
					vAlpha = aAlpha * density * edge * near
						* smoothstep(0.0, 0.035, y)
						* (1.0 - smoothstep(uHeight * 0.7, uHeight, y));
				}`,
			fragmentShader: /* glsl */`
				uniform vec3 uColor;
				uniform float uFlash, uNight;
				varying float vAlpha;
				varying vec2 vUv;
				void main(){
					float ends = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.66, 1.0, vUv.y));
					float side = smoothstep(0.0, 0.28, min(vUv.x, 1.0 - vUv.x));
					float a = vAlpha * ends * side;
					if (a < 0.002) discard;
					vec3 col = uColor * (1.0 - uNight * 0.42 + uFlash * 1.7);
					gl_FragColor = vec4(col, a);
				}`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			blending: THREE.NormalBlending,
			side: THREE.DoubleSide,
			fog: false,
		});
		this.streaks = new THREE.Mesh(geo, mat);
		this.streaks.frustumCulled = false;
		this.streaks.renderOrder = 40;
		this.group.add(this.streaks);
	}

	buildRings() {
		const geo = new THREE.PlaneGeometry(1, 1);
		geo.rotateX(-Math.PI / 2);
		this.rings = [];
		const rand = this.rand;
		for (let i = 0; i < RING_COUNT; i++) {
			this.rings.push({ x: 0, z: 0, age: rand() * 0.7, life: 0.55 + rand() * 0.55, y: 0.02 });
		}

		const alpha = new Float32Array(RING_COUNT);
		this.ringAlpha = new THREE.InstancedBufferAttribute(alpha, 1);
		geo.setAttribute('aAlpha', this.ringAlpha);

		const mat = new THREE.ShaderMaterial({
			uniforms: { uColor: { value: new THREE.Color(0xb9ccd6) } },
			vertexShader: /* glsl */`
				attribute float aAlpha;
				varying vec2 vUv;
				varying float vA;
				void main(){
					vUv = uv;
					vA = aAlpha;
					vec4 p = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
					gl_Position = projectionMatrix * p;
				}`,
			fragmentShader: /* glsl */`
				uniform vec3 uColor;
				varying vec2 vUv;
				varying float vA;
				void main(){
					float d = length(vUv - 0.5);
					float ring = smoothstep(0.495, 0.472, d) * (1.0 - smoothstep(0.443, 0.461, d));
					float a = ring * vA;
					if (a < 0.003) discard;
					gl_FragColor = vec4(uColor, a);
				}`,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			side: THREE.DoubleSide,
			fog: false,
		});
		this.ringMesh = new THREE.InstancedMesh(geo, mat, RING_COUNT);
		this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.ringMesh.frustumCulled = false;
		this.ringMesh.renderOrder = 41;
		this.ringMesh.visible = false;
		this.group.add(this.ringMesh);
	}

	respawnRing(r) {
		const rand = this.rand;
		for (let tries = 0; tries < 8; tries++) {
			const a = rand() * Math.PI * 2;
			const R = this.hf.pondRadius(a);
			const rr = Math.sqrt(rand()) * (R - 0.35);
			const x = Math.cos(a) * rr;
			const z = Math.sin(a) * rr;
			if (this.hf.inPond(x, z) && this.hf.height(x, z) < -0.025) {
				r.x = x;
				r.z = z;
				return;
			}
		}
		r.x = 0;
		r.z = 0;
	}

	update(dt, time, opts = {}) {
		this.rain = opts.rain ?? this.rain;
		this.wind.copy(opts.wind ?? this.wind).normalize();
		this.windStrength = opts.windStrength ?? this.windStrength;
		this.night = opts.night ?? this.night;
		this.flash = opts.flash ?? 0;
		this.time = time;

		const visible = this.rain > 0.015;
		this.group.visible = visible;
		if (!visible) return;

		const cam = this.camera;
		this.streaks.position.set(cam.position.x, 0, cam.position.z);
		const u = this.streakUniforms;
		u.uTime.value = time;
		u.uRain.value = clamp(this.rain * 1.12, 0, 1);
		u.uWind.value.copy(this.wind);
		u.uFlash.value = this.flash;
		u.uNight.value = this.night;

		const showRings = this.rain > 0.10;
		this.ringMesh.visible = showRings;
		if (!showRings) return;

		const m = this._m || (this._m = new THREE.Matrix4());
		const q = this._q || (this._q = new THREE.Quaternion());
		const p = this._p || (this._p = new THREE.Vector3());
		const s = this._s || (this._s = new THREE.Vector3());
		const surf = this._surf || (this._surf = { height: 0, depth: 0 });
		q.identity();
		const alpha = this.ringAlpha.array;
		for (let i = 0; i < this.rings.length; i++) {
			const r = this.rings[i];
			r.age += dt;
			if (r.age >= r.life) {
				r.age = 0;
				r.life = 0.5 + this.rand() * 0.55;
				this.respawnRing(r);
			}
			const t = r.age / r.life;
			const size = 0.045 + t * 0.30;
			this.sim.sampleSurface(r.x, r.z, surf);
			p.set(r.x, surf.height + 0.006, r.z);
			s.set(size, 1, size);
			m.compose(p, q, s);
			this.ringMesh.setMatrixAt(i, m);
			const near = 1.0 - smoothstep(10.0, 14.5, Math.hypot(r.x - cam.position.x, r.z - cam.position.z));
			alpha[i] = Math.sin(Math.PI * t) * 0.19 * this.rain * near;
		}
		this.ringMesh.instanceMatrix.needsUpdate = true;
		this.ringAlpha.needsUpdate = true;
	}
}

const UP = new THREE.Vector3(0, 1, 0);

function smoothstep(a, b, x) {
	const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
	return t * t * (3 - 2 * t);
}
