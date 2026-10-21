import * as THREE from 'three';
import { GLSL_NOISE, GLSL_CAUSTIC } from '../core/Shaders.js';

const TERRAIN_RADIUS = 17;
const TERRAIN_ANGULAR = 320;
const TERRAIN_RADIAL = 84;

export class Terrain {
	constructor(heightField, bedTexture, domain = 20) {
		this.hf = heightField;
		this.bedTexture = bedTexture;
		this.domain = domain;
		this.half = domain * 0.5;
		this.simulationSize = 256;
		this.radius = TERRAIN_RADIUS;
		this.uniforms = {
			uTime: { value: 0 },
			uMacro: { value: null },
			uMicro: { value: null },
			uBed: { value: bedTexture },
			uDomain: { value: domain },
			uHalf: { value: domain * 0.5 },
			uWaterLevel: { value: 0 },
			uSimulationTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
			uSunColor: { value: new THREE.Color(0xffd9a8) },
			uSunIntensity: { value: 1 },
			uWaterHalf: { value: new THREE.Vector2(domain * 0.5, domain * 0.5) },
			uWind: { value: new THREE.Vector2(0.5, 0.2) },
			uDebug: { value: 0 },
		};

		this.geometry = this.buildGeometry();
		this.displaceNormals();

		const mat = new THREE.MeshStandardMaterial({
			color: 0xffffff,
			roughness: 0.96,
			metalness: 0.0,
			side: THREE.FrontSide,
			shadowSide: THREE.FrontSide,
			dithering: true,
		});
		mat.onBeforeCompile = (shader) => this.patchMaterial(shader);
		mat.customProgramCacheKey = () => 'stillwater-terrain-v4';
		this.material = mat;

		this.mesh = new THREE.Mesh(this.geometry, mat);
		this.mesh.receiveShadow = true;
		this.mesh.castShadow = false;
		this.mesh.name = 'terrain';
	}

	// Circular disk with a dense ring of vertices near the waterline. The outer
	// landscape ring starts at exactly the same radius, so there is no seam.
	buildGeometry() {
		const angular = TERRAIN_ANGULAR;
		const radial = TERRAIN_RADIAL;
		const radius = TERRAIN_RADIUS;
		const verts = [];
		const uvs = [];
		const indices = [];

		verts.push(0, this.hf.height(0, 0), 0);
		uvs.push(0.5, 0.5);

		for (let j = 1; j <= radial; j++) {
			// bias rings slightly toward the pond so the shoreline has detail
			const t = j / radial;
			const r = radius * Math.pow(t, 0.94);
			for (let i = 0; i < angular; i++) {
				const a = (i / angular) * Math.PI * 2;
				const x = Math.cos(a) * r;
				const z = Math.sin(a) * r;
				verts.push(x, this.hf.height(x, z), z);
				uvs.push((x + this.half) / this.domain, (z + this.half) / this.domain);
			}
		}

		// center fan
		for (let i = 0; i < angular; i++) {
			const a = 1 + i;
			const b = 1 + ((i + 1) % angular);
			indices.push(0, b, a);
		}
		// rings
		for (let j = 1; j < radial; j++) {
			const rowA = 1 + (j - 1) * angular;
			const rowB = 1 + j * angular;
			for (let i = 0; i < angular; i++) {
				const i2 = (i + 1) % angular;
				const a = rowA + i;
				const b = rowA + i2;
				const c = rowB + i;
				const d = rowB + i2;
				indices.push(a, b, c, b, d, c);
			}
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geo.setIndex(indices);
		geo.computeVertexNormals();
		geo.computeBoundingSphere();
		return geo;
	}

	displaceNormals() {
		const pos = this.geometry.attributes.position;
		const normal = this.geometry.attributes.normal;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), z = pos.getZ(i);
			const n = this.hf.normal(x, z, 0.11);
			normal.setXYZ(i, n[0], n[1], n[2]);
		}
		normal.needsUpdate = true;
	}

	patchMaterial(shader) {
		const u = this.uniforms;
		Object.assign(shader.uniforms, u);
		if (this.material) this.material.userData.shader = shader;

		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);

		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
