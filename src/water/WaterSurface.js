import * as THREE from 'three';
import { GLSL_NOISE, GLSL_WATER_COMMON } from '../core/Shaders.js';

const WATER_VERT = /* glsl */`
precision highp float;
uniform sampler2D tMacro;
uniform sampler2D tMicro;
uniform sampler2D tBed;
uniform float uLevel;
uniform float uDomain;
uniform float uHalf;
uniform mat4 uReflectionMatrix;
varying vec3 vWorld;
varying vec2 vSimUv;
varying vec4 vReflect;
varying float vViewDepth;
void main(){
  vSimUv = (position.xz + uHalf) / uDomain;
  float macro = texture2D(tMacro, vSimUv).r;
  float bed = texture2D(tBed, vSimUv).r;
  float eta = (macro - bed > 0.0001 ? macro : 0.0) + texture2D(tMicro, vSimUv).r + uLevel;
  vec3 p = position;
  p.y = eta;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewDepth = -mv.z;
  vReflect = uReflectionMatrix * wp;
  gl_Position = projectionMatrix * mv;
}`;

const WATER_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
varying vec2 vSimUv;
varying vec4 vReflect;
varying float vViewDepth;
uniform sampler2D tMacro;
uniform sampler2D tMicro;
uniform sampler2D tBed;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tReflection;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uLevel;
uniform float uDomain;
uniform vec2 uMacroTexel;
uniform vec2 uMicroTexel;
uniform float uReflectionValid;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uScatterColor;
uniform vec3 uDeepColor;
uniform vec3 uFogColor;
uniform float uSunIntensity;
uniform float uFogDensity;
uniform float uWindStrength;
uniform vec2 uWind;
uniform float uRain;
uniform float uNight;
uniform float uRefraction;
uniform float uDebug;
${GLSL_NOISE}
${GLSL_WATER_COMMON}

float capillary(vec2 p, vec2 wd){
  float t = uTime;
  float a = sw_noise(p * 10.5 + wd * t * 0.5) * 0.60;
  a += sw_noise(p * 21.0 - wd * t * 0.9 + 7.1) * 0.30;
  a += sw_noise(p * 44.0 + vec2(t * 1.1, -t * 0.7)) * 0.12;
  return a;
}

