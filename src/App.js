import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine } from './core/Engine.js';
import { TerrainHeight } from './world/TerrainHeight.js';
import { Terrain } from './world/Terrain.js';
import { Landscape } from './world/Landscape.js';
import { Vegetation } from './world/Vegetation.js';
import { Props } from './world/Props.js';
import { Fish } from './life/Fish.js';
import { Food } from './life/Food.js';
import { Throwables } from './life/Throwables.js';
import { PondAudio } from './audio/Audio.js';
import { Sky } from './world/Sky.js';
import { createBedTexture } from './world/BedTexture.js';
import { WaterSim } from './water/WaterSim.js';
import { WaterSurface } from './water/WaterSurface.js';
import { SplashFX } from './fx/Splash.js';
import { RainFX } from './fx/Rain.js';
import { QualityController, QUALITY_PRESETS } from './core/Quality.js';

export class App {
	constructor(canvas) {
		this.canvas = canvas;
		this.time = 0;
		this.frame = 0;
		this.last = performance.now();
		this.fpsSmooth = 60;
		const params = new URLSearchParams(location.search);
		const q = params.get('quality');
		const qualityMode = ['auto', 'low', 'medium', 'high'].includes(q) ? q : 'auto';
		this.quality = new QualityController(qualityMode, 'high');
		this.qualitySettings = this.quality.settings;
		const lowMode = this.quality.tier === 'low';

		this.hf = new TerrainHeight(1337);
		const settings = this.qualitySettings;

		this.engine = new Engine(canvas, {
			...settings,
		});
		this.bedTexture = createBedTexture(this.hf, 512, 20, this.engine.renderer);
		this.scene = new THREE.Scene();
		this.scene.background = null;

		this.sky = new Sky(this.engine.renderer, this.scene);
		this.terrain = new Terrain(this.hf, this.bedTexture, 20);
		this.scene.add(this.terrain.mesh);
		this.landscape = new Landscape(this.hf);
		this.landscape.sunHour = 18.8;
		this.scene.add(this.landscape.group);
		this.vegetation = new Vegetation(this.hf);
		this.scene.add(this.vegetation.group);
		this.props = new Props(this.hf);
		this.scene.add(this.props.group);

		this.sim = new WaterSim(this.engine.renderer, this.hf, this.bedTexture, 20, {
			macroSize: settings.macroSize,
			microSize: settings.microSize,
		});
		this.sim.setWind(0.4, 2.75);
		this.water = new WaterSurface(this.engine, this.sim, this.hf, { res: settings.waterRes });
		// SplashFX draws right after the water mesh, so it must live in the water
		// scene: the water compositing pass paints over anything left in the main
		// scene that sits above the surface.
		this.splash = new SplashFX({ engine: this.engine, sim: this.sim, camera: this.engine.camera, renderer: this.engine.renderer });
		this.water.scene.add(this.splash.group);
		this.fish = new Fish(this.hf, this.sim, lowMode ? { koi: 4, minnow: 14 } : this.quality.tier === 'medium' ? { koi: 5, minnow: 20 } : {});
		this.scene.add(this.fish.group);
		this.throwables = new Throwables(this.hf, this.sim, {
				onSplash: (b, impact, info = {}) => {
					this.fish.startle(b.pos.x, b.pos.z, Math.min(2.6, 0.6 + impact * 3.2));
					this.audio.splash(impact, b.pos.x, b.pos.z, info.type || b.type);
					this.splash.splashAt(b.pos.x, b.pos.z, impact, {
						type: info.type || b.type, radius: info.radius || b.cfg.radius,
						vy: info.vy ?? b.vel.y, height: info.height,
					});
				},
		});
		this.scene.add(this.throwables.group);
		this.food = new Food(this.hf, this.sim, this.fish);
		this.scene.add(this.food.group);
		this.audio = new PondAudio();
		this.audioEnvT = 0;
		const wakeAudio = () => { void this.audio.init(); };
		window.addEventListener('pointerdown', wakeAudio, { once: true });
		window.addEventListener('keydown', wakeAudio, { once: true });
		const dbg = parseFloat(params.get('debug'));
		if (dbg > 0) this.water.uniforms.uDebug.value = dbg;

		this.camera = this.engine.camera;
		this.camera.position.set(10.6, 3.2, 8.6);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.target.set(0, 0.8, 0);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.055;
		this.controls.enablePan = false;
		this.controls.minDistance = 6.5;
		this.controls.maxDistance = 25;
		this.controls.minPolarAngle = 0.18;
		this.controls.maxPolarAngle = 1.495;
		this.controls.rotateSpeed = 0.55;
		this.controls.zoomSpeed = 0.7;
		this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
		this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
		this.controls.autoRotate = true;
		this.controls.autoRotateSpeed = 0.085;
		this.controls.addEventListener('start', () => { this.controls.autoRotate = false; this.userInteracted = true; });
		this.controls.update();

		// Rain gets its own scene, rendered after the water so streaks and impact
		// rings are not refracted or punched through by the manual water depth.
		this.rainFx = new RainFX(this.camera, this.hf, this.sim);
		this.rainScene = new THREE.Scene();
		this.rainScene.add(this.rainFx.group);
		this.sky.onLightning = (delay, intensity) => this.audio.thunder(delay, intensity);
		this._hidden = false;
		this._qualityLast = performance.now();
		this._qualityWarmup = 4;

		this.sunScreen = new THREE.Vector2(0.5, 0.5);
		this.sunVisible = 0;
		this.onResize = this.onResize.bind(this);
		this.onResize();
		window.addEventListener('resize', this.onResize);
		this.onVisibility = this.onVisibility.bind(this);
		document.addEventListener('visibilitychange', this.onVisibility);

		this.sky.setTime(18.8);
		this.terrain.mesh.receiveShadow = true;
		// the hero point light lives in the sky module: park it inside the lantern
		if (this.sky.lantern && this.props.lanternPoint) {
			this.sky.lantern.position.copy(this.props.lanternPoint);
		}

		this.setupInteraction(canvas);
		this._applyQuality(this.qualitySettings, false);

		this.fpsEl = document.getElementById('fps');
		this.simEl = document.getElementById('simstat');
		this.lastStats = 0;
		this.frames = 0;
		this.fpsStart = performance.now();

		this.loop = this.loop.bind(this);
		this._raf = requestAnimationFrame(this.loop);

		setTimeout(() => {
			const loading = document.getElementById('loading');
			const bar = loading?.querySelector('.load-bar span');
			if (bar) bar.style.width = '100%';
			setTimeout(() => loading?.classList.add('done'), 250);
		}, 300);
	}

