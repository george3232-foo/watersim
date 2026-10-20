import * as THREE from 'three';
import { clamp } from '../core/Noise.js';
import { GLSL_NOISE } from '../core/Shaders.js';

const MACRO_SIZE = 256;
const MICRO_SIZE = 512;
const READBACK_SIZE = 128;
const FIXED_DT = 1 / 120;

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MACRO_FLUX_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform sampler2D tBed;
uniform vec2 uSize;
uniform float uDt;
uniform float uGravity;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
${GLSL_NOISE}

vec4 getS(ivec2 c){
  c = clamp(c, ivec2(0), ivec2(uSize) - ivec2(1));
  return texture2D(tState, (vec2(c) + 0.5) / uSize);
}
float getBed(ivec2 c){
  c = clamp(c, ivec2(0), ivec2(uSize) - ivec2(1));
  return texture2D(tBed, (vec2(c) + 0.5) / uSize).r;
}
float hAt(ivec2 c){ vec4 s = getS(c); return max(0.0, s.r - getBed(c)); }

float accelX(ivec2 c){
  if (c.x >= int(uSize.x) - 1) return 0.0;
  ivec2 d = c + ivec2(1, 0);
  vec4 a = getS(c), b = getS(d);
  float hA = max(0.0, a.r - getBed(c));
  float hB = max(0.0, b.r - getBed(d));
  float hF = 0.5 * (hA + hB);
  if (hF < 0.00015) return 0.0;
  float q = a.g * exp(-uDt * (0.14 + 0.75 * exp(-hF / 0.09)));
  q += uGravity * uDt * hF * (a.r - b.r);
  float gust = 0.7 + 0.3 * sw_noise(vec2(c) * 0.09 + vec2(uTime * 0.12, -uTime * 0.07));
  q += uWind.x * uWindStrength * uDt * hF * 0.10 * gust;
  q += uWind.y * uWindStrength * uDt * hF * 0.035 * gust;
  return clamp(q, -2.2, 2.2);
}
float accelY(ivec2 c){
  if (c.y >= int(uSize.y) - 1) return 0.0;
  ivec2 d = c + ivec2(0, 1);
  vec4 a = getS(c), b = getS(d);
  float hA = max(0.0, a.r - getBed(c));
  float hB = max(0.0, b.r - getBed(d));
  float hF = 0.5 * (hA + hB);
  if (hF < 0.00015) return 0.0;
  float q = a.b * exp(-uDt * (0.14 + 0.75 * exp(-hF / 0.09)));
  q += uGravity * uDt * hF * (a.r - b.r);
  float gust = 0.7 + 0.3 * sw_noise(vec2(c) * 0.09 + vec2(-uTime * 0.06, uTime * 0.11));
  q += uWind.y * uWindStrength * uDt * hF * (0.10 + 0.06 * uWindStrength) * gust;
  q += uWind.x * uWindStrength * uDt * hF * 0.035 * gust;
  return clamp(q, -2.2, 2.2);
}
float cellScale(ivec2 c){
  float h = hAt(c);
  float outflow = max(-accelX(c - ivec2(1,0)), 0.0)
            + max(accelX(c), 0.0)
            + max(-accelY(c - ivec2(0,1)), 0.0)
            + max(accelY(c), 0.0);
  if (outflow < 1e-9) return 1.0;
  float cell = uSize.x > 0.0 ? (20.0 / uSize.x) : 0.0;
  float cellArea = cell * cell;
  float avail = h * cellArea / uDt;
  return clamp(avail / outflow, 0.0, 1.0);
}