void main(){
  vec2 screenUv = gl_FragCoord.xy / uResolution;

  float etaM = texture2D(tMacro, vSimUv).r;
  float etaR = texture2D(tMicro, vSimUv).r;
  float bed = texture2D(tBed, vSimUv).r;
  float surface = (etaM - bed > 0.0001 ? etaM : 0.0) + uLevel;
  float h = surface - bed;

  if (h < 0.0022) discard;

  // manual depth test against the opaque scene
  float sceneDepth = texture2D(tDepth, screenUv).r;
  float sceneZ = sw_linearDepth(sceneDepth, uNear, uFar);
  if (sceneZ < vViewDepth - 0.035) discard;

  float dist = length(cameraPosition - vWorld);

  // ---- surface normal: macro + micro + sub-grid capillary detail ----
  float eM = 1.6 * uMacroTexel.x;
  float hL = texture2D(tMacro, vSimUv - vec2(eM, 0.0)).r;
  float hR = texture2D(tMacro, vSimUv + vec2(eM, 0.0)).r;
  float hD = texture2D(tMacro, vSimUv - vec2(0.0, eM)).r;
  float hU = texture2D(tMacro, vSimUv + vec2(0.0, eM)).r;
  vec2 gradM = vec2(hR - hL, hU - hD) / (2.0 * eM * uDomain);

  float eR = 2.2 * uMicroTexel.x;
  float rL = texture2D(tMicro, vSimUv - vec2(eR, 0.0)).r;
  float rR = texture2D(tMicro, vSimUv + vec2(eR, 0.0)).r;
  float rD = texture2D(tMicro, vSimUv - vec2(0.0, eR)).r;
  float rU = texture2D(tMicro, vSimUv + vec2(0.0, eR)).r;
  vec2 gradR = vec2(rR - rL, rU - rD) / (2.0 * eR * uDomain);

  vec2 wd = normalize(uWind + vec2(1e-4, 0.0));
  vec2 cp = vWorld.xz;
  float ce = 0.035;
  float c0 = capillary(cp, wd);
  float cx = capillary(cp + vec2(ce, 0.0), wd);
  float cz = capillary(cp + vec2(0.0, ce), wd);
  float capFade = 1.0 - smoothstep(7.0, 24.0, dist);
  float capAmp = (0.0022 + uWindStrength * 0.0065 + uRain * 0.0060) * capFade;
  vec2 gradC = vec2(cx - c0, cz - c0) / ce * capAmp;

  vec2 g = gradM * 1.15 + gradR * 2.4 + gradC * 1.0;
  float slope = length(g);
  if (slope > 1.3) g *= 1.3 / slope;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // ---- refraction ----
  float thick = clamp(h, 0.0, 2.2);
  float shoreFade = smoothstep(0.02, 0.42, h);
  vec2 refr = N.xz * (0.010 + thick * 0.034) * uRefraction * shoreFade;
  // Keep near-surface silhouettes readable without clearing the deeper water.
  refr *= mix(0.65, 1.0, smoothstep(0.06, 0.6, max(0.0, sceneZ - vViewDepth)));
  vec2 refrUv = clamp(screenUv + refr, vec2(0.001), vec2(0.999));
  float offDepth = texture2D(tDepth, refrUv).r;
  float offZ = sw_linearDepth(offDepth, uNear, uFar);
  if (offZ < vViewDepth + 0.012) {
    refrUv = screenUv;
    offDepth = texture2D(tDepth, screenUv).r;
    offZ = sw_linearDepth(offDepth, uNear, uFar);
  }

  vec2 ca = refr * 0.018;
  vec3 refrCol;
  refrCol.r = texture2D(tScene, clamp(refrUv - ca, vec2(0.001), vec2(0.999))).r;
  refrCol.g = texture2D(tScene, refrUv).g;
  refrCol.b = texture2D(tScene, clamp(refrUv + ca, vec2(0.001), vec2(0.999))).b;

  // The water column only tells us how deep the pond is; the light that reaches
  // the eye from a fish just below the surface has crossed far less water than
  // the bed. Use the opaque scene depth to trace the actual submerged path.
  float path = clamp(offZ - vViewDepth, 0.025, 3.4);
  float shortPath = 1.0 - smoothstep(0.12, 0.7, path);
  // peaty garden-pond water: reds die first, blue-greens carry
  vec3 sigma = vec3(1.02, 0.46, 0.34);
  vec3 trans = exp(-sigma * path * (1.0 - shortPath * 0.18));
  vec3 scatter = uScatterColor * (0.32 + 0.22 * max(uSunDir.y, 0.0));
  scatter += uDeepColor * 0.5;
  vec3 refracted = refrCol * trans + scatter * (1.0 - trans);

  // ---- planar reflection ----
  vec2 ruv = vReflect.xy / max(vReflect.w, 0.0001);
  vec2 rOff = N.xz * (0.006 + 0.026 * slope);
  vec2 ruvA = ruv + rOff;
  vec2 ruvB = ruv + rOff * 0.45 + vec2(0.0008, 0.0005);
  vec2 ruvC = ruv + rOff * 1.55 - vec2(0.0007, 0.0009);
  vec3 reflCol;
  float inside = uReflectionValid * step(0.0001, vReflect.w) * step(0.002, ruvA.x) * step(ruvA.x, 0.998) * step(0.002, ruvA.y) * step(ruvA.y, 0.998);
  vec3 rA = texture2D(tReflection, clamp(ruvA, vec2(0.001), vec2(0.999))).rgb;
  vec3 rB = texture2D(tReflection, clamp(ruvB, vec2(0.001), vec2(0.999))).rgb;
  vec3 rC = texture2D(tReflection, clamp(ruvC, vec2(0.001), vec2(0.999))).rgb;
  reflCol = rA * 0.58 + rB * 0.24 + rC * 0.18;
  vec3 rdir = reflect(-V, N);
  vec3 skyRefl = mix(uHorizonColor * 0.70, uSkyColor * 0.98, smoothstep(0.0, 0.6, rdir.y));
  reflCol = mix(skyRefl, reflCol, inside);

  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres *= 1.0 - shortPath * smoothstep(0.2, 0.75, ndv) * 0.12;
  vec3 color = mix(refracted, reflCol, fres);

  // ---- sun & moon specular ----
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float rough = 0.030 + 0.070 * smoothstep(4.0, 42.0, dist) + uWindStrength * 0.012;
  float a = rough * rough;
  float denom = ndh * ndh * (a * a - 1.0) + 1.0;
  float D = a * a / (3.14159265 * denom * denom);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float spec = D * Fs * 0.25 / max(ndv, 0.25);
  spec *= uSunIntensity * 0.045;
  color += uSunColor * spec;

  float sparkleN = sw_noise(vWorld.xz * 95.0 + vec2(uTime * 2.3, -uTime * 1.7));
  float sparkle = pow(ndh, 420.0) * smoothstep(0.72, 0.97, sparkleN) * 0.42;
  color += uSunColor * sparkle * uSunIntensity * 0.022 * (0.4 + uWindStrength);

  vec3 M = normalize(uMoonDir);
  vec3 Hm = normalize(M + V);
  float moonSpec = pow(max(dot(N, Hm), 0.0), 1200.0) * uNight;
  color += vec3(0.55, 0.68, 1.0) * moonSpec * 0.22;

  // ---- crest translucency / subsurface ----
  float crest = smoothstep(0.012, 0.07, max(etaR, 0.0)) * smoothstep(0.0, 0.22, h);
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 2.5);
  color += uScatterColor * crest * back * uSunIntensity * 0.16;

  // ---- foam ----
  float foamImpact = texture2D(tMacro, vSimUv).a;
  float foamRipple = texture2D(tMicro, vSimUv).b;
  float shore = 1.0 - smoothstep(0.002, 0.045, h);
  float foamNoise = sw_fbm(vWorld.xz * 3.6 + uWind * uTime * 0.05);
  float foamDetail = sw_fbm(vWorld.xz * 11.0 - uWind * uTime * 0.09);
  float foam = foamImpact * 0.32;
  foam += foamRipple * 0.14;
  foam += shore * smoothstep(0.80, 0.95, foamNoise) * smoothstep(0.38, 0.78, foamDetail) * 0.10;
  // windrows: long streaks drawn along the wind axis during a blow
  vec2 wf = vec2(dot(vWorld.xz, uWind), dot(vWorld.xz, vec2(-uWind.y, uWind.x)));
  float windrow = sw_fbm(vec2(wf.x * 0.42 + uTime * 0.05, wf.y * 2.6));
  float whitecap = smoothstep(0.64, 0.82, windrow)
    * smoothstep(0.38, 0.92, uWindStrength)
    * smoothstep(0.06, 0.45, h);
  foam += whitecap * 0.10;
  foam *= smoothstep(0.40, 0.80, foamDetail + 0.18);
  foam = clamp(foam, 0.0, 0.38);
  vec3 foamColor = uSunColor * 0.10 + uSkyColor * 0.16 + vec3(0.035);
  color = mix(color, foamColor, foam);

  // a faint scatter of drifting pollen / debris on the surface
  float fleck = step(0.99985, sw_hash12(floor(vWorld.xz * 90.0) + floor(uTime * 0.2)));
  color += vec3(0.30, 0.26, 0.15) * fleck * 0.03;

  // ---- atmospheric fog ----
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  color = mix(color, uFogColor, fog);

  // soften the dry shoreline contact
  float edge = smoothstep(0.0, 0.055, h);
  vec3 sceneCol = texture2D(tScene, screenUv).rgb;
  color = mix(sceneCol, color, edge);

  if (uDebug > 0.5) {
    if (uDebug < 1.5) color = reflCol;
    else if (uDebug < 2.5) color = refracted;
    else if (uDebug < 3.5) color = vec3(fres);
    else if (uDebug < 4.5) color = vec3(1.0 - trans);
    else if (uDebug < 5.5) color = vec3(foam);
    else if (uDebug < 6.5) color = sceneCol;
    else if (uDebug < 7.5) color = N * 0.5 + 0.5;
    else if (uDebug < 8.5) color = vec3(ndv);
    else if (uDebug < 9.5) color = vec3(path / 3.4);
    else if (uDebug < 10.5) color = vec3(offZ / uDomain);
    else if (uDebug < 11.5) color = vec3(vViewDepth / uDomain);
    else if (uDebug < 12.5) color = vec3(texture2D(tDepth, screenUv).r);
    else if (uDebug < 13.5) color = vec3(offDepth);
    else color = vec3(h * 0.5);
  }

  gl_FragColor = vec4(color, 1.0);
}`;

export class WaterSurface {
	constructor(engine, sim, heightField, opts = {}) {
		this.engine = engine;
		this.sim = sim;
		this.hf = heightField;
		this.res = opts.res ?? 256;
		this.domain = sim.domain ?? 20;
		this.half = this.domain * 0.5;
		this.geometry = this.buildGeometry(this.res);
		this.uniforms = {
			tMacro: { value: sim.macroTexture },
			tMicro: { value: sim.microTexture },
			tBed: { value: sim.bedTexture },
			tScene: { value: null },
			tDepth: { value: null },
			tReflection: { value: null },
			uReflectionMatrix: { value: engine.textureMatrix },
			uLevel: { value: 0 },
			uDomain: { value: this.domain }, uHalf: { value: this.half },
			uMacroTexel: { value: new THREE.Vector2(1 / sim.macroSize, 1 / sim.macroSize) },
			uMicroTexel: { value: new THREE.Vector2(1 / sim.microSize, 1 / sim.microSize) },
			uReflectionValid: { value: 0 },
			uResolution: { value: new THREE.Vector2(1, 1) },
			uNear: { value: engine.camera.near },
			uFar: { value: engine.camera.far },
			uTime: { value: 0 },
			uSunDir: { value: new THREE.Vector3(0, 0.4, 0.5) },
			uMoonDir: { value: new THREE.Vector3(0.4, 0.6, -0.4) },
			uSunColor: { value: new THREE.Color(0xffd9a8) },
			uSkyColor: { value: new THREE.Color(0x5383b4) },
			uHorizonColor: { value: new THREE.Color(0xffc18a) },
			uScatterColor: { value: new THREE.Color(0x0a3d36) },
			uDeepColor: { value: new THREE.Color(0x021c20) },
			uFogColor: { value: new THREE.Color(0x9db3ae) },
			uSunIntensity: { value: 1 },
			uFogDensity: { value: 0.012 },
			uWindStrength: { value: 0.3 },
			uWind: { value: new THREE.Vector2(1, 0) },
			uRain: { value: 0 },
			uNight: { value: 0 },
			uRefraction: { value: 1 },
			uDebug: { value: 0 },
		};
		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: WATER_VERT,
			fragmentShader: WATER_FRAG,
			side: THREE.FrontSide,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			fog: false,
		});
		this.mesh = new THREE.Mesh(this.geometry, this.material);
		this.mesh.frustumCulled = false;
		this.mesh.onBeforeRender = () => {
			// Reflection may have been refreshed after update() earlier this frame.
			this.uniforms.uReflectionValid.value = this.engine.reflectionValid ? 1 : 0;
		};
		this.mesh.renderOrder = 10;
		this.scene = new THREE.Scene();
		this.scene.add(this.mesh);
	}

	buildGeometry(n) {
		if (!Number.isInteger(n) || n < 2 || n > 2048) throw new RangeError('Water surface resolution must be an integer from 2 to 2048');
		const half = this.half;
		const positions = new Float32Array((n + 1) * (n + 1) * 3);
		const uvs = new Float32Array((n + 1) * (n + 1) * 2);
		const IndexArray = (n + 1) ** 2 > 65535 ? Uint32Array : Uint16Array;
		const indices = new IndexArray(n * n * 6);
		let p = 0, q = 0;
		for (let j = 0; j <= n; j++) {
			const z = -half + (j / n) * half * 2;
			for (let i = 0; i <= n; i++) {
				const x = -half + (i / n) * half * 2;
				positions[p++] = x; positions[p++] = 0; positions[p++] = z;
				uvs[q++] = (x + half) / (half * 2); uvs[q++] = (z + half) / (half * 2);
			}
		}
		let k = 0;
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const a = j * (n + 1) + i;
				const b = a + 1;
				const c = a + (n + 1);
				const d = c + 1;
				indices[k++] = a; indices[k++] = c; indices[k++] = b;
				indices[k++] = b; indices[k++] = c; indices[k++] = d;
			}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
		geo.setIndex(new THREE.BufferAttribute(indices, 1));
		geo.computeBoundingSphere();
		return geo;
	}

	setResolution(n) {
		if (n === this.res) return false;
		const geometry = this.buildGeometry(n);
		const previous = this.geometry;
		this.geometry = geometry;
		this.mesh.geometry = geometry;
		this.res = n;
		previous.dispose();
		return true;
	}

	update(time, state) {
		const u = this.uniforms;
		const engine = this.engine;
		u.tMacro.value = this.sim.macroTexture;
		u.tMicro.value = this.sim.microTexture;
		u.tBed.value = this.sim.bedTexture;
		u.tScene.value = engine.sceneRT.texture;
		u.tDepth.value = engine.sceneRT.depthTexture;
		u.tReflection.value = engine.reflectionRT.texture;
		u.uReflectionMatrix.value = engine.textureMatrix;
		u.uLevel.value = this.sim.levelOffset;
		u.uDomain.value = this.sim.domain;
		u.uHalf.value = this.sim.half;
		u.uMacroTexel.value.setScalar(1 / this.sim.macroSize);
		u.uMicroTexel.value.setScalar(1 / this.sim.microSize);
		u.uReflectionValid.value = engine.reflectionValid ? 1 : 0;
		u.uResolution.value.set(engine.sceneRT.width, engine.sceneRT.height);
		u.uNear.value = engine.camera.near;
		u.uFar.value = engine.camera.far;
		u.uTime.value = time;
		u.uSunDir.value.copy(state.sunDir);
		if (state.moonDir) u.uMoonDir.value.copy(state.moonDir);
		u.uSunColor.value.copy(state.sunColor);
		u.uSkyColor.value.copy(state.skyColor);
		u.uHorizonColor.value.copy(state.horizonColor);
		u.uScatterColor.value.copy(state.scatterColor);
		u.uDeepColor.value.copy(state.deepColor);
		u.uFogColor.value.copy(state.fogColor);
		u.uSunIntensity.value = state.sunIntensity;
		u.uFogDensity.value = state.fogDensity ?? 0.012;
		u.uWindStrength.value = this.sim.windStrength;
		u.uWind.value.copy(this.sim.wind);
		u.uRain.value = this.sim.rain;
		u.uNight.value = state.night;
	}

	dispose() {
		this.mesh.removeFromParent();
		this.geometry.dispose();
		this.material.dispose();
	}
}
