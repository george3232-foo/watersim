import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { getRenderCapabilities, canFilterLinearly, UnsupportedDeviceError } from './RenderCapabilities.js';
import { GpuTimer } from './GpuTimer.js';

export { UnsupportedDeviceError } from './RenderCapabilities.js';

const COPY_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`;

const BRIGHT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 c2 = texture2D(tDiffuse, vUv + uTexel).rgb;
  vec3 c3 = texture2D(tDiffuse, vUv - uTexel).rgb;
  c = (c + c2 + c3) / 3.0;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uThreshold * 0.6;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDir;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += texture2D(tDiffuse, vUv + uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv - uDir * 1.384615).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv + uDir * 3.230769).rgb * 0.070270;
  c += texture2D(tDiffuse, vUv - uDir * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tComp;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uChromaticAberration;
uniform vec2 uResolution;
uniform vec2 uSunScreen;
uniform float uSunVisible;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
void main(){
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  // very subtle chromatic aberration, growing toward the frame edge
  vec2 ca = fromCenter * (0.00025 + r2 * 0.0008) * uChromaticAberration;
  vec3 col;
  col.r = texture2D(tComp, uv - ca).r;
  col.g = texture2D(tComp, uv).g;
  col.b = texture2D(tComp, uv + ca).b;

  vec3 bloom = vec3(0.0);
  if (uBloom > 0.0) bloom = texture2D(tBloomA, uv).rgb * 0.62 + texture2D(tBloomB, uv).rgb * 0.55;
  // sun glow lift
  float sd = length((uv - uSunScreen) * vec2(uResolution.x / uResolution.y, 1.0));
  bloom += vec3(1.0, 0.72, 0.42) * exp(-sd * 7.0) * 0.018 * uSunVisible;
  col += bloom * uBloom;

  col *= uExposure;
  col = aces(col);

  // gentle grade: cool shadows, warm highlights
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.92, 1.0, 1.06), (1.0 - l) * 0.32);
  col = mix(col, col * vec3(1.05, 1.0, 0.94), smoothstep(0.55, 1.0, l) * 0.25);
  col = pow(col, vec3(1.03, 1.0, 0.985));

  // vignette
  float vig = smoothstep(0.78, 0.18, length(fromCenter * vec2(1.0, 0.92)));
  col *= mix(0.72, 1.0, vig);

  // film grain, strongest in the shadows
  float grain = (hash12(gl_FragCoord.xy + uTime * 71.3) - 0.5);
  col += grain * 0.012 * (1.0 - l);

  // sRGB
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}`;

function makeRT(w, h, type = THREE.HalfFloatType, opts = {}) {
	return new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), {
		minFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
		magFilter: opts.nearest ? THREE.NearestFilter : THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type,
		depthBuffer: !!opts.depth,
		stencilBuffer: false,
		generateMipmaps: false,
		wrapS: THREE.ClampToEdgeWrapping,
		wrapT: THREE.ClampToEdgeWrapping,
	});
}

function fsMaterial(fragmentShader, uniforms) {
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: COPY_VERT,
		fragmentShader,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
}

