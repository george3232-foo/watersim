import * as THREE from 'three';

// Splash / droplet / ripple effects for objects entering the pond.
//
// Particle state lives in preallocated typed arrays and is compacted into one
// Points draw call each frame. Ripple rings are a small pool of quads with a
// procedural foam shader. Nothing is allocated while the effect is running.
//
// Rendering note: the pond is composited in a later pass on top of the main
// scene (`WaterSurface.scene`), so effects placed in the main scene get painted
// over whenever water lies between the camera and the splash. Instead the App
// adds this group to the water scene: it is drawn right after the water mesh
// and performs its own occlusion test against the opaque scene depth texture.
// That keeps droplets and foam lines above the surface while still hiding them
// behind the dock, rocks or the bank when those are in front.

const OCCLUDE_FRAG = /* glsl */`
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uOcclude;
bool hiddenByScene(float viewDepth){
  if (uOcclude < 0.5) return false;
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float d = texture2D(tDepth, screenUv).r;
  float sceneZ = (2.0 * uNear * uFar) / (uFar + uNear - (2.0 * d - 1.0) * (uFar - uNear));
  return sceneZ < viewDepth - 0.06;
}`;

const DROPLET_VERT = /* glsl */`
precision highp float;
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
uniform float uPixelScale;
varying float vAlpha;
varying float vSeed;
varying float vViewDepth;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewDepth = -mv.z;
  float dist = max(vViewDepth, 0.05);
  // world-space size projected to pixels, with a small floor so one-pixel
  // droplets stay legible at pond-view distances
  gl_PointSize = clamp(aSize * uPixelScale / dist, 3.3, 30.0);
  vAlpha = aAlpha;
  vSeed = aSeed;
}`;