void main(){
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 s = getS(coord);
  float eta = s.r, foam = s.a;

  float qx = 0.0, qy = 0.0;
  if (coord.x < int(uSize.x) - 1) {
    qx = accelX(coord);
    ivec2 src = qx > 0.0 ? coord : coord + ivec2(1, 0);
    if (hAt(coord) < 1e-5 && hAt(coord + ivec2(1,0)) < 1e-5) qx = 0.0;
    else qx *= cellScale(src);
  }
  if (coord.y < int(uSize.y) - 1) {
    qy = accelY(coord);
    ivec2 src = qy > 0.0 ? coord : coord + ivec2(0, 1);
    if (hAt(coord) < 1e-5 && hAt(coord + ivec2(0,1)) < 1e-5) qy = 0.0;
    else qy *= cellScale(src);
  }

  gl_FragColor = vec4(eta, qx, qy, foam);
}`;

const MACRO_HEIGHT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tFlux;
uniform sampler2D tBed;
uniform sampler2D tMicro;
uniform vec2 uSize;
uniform float uDt;
uniform float uRain;

void main(){
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(coord) + 0.5) / uSize;
  vec4 s = texture2D(tFlux, uv);
  float eta = s.r, qx = s.g, qy = s.b, foam = s.a;
  float bed = texture2D(tBed, uv).r;

  float qL = coord.x > 0 ? texture2D(tFlux, uv - vec2(1.0 / uSize.x, 0.0)).g : 0.0;
  float qU = coord.y > 0 ? texture2D(tFlux, uv - vec2(0.0, 1.0 / uSize.y)).b : 0.0;
  float dx = 20.0 / uSize.x;
  eta += uDt * (qL - qx + qU - qy) / (dx * dx);

  float h = eta - bed;
  // keep thin films (they still carry volume and feed the shallows); only
  // clamp genuinely overdrawn cells back to the bed
  if (h < 0.0) { eta = bed; qx = 0.0; qy = 0.0; h = 0.0; }
  eta = clamp(eta, bed - 0.2, 1.4);

  // rain adds a tiny volume, mostly visual; ripples are handled by the micro layer
  float microEta = texture2D(tMicro, uv).r;
  if (h > 0.002) eta += uRain * 0.0000012 * uDt;

  float speed = length(vec2(qL + qx, qU + qy) * 0.5) / (max(h, 0.002) * dx + 0.0001);
  foam *= exp(-uDt * 0.34);
  float shoreFoam = smoothstep(1.1, 2.6, speed) * (1.0 - smoothstep(0.0, 0.07, h)) * 0.10;
  foam = max(foam, shoreFoam);
  foam = clamp(foam, 0.0, 1.0);

  gl_FragColor = vec4(eta + microEta * 0.0, qx, qy, foam);
}`;

const MICRO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform sampler2D tMacro;
uniform sampler2D tBed;
uniform vec2 uSize;
uniform float uDt;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
uniform float uRain;
${GLSL_NOISE}

float hashCell(ivec2 c, float t){
  return sw_hash12(vec2(c) * 0.017 + vec2(t * 1.31, t * 0.77));
}

