import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

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
  vec2 ca = fromCenter * (0.0012 + r2 * 0.0035);
  vec3 col;
  col.r = texture2D(tComp, uv - ca).r;
  col.g = texture2D(tComp, uv).g;
  col.b = texture2D(tComp, uv + ca).b;

  vec3 bloom = texture2D(tBloomA, uv).rgb * 0.62 + texture2D(tBloomB, uv).rgb * 0.55;
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
	});
}

export class Engine {
	constructor(canvas, opts = {}) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			alpha: false,
			powerPreference: 'high-performance',
			stencil: false,
			preserveDrawingBuffer: false,
		});
		this.renderer.setPixelRatio(1);
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
		this.qualityScale = opts.qualityScale || 1;
		this.maxDpr = opts.maxDpr || 1.6;
		this.reflectionScale = opts.reflectionScale || 0.55;

		this.camera = new THREE.PerspectiveCamera(50, 1, 0.08, 500);
		this.camera.position.set(10.6, 3.2, 8.6);
		this.camera.lookAt(0, 0.8, 0);

		this.reflectionCamera = new THREE.PerspectiveCamera(50, 1, 0.08, 500);
		this.textureMatrix = new THREE.Matrix4();
		this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.002);

		this.fsScene = new THREE.Scene();
		this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
		this.fsQuad.frustumCulled = false;
		this.fsScene.add(this.fsQuad);

		this.copyMat = fsMaterial(COPY_FRAG, { tDiffuse: { value: null } });
		this.brightMat = fsMaterial(BRIGHT_FRAG, {
			tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.35 },
		});
		this.blurMat = fsMaterial(BLUR_FRAG, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
		this.finalMat = fsMaterial(FINAL_FRAG, {
			tComp: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
			uTime: { value: 0 }, uExposure: { value: 1.06 }, uBloom: { value: 0.32 },
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
		return { width: Math.floor(this.width * this.dpr), height: Math.floor(this.height * this.dpr) };
	}

	resize(width, height, dpr) {
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		const w = Math.max(2, Math.floor(width * dpr));
		const h = Math.max(2, Math.floor(height * dpr));
		this.renderer.setSize(w, h, false);
		const canvas = this.renderer.domElement;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';

		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();

		const dispose = (rt) => rt && rt.dispose();
		dispose(this.sceneRT); dispose(this.reflectionRT); dispose(this.compRT); dispose(this.ldrRT);
		dispose(this.bloomA); dispose(this.bloomB); dispose(this.bloomC); dispose(this.bloomD);

		const depth = new THREE.DepthTexture(w, h);
		depth.type = THREE.UnsignedIntType;
		depth.format = THREE.DepthFormat;
		depth.minFilter = THREE.NearestFilter;
		depth.magFilter = THREE.NearestFilter;

		this.sceneRT = makeRT(w, h, THREE.HalfFloatType, { depth: true });
		this.sceneRT.depthTexture = depth;
		this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.sceneRT.depthTexture.colorSpace = THREE.NoColorSpace;

		this.reflectionRT = makeRT(w * this.reflectionScale, h * this.reflectionScale, THREE.HalfFloatType, { depth: true });
		this.reflectionRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.compRT = makeRT(w, h, THREE.HalfFloatType);
		this.compRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
		this.ldrRT = makeRT(w, h, THREE.UnsignedByteType);
		this.bloomA = makeRT(w / 2, h / 2, THREE.HalfFloatType);
		this.bloomB = makeRT(w / 2, h / 2, THREE.HalfFloatType);
		this.bloomC = makeRT(w / 4, h / 4, THREE.HalfFloatType);
		this.bloomD = makeRT(w / 4, h / 4, THREE.HalfFloatType);

		this.finalMat.uniforms.uResolution.value.set(w, h);
		this.fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
		this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);

		this.ldrRT.texture.colorSpace = THREE.SRGBColorSpace;
		this.reflectionCamera.aspect = width / height;
		this.reflectionCamera.updateProjectionMatrix();
	}

	fsPass(material, target, clear = true) {
		this.fsQuad.material = material;
		this.renderer.setRenderTarget(target);
		this.renderer.autoClear = clear;
		this.renderer.render(this.fsScene, this.fsCamera);
	}

	renderScene(scene, camera, sky) {
		this.renderer.shadowMap.needsUpdate = true;
		this.renderer.setRenderTarget(this.sceneRT);
		this.renderer.autoClear = true;
		this.renderer.setClearColor(0x000000, 1);
		this.renderer.render(scene, camera);
	}

	updateReflectionCamera(camera, level, sky) {
		const normal = new THREE.Vector3(0, 1, 0);
		const mirror = new THREE.Vector3(0, level, 0);
		const camPos = camera.position;
		const view = mirror.clone().sub(camPos);
		if (view.dot(normal) > -0.01) return false;

		const virtualPos = view.clone().reflect(normal).negate().add(mirror);
		const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
		const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(camPos);
		const target = mirror.clone().sub(lookAt).reflect(normal).negate().add(mirror);

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
		if (!this.updateReflectionCamera(camera, level, sky)) return;
		const oldClipping = this.renderer.clippingPlanes;
		this.renderer.clippingPlanes = [this.clipPlane];
		// sky first, unclipped, so the reflection never shows a hole at the horizon
		// The direct sun disc is dimmed in the mirror; the glitter path is
		// produced by the water's specular lobe instead of a blown-out blob.
		const sunDisc = sky.uniforms.uSunDisc.value;
		sky.uniforms.uSunDisc.value = 0.12;
		this.renderer.setRenderTarget(this.reflectionRT);
		this.renderer.autoClear = true;
		this.renderer.clear();
		this.renderer.render(sky.skyScene, this.reflectionCamera);
		sky.uniforms.uSunDisc.value = sunDisc;
		sky.mesh.visible = false;
		this.renderer.autoClear = false;
		this.renderer.render(scene, this.reflectionCamera);
		sky.mesh.visible = true;
		this.renderer.clippingPlanes = oldClipping;
		this.renderer.autoClear = true;
	}

	renderComposite(scene, waterScene, fxScene, camera) {
		// copy scene colour
		this.copyMat.uniforms.tDiffuse.value = this.sceneRT.texture;
		this.fsPass(this.copyMat, this.compRT, true);
		// water over the copy
		this.renderer.setRenderTarget(this.compRT);
		this.renderer.autoClear = false;
		this.renderer.render(waterScene, camera);
		if (fxScene) this.renderer.render(fxScene, camera);
		this.renderer.autoClear = true;
	}

	post(time, sunScreen) {
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

		this.finalMat.uniforms.tComp.value = this.compRT.texture;
		this.finalMat.uniforms.tBloomA.value = this.bloomA.texture;
		this.finalMat.uniforms.tBloomB.value = this.bloomC.texture;
		this.finalMat.uniforms.uTime.value = time;
		if (sunScreen) this.finalMat.uniforms.uSunScreen.value.copy(sunScreen);
		this.fsPass(this.finalMat, this.ldrRT, true);

		this.fxaaMat.uniforms.tDiffuse.value = this.ldrRT.texture;
		this.fsQuad.material = this.fxaaMat;
		this.renderer.setRenderTarget(null);
		this.renderer.autoClear = true;
		this.renderer.render(this.fsScene, this.fsCamera);
	}
}
