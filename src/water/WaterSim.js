import * as THREE from 'three';
import { clamp } from '../core/Noise.js';
import { GLSL_NOISE } from '../core/Shaders.js';
import { getRenderCapabilities, canFilterLinearly } from '../core/RenderCapabilities.js';

const READBACK_SIZE = 128;
const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 7;
const MAX_FRAME_DT = 0.05;
const MAX_LEVEL_OFFSET = 0.03;
const READBACK_STALE_MS = 2000;

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MACRO_FLUX_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform sampler2D tBed;
uniform vec2 uSize;
uniform float uDomain;
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
  if (c.x < 0 || c.y < 0 || c.x >= int(uSize.x) - 1 || c.y >= int(uSize.y)) return 0.0;
  ivec2 d = c + ivec2(1, 0);
  vec4 a = getS(c), b = getS(d);
  float hA = max(0.0, a.r - getBed(c));
  float hB = max(0.0, b.r - getBed(d));
  float hF = 0.5 * (hA + hB);
  if (hF < 0.00015) return 0.0;
  float q = a.g * exp(-uDt * (0.14 + 0.75 * exp(-hF / 0.09)));
  q += uGravity * uDt * hF * (a.r - b.r);
  float gust = 0.7 + 0.3 * sw_noise((vec2(c) + 0.5) / uSize * uDomain * 1.15 + vec2(uTime * 0.12, -uTime * 0.07));
  float edge = uDomain / uSize.x;
  q += uWind.x * uWindStrength * uDt * hF * edge * 1.28 * gust;
  q += uWind.y * uWindStrength * uDt * hF * edge * 0.448 * gust;
  return clamp(q, -2.2, 2.2);
}
float accelY(ivec2 c){
  if (c.x < 0 || c.y < 0 || c.x >= int(uSize.x) || c.y >= int(uSize.y) - 1) return 0.0;
  ivec2 d = c + ivec2(0, 1);
  vec4 a = getS(c), b = getS(d);
  float hA = max(0.0, a.r - getBed(c));
  float hB = max(0.0, b.r - getBed(d));
  float hF = 0.5 * (hA + hB);
  if (hF < 0.00015) return 0.0;
  float q = a.b * exp(-uDt * (0.14 + 0.75 * exp(-hF / 0.09)));
  q += uGravity * uDt * hF * (a.r - b.r);
  float gust = 0.7 + 0.3 * sw_noise((vec2(c) + 0.5) / uSize * uDomain * 1.15 + vec2(-uTime * 0.06, uTime * 0.11));
  float edge = uDomain / uSize.x;
  q += uWind.y * uWindStrength * uDt * hF * edge * (1.28 + 0.768 * uWindStrength) * gust;
  q += uWind.x * uWindStrength * uDt * hF * edge * 0.448 * gust;
  return clamp(q, -2.2, 2.2);
}
float cellScale(ivec2 c){
  float h = hAt(c);
  float outflow = max(-accelX(c - ivec2(1,0)), 0.0)
            + max(accelX(c), 0.0)
            + max(-accelY(c - ivec2(0,1)), 0.0)
            + max(accelY(c), 0.0);
  if (outflow < 1e-9) return 1.0;
  float cell = uDomain / uSize.x;
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
uniform float uDomain;
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
  float dx = uDomain / uSize.x;
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
uniform float uDomain;
uniform float uHalf;
uniform float uLevel;
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
  float h = max(0.0, etaM + uLevel - bed);
  vec2 world = uv * uDomain - uHalf;

  float c = 0.42 + 0.30 * smoothstep(0.0, 1.1, h);
  float dx = uDomain / uSize.x;
  c = min(c, 0.65 * dx / uDt); // CFL safety for custom small domains/dense grids
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
  float bed = texture2D(tBed, vUv).r;
  float macro = texture2D(tMacro, vUv).r;
  // Dry solver cells store bed elevation, not a water surface. A uniform offset
  // must not create a film over every dry bank.
  float wet = step(0.0001, macro - bed);
  float eta = (wet > 0.5 ? macro : 0.0) + texture2D(tMicro, vUv).r + uLevel;
  float depth = wet * max(0.0, eta - bed);
  float v = floor(clamp((eta + 2.0) / 4.0, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  float lo = v - hi * 256.0;
  gl_FragColor = vec4(hi / 255.0, lo / 255.0, clamp(depth / 2.0, 0.0, 1.0), 1.0);
}`;

const RESAMPLE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tState;
uniform sampler2D tBed;
uniform vec2 uSourceSize;
uniform float uFlowScale;
uniform bool uMacro;
vec4 sampleCell(vec2 c){
  return texture2D(tState, (clamp(c, vec2(0.0), uSourceSize - 1.0) + 0.5) / uSourceSize);
}
void main(){
  // Explicit bilinear interpolation also works on RGBA32F without float-linear.
  vec2 p = vUv * uSourceSize - 0.5;
  vec2 c = floor(p), f = fract(p);
  vec4 a = mix(sampleCell(c), sampleCell(c + vec2(1.0, 0.0)), f.x);
  vec4 b = mix(sampleCell(c + vec2(0.0, 1.0)), sampleCell(c + vec2(1.0)), f.x);
  vec4 s = mix(a, b, f.y);
  if (uMacro) {
    s.r = max(s.r, texture2D(tBed, vUv).r);
    // Flux is volume per edge per second: its edge width changes with the grid.
    s.gb *= uFlowScale;
  }
  gl_FragColor = s;
}`;

function validSize(size, max) {
	if (!Number.isInteger(size) || size < 2 || size > max) throw new RangeError(`Water grid must be an integer between 2 and ${max}`);
	return size;
}

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
	rt.texture.colorSpace = THREE.NoColorSpace;
	return rt;
}

export class WaterSim {
	constructor(renderer, heightField, bedTexture, domain = 20, opts = {}) {
		this.renderer = renderer;
		this.hf = heightField;
		this.bedTexture = bedTexture;
		if (!Number.isFinite(domain) || domain <= 0) throw new RangeError('Water domain must be positive');
		this.domain = domain;
		this.half = domain * 0.5;
		this.capabilities = getRenderCapabilities(renderer);
		this.macroSize = validSize(opts.macroSize ?? 256, this.capabilities.maxTextureSize);
		this.microSize = validSize(opts.microSize ?? 512, this.capabilities.maxTextureSize);
		this.stateType = this.capabilities.stateType;
		this.microType = this.capabilities.halfFloatRenderable ? THREE.HalfFloatType : this.stateType;
		this.macroFloatType = this.stateType;
		this.floatLinear = this.capabilities.floatLinear;
		// Keep signed bed data valid even when it was created before the renderer.
		const bedFilter = canFilterLinearly(bedTexture.type, this.capabilities) ? THREE.LinearFilter : THREE.NearestFilter;
		if (bedTexture.minFilter !== bedFilter || bedTexture.magFilter !== bedFilter) {
			bedTexture.minFilter = bedTexture.magFilter = bedFilter;
			bedTexture.needsUpdate = true;
		}
		this.macroRT = this.makeStatePair(this.macroSize, this.stateType);
		this.microRT = this.makeStatePair(this.microSize, this.microType);
		this.readbackRT = makeRT(READBACK_SIZE, READBACK_SIZE, THREE.UnsignedByteType, { nearest: true });

		this.macroIndex = 0;
		this.microIndex = 0;
		this.levelOffset = 0;
		this.displacedVolume = 0;
		this.targetLevelOffset = 0;
		this.wetPondArea = this.estimateWetArea();
		this.wetArea = this.wetPondArea;
		this.accumulator = 0;
		this.stepsThisFrame = 0;
		this.totalSteps = 0;
		this.simulatedTime = 0;
		this.droppedTime = 0;
		this.lastUpdateMs = 0;

		this.pending = [];
		this.droppedImpulses = 0;
		this.readbackBuffer = new Uint8Array(READBACK_SIZE * READBACK_SIZE * 4);
		this.readbackHeights = new Float32Array(READBACK_SIZE * READBACK_SIZE);
		this.readbackDepths = new Float32Array(READBACK_SIZE * READBACK_SIZE);
		this.hasReadback = false;
		this.reading = false;
		this.readbackCount = 0;
		this.readbackLatency = 0;
		this.readbackFailures = 0;
		this.readbackLastError = null;
		this.readbackStatus = 'idle';
		this.readbackMode = typeof renderer.readRenderTargetPixelsAsync === 'function' ? 'async'
			: typeof renderer.readRenderTargetPixels === 'function' ? 'sync' : 'analytic';
		if (this.readbackMode === 'analytic') this.readbackStatus = 'unavailable';
		this.readbackLevelOffset = 0;
		this._readbackCapturedAt = 0;
		this._readbackRetryAt = 0;
		this._readbackConsecutiveFailures = 0;
		this._surfaceScratch = { height: 0, depth: 0 };
		this.frame = 0;

		this.wind = new THREE.Vector2(1, 0.35).normalize();
		this.windStrength = 0.35;
		this.rain = 0;

		this.materialFlux = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tBed: { value: bedTexture },
				uSize: { value: new THREE.Vector2(this.macroSize, this.macroSize) },
				uDomain: { value: domain },
				uDt: { value: FIXED_DT }, uGravity: { value: 9.81 }, uTime: { value: 0 },
				uWind: { value: new THREE.Vector2() }, uWindStrength: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_FLUX_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialHeight = new THREE.ShaderMaterial({
			uniforms: {
				tFlux: { value: null }, tBed: { value: bedTexture }, tMicro: { value: null },
				uSize: { value: new THREE.Vector2(this.macroSize, this.macroSize) },
				uDomain: { value: domain },
				uDt: { value: FIXED_DT }, uRain: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_HEIGHT_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMicro = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tMacro: { value: null }, tBed: { value: bedTexture },
				uSize: { value: new THREE.Vector2(this.microSize, this.microSize) },
				uDomain: { value: domain }, uHalf: { value: this.half },
				uLevel: { value: 0 },
				uDt: { value: FIXED_DT }, uTime: { value: 0 },
				uWind: { value: new THREE.Vector2() }, uWindStrength: { value: 0 },
				uRain: { value: 0 },
			},
			vertexShader: FS_VERT, fragmentShader: MICRO_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMacroImpulse = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tBed: { value: bedTexture }, uSize: { value: new THREE.Vector2(this.macroSize, this.macroSize) },
				uDomain: { value: domain }, uHalf: { value: this.half }, uCount: { value: 0 },
				uImpulse: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFlow: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
				uFoam: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
			},
			vertexShader: FS_VERT, fragmentShader: MACRO_IMPULSE_FRAG, depthTest: false, depthWrite: false,
		});
		this.materialMicroImpulse = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, uSize: { value: new THREE.Vector2(this.microSize, this.microSize) },
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
		this.materialResample = new THREE.ShaderMaterial({
			uniforms: {
				tState: { value: null }, tBed: { value: bedTexture },
				uSourceSize: { value: new THREE.Vector2() }, uFlowScale: { value: 1 }, uMacro: { value: true },
			},
			vertexShader: FS_VERT, fragmentShader: RESAMPLE_FRAG, depthTest: false, depthWrite: false,
		});
		this.materials = [this.materialFlux, this.materialHeight, this.materialMicro,
			this.materialMacroImpulse, this.materialMicroImpulse, this.materialInitMacro,
			this.materialInitMicro, this.materialReadback, this.materialResample];
		for (const material of this.materials) {
			material.blending = THREE.NoBlending;
			material.toneMapped = false;
		}

		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materialFlux);
		this.quad.frustumCulled = false;
		this.scene = new THREE.Scene();
		this.scene.add(this.quad);
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		this.init();
	}

	makeStatePair(size, type) {
		const opts = { nearest: !canFilterLinearly(type, this.capabilities) };
		return [makeRT(size, size, type, opts), makeRT(size, size, type, opts)];
	}

	estimateWetArea() {
		const n = 64;
		let wet = 0;
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const x = (i + 0.5) / n * this.domain - this.half;
				const z = (j + 0.5) / n * this.domain - this.half;
				if (this.hf.height(x, z) < 0) wet++;
			}
		}
		return wet * (this.domain / n) ** 2;
	}

	setDisplacedVolume(volume, dt = FIXED_DT) {
		this.displacedVolume = Number.isFinite(volume) ? Math.max(0, volume) : 0;
		this.targetLevelOffset = this.wetPondArea > 0 ? Math.min(MAX_LEVEL_OFFSET, this.displacedVolume / this.wetPondArea) : 0;
		const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
		this.levelOffset = clamp(this.levelOffset + (this.targetLevelOffset - this.levelOffset) * (1 - Math.exp(-elapsed / 0.55)), 0, MAX_LEVEL_OFFSET);
		return this.levelOffset;
	}

	// Resample the completed field, never the scratch flux pass. Both new sides
	// start from that field; queued impulses and all CPU actors remain untouched.
	setResolution(macroSize, microSize) {
		macroSize = validSize(macroSize, this.capabilities.maxTextureSize);
		microSize = validSize(microSize, this.capabilities.maxTextureSize);
		if (macroSize === this.macroSize && microSize === this.microSize) return false;
		if (this._disposed) return false;
		const macro = this.makeStatePair(macroSize, this.stateType);
		const micro = this.makeStatePair(microSize, this.microType);
		const previous = this.renderer.getRenderTarget();
		const autoClear = this.renderer.autoClear;
		try {
			const u = this.materialResample.uniforms;
			u.tState.value = this.macroTexture;
			u.uSourceSize.value.set(this.macroSize, this.macroSize);
			u.uFlowScale.value = this.macroSize / macroSize;
			u.uMacro.value = true;
			for (const target of macro) this.pass(this.materialResample, target);
			u.tState.value = this.microTexture;
			u.uSourceSize.value.set(this.microSize, this.microSize);
			u.uMacro.value = false;
			for (const target of micro) this.pass(this.materialResample, target);
		} catch (error) {
			for (const target of [...macro, ...micro]) target.dispose();
			throw error;
		} finally {
			this.renderer.setRenderTarget(previous);
			this.renderer.autoClear = autoClear;
			this.materialResample.uniforms.tState.value = null;
		}
		const old = [...this.macroRT, ...this.microRT];
		this.macroRT = macro;
		this.microRT = micro;
		this.macroIndex = this.microIndex = 0;
		this.macroSize = macroSize;
		this.microSize = microSize;
		for (const material of [this.materialFlux, this.materialHeight, this.materialMacroImpulse]) material.uniforms.uSize.value.set(macroSize, macroSize);
		for (const material of [this.materialMicro, this.materialMicroImpulse]) material.uniforms.uSize.value.set(microSize, microSize);
		// Drop references to disposed textures, including those used only next frame.
		this.materialFlux.uniforms.tState.value = this.macroTexture;
		this.materialHeight.uniforms.tFlux.value = this.macroTexture;
		this.materialHeight.uniforms.tMicro.value = this.microTexture;
		this.materialMicro.uniforms.tState.value = this.microTexture;
		this.materialMicro.uniforms.tMacro.value = this.macroTexture;
		this.materialMacroImpulse.uniforms.tState.value = this.macroTexture;
		this.materialMicroImpulse.uniforms.tState.value = this.microTexture;
		this.materialReadback.uniforms.tMacro.value = this.macroTexture;
		this.materialReadback.uniforms.tMicro.value = this.microTexture;
		if (old.includes(this.renderer.getRenderTarget())) this.renderer.setRenderTarget(null);
		for (const target of old) target.dispose();
		this._stateGeneration++;
		this.hasReadback = false;
		this.readbackStatus = this.readbackMode === 'analytic' ? 'unavailable' : 'idle';
		return true;
	}

	init() {
		const renderer = this.renderer;
		const previous = renderer.getRenderTarget();
		const autoClear = renderer.autoClear;
		try {
			for (const target of this.macroRT) this.pass(this.materialInitMacro, target);
			for (const target of this.microRT) this.pass(this.materialInitMicro, target);
		} finally {
			renderer.setRenderTarget(previous);
			renderer.autoClear = autoClear;
		}
		this.macroIndex = 0;
		this.microIndex = 0;
		this._stateGeneration = (this._stateGeneration || 0) + 1;
		this.resetTiming();
		this.hasReadback = false;
		this.readbackStatus = this.readbackMode === 'analytic' ? 'unavailable' : 'idle';
	}

	pass(material, target) {
		this.quad.material = material;
		this.renderer.setRenderTarget(target);
		// Every pixel is overwritten; no depth or colour clear is needed.
		this.renderer.autoClear = false;
		this.renderer.render(this.scene, this.camera);
	}

	get macroTexture() { return this.macroRT[this.macroIndex].texture; }
	get microTexture() { return this.microRT[this.microIndex].texture; }
	get pendingImpulseCount() { return this.pending.length; }
	get readbackAgeMs() { return this.hasReadback ? performance.now() - this._readbackCapturedAt : null; }
	get hasFreshReadback() { return this.hasReadback && this.readbackAgeMs < READBACK_STALE_MS; }

	resetTiming() {
		this.accumulator = 0;
		this.stepsThisFrame = 0;
	}

	setWind(strength, angle) {
		this.windStrength = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0;
		angle = Number.isFinite(angle) ? angle : 0;
		this.wind.set(Math.cos(angle), Math.sin(angle));
	}

	setRain(amount) { this.rain = Number.isFinite(amount) ? clamp(amount, 0, 1) : 0; }

	addImpulse(imp) {
		if (!imp || this._disposed) return;
		const base = {
			x: 0, z: 0, radius: 0.22, amp: -0.04, flowX: 0, flowZ: 0, flowRadius: 0.4,
			flowStrength: 0, foam: 0, microScale: 1.0,
		};
		Object.assign(base, imp);
		if (![base.x, base.z, base.radius, base.amp, base.flowX, base.flowZ,
			base.flowRadius, base.flowStrength, base.foam, base.microScale].every(Number.isFinite)) return;
		base.radius = Math.max(0.01, base.radius);
		base.flowRadius = Math.max(0.01, base.flowRadius);
		this.pending.push(base);
		if (this.pending.length > 24) {
			this.pending.shift();
			this.droppedImpulses++;
		}
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
		m.uniforms.uLevel.value = this.levelOffset;
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
		if (this._disposed) return;
		const start = performance.now();
		const previous = this.renderer.getRenderTarget();
		const autoClear = this.renderer.autoClear;
		const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
		this.droppedTime += Math.max(0, elapsed - MAX_FRAME_DT);
		this.accumulator += Math.min(elapsed, MAX_FRAME_DT);
		if (!Number.isFinite(time)) time = this.simulatedTime + this.accumulator;
		try {
			let steps = 0;
			while (this.accumulator + 1e-10 >= FIXED_DT && steps < MAX_SUBSTEPS) {
				const t = time - this.accumulator + FIXED_DT;
				this.stepMacro(t);
				this.stepMicro(t);
				this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
				steps++;
				this.totalSteps++;
				this.simulatedTime += FIXED_DT;
			}
			if (this.accumulator >= FIXED_DT) {
				const remainder = this.accumulator % FIXED_DT;
				this.droppedTime += this.accumulator - remainder;
				this.accumulator = remainder;
			}
			this.stepsThisFrame = steps;
			this.applyImpulses();
			this.frame++;
			if (this.frame % 2 === 0 || this.reading) this.updateReadback();
		} finally {
			this.renderer.setRenderTarget(previous);
			this.renderer.autoClear = autoClear;
			// Command submission/readback setup only; asynchronous latency is separate.
			this.lastUpdateMs = performance.now() - start;
		}
	}

	updateReadback() {
		if (this._disposed || this.readbackMode === 'analytic') return;
		const now = performance.now();
		if (this.reading) {
			if (now - this._readbackStartedAt > READBACK_STALE_MS) this.readbackStatus = 'stalled';
			// A slow request must not create an unbounded queue or reuse its buffer.
			return;
		}
		if (now < this._readbackRetryAt) return;
		const previous = this.renderer.getRenderTarget();
		const autoClear = this.renderer.autoClear;
		const level = this.levelOffset;
		const generation = this._stateGeneration;
		this._readbackStartedAt = now;
		this.reading = true;
		this.readbackStatus = 'pending';
		this.readbackBuffer.fill(0);
		let promise;
		try {
			const m = this.materialReadback;
			m.uniforms.tMacro.value = this.macroTexture;
			m.uniforms.tMicro.value = this.microTexture;
			m.uniforms.uLevel.value = level;
			this.pass(m, this.readbackRT);
			if (this.readbackMode === 'async') {
				promise = this.renderer.readRenderTargetPixelsAsync(
					this.readbackRT, 0, 0, READBACK_SIZE, READBACK_SIZE, this.readbackBuffer
				);
			} else {
				this.renderer.readRenderTargetPixels(this.readbackRT, 0, 0, READBACK_SIZE, READBACK_SIZE, this.readbackBuffer);
				this.decodeReadback(this.readbackBuffer, level);
				this._readbackCapturedAt = now;
				this.readbackCount++;
				this.readbackLatency = performance.now() - now;
				this.readbackStatus = 'ready';
				this.readbackLastError = null;
				this._readbackConsecutiveFailures = 0;
				this.reading = false;
				return;
			}
		} catch (error) {
			this.failReadback(error);
			return;
		} finally {
			this.renderer.setRenderTarget(previous);
			this.renderer.autoClear = autoClear;
		}
		Promise.resolve(promise).then((buffer) => {
			if (this._disposed || generation !== this._stateGeneration) return;
			this.decodeReadback(buffer || this.readbackBuffer, level);
			this._readbackCapturedAt = now;
			this.readbackCount++;
			this.readbackLatency = performance.now() - now;
			this.readbackStatus = 'ready';
			this.readbackLastError = null;
			this._readbackConsecutiveFailures = 0;
		}).catch((error) => {
			if (!this._disposed && generation === this._stateGeneration) this.failReadback(error);
		}).finally(() => { this.reading = false; });
	}

	failReadback(error) {
		this.reading = false;
		this.readbackFailures++;
		this._readbackConsecutiveFailures++;
		this.readbackStatus = 'failed';
		this.readbackLastError = error?.message || String(error);
		this.readbackLatency = performance.now() - this._readbackStartedAt;
		this._readbackRetryAt = performance.now() + Math.min(5000, 250 * 2 ** Math.min(5, this._readbackConsecutiveFailures - 1));
	}

	decodeReadback(buf, capturedLevel = this.levelOffset) {
		const n = READBACK_SIZE;
		if (!buf || buf.length !== n * n * 4) throw new Error('Incomplete water readback');
		// Alpha is a sentinel; a missing/uninitialised framebuffer must not look like -2 m water.
		for (let i = 3; i < buf.length; i += 4) {
			if (buf[i] !== 255) throw new Error('Invalid water readback');
		}
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
		this.readbackLevelOffset = capturedLevel;
		this._readbackCapturedAt = performance.now();
	}

	sampleSurface(x, z, out = { height: 0, depth: 0 }) {
		if (!this.hasFreshReadback) {
			out.height = this.levelOffset;
			out.depth = Math.max(0, out.height - this.hf.height(x, z));
			return out;
		}
		const n = READBACK_SIZE;
		const u = clamp((x + this.half) / this.domain * n - 0.5, 0, n - 1);
		const v = clamp((z + this.half) / this.domain * n - 0.5, 0, n - 1);
		const x0 = Math.floor(u), x1 = Math.min(x0 + 1, n - 1);
		const y0 = Math.floor(v), y1 = Math.min(y0 + 1, n - 1);
		const fx = u - x0, fy = v - y0;
		const h00 = this.readbackHeights[y0 * n + x0], h10 = this.readbackHeights[y0 * n + x1];
		const h01 = this.readbackHeights[y1 * n + x0], h11 = this.readbackHeights[y1 * n + x1];
		const d00 = this.readbackDepths[y0 * n + x0], d10 = this.readbackDepths[y0 * n + x1];
		const d01 = this.readbackDepths[y1 * n + x0], d11 = this.readbackDepths[y1 * n + x1];
		const offsetDelta = this.levelOffset - this.readbackLevelOffset;
		out.height = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy + offsetDelta;
		const capturedDepth = (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
		out.depth = capturedDepth > 2 / 255
			? Math.max(0, capturedDepth + offsetDelta)
			: Math.max(0, out.height - this.hf.height(x, z));
		return out;
	}

	surfaceAt(x, z) {
		return this.sampleSurface(x, z, { height: 0, depth: 0 });
	}

	slopeAt(x, z, eps = 0.25) {
		eps = Number.isFinite(eps) && eps > 0 ? eps : 0.25;
		const out = this._surfaceScratch;
		const hL = this.sampleSurface(x - eps, z, out).height;
		const hR = this.sampleSurface(x + eps, z, out).height;
		const hD = this.sampleSurface(x, z - eps, out).height;
		const hU = this.sampleSurface(x, z + eps, out).height;
		return { x: (hR - hL) / (2 * eps), z: (hU - hD) / (2 * eps) };
	}

	getDiagnostics() {
		return {
			macroSize: this.macroSize, microSize: this.microSize,
			stateType: this.stateType, macroFloatType: this.macroFloatType, microType: this.microType,
			floatLinear: this.floatLinear,
			fixedDt: FIXED_DT, stepsThisFrame: this.stepsThisFrame, totalSteps: this.totalSteps,
			simulatedTime: this.simulatedTime, droppedTime: this.droppedTime,
			lastUpdateMs: this.lastUpdateMs, timingLabel: 'CPU submission',
			pendingImpulses: this.pending.length, droppedImpulses: this.droppedImpulses,
			levelOffset: this.levelOffset, targetLevelOffset: this.targetLevelOffset,
			displacedVolume: this.displacedVolume, wetPondArea: this.wetPondArea,
			hasReadback: this.hasReadback, hasFreshReadback: this.hasFreshReadback,
			readbackCount: this.readbackCount, readbackLatency: this.readbackLatency,
			readbackAgeMs: this.readbackAgeMs, readbackFailures: this.readbackFailures,
			readbackStatus: this.readbackStatus, readbackLastError: this.readbackLastError,
			readbackMode: this.readbackMode, readbackPending: this.reading,
		};
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		this.readbackStatus = 'disposed';
		// An in-flight Three readback owns its PBO/fence until its promise settles.
		// Its completion is ignored; no more requests can start after disposal.
		for (const target of [...this.macroRT, ...this.microRT, this.readbackRT]) target.dispose();
		for (const material of this.materials) material.dispose();
		this.quad.geometry.dispose();
		this.scene.clear();
		this.pending.length = 0;
	}
}