void main(){
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(coord) + 0.5) / uSize;
  vec4 s = texture2D(tState, uv);
  float eta = s.r, vel = s.g, foam = s.b;
  vec2 texel = 1.0 / uSize;

  float etaL = texture2D(tState, uv - vec2(texel.x, 0.0)).r;
  float etaR = texture2D(tState, uv + vec2(texel.x, 0.0)).r;
  float etaD = texture2D(tState, uv - vec2(0.0, texel.y)).r;
  float etaU = texture2D(tState, uv + vec2(0.0, texel.y)).r;
  float lap = (etaL + etaR + etaD + etaU - 4.0 * eta);

  float etaM = texture2D(tMacro, uv).r;
  float bed = texture2D(tBed, uv).r;
  float h = max(0.0, etaM - bed);
  vec2 world = uv * 20.0 - 10.0;

  float c = 0.42 + 0.30 * smoothstep(0.0, 1.1, h);
  float dx = 20.0 / uSize.x;
  float accel = (c * c) * lap / (dx * dx);

  // depth-dependent damping: strong in the shallows, gentle in the deep
  float damping = 0.30 + 0.95 * (1.0 - smoothstep(0.02, 0.35, h));
  accel -= vel * damping;
  eta *= exp(-uDt * 0.035);

  // wind chop: three directional wave trains + gust noise
  vec2 wd = normalize(uWind + vec2(1e-5, 0.0));
  float gust = 0.55 + 0.45 * sw_noise(world * 0.55 + vec2(uTime * 0.09, -uTime * 0.04));
  float stormy = smoothstep(0.42, 0.95, uWindStrength);
  float w1 = sin(dot(world, wd) * 5.8 - uTime * 4.6 + sw_noise(world * 0.4) * 2.4);
  float w2 = sin(dot(world, vec2(-wd.y, wd.x) * 1.3 + wd * 0.4) * 12.5 - uTime * 7.4 + 1.7);
  float w3 = sin(dot(world, wd * 1.2 + vec2(wd.y, -wd.x) * 0.3) * 26.0 - uTime * 11.0 + 3.3);
  float swell = sin(dot(world, wd) * 2.15 - uTime * 2.3 + sw_noise(world * 0.18) * 1.5);
  float roll = sin(dot(world, wd) * 3.15 - uTime * 2.8 + sw_noise(world * 0.22) * 1.8);
  accel += uWindStrength * gust * (0.050 * w1 + 0.030 * w2 + 0.014 * w3) * (1.0 + stormy * 1.55);
  accel += stormy * gust * (0.055 * swell + 0.022 * roll);

  vel += accel * uDt;
  vel *= exp(-uDt * 0.22);

  // stochastic rain impact rings, independent per cell and time bucket
  float bucket = floor(uTime * 26.0);
  float rnd = hashCell(coord, bucket);
  float rnd2 = hashCell(coord + ivec2(37, 11), bucket);
  float wet = smoothstep(0.002, 0.03, h);
  if (rnd < uRain * 0.0075) {
    vel -= (0.35 + 0.65 * rnd2) * 0.55;
    foam = max(foam, 0.12);
  }

  eta += vel * uDt;
  eta = clamp(eta, -0.16, 0.16) * wet;
  vel *= mix(0.2, 1.0, wet);

  foam *= exp(-uDt * 0.7);
  foam = max(foam, smoothstep(0.22, 0.6, abs(vel)) * 0.18);
  foam = max(foam, stormy * smoothstep(0.55, 0.92, gust) * 0.10);
  foam = clamp(foam, 0.0, 1.0);

  gl_FragColor = vec4(eta, vel, foam, 0.0);
}`;

const MACRO_IMPULSE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform sampler2D tBed;
uniform vec2 uSize;
uniform float uDomain;
uniform float uHalf;
uniform int uCount;
uniform vec4 uImpulse[8];
uniform vec4 uFlow[8];
uniform vec4 uFoam[8];
${GLSL_NOISE}

float getBed(ivec2 c){
  c = clamp(c, ivec2(0), ivec2(uSize) - ivec2(1));
  return texture2D(tBed, (vec2(c) + 0.5) / uSize).r;
}

void main(){
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(coord) + 0.5) / uSize;
  vec4 s = texture2D(tState, uv);
  vec2 world = uv * uDomain - uHalf;
  float eta = s.r, qx = s.g, qy = s.b, foam = s.a;

  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec4 im = uImpulse[i];
    vec2 d = world - im.xy;
    float r2 = dot(d, d);
    float r = max(im.z, 0.03);
    float g1 = exp(-r2 / (2.0 * r * r));
    float s2 = r * 2.15;
    float g2 = exp(-r2 / (2.0 * s2 * s2));
    float volRatio = (r * r) / (s2 * s2);
    eta += im.w * (g1 - volRatio * g2);

    vec4 fl = uFlow[i];
    float fdir = length(fl.xy);
    float hHere = max(0.0, eta - getBed(coord));
    if (fdir > 0.00001 && abs(fl.w) > 0.00001 && hHere > 0.0001) {
      // fl.xy is a direction, fl.w a surface current speed (m/s). Convert to
      // volumetric edge flux so the height pass sees a consistent discharge.
      vec2 dir = fl.xy / fdir;
      float fr = max(fl.z, 0.05);
      float falloff = exp(-r2 / (2.0 * fr * fr));
      float q = fl.w * hHere * (uDomain / uSize.x) * falloff;
      qx += dir.x * q;
      qy += dir.y * q;
    }
    vec4 fm = uFoam[i];
    if (fm.w > 0.0) {
      foam = max(foam, fm.w * exp(-r2 / (2.0 * fm.z * fm.z)));
    }
  }

  foam = clamp(foam, 0.0, 1.0);
  gl_FragColor = vec4(eta, qx, qy, foam);
}`;