export class Engine {
	constructor(canvas, opts = {}) {
		try {
			this.renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: false,
				alpha: false,
				powerPreference: 'high-performance',
				stencil: false,
				preserveDrawingBuffer: false,
			});
			// Fail before constructing cameras, post-processing, or the world.
			this.capabilities = getRenderCapabilities(this.renderer);
		} catch (error) {
			this.renderer?.dispose();
			throw error instanceof UnsupportedDeviceError ? error : new UnsupportedDeviceError(undefined, error);
		}
		this.renderer.setPixelRatio(1);
		this.renderer.info.autoReset = false;
		this.renderer.autoClear = true;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.shadowMap.autoUpdate = false;
		this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
		this.renderer.toneMapping = THREE.NoToneMapping;
		this.renderer.setClearColor(0x000000, 1);

		this.width = 1;
		this.height = 1;
		this.dpr = 1;
		this.qualityScale = opts.qualityScale ?? opts.scale ?? 1;
		this.maxDpr = opts.maxDpr ?? 1.6;
		this.reflectionScale = opts.reflectionScale ?? 0.6;
		this.reflectionInterval = opts.reflectionInterval ?? 1;
		this.shadowInterval = opts.shadowInterval ?? 1;
		this.bloomEnabled = opts.bloom !== false;
		this.chromaticAberration = this.qualityScale <= 0.7 ? 0.55 : this.qualityScale < 0.95 ? 0.8 : 1;
		this.shadowSize = opts.shadowSize || 2048;
		this.qualitySettings = {};
		this.reflectionValid = false;
		this._reflectionFrames = 0;
		this._frameId = 0;
		this._frameOpen = false;
		this.frameStats = { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 };
		this.timings = { label: 'CPU submission', unit: 'ms', scene: 0, reflection: 0, composite: 0, post: 0, frame: 0 };
		this._gpuTimer = new GpuTimer(this.renderer, opts.gpuTiming !== false);
		this.gpuTimings = this._gpuTimer.stats;

		this.camera = new THREE.PerspectiveCamera(50, 1, 0.08, 500);
		this.camera.position.set(10.6, 3.2, 8.6);
		this.camera.lookAt(0, 0.8, 0);

		this.reflectionCamera = new THREE.PerspectiveCamera(50, 1, 0.08, 500);
		this.textureMatrix = new THREE.Matrix4();
		this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.002);
		this._normal = new THREE.Vector3(0, 1, 0);
		this._mirror = new THREE.Vector3();
		this._view = new THREE.Vector3();
		this._virtualPos = new THREE.Vector3();
		this._lookAt = new THREE.Vector3();
		this._target = new THREE.Vector3();
		this._rotation = new THREE.Matrix4();

		this.copyMat = fsMaterial(COPY_FRAG, { tDiffuse: { value: null } });
		this.brightMat = fsMaterial(BRIGHT_FRAG, {
			tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.35 },
		});
		this.blurMat = fsMaterial(BLUR_FRAG, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
		this.finalMat = fsMaterial(FINAL_FRAG, {
			tComp: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
			uTime: { value: 0 }, uExposure: { value: 1.06 }, uBloom: { value: 0.32 },
			uChromaticAberration: { value: this.chromaticAberration },
			uResolution: { value: new THREE.Vector2(1, 1) },
			uSunScreen: { value: new THREE.Vector2(0.5, 0.5) }, uSunVisible: { value: 1 },
		});
		this.fxaaMat = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
			vertexShader: FXAAShader.vertexShader,
			fragmentShader: FXAAShader.fragmentShader,
			depthTest: false,
			depthWrite: false,
		});
		this.fxaaMat.uniforms.tDiffuse.value = null;
		this.fsScene = new THREE.Scene();
		this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
		this.fsQuad.frustumCulled = false;
		this.fsScene.add(this.fsQuad);
		this.blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
		this.blackTexture.needsUpdate = true;

		this.sceneRT = null;
		this.reflectionRT = null;
		this.compRT = null;
		this.ldrRT = null;
		this.bloomA = null;
		this.bloomB = null;
		this.bloomC = null;
		this.bloomD = null;
	}

	get internalSize() {
		return { width: this.sceneRT?.width ?? 1, height: this.sceneRT?.height ?? 1 };
	}

	setQuality(settings = {}) {
		const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
		this.qualityScale = positive(settings.scale, this.qualityScale);
		this.maxDpr = positive(settings.maxDpr, this.maxDpr);
		const reflectionScale = Math.min(1, positive(settings.reflectionScale, this.reflectionScale));
		if (reflectionScale !== this.reflectionScale) this.reflectionValid = false;
		this.reflectionScale = reflectionScale;
		this.reflectionInterval = Math.max(1, Math.floor(positive(settings.reflectionInterval, this.reflectionInterval)));
		if (settings.bloom !== undefined) this.bloomEnabled = !!settings.bloom;
		this.shadowSize = Number.isFinite(settings.shadowSize) ? Math.max(1, Math.floor(settings.shadowSize)) : this.shadowSize;
		this.shadowInterval = Number.isFinite(settings.shadowInterval) ? Math.max(1, Math.floor(settings.shadowInterval)) : this.shadowInterval;
		this.chromaticAberration = Number.isFinite(settings.chromaticAberration)
			? Math.max(0, settings.chromaticAberration)
			: (this.qualityScale <= 0.7 ? 0.55 : this.qualityScale < 0.95 ? 0.8 : 1);
		this.finalMat?.uniforms.uChromaticAberration && (this.finalMat.uniforms.uChromaticAberration.value = this.chromaticAberration);
		this.finalMat?.uniforms.uBloom && (this.finalMat.uniforms.uBloom.value = this.bloomEnabled ? 0.32 : 0);
		this.qualitySettings = { ...this.qualitySettings, ...settings };
		if (!this.bloomEnabled) {
			this.disposeBloom();
		} else if (this.sceneRT && !this.bloomA) {
			this.createBloom(this.sceneRT.width, this.sceneRT.height);
		}
		return this.qualitySettings;
	}

	beginFrame() {
		if (this._disposed) return;
		if (this._frameOpen) this.endFrame();
		this._frameId++;
		this.renderer.info.reset();
		this._reflectionRendered = false;
		this.timings.scene = this.timings.reflection = this.timings.composite = this.timings.post = this.timings.frame = 0;
		this._gpuTimer.begin(this._frameId);
		this._frameStart = performance.now();
		this._frameOpen = true;
	}

	endFrame() {
		if (!this._frameOpen) return this.frameStats;
		this.timings.frame = performance.now() - this._frameStart;
		this._gpuTimer.end();
		const info = this.renderer.info;
		Object.assign(this.frameStats, {
			frame: this._frameId, calls: info.render.calls, triangles: info.render.triangles,
			points: info.render.points, lines: info.render.lines,
			textures: info.memory.textures, geometries: info.memory.geometries,
			reflectionRendered: this._reflectionRendered, bloom: this.bloomEnabled,
			autoReset: info.autoReset, timings: { ...this.timings }, gpuTimings: { ...this.gpuTimings },
		});
		this._frameOpen = false;
		return this.frameStats;
	}

	makeHdrTarget(w, h, depth = false) {
		return makeRT(w, h, this.capabilities.hdrType, {
			depth, nearest: !canFilterLinearly(this.capabilities.hdrType, this.capabilities),
		});
	}

	disposeBloom() {
		for (const key of ['bloomA', 'bloomB', 'bloomC', 'bloomD']) {
			this[key]?.dispose();
			this[key] = null;
		}
		this.finalMat.uniforms.tBloomA.value = this.blackTexture;
		this.finalMat.uniforms.tBloomB.value = this.blackTexture;
	}

	createBloom(w, h) {
		this.bloomA = this.makeHdrTarget(w / 2, h / 2);
		this.bloomB = this.makeHdrTarget(w / 2, h / 2);
		this.bloomC = this.makeHdrTarget(w / 4, h / 4);
		this.bloomD = this.makeHdrTarget(w / 4, h / 4);
	}

	// An explicitly supplied dpr is already scaled by App. The default computes it here.
	resize(width, height, dpr = Math.min(globalThis.devicePixelRatio || 1, this.maxDpr) * this.qualityScale) {
		width = Number.isFinite(width) ? Math.max(1, width) : 1;
		height = Number.isFinite(height) ? Math.max(1, height) : 1;
		dpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
		// A supplied dpr is the final CSS-to-render target ratio (App may already
		// have applied scale); the no-argument default applies qualityScale below.
		dpr = Math.min(dpr, this.maxDpr);
		dpr *= Math.min(1, this.capabilities.maxTextureSize / Math.max(2, width * dpr, height * dpr));
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		const w = Math.max(2, Math.floor(width * dpr));
		const h = Math.max(2, Math.floor(height * dpr));
		const rw = Math.max(1, Math.floor(w * this.reflectionScale));
		const rh = Math.max(1, Math.floor(h * this.reflectionScale));
		this.renderer.setSize(w, h, false);
		const canvas = this.renderer.domElement;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();

		// Even an aspect-only resize invalidates the texture/matrix pair.
		this.reflectionValid = false;
		this._reflectionFrames = 0;
		if (this.sceneRT?.width === w && this.sceneRT?.height === h &&
			this.reflectionRT?.width === rw && this.reflectionRT?.height === rh) return false;
		this.renderer.setRenderTarget(null);
		for (const key of ['sceneRT', 'reflectionRT', 'compRT', 'ldrRT']) this[key]?.dispose();
		this.disposeBloom();

		const depth = new THREE.DepthTexture(w, h);
		depth.type = THREE.UnsignedIntType;
		depth.format = THREE.DepthFormat;
		depth.minFilter = THREE.NearestFilter;
		depth.magFilter = THREE.NearestFilter;

		this.sceneRT = this.makeHdrTarget(w, h, true);
		this.sceneRT.depthTexture = depth;
		this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.sceneRT.depthTexture.colorSpace = THREE.NoColorSpace;

		this.reflectionRT = this.makeHdrTarget(rw, rh, true);
		this.reflectionRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.compRT = this.makeHdrTarget(w, h);
		this.compRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.ldrRT = makeRT(w, h, THREE.UnsignedByteType);
		if (this.bloomEnabled) this.createBloom(w, h);

		this.finalMat.uniforms.uResolution.value.set(w, h);
		this.fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
		this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);

		// FINAL_FRAG writes display-encoded values. FXAA samples those without a second transfer.
		this.ldrRT.texture.colorSpace = THREE.NoColorSpace;
		this.reflectionCamera.aspect = width / height;
		this.reflectionCamera.updateProjectionMatrix();
		return true;
	}

	fsPass(material, target, clear = true) {
		this.fsQuad.material = material;
		this.renderer.setRenderTarget(target);
		this.renderer.autoClear = clear;
		this.renderer.render(this.fsScene, this.fsCamera);
	}

		renderScene(scene, camera, sky) {
		const start = performance.now();
		// Animated vegetation can tolerate an occasional shadow refresh on lower
		// tiers. Preserve an explicit invalidation from a time/weather change, but
		// do not render the entire shadow scene at the full frame rate on mobile.
		this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.needsUpdate
			|| this._frameId % this.shadowInterval === 0;
		this.renderer.setRenderTarget(this.sceneRT);
		this.renderer.autoClear = true;
		this.renderer.setClearColor(0x000000, 1);
		this.renderer.render(scene, camera);
		this.timings.scene += performance.now() - start;
	}

	updateReflectionCamera(camera, level, sky) {
		camera.updateMatrixWorld();
		const normal = this._normal;
		const mirror = this._mirror.set(0, level, 0);
		const camPos = this._lookAt.setFromMatrixPosition(camera.matrixWorld);
		const view = this._view.copy(mirror).sub(camPos);
		if (view.dot(normal) > -0.01) return false;

		const virtualPos = this._virtualPos.copy(view).reflect(normal).negate().add(mirror);
		const rotation = this._rotation.extractRotation(camera.matrixWorld);
		const lookAt = this._target.set(0, 0, -1).applyMatrix4(rotation).add(camPos);
		const target = this._view.copy(mirror).sub(lookAt).reflect(normal).negate().add(mirror);

		const rc = this.reflectionCamera;
		rc.position.copy(virtualPos);
		rc.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
		rc.lookAt(target);
		rc.far = camera.far;
		rc.near = camera.near;
		rc.updateMatrixWorld();
		rc.projectionMatrix.copy(camera.projectionMatrix);
		rc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

		const tm = this.textureMatrix;
		tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
		tm.multiply(rc.projectionMatrix);
		tm.multiply(rc.matrixWorldInverse);
		return true;
	}

	renderReflection(scene, camera, sky, level) {
		// Do not change the projection matrix unless its matching texture is refreshed.
		this._reflectionFrames++;
		if (this.reflectionValid && this._reflectionFrames < this.reflectionInterval) return false;
		if (!this.reflectionRT || !this.updateReflectionCamera(camera, level, sky)) return false;
		const start = performance.now();
		const oldClipping = this.renderer.clippingPlanes;
		const oldAutoClear = this.renderer.autoClear;
		const skyVisible = sky.mesh.visible;
		this.reflectionValid = false;
		// sky first, unclipped, so the reflection never shows a hole at the horizon
		// The direct sun disc is dimmed in the mirror; the glitter path is
		// produced by the water's specular lobe instead of a blown-out blob.
		const sunDisc = sky.uniforms.uSunDisc.value;
		try {
			this.renderer.setRenderTarget(this.reflectionRT);
			this.renderer.clippingPlanes = [];
			this.renderer.autoClear = true;
			sky.uniforms.uSunDisc.value = 0.12;
			this.renderer.render(sky.skyScene, this.reflectionCamera);
			sky.uniforms.uSunDisc.value = sunDisc;
			sky.mesh.visible = false;
			this.clipPlane.constant = 0.002 - level;
			this.renderer.clippingPlanes = [this.clipPlane];
			this.renderer.autoClear = false;
			this.renderer.render(scene, this.reflectionCamera);
			this.reflectionValid = true;
			this._reflectionRendered = true;
			this._reflectionFrames = 0;
		} finally {
			sky.uniforms.uSunDisc.value = sunDisc;
			sky.mesh.visible = skyVisible;
			this.renderer.clippingPlanes = oldClipping;
			this.renderer.autoClear = oldAutoClear;
			this.timings.reflection += performance.now() - start;
		}
		return true;
	}

	renderComposite(scene, waterScene, fxScene, camera) {
		const start = performance.now();
		// copy scene colour
		this.copyMat.uniforms.tDiffuse.value = this.sceneRT.texture;
		this.fsPass(this.copyMat, this.compRT, true);
		// water over the copy
		this.renderer.setRenderTarget(this.compRT);
		this.renderer.autoClear = false;
		this.renderer.render(waterScene, camera);
		if (fxScene) this.renderer.render(fxScene, camera);
		this.renderer.autoClear = true;
		this.timings.composite += performance.now() - start;
	}

	post(time, sunScreen) {
		const start = performance.now();
		if (this.bloomEnabled && this.bloomA) {
			this.brightMat.uniforms.tDiffuse.value = this.compRT.texture;
			this.fsPass(this.brightMat, this.bloomA, true);

			this.blurMat.uniforms.tDiffuse.value = this.bloomA.texture;
			this.blurMat.uniforms.uDir.value.set(1 / this.bloomA.width, 0);
			this.fsPass(this.blurMat, this.bloomB, true);

			this.blurMat.uniforms.tDiffuse.value = this.bloomB.texture;
			this.blurMat.uniforms.uDir.value.set(0, 1 / this.bloomB.height);
			this.fsPass(this.blurMat, this.bloomA, true);

			// wide bloom
			this.copyMat.uniforms.tDiffuse.value = this.bloomA.texture;
			this.fsPass(this.copyMat, this.bloomC, true);
			this.blurMat.uniforms.tDiffuse.value = this.bloomC.texture;
			this.blurMat.uniforms.uDir.value.set(1 / this.bloomC.width, 0);
			this.fsPass(this.blurMat, this.bloomD, true);
			this.blurMat.uniforms.tDiffuse.value = this.bloomD.texture;
			this.blurMat.uniforms.uDir.value.set(0, 1 / this.bloomD.height);
			this.fsPass(this.blurMat, this.bloomC, true);
		}

		this.finalMat.uniforms.tComp.value = this.compRT.texture;
		this.finalMat.uniforms.tBloomA.value = this.bloomA?.texture ?? this.blackTexture;
		this.finalMat.uniforms.tBloomB.value = this.bloomC?.texture ?? this.blackTexture;
		this.finalMat.uniforms.uBloom.value = this.bloomEnabled ? 0.32 : 0;
		this.finalMat.uniforms.uTime.value = time;
		if (sunScreen) this.finalMat.uniforms.uSunScreen.value.copy(sunScreen);
		this.fsPass(this.finalMat, this.ldrRT, true);

		this.fxaaMat.uniforms.tDiffuse.value = this.ldrRT.texture;
		this.fsQuad.material = this.fxaaMat;
		this.renderer.setRenderTarget(null);
		this.renderer.autoClear = true;
		this.renderer.render(this.fsScene, this.fsCamera);
		this.timings.post += performance.now() - start;
	}

	dispose() {
		if (this._disposed) return;
		this.endFrame();
		this._disposed = true;
		this._gpuTimer.dispose();
		this.renderer.setRenderTarget(null);
		for (const key of ['sceneRT', 'reflectionRT', 'compRT', 'ldrRT']) {
			this[key]?.dispose();
			this[key] = null;
		}
		this.disposeBloom();
		this.fsQuad.geometry.dispose();
		for (const material of [this.copyMat, this.brightMat, this.blurMat, this.finalMat, this.fxaaMat]) material.dispose();
		this.fsScene.clear();
		this.blackTexture.dispose();
		this.renderer.dispose();
	}
}
