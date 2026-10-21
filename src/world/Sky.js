import * as THREE from 'three';
import { clamp, smoothstep } from '../core/Noise.js';

const DEG = Math.PI / 180;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always on the far plane
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uMoonColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uCover;
uniform float uNight;
uniform float uSunIntensity;
uniform float uSunDisc;
uniform float uHaze;
uniform float uStorm;
uniform float uFlash;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  mat2 R = mat2(0.8,0.6,-0.6,0.8);
  for(int i=0;i<5;i++){ s += a*vnoise(p); p = R*p*2.03 + 7.1; a *= 0.5; }
  return s;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);

  // base gradient: a deep zenith over a warm, hazy horizon
  vec3 col = mix(uHorizon, uZenith, pow(clamp(hp, 0.0, 1.0), 0.78));
  // Storm light: crush and desaturate the sky before the clouds are drawn so
  // every layer stays in the same gloomy key.
  col *= mix(1.0, 0.46, uStorm);
  col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.68, 0.78, 0.80), uStorm * 0.52);
  col = mix(col, uHorizon * vec3(1.02, 0.94, 0.82), exp(-hp * 28.0) * 0.34 * (1.0 - uStorm * 0.90) * (1.0 - uNight));
  // faint cool band just above the horizon, opposite the sun
  float anti = clamp(-dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
  col = mix(col, uZenith * 0.9, exp(-hp * 7.0) * anti * 0.16);

  // sun halo and disc
  float mu = max(dot(d, normalize(uSunDir)), 0.0);
  float glow = pow(mu, 3.0) * 0.035 + pow(mu, 26.0) * 0.11 + pow(mu, 200.0) * 0.55;
  col += uSunColor * glow * uSunIntensity;
  float disc = smoothstep(0.99972, 0.99987, mu);
  col += uSunColor * disc * 16.0 * uSunIntensity * uSunDisc;

  // cumulus + high cloud, projected on a sky plane
  if (h > 0.004) {
    vec2 cuv = d.xz / (h + 0.125) * 0.52;
    vec2 drift = vec2(uTime * 0.0016, uTime * 0.0008);
    vec2 warp = vec2(fbm(cuv * 0.5 + 3.2), fbm(cuv * 0.5 - 4.7));
    float base = fbm(cuv * 1.02 + warp * 0.48 + drift);
    float detail = fbm(cuv * 3.05 + warp * 1.5 - drift * 1.4);
    float n = base * 0.78 + detail * 0.22;
    float thr = mix(0.665, 0.33, clamp(uCover, 0.0, 1.0));
    float cov = smoothstep(thr, thr + 0.11, n);
    cov *= smoothstep(0.0, 0.055, h);
    cov *= 0.92;

    float sunSide = clamp(dot(normalize(vec3(d.x, 0.30, d.z)), normalize(uSunDir)), 0.0, 1.0);
    vec3 shade = mix(uZenith * 0.38, uHorizon * 0.16, 0.42);
    shade *= 1.0 - uStorm * 0.50;
    vec3 cloudLight = mix(uSunColor * 0.92, uMoonColor * 0.055, uNight);
    vec3 lit = mix(uHorizon * 0.68, cloudLight, clamp(pow(sunSide, 1.4) * 0.8 + 0.12, 0.0, 1.0));
    lit *= 1.0 - uStorm * 0.68;
    vec3 cloud = mix(shade, lit, 0.38 + 0.34 * (1.0 - cov) + 0.22 * sunSide);
    // silver rim towards the sun
    cloud += uSunColor * pow(mu, 14.0) * 0.22 * (1.0 - cov) * (1.0 - uStorm * 0.9) * (1.0 - uNight);
    cloud = mix(cloud, uZenith * 0.65, 0.16);
    cloud *= 1.0 - uStorm * 0.52;
    col = mix(col, cloud, cov * (0.80 - 0.25 * uNight));

    // thin high cirrus streaks
    vec2 cuv2 = d.xz / (h + 0.22);
    float cir = fbm(vec2(cuv2.x * 1.9, cuv2.y * 7.5) + vec2(uTime * 0.0025, 0.0));
    float cirCov = smoothstep(0.575, 0.73, cir) * smoothstep(0.03, 0.30, h) * (0.23 - 0.10 * uCover);
    vec3 cirLight = mix(uSunColor * 0.62, uMoonColor * 0.035, uNight);
    vec3 cirCol = mix(uHorizon * 0.55, cirLight, clamp(pow(mu, 2.0) * 0.6, 0.0, 1.0));
    col = mix(col, cirCol, max(cirCov, 0.0) * 0.65);
  }

  // stars and the moon at night
  if (uNight > 0.005) {
    float clearNight = uNight * (1.0 - uCover * 0.78) * (1.0 - uStorm * 0.92);
    float moonNight = uNight * (1.0 - uCover * 0.35) * (1.0 - uStorm * 0.72);
    vec3 sp = d * 210.0;
    vec3 cell = floor(sp);
    float r = hash31(cell);
    vec3 fp = fract(sp) - 0.5;
    float star = (1.0 - smoothstep(0.0, 0.055, length(fp))) * step(0.9925, r);
    star *= 0.35 + 0.65 * hash31(cell + 9.1);
    float tw = 0.72 + 0.28 * sin(uTime * 1.7 + r * 40.0);
    float horizonFade = smoothstep(0.02, 0.25, h);
    col += vec3(0.78, 0.86, 1.0) * star * tw * clearNight * 1.9 * horizonFade;
    float band = exp(-pow((dot(d, normalize(vec3(0.2, 0.25, -0.94)))) / 0.16, 2.0));
    col += vec3(0.10, 0.12, 0.19) * band * clearNight * horizonFade * (0.22 + 0.5 * fbm(d.xz * 5.0 + 3.0));

    float mm = max(dot(d, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.99972, 0.99987, mm);
    col += uMoonColor * moonDisc * 15.0 * moonNight;
    col += uMoonColor * pow(mm, 280.0) * 0.22 * moonNight;
    col += uMoonColor * pow(mm, 12.0) * 0.045 * moonNight;
  }

  // below the horizon: a dark, hazy ground tone (mostly covered by landscape)
  col = mix(col, uGround * (1.0 - uStorm * 0.35), 1.0 - smoothstep(-0.09, 0.0, h));

  // Lightning: a cold blue-white sheet behind the cloud deck, plus a hot core
  // near the strike. The exposure is deliberately short and cold.
  if (uFlash > 0.001) {
    float bolt = exp(-pow((h - 0.24) / 0.22, 2.0)) * 0.85 + 0.35;
    col += vec3(0.62, 0.75, 1.0) * uFlash * bolt * 0.42;
  }

  // tiny dither to break up banding in the big gradients
  col += (hash21(gl_FragCoord.xy * 0.71 + fract(uTime) * 13.0) - 0.5) * 0.0025;

  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
	constructor(renderer, scene) {
		this.renderer = renderer;
		this.scene = scene;
		this.hour = 18.8;
		this.cloudCover = 0.22;
		this.rain = 0;
		this.envDirty = true;
		this.envTimer = 0;
		this._env = null;

		this.uniforms = {
			uZenith: { value: new THREE.Color(0x3e77ad) },
			uHorizon: { value: new THREE.Color(0xe2a26b) },
			uGround: { value: new THREE.Color(0x0f1613) },
			uSunColor: { value: new THREE.Color(0xffa368) },
			uMoonColor: { value: new THREE.Color(0xbfd4ff) },
			uSunDir: { value: new THREE.Vector3(0, 0.4, 0.5) },
			uMoonDir: { value: new THREE.Vector3(0.4, 0.6, -0.5) },
			uTime: { value: 0 },
			uCover: { value: 0.22 },
			uNight: { value: 0 },
			uSunIntensity: { value: 1 },
			uSunDisc: { value: 1 },
			uHaze: { value: 0.55 },
			uStorm: { value: 0 },
			uFlash: { value: 0 },
		};

		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: SKY_VERT,
			fragmentShader: SKY_FRAG,
			side: THREE.BackSide,
			depthWrite: false,
			depthTest: false,
			fog: false,
		});
		this.geometry = new THREE.SphereGeometry(500, 48, 24);
		this.mesh = new THREE.Mesh(this.geometry, this.material);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = -1000;
		scene.add(this.mesh);

		this.sun = new THREE.DirectionalLight(0xffd9a8, 5.2);
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		this.sun.shadow.camera.left = -20;
		this.sun.shadow.camera.right = 20;
		this.sun.shadow.camera.top = 20;
		this.sun.shadow.camera.bottom = -20;
		this.sun.shadow.camera.near = 0.5;
		this.sun.shadow.camera.far = 90;
		this.sun.shadow.bias = -0.00035;
		this.sun.shadow.normalBias = 0.018;
		this.sun.shadow.radius = 2.2;
		this.sun.target.position.set(0, 0, 0);
		scene.add(this.sun, this.sun.target);

		// A broad, cool source gives the banks shape at night without another
		// shadow pass. Its direction matches the moon drawn in the sky.
		this.moonLight = new THREE.DirectionalLight(0xb5ccf0, 0);
		this.moonLight.name = 'moon-light';
		this.moonLight.castShadow = false;
		scene.add(this.moonLight, this.moonLight.target);

		this.hemi = new THREE.HemisphereLight(0xbfd7ff, 0x2b2a1e, 0.85);
		scene.add(this.hemi);

		// soft cool skylight from the camera side, to keep near foliage readable
		this.fill = new THREE.DirectionalLight(0xa8c3dc, 1.0);
		this.fill.position.set(14, 9, 14);
		this.fill.target.position.set(0, 0, 0);
		scene.add(this.fill, this.fill.target);

		this.lantern = new THREE.PointLight(0xffb45a, 0.0, 9, 1.7);
		this.lantern.position.set(-2.4, 1.2, 6.8);
		scene.add(this.lantern);

		// Cold, shadowless flash used for lightning. It moves to a random point
		// on the horizon for each strike so the trees and water are lit from the
		// same side as the flash in the sky.
		this.flashLight = new THREE.DirectionalLight(0xcfe0ff, 0);
		this.flashLight.position.set(14, 26, -12);
		scene.add(this.flashLight, this.flashLight.target);

		this.bolt = new THREE.Group();
		this.bolt.name = 'lightning-bolt';
		this.bolt.visible = false;
		scene.add(this.bolt);
		this.boltLife = 0;
		this.lastCamera = null;
		this.boltMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(0.82, 0.98, 1.30),
			transparent: true,
			opacity: 0.95,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		});
		this.boltBranchMat = this.boltMat.clone();
		this.boltBranchMat.opacity = 0.7;
		this.boltCoreMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(2.4, 3.0, 4.0),
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		});
		this.boltGlowMat = new THREE.MeshBasicMaterial({
			color: new THREE.Color(0.24, 0.46, 0.86),
			transparent: true,
			opacity: 0.20,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
		});

		this.previousFog = scene.fog;
		this.fog = new THREE.FogExp2(0xb4916f, 0.0075);
		scene.fog = this.fog;

		this.storm = 0;
		this.flash = 0;
		this.flashPeak = 0;
		this.flashAge = -1;
		this.nextFlash = 4 + Math.random() * 8;
		this.onLightning = null;
		this.baseSun = 4.8;
		this.baseMoon = 0;
		this.baseHemi = 0.78;
		this.baseFill = 0.82;
		this.baseEnv = 0.8;
		this.baseFog = 0.0032;
		this.baseSunState = 0.22;
		this.sunLevel = 1;
		this.baseZen = new THREE.Color(0x3e77ad);
		this.baseHor = new THREE.Color(0xe2a26b);
		this.baseScatter = new THREE.Color(0x17503f);
		this.baseDeep = new THREE.Color(0x072624);

		this.skyScene = new THREE.Scene();
		const envMesh = new THREE.Mesh(this.geometry, this.material);
		envMesh.frustumCulled = false;
		this.skyScene.add(envMesh);
		this.pmrem = new THREE.PMREMGenerator(renderer);
		this.pmrem.compileEquirectangularShader();

		this.state = {
			sunDir: new THREE.Vector3(0, 0.4, 0.5),
			sunColor: new THREE.Color(0xffd9a8),
			sunIntensity: 1,
			skyColor: new THREE.Color(0x4b7cab),
			horizonColor: new THREE.Color(0xe2a26b),
			scatterColor: new THREE.Color(0x0a3d36),
			deepColor: new THREE.Color(0x062c2c),
			night: 0,
			day: 1,
			moonIntensity: 0,
			haze: 0.55,
		};
		this.setTime(this.hour);
		this.setWeather({ cloudCover: this.cloudCover, rain: this.rain });
	}

	sunDirection(hour) {
		const h = ((hour % 24) + 24) % 24;
		let phase;
		if (h >= 6 && h <= 20) {
			// Keep the original daytime composition, especially golden hour.
			phase = Math.PI * (h - 6) / 14;
		} else {
			const t = (h >= 20 ? h - 20 : h + 4) / 10;
			// The shorter night arc matches the daytime angular speed at both
			// horizons. Position AND velocity are continuous, including midnight.
			phase = Math.PI + Math.PI * (t - (2 / 7) * Math.sin(2 * Math.PI * t) / (2 * Math.PI));
		}
		const az = phase;
		const el = Math.sin(phase) * (61 * DEG);
		const ce = Math.cos(el);
		return new THREE.Vector3(ce * Math.cos(az), Math.sin(el), -ce * Math.sin(az)).normalize();
	}

	setTime(hour) {
		this.hour = clamp(hour, 0, 24);
		const sunDir = this.sunDirection(this.hour);
		const sinEl = sunDir.y;
		const day = smoothstep(-0.06, 0.22, sinEl);
		const night = 1 - smoothstep(-0.18, 0.02, sinEl);
		const golden = Math.exp(-Math.pow((sinEl - 0.055) / 0.26, 2)) * (1 - night);

		const dayZen = new THREE.Color(0x2f6cab);
		const dayHor = new THREE.Color(0xbcd4df);
		const goldZen = new THREE.Color(0x1d426f);
		const goldHor = new THREE.Color(0xf6a25f);
		const duskZen = new THREE.Color(0x1a2a47);
		const duskHor = new THREE.Color(0xd17550);
		const nightZen = new THREE.Color(0x071020);
		const nightHor = new THREE.Color(0x172637);

		const zen = new THREE.Color().copy(nightZen);
		const hor = new THREE.Color().copy(nightHor);
		zen.lerp(dayZen, smoothstep(-0.12, 0.25, sinEl));
		zen.lerp(goldZen, golden * 0.6);
		hor.lerp(dayHor, smoothstep(-0.08, 0.35, sinEl));
		hor.lerp(goldHor, golden * 0.82);
		const dusk = clamp((1 - day) * (1 - night) * 0.9, 0, 1);
		zen.lerp(duskZen, dusk);
		hor.lerp(duskHor, dusk);

		const sunColor = new THREE.Color(0xff9d55).lerp(new THREE.Color(0xffe9c8), smoothstep(0.06, 0.60, sinEl));
		const sunIntensity = smoothstep(-0.005, 0.18, sinEl) * (0.62 + 0.38 * smoothstep(0.06, 0.62, sinEl));
		const moonDir = new THREE.Vector3(-0.5, 0.68, -0.54).normalize();
		const ground = new THREE.Color(0x0f1613).lerp(new THREE.Color(0x0a1117), night);

		this.uniforms.uZenith.value.copy(zen);
		this.uniforms.uHorizon.value.copy(hor);
		this.uniforms.uGround.value.copy(ground);
		this.uniforms.uSunColor.value.copy(sunColor);
		this.uniforms.uSunDir.value.copy(sunDir);
		this.uniforms.uMoonDir.value.copy(moonDir);
		this.uniforms.uNight.value = night;
		this.uniforms.uSunIntensity.value = sunIntensity;
		this.uniforms.uHaze.value = 0.38 + golden * 0.42;

		this.sun.position.copy(sunDir).multiplyScalar(45);
		this.sun.color.copy(sunColor);
		this.sun.intensity = 4.8 * sunIntensity;
		this.sun.visible = sunIntensity > 0.002;
		this.moonDir = moonDir;
		this.moonLight.position.copy(moonDir).multiplyScalar(45);
		this.hemi.color.copy(zen).lerp(new THREE.Color(0xbfd7ff), 0.4);
		this.hemi.groundColor.set(0x2b2a1e).lerp(new THREE.Color(0x17242e), night);
		this.lantern.intensity = night * 4.2 + (1 - day) * 2.6;

		this.state.sunDir.copy(sunDir);
		this.state.sunColor.copy(sunColor);
		this.state.sunIntensity = (0.22 + sunIntensity * 4.8) * (1 - night);
		this.state.skyColor.copy(zen);
		this.state.horizonColor.copy(hor);
		this.state.night = night;
		this.state.day = day;
		this.state.haze = this.uniforms.uHaze.value;
		this.state.moonDir = moonDir;
		// the body of the pond: clear green-teal, warmer when the sun is low
		this.state.scatterColor.copy(new THREE.Color(0x17503f)).multiplyScalar(0.55 + day * 0.65);
		this.state.deepColor.copy(new THREE.Color(0x072624)).multiplyScalar(0.55 + day * 0.75);

		// Remember the clear-weather light so weather changes never compound.
		this.baseSun = 4.8 * sunIntensity;
		this.baseMoon = 0.32 * night;
		this.baseHemi = 0.78 * day + 0.18 * night + 0.045;
		this.baseFill = 0.82 * day + 0.06 * night + 0.04;
		this.baseEnv = 0.82 * day + 0.20 * night + 0.05;
		this.baseFog = 0.0032 + night * 0.005;
		this.baseSunState = this.state.sunIntensity;
		this.sunLevel = sunIntensity;
		this.baseZen.copy(zen);
		this.baseHor.copy(hor);
		this.baseScatter.copy(this.state.scatterColor);
		this.baseDeep.copy(this.state.deepColor);

		this.applyWeather();
	}

	applyWeather() {
		const storm = clamp(this.rain * 1.1 + Math.max(0, this.cloudCover - 0.68) * 0.5, 0, 1);
		this.storm = storm;
		this.uniforms.uStorm.value = storm;
		this.uniforms.uSunIntensity.value = this.sunLevel * (1 - storm * 0.92);

		this.sun.intensity = this.baseSun * (1 - storm * 0.84);
		this.sun.visible = this.sun.intensity > 0.02;
		this.moonLight.intensity = this.baseMoon * (1 - this.cloudCover * 0.35) * (1 - storm * 0.72);
		this.moonLight.visible = this.moonLight.intensity > 0.001;
		this.hemi.intensity = this.baseHemi * (1 - storm * 0.48);
		this.fill.intensity = this.baseFill * (1 - storm * 0.6);
		this.scene.environmentIntensity = this.baseEnv * (1 - storm * 0.55);

		this.state.sunIntensity = this.baseSunState * (1 - storm * 0.86);
		this.state.moonIntensity = this.moonLight.intensity;
		this.state.skyColor.copy(this.baseZen).multiplyScalar(1 - storm * 0.58);
		this.state.horizonColor.copy(this.baseHor).multiplyScalar(1 - storm * 0.5);
		this.state.scatterColor.copy(this.baseScatter).multiplyScalar(1 - storm * 0.55);
		this.state.deepColor.copy(this.baseDeep).multiplyScalar(1 - storm * 0.35);
		this.state.storm = storm;

		// Dense, cold haze under the storm. The green-grey keeps the meadow from
		// turning into a flat grey card while the sky is almost monochrome.
		const fogTint = new THREE.Color(0x58645f).lerp(new THREE.Color(0x182939), this.state.night);
		const fogCol = this.baseHor.clone()
			.lerp(fogTint, 0.34 + storm * 0.4)
			.multiplyScalar((0.86 + this.state.day * 0.2) * (1 - storm * 0.32));
		this.fog.color.copy(fogCol);
		this.fog.density = this.baseFog + this.rain * 0.030 + storm * 0.009;
		this.state.fogColor = this.fog.color.clone();
		this.state.fogDensity = this.fog.density;

		this.envDirty = true;
	}

	setWeather({ cloudCover = this.cloudCover, rain = this.rain } = {}) {
		this.cloudCover = clamp(cloudCover, 0, 1);
		this.rain = clamp(rain, 0, 1);
		this.uniforms.uCover.value = this.cloudCover;
		this.applyWeather();
	}

	setQuality(settings = {}) {
		if (!Number.isFinite(settings.shadowSize)) return this;
		const size = settings.shadowSize <= 512 ? 512 : settings.shadowSize <= 1024 ? 1024 : 2048;
		const shadow = this.sun.shadow;
		if (shadow.mapSize.x === size && shadow.mapSize.y === size) return this;
		shadow.dispose();
		shadow.map = null;
		shadow.mapPass = null;
		shadow.mapSize.set(size, size);
		shadow.needsUpdate = true;
		if (this.renderer.shadowMap) this.renderer.shadowMap.needsUpdate = true;
		return this;
	}

	// One jagged, emissive tube per strike. Fog is disabled on the material so
	// the bolt still reads through the storm haze; the flash itself does the
	// atmospheric scattering.
	spawnBolt(azimuth, distance, top = 26 + Math.random() * 8, bottom = 5 + Math.random() * 6) {
		while (this.bolt.children.length) {
			const child = this.bolt.children[0];
			this.bolt.remove(child);
			child.geometry.dispose();
		}

		const rand = (a, b) => a + Math.random() * (b - a);
		const baseX = Math.cos(azimuth) * distance;
		const baseZ = Math.sin(azimuth) * distance;
		const pts = [];
		const n = 17;
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const y = top + (bottom - top) * t;
			const jitter = (1 - Math.abs(t - 0.5) * 1.25) * 3.8;
			pts.push(new THREE.Vector3(
				baseX + rand(-jitter, jitter),
				y,
				baseZ + rand(-jitter, jitter)
			));
		}
		const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.18);
		const geo = new THREE.TubeGeometry(curve, 36, 0.17, 4, false);
		const streak = new THREE.Mesh(geo, this.boltMat);
		streak.renderOrder = 20;
		this.bolt.add(streak);

		// white-hot core inside the channel; blooms slightly in the HDR pass
		const coreGeo = new THREE.TubeGeometry(curve, 36, 0.060, 4, false);
		const core = new THREE.Mesh(coreGeo, this.boltCoreMat);
		core.renderOrder = 21;
		this.bolt.add(core);

		// soft halo around the channel
		const glowGeo = new THREE.TubeGeometry(curve, 28, 0.78, 5, false);
		const glow = new THREE.Mesh(glowGeo, this.boltGlowMat);
		glow.renderOrder = 19;
		this.bolt.add(glow);

		// short branch
		const bi = 4 + ((Math.random() * 4) | 0);
		const branchPts = [pts[bi].clone()];
		const dir = Math.random() < 0.5 ? -1 : 1;
		for (let i = 1; i <= 4; i++) {
			branchPts.push(new THREE.Vector3(
				pts[bi].x + dir * i * rand(0.5, 1.1) + rand(-0.3, 0.3),
				pts[bi].y - i * 0.9,
				pts[bi].z + rand(-0.8, 0.8)
			));
		}
		const branchCurve = new THREE.CatmullRomCurve3(branchPts, false, 'catmullrom', 0.2);
		const branchGeo = new THREE.TubeGeometry(branchCurve, 14, 0.095, 4, false);
		const branch = new THREE.Mesh(branchGeo, this.boltBranchMat);
		branch.renderOrder = 20;
		this.bolt.add(branch);

		this.bolt.visible = true;
		this.boltLife = 0.24;
	}

	// Place the next bolt in the camera's forward view, low enough to appear in
	// the sky gap above the far bank rather than behind the canopy.
	spawnBoltAhead(camera) {
		const fwd = new THREE.Vector3();
		camera.getWorldDirection(fwd);
		const px = camera.position.x + fwd.x * 42;
		const pz = camera.position.z + fwd.z * 42;
		const dist = Math.hypot(px, pz);
		const az = Math.atan2(pz, px);
		const top = camera.position.y + 15 + Math.random() * 5;
		const bottom = camera.position.y + 1.5;
		this.spawnBolt(az, dist, top, bottom);
		return { x: px, z: pz };
	}

	updateBolt(dt) {
		if (this.boltLife <= 0) return;
		this.boltLife -= dt;
		const t = Math.max(0, this.boltLife / 0.24);
		this.boltMat.opacity = 0.95 * t;
		this.boltBranchMat.opacity = 0.7 * t;
		this.boltCoreMat.opacity = t;
		this.boltGlowMat.opacity = 0.20 * t;
		if (this.boltLife <= 0) {
			this.bolt.visible = false;
		}
	}

	update(dt, camera) {
		if (this.disposed) return;
		this.uniforms.uTime.value += dt;
		if (camera) {
			this.lastCamera = camera;
			this.mesh.position.set(camera.position.x, 0, camera.position.z);
		}

		// lightning scheduling: only once the storm is genuinely dark
		if (this.storm > 0.22) {
			this.nextFlash -= dt;
			if (this.nextFlash <= 0) {
				this.nextFlash = 5.5 + Math.random() * 11;
				const intensity = 0.55 + Math.random() * 0.45;
				this.flashPeak = intensity;
				this.flash = intensity;
				this.flashAge = 0;
				const a = Math.random() * Math.PI * 2;
				const dist = 16 + Math.random() * 18;
				let bx = Math.cos(a) * dist;
				let bz = Math.sin(a) * dist;
				if (this.lastCamera) {
					const p = this.spawnBoltAhead(this.lastCamera);
					bx = p.x; bz = p.z;
				} else {
					this.spawnBolt(a, 30 + Math.random() * 22);
				}
				this.flashLight.position.set(bx, 26, bz);
				this.onLightning?.(0.35 + Math.random() * 2.8, intensity);
			}
		}
		if (this.flashAge >= 0) {
			this.flashAge += dt;
			if (this.flashAge < 0.16) {
				this.flash = this.flashPeak * (0.78 + Math.random() * 0.30);
			} else {
				this.flash = Math.max(0, this.flash - dt * 3.4);
			}
			if (this.flash <= 0.001) {
				this.flash = 0;
				this.flashAge = -1;
			}
		}
		const flicker = this.flash > 0.01 ? this.flash * (0.82 + Math.random() * 0.28) : 0;
		this.uniforms.uFlash.value = flicker;
		this.flashLight.intensity = flicker * 1.8;
		this.updateBolt(dt);

		this.envTimer += dt;
		if (this.envDirty && this.envTimer > 0.12) {
			this.envDirty = false;
			this.envTimer = 0;
			this.refreshEnvironment();
		}
	}

	refreshEnvironment() {
		if (this.disposed) return;
		try {
			const env = this.pmrem.fromScene(this.skyScene, 0.035, 0.1, 1000);
			const previous = this._env;
			this._env = env;
			this.scene.environment = env.texture;
			previous?.dispose();
		} catch (e) {
			console.warn('Environment generation failed', e);
		}
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.onLightning = null;
		this.lastCamera = null;
		this.envDirty = false;
		if (this._env && this.scene.environment === this._env.texture) this.scene.environment = null;
		if (this.scene.fog === this.fog) this.scene.fog = this.previousFog;
		this._env?.dispose();
		this._env = null;
		this.pmrem.dispose();
		this.sun.shadow.dispose();
		this.sun.shadow.map = null;
		this.sun.shadow.mapPass = null;
		for (const child of this.bolt.children) child.geometry.dispose();
		this.bolt.clear();
		this.boltMat.dispose();
		this.boltBranchMat.dispose();
		this.boltCoreMat.dispose();
		this.boltGlowMat.dispose();
		this.geometry.dispose();
		this.material.dispose();
		this.skyScene.clear();
		for (const object of [this.mesh, this.sun, this.sun.target, this.moonLight, this.moonLight.target,
			this.hemi, this.fill, this.fill.target, this.lantern, this.flashLight, this.flashLight.target, this.bolt]) {
			object.removeFromParent();
		}
	}
}