const MICRO_IMPULSE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform vec2 uSize;
uniform float uDomain;
uniform float uHalf;
uniform int uCount;
uniform vec4 uImpulse[8];
uniform vec4 uFlow[8];
uniform vec4 uFoam[8];
${GLSL_NOISE}

void main(){
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(coord) + 0.5) / uSize;
  vec4 s = texture2D(tState, uv);
  vec2 world = uv * uDomain - uHalf;
  float eta = s.r, vel = s.g, foam = s.b;

  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec4 im = uImpulse[i];
    vec2 d = world - im.xy;
    float r2 = dot(d, d);
    float r = max(im.z * 0.32, 0.018);
    float g1 = exp(-r2 / (2.0 * r * r));
    float s2 = r * 2.4;
    float g2 = exp(-r2 / (2.0 * s2 * s2));
    float volRatio = (r * r) / (s2 * s2);
    eta += im.w * 0.95 * (g1 - volRatio * g2);
    float fstr = uFlow[i].w;
    if (abs(fstr) > 0.00001) {
      float fr = max(uFlow[i].z * 0.4, 0.04);
      vel -= fstr * 0.08 * exp(-r2 / (2.0 * fr * fr));
    }
    vec4 fm = uFoam[i];
    if (fm.w > 0.0) {
      foam = max(foam, fm.w * 0.8 * exp(-r2 / (2.0 * fm.z * fm.z)));
    }
  }

  foam = clamp(foam, 0.0, 1.0);
  gl_FragColor = vec4(eta, vel, foam, 0.0);
}`;

const INIT_MACRO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tBed;
uniform float uLevel;
void main(){
  float bed = texture2D(tBed, vUv).r;
  float eta = max(uLevel, bed);
  gl_FragColor = vec4(eta, 0.0, 0.0, 0.0);
}`;

const INIT_MICRO_FRAG = /* glsl */`
precision highp float;
void main(){ gl_FragColor = vec4(0.0); }`;