const DROPLET_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
varying float vAlpha;
varying float vSeed;
varying float vViewDepth;
${OCCLUDE_FRAG}
void main(){
  if (hiddenByScene(vViewDepth)) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float core = exp(-d * 3.4) - 0.035;
  float spark = smoothstep(0.55, 0.0, d);
  float twinkle = 0.86 + 0.14 * sin(uTime * 37.0 + vSeed * 41.0);
  float a = max(core, 0.0) * vAlpha * twinkle;
  if (a < 0.018) discard;
  vec3 col = mix(vec3(0.48, 0.67, 0.73), vec3(0.98, 1.0, 0.98), spark);
  col *= 1.05 + 0.55 * spark;
  gl_FragColor = vec4(col, a);
}`;

const RING_VERT = /* glsl */`
precision highp float;
varying vec2 vP;
varying float vViewDepth;
void main(){
  vP = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = /* glsl */`
precision highp float;
uniform float uRadius;    // current wavefront radius, metres
uniform float uMaxRadius; // mesh extent, metres
uniform float uWidth;     // half-width of the foam line, metres
uniform float uAlpha;
uniform float uFoam;
uniform float uSeed;
varying vec2 vP;
varying float vViewDepth;
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
${OCCLUDE_FRAG}
void main(){
  if (hiddenByScene(vViewDepth)) discard;
  float r = length(vP);
  float rm = r * uMaxRadius;

  // primary ripple line, gently feathered
  float d1 = abs(rm - uRadius);
  float line = 1.0 - smoothstep(uWidth * 0.30, uWidth, d1);

  // fainter trailing capillary line just inside the front
  float d2 = abs(rm - uRadius * 0.70);
  float line2 = (1.0 - smoothstep(uWidth * 0.35, uWidth * 1.55, d2)) * 0.11;

  float ang = atan(vP.y, vP.x);
  // Break the circle into uneven foam lobes and grain so it reads as a
  // ripple line rather than a painted vector ring.
  float lobes = 0.68
    + 0.20 * sin(ang * 11.0 + uSeed * 13.0 + rm * 7.0)
    + 0.12 * sin(ang * 29.0 - uSeed * 7.0 - rm * 19.0);
  lobes = smoothstep(0.30, 0.92, lobes);
  float grain = 0.62 + 0.38 * sin(ang * 67.0 + uSeed * 29.0 + rm * 37.0);
  grain = 0.45 + 0.55 * smoothstep(0.10, 0.95, grain);
  float a = (line * (0.30 + 0.70 * lobes) * grain + line2 * lobes) * uAlpha;

  // scattered flecks riding the crest
  float fleckRing = step(0.92, hash11(floor(ang * 23.0) + uSeed * 71.0 + floor(rm * 260.0)));
  a += fleckRing * line * uAlpha * 0.40;

  // a short-lived speckle of foam at the impact point
  float centre = 1.0 - smoothstep(0.0, 0.18, r);
  float fleck = step(0.52, hash11(floor(ang * 21.0) + uSeed * 71.0 + floor(rm * 190.0)));
  a += centre * fleck * uFoam * (0.45 + 0.55 * grain);

  if (a < 0.012) discard;
  vec3 col = vec3(0.60, 0.71, 0.72);
  gl_FragColor = vec4(col, min(a, 0.86));
}`;

const TAU = Math.PI * 2;

function smooth01(a, b, x) {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

function occlusionUniforms(engine) {
	return {
		tDepth: { value: engine && engine.sceneRT ? engine.sceneRT.depthTexture : null },
		uResolution: { value: new THREE.Vector2(1, 1) },
		uNear: { value: 0.08 },
		uFar: { value: 500 },
		uOcclude: { value: engine && engine.sceneRT ? 1 : 0 },
	};
}

function makeParticleMaterial(engine) {
	return new THREE.ShaderMaterial({
		uniforms: Object.assign({
			uPixelScale: { value: 600 },
			uTime: { value: 0 },
		}, occlusionUniforms(engine)),
		vertexShader: DROPLET_VERT,
		fragmentShader: DROPLET_FRAG,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		fog: false,
	});
}

function makeRingMaterial(engine) {
	return new THREE.ShaderMaterial({
		uniforms: Object.assign({
			uRadius: { value: 0.15 },
			uMaxRadius: { value: 0.8 },
			uWidth: { value: 0.01 },
			uAlpha: { value: 0 },
			uFoam: { value: 0 },
			uSeed: { value: 0 },
		}, occlusionUniforms(engine)),
		vertexShader: RING_VERT,
		fragmentShader: RING_FRAG,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.NormalBlending,
		fog: false,
	});
}

export class SplashFX {
	constructor(opts = {}) {
		this.group = new THREE.Group();
		this.group.name = 'splash-fx';

		this.camera = opts.camera || null;
		this.renderer = opts.renderer || null;
		this.engine = opts.engine || null;

		this.maxDroplets = opts.maxDroplets ?? 420;
		this.maxRings = opts.maxRings ?? 12;
		this._dropletCursor = 0;
		this._ringCursor = 0;
		this._time = 0;
		this._occlusionMaterials = [];

		this._initParticles();
		this._initRings();
	}

	_initParticles() {
		const cap = this.maxDroplets;
		this._alive = new Uint8Array(cap);
		this._px = new Float32Array(cap);
		this._py = new Float32Array(cap);
		this._pz = new Float32Array(cap);
		this._vx = new Float32Array(cap);
		this._vy = new Float32Array(cap);
		this._vz = new Float32Array(cap);
		this._age = new Float32Array(cap);
		this._life = new Float32Array(cap);
		this._size = new Float32Array(cap);
		this._gravity = new Float32Array(cap);
		this._drag = new Float32Array(cap);
		this._alpha = new Float32Array(cap);
		this._seed = new Float32Array(cap);

		const geo = new THREE.BufferGeometry();
		this._renderPos = new Float32Array(cap * 3);
		this._renderSize = new Float32Array(cap);
		this._renderAlpha = new Float32Array(cap);
		this._renderSeed = new Float32Array(cap);

		const posAttr = new THREE.BufferAttribute(this._renderPos, 3);
		posAttr.setUsage(THREE.DynamicDrawUsage);
		const sizeAttr = new THREE.BufferAttribute(this._renderSize, 1);
		sizeAttr.setUsage(THREE.DynamicDrawUsage);
		const alphaAttr = new THREE.BufferAttribute(this._renderAlpha, 1);
		alphaAttr.setUsage(THREE.DynamicDrawUsage);
		const seedAttr = new THREE.BufferAttribute(this._renderSeed, 1);
		seedAttr.setUsage(THREE.DynamicDrawUsage);

		geo.setAttribute('position', posAttr);
		geo.setAttribute('aSize', sizeAttr);
		geo.setAttribute('aAlpha', alphaAttr);
		geo.setAttribute('aSeed', seedAttr);
		geo.setDrawRange(0, 0);

		this._particleGeo = geo;
		this._posAttr = posAttr;
		this._sizeAttr = sizeAttr;
		this._alphaAttr = alphaAttr;
		this._seedAttr = seedAttr;

		this._particleMat = makeParticleMaterial(this.engine);
		this._occlusionMaterials.push(this._particleMat);
		this._points = new THREE.Points(geo, this._particleMat);
		this._points.name = 'splash-droplets';
		this._points.frustumCulled = false;
		this._points.renderOrder = 20;
		this.group.add(this._points);
	}

	_initRings() {
		// Unit plane in XZ (extends [-1, 1]); the mesh is scaled to the final
		// ripple radius and the shader places the moving foam front.
		const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
		geo.rotateX(-Math.PI / 2);
		this._ringGeo = geo;
		this._rings = [];
		for (let i = 0; i < this.maxRings; i++) {
			const mat = makeRingMaterial(this.engine);
			this._occlusionMaterials.push(mat);
			const mesh = new THREE.Mesh(geo, mat);
			mesh.name = `splash-ring-${i}`;
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 21;
			this.group.add(mesh);
			this._rings.push({
				mesh, mat,
				active: false,
				age: 0,
				delay: 0,
				life: 1,
				startR: 0.15,
				endR: 0.8,
				alpha0: 0,
				width: 0.01,
				foam0: 0,
				y: 0.014,
				seed: 0,
			});
		}
	}

	/**
	 * Emit a splash at a point on the pond surface.
	 * @param {number} x world x
	 * @param {number} z world z
	 * @param {number} impact 0.002..0.5 mass/velocity scale from Throwables
	 * @param {{radius?:number, vy?:number, scale?:number}} opts
	 */
	splashAt(x, z, impact, opts = {}) {
		if (!Number.isFinite(x) || !Number.isFinite(z)) return;
		const imp = Math.min(0.5, Math.max(0, Number.isFinite(impact) ? impact : 0));
		const radius = opts.radius ?? 0.06;
		const vy = Math.abs(opts.vy ?? 2.0);
		const userScale = opts.scale ?? 1;

		// Normalise against the maximum the throwables hook can report. Cubing
		// would make light impacts vanish; a 0.65 power keeps pebbles restrained
		// while stones/ducks still get a full crown.
		let strength = Math.pow(imp / 0.5, 0.65);
		strength *= Math.min(1.3, Math.max(0.72, radius / 0.07));
		strength = Math.min(1, Math.max(0.035, strength)) * userScale;

		const radiusScale = Math.min(1.3, Math.max(0.8, radius / 0.07));
		const nDroplets = Math.round(10 + 24 * strength);
		const spread = (0.050 + 0.120 * strength) * radiusScale;
		const baseUp = 1.05 + 1.35 * strength + Math.min(0.45, vy * 0.10);
		const rand = Math.random;

		// Crown: a ring of droplets thrown up and out from the entry crater.
		for (let i = 0; i < nDroplets; i++) {
			const a = rand() * TAU;
			const rr = spread * Math.pow(rand(), 0.55);
			const edge = spread > 1e-5 ? rr / spread : 0;
			const outward = (0.14 + rand() * 0.28 + 0.34 * strength) * (0.55 + 0.45 * edge);
			const up = baseUp * (0.62 + rand() * 0.52) + (1 - edge) * 0.38 * strength;
			this._spawnParticle(
				x + Math.cos(a) * rr,
				0.022 + rand() * 0.045,
				z + Math.sin(a) * rr,
				Math.cos(a) * outward + (rand() - 0.5) * 0.10,
				up,
				Math.sin(a) * outward + (rand() - 0.5) * 0.10,
				0.62 + rand() * 0.42 + 0.26 * strength,
				Math.min(0.045, Math.max(0.01, (0.012 + rand() * 0.022 + 0.010 * strength) * radiusScale)),
				9.81,
				0.35 + rand() * 0.25,
				0.55 + rand() * 0.38
			);
		}

		// A few heavier central jets give the crown some vertical structure.
		const jets = 1 + Math.floor(strength * 3.2);
		for (let i = 0; i < jets; i++) {
			const a = rand() * TAU;
			const rr = spread * 0.22 * rand();
			this._spawnParticle(
				x + Math.cos(a) * rr,
				0.025 + rand() * 0.03,
				z + Math.sin(a) * rr,
				Math.cos(a) * (0.05 + rand() * 0.15),
				baseUp * (1.20 + rand() * 0.5),
				Math.sin(a) * (0.05 + rand() * 0.15),
				0.72 + rand() * 0.42,
				Math.min(0.045, Math.max(0.01, (0.015 + rand() * 0.018) * radiusScale)),
				9.81,
				0.30,
				0.62 + rand() * 0.30
			);
		}

		// Foam / bubble flecks that linger on the surface for a moment.
		const nFoam = 4 + Math.round(9 * strength);
		for (let i = 0; i < nFoam; i++) {
			const a = rand() * TAU;
			const rr = spread * (0.35 + rand() * 0.65);
			this._spawnParticle(
				x + Math.cos(a) * rr,
				0.012 + rand() * 0.008,
				z + Math.sin(a) * rr,
				Math.cos(a) * (0.06 + rand() * 0.22),
				0.04 + rand() * (0.16 + 0.22 * strength),
				Math.sin(a) * (0.06 + rand() * 0.22),
				0.30 + rand() * 0.40,
				(0.007 + rand() * 0.013) * radiusScale,
				0.0,
				4.2,
				0.42 + rand() * 0.32
			);
		}

		// Expanding surface rings. Up to three, progressively delayed/slower.
		const nRings = 1 + (strength > 0.28 ? 1 : 0) + (strength > 0.62 ? 1 : 0);
		for (let i = 0; i < nRings; i++) {
			const endR = (0.46 + 0.34 * strength) * (1 - i * 0.075);
			this._spawnRing({
				x, z,
				delay: i * 0.075 + rand() * 0.02,
				life: 0.82 + 0.34 * strength + i * 0.13 + rand() * 0.10,
				startR: 0.120 + i * 0.018 + rand() * 0.015,
				endR,
				alpha0: (0.17 + 0.16 * strength) * (1 - i * 0.24),
				width: (0.007 + 0.006 * strength) * (1 - i * 0.10),
				foam0: i === 0 ? 0.40 * strength : 0,
				y: 0.014 + i * 0.0018,
				seed: rand() * 100,
			});
		}
	}

	_spawnParticle(x, y, z, vx, vy, vz, life, size, gravity, drag, alpha) {
		const i = this._dropletCursor;
		this._dropletCursor = (this._dropletCursor + 1) % this.maxDroplets;
		this._alive[i] = 1;
		this._px[i] = x; this._py[i] = y; this._pz[i] = z;
		this._vx[i] = vx; this._vy[i] = vy; this._vz[i] = vz;
		this._age[i] = 0;
		this._life[i] = life;
		this._size[i] = size;
		this._gravity[i] = gravity;
		this._drag[i] = drag;
		this._alpha[i] = alpha;
		this._seed[i] = Math.random() * 100;
	}

	_spawnRing(r) {
		const slot = this._rings[this._ringCursor];
		this._ringCursor = (this._ringCursor + 1) % this.maxRings;
		slot.active = true;
		slot.age = 0;
		slot.delay = r.delay;
		slot.life = r.life;
		slot.startR = r.startR;
		slot.endR = r.endR;
		slot.alpha0 = r.alpha0;
		slot.width = r.width;
		slot.foam0 = r.foam0;
		slot.y = r.y;
		slot.seed = r.seed;
		slot.mesh.position.set(r.x, r.y, r.z);
		slot.mesh.scale.setScalar(r.endR);
		slot.mesh.visible = false;
		const u = slot.mat.uniforms;
		u.uRadius.value = r.startR;
		u.uMaxRadius.value = r.endR;
		u.uWidth.value = r.width;
		u.uAlpha.value = 0;
		u.uFoam.value = 0;
		u.uSeed.value = r.seed;
	}

	update(dt, time) {
		if (!(dt > 0)) return;
		if (dt > 0.05) dt = 0.05;
		this._time += dt;

		// point size scale depends on render-target height and vertical fov
		if (this.camera && this.renderer) {
			const h = this.renderer.domElement.height || 1;
			const fov = (this.camera.fov || 50) * Math.PI / 180;
			this._particleMat.uniforms.uPixelScale.value = h / (2 * Math.tan(fov * 0.5));
		}
		this._particleMat.uniforms.uTime.value = this._time;
		this._syncOcclusion();

		this._updateParticles(dt);
		this._updateRings(dt);
	}

	_syncOcclusion() {
		const engine = this.engine;
		if (!engine) return;
		const rt = engine.sceneRT;
		const cam = engine.camera || this.camera;
		const width = rt ? rt.width : 1;
		const height = rt ? rt.height : 1;
		for (let i = 0; i < this._occlusionMaterials.length; i++) {
			const u = this._occlusionMaterials[i].uniforms;
			u.tDepth.value = rt ? rt.depthTexture : null;
			u.uResolution.value.set(width, height);
			u.uNear.value = cam ? cam.near : 0.08;
			u.uFar.value = cam ? cam.far : 500;
			u.uOcclude.value = rt && rt.depthTexture ? 1 : 0;
		}
	}

	_updateParticles(dt) {
		const cap = this.maxDroplets;
		const pos = this._renderPos;
		const sizes = this._renderSize;
		const alphas = this._renderAlpha;
		const seeds = this._renderSeed;
		let n = 0;

		for (let i = 0; i < cap; i++) {
			if (!this._alive[i]) continue;
			const age = this._age[i] + dt;
			if (age >= this._life[i]) {
				this._alive[i] = 0;
				continue;
			}
			this._age[i] = age;

			const drag = Math.exp(-this._drag[i] * dt);
			let vx = this._vx[i] * drag;
			let vy = this._vy[i] * drag - this._gravity[i] * dt;
			let vz = this._vz[i] * drag;
			let px = this._px[i] + vx * dt;
			let py = this._py[i] + vy * dt;
			let pz = this._pz[i] + vz * dt;

			// droplets merge back into the pond; foam stays on the surface
			if (this._gravity[i] > 0.01) {
				if (py < 0.012) {
					this._alive[i] = 0;
					continue;
				}
			} else if (py > 0.22) {
				// surface bubbles pop instead of drifting into the air
				vy *= 0.3;
				py = 0.22;
			}

			this._vx[i] = vx; this._vy[i] = vy; this._vz[i] = vz;
			this._px[i] = px; this._py[i] = py; this._pz[i] = pz;

			const t = age / this._life[i];
			let a = this._alpha[i] * Math.pow(1 - t, 1.35);
			a *= smooth01(0, 0.045, age);
			if (a < 0.018) {
				this._alive[i] = 0;
				continue;
			}

			const j = n * 3;
			pos[j] = px; pos[j + 1] = py; pos[j + 2] = pz;
			sizes[n] = this._size[i];
			alphas[n] = a;
			seeds[n] = this._seed[i];
			n++;
		}

		this._particleGeo.setDrawRange(0, n);
		if (n > 0) {
			this._posAttr.needsUpdate = true;
			this._sizeAttr.needsUpdate = true;
			this._alphaAttr.needsUpdate = true;
			this._seedAttr.needsUpdate = true;
		}
	}

	_updateRings(dt) {
		for (let i = 0; i < this._rings.length; i++) {
			const r = this._rings[i];
			if (!r.active) continue;
			r.age += dt;
			if (r.age >= r.life) {
				r.active = false;
				r.mesh.visible = false;
				continue;
			}
			if (r.age < r.delay) {
				r.mesh.visible = false;
				continue;
			}
			const span = Math.max(1e-4, r.life - r.delay);
			const t = Math.min(1, Math.max(0, (r.age - r.delay) / span));
			const ease = 1 - Math.pow(1 - t, 2.1);
			const radius = r.startR + (r.endR - r.startR) * ease;

			// fade in over the first instants, then fade out as it widens
			const fadeIn = smooth01(0, 0.06, t);
			const fadeOut = Math.pow(1 - t, 1.45);
			const alpha = r.alpha0 * fadeIn * fadeOut;
			const foam = r.foam0 * Math.max(0, 1 - t * 5.5);

			const u = r.mat.uniforms;
			u.uRadius.value = radius;
			u.uWidth.value = r.width * (1 - 0.42 * t);
			u.uAlpha.value = alpha;
			u.uFoam.value = foam;
			r.mesh.visible = alpha > 0.004;
		}
	}
}