	onResize() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		const settings = this.qualitySettings || QUALITY_PRESETS.high;
		const dpr = Math.min(window.devicePixelRatio || 1, settings.maxDpr || 1.6) * (settings.scale || 1);
		this.engine.resize(w, h, dpr);
		if (this.water) {
			const u = this.water.uniforms;
			u.uResolution.value.set(this.engine.sceneRT.width, this.engine.sceneRT.height);
		}
	}

	setTime(hour) {
		this.sky.setTime(hour);
		this.sky.setWeather({ cloudCover: this.sky.cloudCover, rain: this.sky.rain });
		const slider = document.getElementById('time-slider');
		if (slider && document.activeElement !== slider) slider.value = String(hour);
		const output = document.getElementById('time-out');
		if (output) output.textContent = this.formatTime(hour);
	}

	setWind(strength, angle) {
		this.sim.setWind(strength, angle);
		this.sky.setWeather({ cloudCover: this.sky.cloudCover, rain: this.sky.rain });
		const slider = document.getElementById('wind-slider');
		if (slider && document.activeElement !== slider) slider.value = String(strength);
		const output = document.getElementById('wind-out');
		if (output) output.textContent = Math.round(strength * 100) + '%';
	}

	setRain(amount) {
		this.sim.setRain(amount);
		this.sky.rain = amount;
		this.sky.setWeather({ cloudCover: Math.min(1, 0.35 + amount * 0.75), rain: amount });
		const slider = document.getElementById('rain-slider');
		if (slider && document.activeElement !== slider) slider.value = String(amount);
		const output = document.getElementById('rain-out');
		if (output) output.textContent = Math.round(amount * 100) + '%';
	}

	formatTime(hour) {
		const h = ((Number(hour) % 24) + 24) % 24;
		const hh = Math.floor(h);
		const mm = Math.round((h - hh) * 60) % 60;
		return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
	}

	setHint(text) {
		const hint = document.getElementById('hint');
		if (hint) hint.textContent = text;
	}

	setPhotoMode(active) {
		const enabled = !!active;
		document.body.classList.toggle('photo', enabled);
		const exit = document.getElementById('photo-exit');
		if (exit) exit.classList.toggle('hidden', !enabled);
		return enabled;
	}

	toggleMute() {
		this.audio.setMuted(!this.audio.muted);
		const button = document.getElementById('sound-btn');
		if (button) {
			button.setAttribute('aria-pressed', String(this.audio.muted));
			button.setAttribute('aria-label', this.audio.muted ? 'Unmute sound' : 'Mute sound');
			button.title = this.audio.muted ? 'Unmute sound (M)' : 'Mute sound (M)';
			button.textContent = this.audio.muted ? '◑' : '◒';
		}
		return this.audio.muted;
	}

	toggleRain() {
		this.setRain(this.sim.rain > 0.01 ? 0 : 0.72);
		return this.sim.rain;
	}

	_applyQuality(settings, resize = true) {
		this.qualitySettings = settings;
		this.engine.setQuality(settings);
		if (this.sim) this.sim.setResolution(settings.macroSize, settings.microSize);
		if (this.water) this.water.setResolution(settings.waterRes);
		if (this.terrain) this.terrain.setSimulationSize(settings.macroSize);
		this.sky?.setQuality(settings);
		this.landscape?.setQuality(settings);
		this.vegetation?.setQuality(settings);
		if (resize) this.onResize();
		const select = document.getElementById('quality-select');
		if (select && document.activeElement !== select) select.value = this.quality.mode === 'auto' ? 'auto' : this.quality.tier;
		return settings;
	}

	setQuality(mode = 'auto') {
		if (!['auto', 'low', 'medium', 'high'].includes(mode)) return this.qualitySettings;
		this.quality.setMode(mode);
		return this._applyQuality(this.quality.settings, true);
	}

	onVisibility() {
		if (document.hidden) {
			this._hidden = true;
			this.cancelPointerInteraction();
			this.sim.resetTiming();
			this.quality.resetTiming();
			void this.audio.suspend();
			return;
		}
		this._hidden = false;
		this.last = performance.now();
		this.sim.resetTiming();
		this.quality.resetTiming();
		void this.audio.resume();
	}

	setupInteraction(canvas) {
		this.mode = 'throw';
		this.selected = 'pebble';
		this.raycaster = new THREE.Raycaster();
		this.pointerNDC = new THREE.Vector2(0, 0);
		this.waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
		this.pointerWorld = new THREE.Vector3();
		this.throwTarget = new THREE.Vector3();
		this.throwOrigin = new THREE.Vector3();
		this.throwVelocityScratch = new THREE.Vector3();
		this.dragging = false;
		this.dragLast = { x: 0, z: 0, t: 0 };
		this.feeding = false;
		this.feedTimer = 0;
		this.pointerInside = false;
		this.activePointers = new Map();
		this.primaryPointerId = null;
		this.multiTouch = false;
		this.charging = false;
		this.chargeStarted = 0;
		this.charge = 0.25;

		const pts = [];
		for (let i = 0; i < 28; i++) pts.push(new THREE.Vector3());
		this.previewPts = pts;
		this.previewGeo = new THREE.BufferGeometry().setFromPoints(pts);
		this.previewMat = new THREE.LineBasicMaterial({
			color: 0xffe6ad, transparent: true, opacity: 0.55, depthTest: false, fog: false,
		});
		this.previewLine = new THREE.Line(this.previewGeo, this.previewMat);
		this.previewLine.frustumCulled = false;
		this.previewLine.renderOrder = 30;
		this.previewLine.visible = false;
		this.scene.add(this.previewLine);
		this.targetMarker = new THREE.Mesh(
			new THREE.RingGeometry(0.075, 0.095, 32),
			new THREE.MeshBasicMaterial({ color: 0xffe6ad, transparent: true, opacity: 0.7, depthTest: false, fog: false, side: THREE.DoubleSide })
		);
		this.targetMarker.rotation.x = -Math.PI / 2;
		this.targetMarker.renderOrder = 31;
		this.targetMarker.visible = false;
		this.water.scene.add(this.targetMarker);

		const updatePointer = (e) => {
			const rect = canvas.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			this.pointerNDC.set(
				((e.clientX - rect.left) / rect.width) * 2 - 1,
				-((e.clientY - rect.top) / rect.height) * 2 + 1
			);
			this.pointerInside = true;
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
		};
		const waterHit = () => {
			this.waterPlane.constant = -(this.sim?.levelOffset || 0);
			this.raycaster.setFromCamera(this.pointerNDC, this.camera);
			const hit = this.raycaster.ray.intersectPlane(this.waterPlane, this.pointerWorld);
			if (!hit || !this.hf.inPond(hit.x, hit.z)) return null;
			const depth = this.sim?.surfaceAt(hit.x, hit.z)?.depth ?? -this.hf.height(hit.x, hit.z);
			return Number.isFinite(depth) && depth > 0.01 ? hit : null;
		};
		this._waterHit = waterHit;

		canvas.addEventListener('pointermove', (e) => {
			updatePointer(e);
			if (this.charging && e.pointerId === this.primaryPointerId) {
				const hit = waterHit();
				if (hit) this.throwTarget.copy(hit);
			}
			if (!this.dragging || this.mode !== 'touch' || e.pointerId !== this.primaryPointerId || this.multiTouch) return;
			const hit = waterHit();
			if (!hit) return;
			const now = performance.now();
			const dt = Math.max(0.008, (now - this.dragLast.t) / 1000);
			const dx = hit.x - this.dragLast.x;
			const dz = hit.z - this.dragLast.z;
			const dist = Math.hypot(dx, dz);
			if (dist > 0.02) {
				const count = Math.min(8, Math.max(1, Math.ceil(dist / 0.12)));
				for (let i = 1; i <= count; i++) {
					const t = i / count;
					this.stirAt(this.dragLast.x + dx * t, this.dragLast.z + dz * t, dx / dt, dz / dt, dist / count);
				}
				this.dragLast.x = hit.x; this.dragLast.z = hit.z; this.dragLast.t = now;
			}
		});
		canvas.addEventListener('pointerleave', () => {
			this.pointerInside = false;
			if (!this.charging) {
				this.previewLine.visible = false;
				this.targetMarker.visible = false;
			}
		});
		canvas.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			if (this.activePointers.size > 0 && !this.activePointers.has(e.pointerId)) {
				this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
				const primary = this.primaryPointerId;
				this.cancelPointerInteraction({ clearPointers: false, release: false });
				this.primaryPointerId = primary;
				this.multiTouch = true;
				return;
			}
			updatePointer(e);
			this.controls.autoRotate = false;
			this.userInteracted = true;
			const hit = waterHit();
			if (!hit) return;
			this.primaryPointerId = e.pointerId;
			try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is unavailable in some test/device contexts */ }
			if (this.mode === 'throw') {
				this.charging = true;
				this.chargeStarted = performance.now();
				this.charge = 0.25;
				this.throwTarget.copy(hit);
			} else if (this.mode === 'touch') {
				this.dragging = true;
				this.dragLast = { x: hit.x, z: hit.z, t: performance.now() };
				this.stirAt(hit.x, hit.z, 0, 0, 0.12);
			} else {
				this.feedAt(hit.x, hit.z);
				this.feeding = true;
				this.feedTimer = 0.4;
			}
		});
		const finish = (e, cancelled = false) => {
			const isPrimary = e.pointerId === this.primaryPointerId;
			if (isPrimary && this.charging) {
				if (!cancelled && !this.multiTouch) {
					const hit = waterHit();
					const target = hit || this.throwTarget;
					this.throwAt(target.x, target.z, this.charge);
				}
				this.cancelPointerInteraction({ clearPointers: false, release: false });
			}
			if (isPrimary) {
				this.dragging = false;
				this.feeding = false;
			}
			this.activePointers.delete(e.pointerId);
			if (this.activePointers.size === 0) {
				this.multiTouch = false;
				this.primaryPointerId = null;
			}
		};
		canvas.addEventListener('pointerup', (e) => finish(e, false));
		canvas.addEventListener('pointercancel', (e) => finish(e, true));
		canvas.addEventListener('lostpointercapture', (e) => finish(e, true));
		window.addEventListener('blur', () => this.cancelPointerInteraction());
	}

	cancelPointerInteraction({ clearPointers = true, release = true } = {}) {
		if (release && this.primaryPointerId !== null) {
			try { this.canvas.releasePointerCapture(this.primaryPointerId); } catch { /* already released */ }
		}
		this.charging = false;
		this.dragging = false;
		this.feeding = false;
		this.charge = 0.25;
		document.getElementById('custom-cursor')?.classList.remove('charge');
		this.previewLine && (this.previewLine.visible = false);
		this.targetMarker && (this.targetMarker.visible = false);
		this.primaryPointerId = null;
		this.multiTouch = false;
		if (clearPointers) this.activePointers.clear();
	}

	setMode(mode) {
		if (!['throw', 'touch', 'feed'].includes(mode)) return;
		this.cancelPointerInteraction();
		this.mode = mode;
		const hints = {
			throw: 'hold to charge · release to throw · right-drag to orbit',
			touch: 'drag through the water · right-drag to orbit',
			feed: 'tap or hold over the water · scatter food for the koi',
		};
		this.setHint(hints[mode]);
	}

	setThrowable(name) { this.selected = name; }

	throwVelocity(target, out, charge = 0.25) {
		const origin = this.throwOrigin.copy(this.camera.position).addScaledVector(
			this.camera.getWorldDirection(this.throwVelocityScratch), 0.55
		);
		origin.y -= 0.1;
		const dx = target.x - origin.x;
		const dz = target.z - origin.z;
		const distXZ = Math.hypot(dx, dz);
		const dy = target.y - origin.y;
		const g = 9.81;
		let speed = 5.4 + THREE.MathUtils.clamp(charge, 0.25, 1) * 2.8;
		out.set(0, 0, 0);
		for (let attempt = 0; attempt < 24; attempt++) {
			const v2 = speed * speed;
			const disc = v2 * v2 - g * (g * distXZ * distXZ + 2 * dy * v2);
			if (disc >= 0 && distXZ > 0.05) {
				const tanTheta = (v2 - Math.sqrt(disc)) / (g * distXZ);
				const theta = Math.atan(tanTheta);
				const horiz = Math.cos(theta) * speed;
				out.set((dx / distXZ) * horiz, Math.sin(theta) * speed, (dz / distXZ) * horiz);
				break;
			}
			speed += 0.5;
		}
		if (out.lengthSq() < 1e-6) out.set(0, Math.max(1.2, speed * 0.35), 0);
		return out;
	}

	throwAt(x, z, charge = 1) {
		if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
		const origin = this.throwOrigin.copy(this.camera.position).addScaledVector(
			this.camera.getWorldDirection(this.throwVelocityScratch), 0.55
		);
		origin.y -= 0.12;
		const surface = this.sim.surfaceAt(x, z);
		const targetY = Number.isFinite(surface?.height) ? surface.height : this.sim.levelOffset;
		const target = new THREE.Vector3(x, targetY - 0.02, z);
		const vel = this.throwVelocity(target, this.throwVelocityScratch, charge);
		return this.throwables.spawn(this.selected, origin, vel, 1.2);
	}

	stirAt(x, z, vx, vz, dist) {
		const drag = Math.min(Math.hypot(vx, vz), 6);
		const amp = -Math.min(0.008 + drag * 0.006 + dist * 0.05, 0.085);
		this.sim.addImpulse({
			x, z,
			radius: 0.16 + Math.min(dist, 0.8) * 0.35,
			amp,
			flowX: vx * 0.25, flowZ: vz * 0.25,
			flowStrength: Math.min(drag * 0.12, 0.6),
			foam: Math.min(0.02 + drag * 0.02, 0.09),
			microScale: 1.6,
		});
		this.fish.startle(x, z, Math.min(1.4, 0.3 + drag * 0.18));
		this.audio.stir(drag, x, z);
	}

	feedAt(x, z) {
		this.food.sprinkle(x, z, 7 + Math.floor(Math.random() * 5), 0.42);
		this.fish.feed(x, z);
		this.audio.plop(x, z);
	}

	updateAimPreview() {
		if (this.mode !== 'throw' || !this.pointerInside) {
			this.previewLine.visible = false;
			this.targetMarker.visible = false;
			return;
		}
		const hit = this._waterHit ? this._waterHit() : null;
		if (!hit) {
			this.previewLine.visible = false;
			this.targetMarker.visible = false;
			return;
		}
		const origin = this.camera.position.clone().addScaledVector(
			this.camera.getWorldDirection(new THREE.Vector3()), 0.55
		);
		origin.y -= 0.12;
		const targetHeight = this.sim.surfaceAt(hit.x, hit.z)?.height ?? this.sim.levelOffset;
		const target = new THREE.Vector3(hit.x, targetHeight - 0.02, hit.z);
		const charge = this.charging ? this.charge : 0.25;
		const vel = this.throwVelocity(target, new THREE.Vector3(), charge);
		const g = 9.81;
		const pts = this.previewPts;
		const attr = this.previewGeo.attributes.position;
		for (let i = 0; i < pts.length; i++) {
			const t = (i / (pts.length - 1)) * 1.7;
			pts[i].set(
				origin.x + vel.x * t,
				origin.y + vel.y * t - 0.5 * g * t * t,
				origin.z + vel.z * t
			);
			attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
		}
		attr.needsUpdate = true;
		this.previewGeo.computeBoundingSphere();
		this.previewLine.visible = true;
		this.targetMarker.position.set(hit.x, targetHeight + 0.012, hit.z);
		this.targetMarker.scale.setScalar(0.9 + charge * 0.35);
		this.targetMarker.visible = true;
	}

	updateFeedHold(dt) {
		if (!this.feeding || this.mode !== 'feed') return;
		this.feedTimer -= dt;
		if (this.feedTimer > 0) return;
		this.feedTimer = 0.5;
		const hit = this._waterHit ? this._waterHit() : null;
		if (hit) this.feedAt(hit.x, hit.z);
	}

	updateChargeState() {
		if (!this.charging) return;
		const elapsed = Math.max(0, (performance.now() - this.chargeStarted) / 1000);
		this.charge = THREE.MathUtils.clamp(0.25 + elapsed * 0.72, 0.25, 1);
		const cursor = document.getElementById('custom-cursor');
		if (cursor) {
			cursor.classList.add('charge');
			cursor.style.setProperty('--charge', String(this.charge));
		}
	}

	updateSunScreen() {
		const cam = this.camera;
		const dir = this.sky.state.sunDir;
		const p = new THREE.Vector3().copy(cam.position).addScaledVector(dir, 300);
		const projected = p.clone().project(cam);
		const forward = new THREE.Vector3();
		cam.getWorldDirection(forward);
		const facing = forward.dot(dir);
		this.sunScreen.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
		this.sunVisible = THREE.MathUtils.clamp((facing - 0.05) * 5, 0, 1) * this.sky.state.sunIntensity * 0.25;
	}

	loop(now) {
		this._raf = requestAnimationFrame(this.loop);
		if (this._hidden) {
			this.last = now;
			return;
		}
		const dt = Math.min((now - this.last) / 1000, 0.05);
		this.last = now;
		this.time += dt;
		this.frame++;
		this.engine.beginFrame();

		this.controls.update(dt);
		// keep the camera from dipping below the water surface
		if (this.camera.position.y < 0.55) this.camera.position.y = 0.55;

		this.sim.update(dt, this.time);
		this.sky.update(dt, this.camera);
		this.terrain.update(dt, this.time, this.sim.macroTexture, this.sim.microTexture, this.sky.state, this.sim.wind.clone().multiplyScalar(this.sim.windStrength));
		this.vegetation.uniforms.uWindPower.value = this.sim.windStrength;
		this.vegetation.update(dt, this.time);
		this.landscape.windUniforms.uWindTime.value = this.time;
		this.landscape.windUniforms.uWindPower.value = this.sim.windStrength;
		this.landscape.windUniforms.uWindDir.value.copy(this.sim.wind);
		this.throwables.update(dt, this.time);
		this.fish.update(dt, this.time);
		this.props.update(dt, this.time, this.sim);
		this.water.update(this.time, this.sky.state);
		this.splash.update(dt, this.time);
		this.food.update(dt, this.time);
		this.rainFx.update(dt, this.time, {
			rain: this.sim.rain,
			wind: this.sim.wind,
			windStrength: this.sim.windStrength,
			night: this.sky.state.night,
			flash: this.sky.uniforms.uFlash.value,
		});
		this.updateFeedHold(dt);
		this.updateChargeState();
		this.updateAimPreview();
		this.audio.setListener(this.camera);
		this.audioEnvT -= dt;
		if (this.audioEnvT <= 0) {
			this.audioEnvT = 0.5;
			this.audio.setEnvironment({
				night: this.sky.state.night,
				rain: this.sim.rain,
				wind: this.sim.windStrength,
			});
		}
		this.audio.tick(dt);
		this.updateSunScreen();

		this.engine.renderScene(this.scene, this.camera, this.sky);
		this.engine.renderReflection(this.scene, this.camera, this.sky, this.sim.levelOffset);
		this.engine.renderComposite(this.scene, this.water.scene, this.rainScene, this.camera);
		this.engine.finalMat.uniforms.uSunVisible.value = this.sunVisible;
		this.engine.finalMat.uniforms.uExposure.value = 1.06 - this.sky.storm * 0.20;
		this.engine.post(this.time, this.sunScreen);
		this.engine.endFrame();

		this.frames++;
		const nowMs = performance.now();
		if (nowMs - this.fpsStart > 600) {
			const fps = this.frames * 1000 / (nowMs - this.fpsStart);
			this.fpsSmooth += (fps - this.fpsSmooth) * 0.4;
			this.frames = 0;
			this.fpsStart = nowMs;
			if (this.fpsEl) this.fpsEl.textContent = Math.round(fps);
			if (this.simEl) this.simEl.textContent = `sim ${this.sim.macroSize}² · ${this.sim.microSize}² · rb ${this.sim.readbackCount}`;
			if (this.quality.mode === 'auto' && this.quality.update(this.fpsSmooth, (nowMs - this._qualityLast) / 1000)) {
				this._applyQuality(this.quality.settings, true);
			}
			this._qualityLast = nowMs;
		}
	}

	getStats() {
		const frameStats = this.engine.frameStats || {};
		const diagnostics = this.sim.getDiagnostics ? this.sim.getDiagnostics() : {};
		return {
			fps: this.fpsSmooth,
			readback: this.sim.readbackCount,
			hasReadback: this.sim.hasReadback,
			steps: this.sim.totalSteps,
			type: String(this.sim.stateType),
			triangles: frameStats.triangles ?? this.engine.renderer.info.render.triangles,
			calls: frameStats.calls ?? this.engine.renderer.info.render.calls,
			fish: this.fish.fish.length,
			bodies: this.throwables.bodies.length,
			pellets: this.food.pellets.length,
			mode: this.mode,
			quality: this.quality.tier,
			qualityMode: this.quality.mode === 'auto' ? 'auto' : 'manual',
			macroSize: this.sim.macroSize,
			microSize: this.sim.microSize,
			waterRes: this.water.res,
			readbackLatency: Number.isFinite(this.sim.readbackLatency) ? this.sim.readbackLatency : 0,
			timings: frameStats.timings || this.engine.timings,
			gpuTimings: frameStats.gpuTimings || this.engine.gpuTimings,
			frameStats,
			diagnostics,
		};
	}
}