const READBACK_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tMacro;
uniform sampler2D tMicro;
uniform sampler2D tBed;
uniform float uLevel;
void main(){
  float eta = texture2D(tMacro, vUv).r + texture2D(tMicro, vUv).r + uLevel;
  float depth = max(0.0, eta - texture2D(tBed, vUv).r);
  float v = clamp((eta + 2.0) / 4.0, 0.0, 1.0) * 65535.0;
  float hi = floor(v / 256.0);
  float lo = v - hi * 256.0;
  gl_FragColor = vec4(hi / 255.0, lo / 255.0, clamp(depth / 2.0, 0.0, 1.0), 1.0);
}`;

function makeRT(w, h, type, opts = {}) {
	const rt = new THREE.WebGLRenderTarget(w, h, {
		minFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
		magFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type,
		depthBuffer: false,
		stencilBuffer: false,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping,
		generateMipmaps: false,
	});
	return rt;
}

export class WaterSim {
	constructor(renderer, heightField, bedTexture, domain = 20) {
		this.renderer = renderer;
		this.hf = heightField;
		this.bedTexture = bedTexture;
		this.domain = domain;
		this.half = domain * 0.5;
		this.macroSize = MACRO_SIZE;
		this.microSize = MICRO_SIZE;

		const caps = renderer.capabilities;
		const canFloat = renderer.extensions.has('EXT_color_buffer_float');
		const canHalf = renderer.extensions.has('EXT_color_buffer_half_float') || canFloat;
		this.stateType = canFloat ? THREE.FloatType : (canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType);
		this.macroRT = [makeRT(MACRO_SIZE, MACRO_SIZE, this.stateType), makeRT(MACRO_SIZE, MACRO_SIZE, this.stateType)];
		this.microRT = [makeRT(MICRO_SIZE, MICRO_SIZE, canHalf ? THREE.HalfFloatType : this.stateType), makeRT(MICRO_SIZE, MICRO_SIZE, canHalf ? THREE.HalfFloatType : this.stateType)];
		this.readbackRT = makeRT(READBACK_SIZE, READBACK_SIZE, THREE.UnsignedByteType, { nearest: true });

		this.macroIndex = 0;
		this.microIndex = 0;
		this.levelOffset = 0;
		this.accumulator = 0;
		this.stepsThisFrame = 0;
		this.totalSteps = 0;

		this.pending = [];
		this.readbackBuffer = new Uint8Array(READBACK_SIZE * READBACK_SIZE * 4);
		this.readbackHeights = new Float32Array(READBACK_SIZE * READBACK_SIZE);
		this.readbackDepths = new Float32Array(READBACK_SIZE * READBACK_SIZE);
		this.hasReadback = false;
		this.reading = false;
		this.readbackCount = 0;
		this.readbackLatency = 0;
		this.frame = 0;

		this.wind = new THREE.Vector2(1, 0.35).normalize();
		this.windStrength = 0.35;
		this.rain = 0;

		this.materialFlux = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tBed: { value: bedTexture },
				uSize: { value: new THREE.Vector2(MACRO_SIZE, MACRO_SIZE) },
				uDt: { value: FIXED_DT }, uGravity: { value: 9.81 }, uTime: { value: 0 },
				uWind: { value: new THREE.Vector2() }, uWindStrength: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_FLUX_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialHeight = new THREE.ShaderMaterial({
			uniforms: {
				tFlux: { value: null }, tBed: { value: bedTexture }, tMicro: { value: null },
				uSize: { value: new THREE.Vector2(MACRO_SIZE, MACRO_SIZE) },
				uDt: { value: FIXED_DT }, uRain: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_HEIGHT_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMicro = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tMacro: { value: null }, tBed: { value: bedTexture },
				uSize: { value: new THREE.Vector2(MICRO_SIZE, MICRO_SIZE) },
				uDt: { value: FIXED_DT }, uTime: { value: 0 },
				uWind: { value: new THREE.Vector2() }, uWindStrength: { value: 0 },
				uRain: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MICRO_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMacroImpulse = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tBed: { value: bedTexture }, uSize: { value: new THREE.Vector2(MACRO_SIZE, MACRO_SIZE) },
				uDomain: { value: domain }, uHalf: { value: this.half }, uCount: { value: 0 },
				uImpulse: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFlow: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFoam: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_IMPULSE_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMicroImpulse = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, uSize: { value: new THREE.Vector2(MICRO_SIZE, MICRO_SIZE) },
				uDomain: { value: domain }, uHalf: { value: this.half }, uCount: { value: 0 },
				uImpulse: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFlow: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFoam: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
			},
			vertexShader: FS_VERT, fragmentShader: MICRO_IMPULSE_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialInitMacro = new THREE.ShaderMaterial({
			uniforms: { tBed: { value: bedTexture }, uLevel: { value: 0 } },
			vertexShader: FS_VERT, fragmentShader: INIT_MACRO_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialInitMicro = new THREE.ShaderMaterial({
			uniforms: {}, vertexShader: FS_VERT, fragmentShader: INIT_MICRO_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialReadback = new THREE.ShaderMaterial({
			uniforms: {
				tMacro: { value: null }, tMicro: { value: null }, tBed: { value: bedTexture },
				uLevel: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: READBACK_FRAG, depthTest: false, depthWrite: false,
		});

		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materialFlux);
		this.quad.frustumCulled = false;
		this.scene = new THREE.Scene();
		this.scene.add(this.quad);
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		this.init();
	}

	init() {
		const renderer = this.renderer;
		this.quad.material = this.materialInitMacro;
		renderer.setRenderTarget(this.macroRT[0]);
		renderer.render(this.scene, this.camera);
		this.quad.material = this.materialInitMicro;
		renderer.setRenderTarget(this.microRT[0]);
		renderer.render(this.scene, this.camera);
		renderer.setRenderTarget(null);
		this.macroIndex = 0;
		this.microIndex = 0;
	}

	pass(material, target, items) {
		this.quad.material = material;
		this.renderer.setRenderTarget(target);
		this.renderer.render(this.scene, this.camera);
	}

	get macroTexture() { return this.macroRT[this.macroIndex].texture; }
	get microTexture() { return this.microRT[this.microIndex].texture; }

	setWind(strength, angle) {
		this.windStrength = clamp(strength, 0, 1);
		this.wind.set(Math.cos(angle), Math.sin(angle));
	}

	setRain(amount) { this.rain = clamp(amount, 0, 1); }

	addImpulse(imp) {
		if (!imp) return;
		const base = {
			x: 0, z: 0, radius: 0.22, amp: -0.04, flowX: 0, flowZ: 0, flowRadius: 0.4,
			flowStrength: 0, foam: 0, microScale: 1.0,
		};
		this.pending.push(Object.assign(base, imp));
		if (this.pending.length > 24) this.pending.shift();
	}

	stepMacro(time) {
		const read = this.macroIndex;
		const write = 1 - read;
		const m = this.materialFlux;
		m.uniforms.tState.value = this.macroRT[read].texture;
		m.uniforms.uTime.value = time;
		m.uniforms.uWind.value.copy(this.wind);
		m.uniforms.uWindStrength.value = this.windStrength;
		this.pass(m, this.macroRT[write]);
		this.macroIndex = write;

		const h = this.materialHeight;
		h.uniforms.tFlux.value = this.macroRT[this.macroIndex].texture;
		h.uniforms.tMicro.value = this.microRT[this.microIndex].texture;
		h.uniforms.uRain.value = this.rain;
		this.pass(h, this.macroRT[1 - this.macroIndex]);
		this.macroIndex = 1 - this.macroIndex;
	}

	stepMicro(time) {
		const read = this.microIndex;
		const write = 1 - read;
		const m = this.materialMicro;
		m.uniforms.tState.value = this.microRT[read].texture;
		m.uniforms.tMacro.value = this.macroRT[this.macroIndex].texture;
		m.uniforms.uTime.value = time;
		m.uniforms.uWind.value.copy(this.wind);
		m.uniforms.uWindStrength.value = this.windStrength;
		m.uniforms.uRain.value = this.rain;
		this.pass(m, this.microRT[write]);
		this.microIndex = write;
	}

	applyImpulses() {
		if (!this.pending.length) return;
		const count = Math.min(this.pending.length, 8);
		const list = this.pending.slice(0, count);
		for (const mat of [this.materialMacroImpulse, this.materialMicroImpulse]) {
			const micro = mat === this.materialMicroImpulse;
			const u = mat.uniforms;
			u.uCount.value = count;
			for (let i = 0; i < 8; i++) {
				const imp = list[i];
				if (!imp) {
					u.uImpulse.value[i].set(0, 0, 0, 0);
					u.uFlow.value[i].set(0, 0, 0, 0);
					u.uFoam.value[i].set(0, 0, 0, 0);
					continue;
				}
				// the macro surface takes the true displacement; the micro field
				// exaggerates it so the short capillary ripples read at a distance
				u.uImpulse.value[i].set(imp.x, imp.z, imp.radius, micro ? imp.amp * imp.microScale : imp.amp);
				u.uFlow.value[i].set(imp.flowX, imp.flowZ, imp.flowRadius, imp.flowStrength);
				u.uFoam.value[i].set(imp.x, imp.z, Math.max(imp.radius * 2.2, 0.12), imp.foam);
			}
		}
		{
			const read = this.macroIndex, write = 1 - read;
			this.materialMacroImpulse.uniforms.tState.value = this.macroRT[read].texture;
			this.pass(this.materialMacroImpulse, this.macroRT[write]);
			this.macroIndex = write;
		}
		{
			const read = this.microIndex, write = 1 - read;
			this.materialMicroImpulse.uniforms.tState.value = this.microRT[read].texture;
			this.pass(this.materialMicroImpulse, this.microRT[write]);
			this.microIndex = write;
		}
		// drain at most 8 per frame; anything beyond that waits for the next
		// frame instead of being silently discarded
		this.pending.splice(0, count);
	}

	update(dt, time) {
		this.accumulator += Math.min(dt, 0.05);
		let steps = 0;
		while (this.accumulator >= FIXED_DT && steps < 7) {
			const t = time - this.accumulator;
			this.stepMacro(t);
			this.stepMicro(t);
			this.accumulator -= FIXED_DT;
			steps++;
			this.totalSteps++;
		}
		this.stepsThisFrame = steps;
		this.applyImpulses();

		this.frame++;
		if (this.frame % 2 === 0) this.updateReadback();
	}

	updateReadback() {
		if (this.reading) return;
		const m = this.materialReadback;
		m.uniforms.tMacro.value = this.macroTexture;
		m.uniforms.tMicro.value = this.microTexture;
		m.uniforms.uLevel.value = this.levelOffset;
		this.pass(m, this.readbackRT);
		this.renderer.setRenderTarget(null);
		this.reading = true;
		const t0 = performance.now();
		const self = this;
		const prom = this.renderer.readRenderTargetPixelsAsync(
			this.readbackRT, 0, 0, READBACK_SIZE, READBACK_SIZE, this.readbackBuffer
		);
		if (prom && prom.then) {
			prom.then((buf) => {
				self.decodeReadback(buf || self.readbackBuffer);
				self.reading = false;
				self.readbackCount++;
				self.readbackLatency = performance.now() - t0;
			}).catch((e) => {
				self.reading = false;
				if (!self._warnedReadback) { console.warn('Async readback failed, using analytic buoyancy', e); self._warnedReadback = true; }
			});
		} else {
			this.decodeReadback(this.readbackBuffer);
			this.reading = false;
			this.readbackCount++;
		}
	}

	decodeReadback(buf) {
		const n = READBACK_SIZE;
		const heights = this.readbackHeights;
		const depths = this.readbackDepths;
		for (let y = 0; y < n; y++) {
			for (let x = 0; x < n; x++) {
				const i = (y * n + x) * 4;
				const hi = buf[i], lo = buf[i + 1];
				const packed = (hi * 256 + lo) / 65535;
				heights[y * n + x] = packed * 4.0 - 2.0;
				depths[y * n + x] = (buf[i + 2] / 255) * 2.0;
			}
		}
		this.hasReadback = true;
	}

	sampleSurface(x, z, out = { height: 0, depth: 0 }) {
		if (!this.hasReadback) {
			out.height = 0 + this.levelOffset;
			out.depth = Math.max(0, -this.hf.height(x, z));
			return out;
		}
		const n = READBACK_SIZE;
		const u = (x + this.half) / this.domain * n - 0.5;
		const v = (z + this.half) / this.domain * n - 0.5;
		const x0 = clamp(Math.floor(u), 0, n - 1), x1 = Math.min(x0 + 1, n - 1);
		const y0 = clamp(Math.floor(v), 0, n - 1), y1 = Math.min(y0 + 1, n - 1);
		const fx = clamp(u - Math.floor(u), 0, 1), fy = clamp(v - Math.floor(v), 0, 1);
		const h00 = this.readbackHeights[y0 * n + x0], h10 = this.readbackHeights[y0 * n + x1];
		const h01 = this.readbackHeights[y1 * n + x0], h11 = this.readbackHeights[y1 * n + x1];
		const d00 = this.readbackDepths[y0 * n + x0], d10 = this.readbackDepths[y0 * n + x1];
		const d01 = this.readbackDepths[y1 * n + x0], d11 = this.readbackDepths[y1 * n + x1];
		out.height = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
		out.depth = (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
		return out;
	}

	surfaceAt(x, z) {
		return this.sampleSurface(x, z, { height: 0, depth: 0 });
	}

	slopeAt(x, z, eps = 0.25) {
		const hL = this.surfaceAt(x - eps, z).height;
		const hR = this.surfaceAt(x + eps, z).height;
		const hD = this.surfaceAt(x, z - eps).height;
		const hU = this.surfaceAt(x, z + eps).height;
		return { x: (hR - hL) / (2 * eps), z: (hU - hD) / (2 * eps) };
	}
}