uniform float uTime;
uniform sampler2D uMacro;
uniform sampler2D uMicro;
uniform sampler2D uBed;
uniform float uDomain;
uniform float uHalf;
uniform float uWaterLevel;
uniform vec2 uSimulationTexel;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec2 uWind;
uniform float uDebug;
${GLSL_NOISE}
${GLSL_CAUSTIC}
float sw_groundBump(vec2 p){
  float n = sw_noise(p * 4.2) * 0.55 + sw_noise(p * 11.5 + 13.0) * 0.28 + sw_noise(p * 27.0) * 0.12;
  return n;
}`)
			.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wp = vWPos;
  float y = wp.y - uWaterLevel;
  float slope = clamp(1.0 - normalize(vWNormal).y, 0.0, 1.0);
  float nBig = sw_fbm(wp.xz * 0.135 + 3.1);
  float nMid = sw_fbm(wp.xz * 0.48 - 1.7);
  float nFine = sw_noise(wp.xz * 5.5 + 5.0);
  float nMicro = sw_noise(wp.xz * 21.0);
  float nPatch = sw_fbm(wp.xz * 1.65 + 17.0);

  // deep, slightly olive meadow grass
  vec3 grassDark  = vec3(0.036, 0.075, 0.021);
  vec3 grassMid   = vec3(0.082, 0.148, 0.040);
  vec3 grassWarm  = vec3(0.135, 0.178, 0.058);
  vec3 grassDry   = vec3(0.205, 0.188, 0.084);
  vec3 dirt       = vec3(0.108, 0.082, 0.048);
  vec3 sand       = vec3(0.118, 0.098, 0.068);
  vec3 pebble     = vec3(0.145, 0.136, 0.118);
  vec3 silt       = vec3(0.048, 0.040, 0.025);
  vec3 algae      = vec3(0.040, 0.062, 0.022);

  float patchMask = smoothstep(0.28, 0.78, nPatch);
  vec3 grass = mix(grassDark, grassMid, smoothstep(0.22, 0.82, nBig * 0.55 + nMid * 0.45));
  grass = mix(grass, grassWarm, smoothstep(0.55, 0.9, nMid * 0.6 + nFine * 0.4) * 0.62);
  grass = mix(grass, grassDry, smoothstep(0.62, 0.94, nPatch) * 0.42);
  grass *= 0.86 + 0.28 * nMicro;
  vec3 ground = mix(grass, grassDark, patchMask * 0.22);

  float dirtMask = smoothstep(0.16, 0.5, slope) * (0.25 + 0.75 * smoothstep(0.3, 0.75, nMid));
  ground = mix(ground, dirt, clamp(dirtMask, 0.0, 0.72));

  // shoreline: a narrow wet shingle band, never a bright white ring
  float shore = 1.0 - smoothstep(0.015, 0.11, abs(y + 0.04 + nFine * 0.04));
  float sandMask = shore * smoothstep(0.46, 0.8, nMid * 0.6 + nFine * 0.4);
  ground = mix(ground, sand, clamp(sandMask * 0.34, 0.0, 0.44));
  float pebbleMask = shore * smoothstep(0.58, 0.80, nMid * 0.55 + nFine * 0.45);
  ground = mix(ground, pebble, pebbleMask * 0.44);

  // submerged bed: warm silt, algae, scattered pale stones
  float underwater = 1.0 - smoothstep(-0.05, 0.035, y);
  vec3 bedCol = mix(silt, algae, smoothstep(0.3, 0.72, nMid) * 0.62);
  bedCol = mix(bedCol, vec3(0.082, 0.070, 0.046), smoothstep(0.72, 0.94, nFine) * 0.34);
  bedCol = mix(bedCol, pebble * 0.52, smoothstep(0.9, 0.97, nPatch) * 0.3);
  // just below the waterline: wet mud and small stones, not beach sand
  float shallow = smoothstep(0.02, -0.22, y) * (1.0 - smoothstep(-0.24, -0.5, y));
  bedCol = mix(bedCol, vec3(0.058, 0.058, 0.032), shallow * 0.55);
  ground = mix(ground, bedCol, underwater);

  // wet band just above the waterline, plus a dark organic line at the edge
  float wet = (1.0 - smoothstep(0.015, 0.28, y + 0.04 * nFine)) * (1.0 - underwater);
  ground *= mix(1.0, 0.48, wet);
  float waterline = 1.0 - smoothstep(0.0, 0.055, abs(y + 0.012));
  ground *= mix(1.0, 0.62, waterline);

  // tiny meadow flowers, sparse and warm
  float flowers = step(0.9965, sw_hash12(floor(wp.xz * 3.2) + 2.0)) * smoothstep(0.22, 0.6, y) * (1.0 - wet);
  float flowerTint = sw_hash12(floor(wp.xz * 3.2) + 8.0);
  vec3 flowerCol = mix(vec3(0.52, 0.43, 0.20), vec3(0.62, 0.50, 0.25), flowerTint);
  ground = mix(ground, flowerCol, flowers * 0.65);

  diffuseColor.rgb = ground;
  if (uDebug > 0.5) {
    if (uDebug < 1.5) diffuseColor.rgb = vec3(clamp(y * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0);
    else if (uDebug < 2.5) diffuseColor.rgb = vWPos * 0.5 + 0.5;
    else diffuseColor.rgb = vec3(underwater, shore, wet);
  }
}
`)
			.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec3 wn = normalize(vWNormal);
  float e = 0.14;
  vec2 bp = vWPos.xz;
  float b0 = sw_groundBump(bp);
  float bx = sw_groundBump(bp + vec2(e, 0.0));
  float bz = sw_groundBump(bp + vec2(0.0, e));
  vec3 bumpN = normalize(vec3(-(bx - b0) / e, 1.0, -(bz - b0) / e));
  float strength = 0.075 * (1.0 - smoothstep(0.0, 0.5, abs(vWPos.y))) + 0.03;
  vec3 pw = normalize(wn + bumpN * strength);
  normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);
}`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  float y = vWPos.y - uWaterLevel;
  float wet = 1.0 - smoothstep(0.01, 0.32, y);
  roughnessFactor = mix(roughnessFactor, 0.55, wet * 0.85);
  float under = 1.0 - smoothstep(-0.2, 0.02, y);
  roughnessFactor = mix(roughnessFactor, 0.88, under);
}`)
			.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float y = vWPos.y - uWaterLevel;
  float depth = max(-y, 0.0);
  float under = 1.0 - smoothstep(-0.05, 0.02, y);
  if (under > 0.001 && uSunIntensity > 0.01) {
    vec2 uv = (vWPos.xz + uHalf) / uDomain;
    float etaM = texture2D(uMacro, uv).r;
    vec2 e = uSimulationTexel;
    float etaL = texture2D(uMacro, uv - vec2(e.x, 0.0)).r;
    float etaR = texture2D(uMacro, uv + vec2(e.x, 0.0)).r;
    float etaU = texture2D(uMacro, uv - vec2(0.0, e.y)).r;
    float etaD = texture2D(uMacro, uv + vec2(0.0, e.y)).r;
    float cell = uDomain * e.x;
    float lap = (etaL + etaR + etaU + etaD - 4.0 * etaM) / (cell * cell) * 0.427;
    vec2 grad = vec2(etaR - etaL, etaD - etaU) / (2.0 * cell) * 3.44;
    float time = uTime * 0.42;
    float c1 = sw_caustic(vWPos.xz * 0.62 + grad * 0.9, time);
    float c2 = sw_caustic(vWPos.xz * 0.91 - grad * 0.6 + 4.3, time * 0.8 + 7.1);
    float caus = (c1 * 0.65 + c2 * 0.45) * (0.75 + abs(lap) * 1.4);
    caus *= smoothstep(0.06, 0.45, depth);
    caus *= exp(-depth * 1.3);
    caus *= smoothstep(0.0, 0.35, normalize(vWNormal).y);
    caus = clamp(caus, 0.0, 1.15);
    totalEmissiveRadiance += uSunColor * uSunIntensity * caus * 0.028;
  }
}`);
	}

	setSimulationSize(n) {
		if (!Number.isInteger(n) || n < 2) throw new RangeError('Terrain simulation size must be an integer of at least 2');
		this.simulationSize = n;
		this.uniforms.uSimulationTexel.value.setScalar(1 / n);
	}

	update(dt, time, macroTexture, microTexture, sun, wind, waterLevel = this.uniforms.uWaterLevel.value) {
		this.uniforms.uTime.value = time;
		this.uniforms.uMacro.value = macroTexture;
		this.uniforms.uMicro.value = microTexture;
		const macroSize = macroTexture?.image?.width || macroTexture?.width;
		if (Number.isFinite(macroSize) && macroSize !== this.simulationSize) this.setSimulationSize(macroSize);
		this.uniforms.uSunColor.value.copy(sun.sunColor);
		this.uniforms.uSunIntensity.value = sun.sunIntensity;
		this.uniforms.uWind.value.copy(wind);
		if (Number.isFinite(waterLevel)) this.uniforms.uWaterLevel.value = waterLevel;
	}

	dispose() {
		this.mesh.removeFromParent();
		this.geometry.dispose();
		this.material.dispose();
	}
}
