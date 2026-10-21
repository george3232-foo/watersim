// Fully procedural pond ambience and interaction sounds: no samples, only
// oscillators and filtered noise. The context is created on the first gesture
// so browsers allow playback.
import { computeSpatialAudio } from './Spatial.js';
export { computeSpatialAudio } from './Spatial.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export class PondAudio {
	constructor() {
		this.ctx = null;
		this.ready = false;
		this.muted = false;
		this.environment = { night: 0, rain: 0, wind: 0.3 };
		this.nextBird = 2;
		this.nextFrog = 3;
		this.suspended = false;
		this.disposed = false;
		this.listener = { x: 0, y: 0, z: 0, rightX: 1, rightY: 0, rightZ: 0 };
		this.hasListener = false;
		this._spatial = { pan: 0, gain: 1, distance: 0 };
		this._sources = new Map();
		this._timers = new Set();
		this._lastStir = -Infinity;
		this._lifecycle = 0;
	}

	async init() {
		if (this.disposed) return false;
		if (this.ctx) return this.resume();
		const AC = globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
		if (!AC) return false;
		let ctx;
		try { ctx = new AC(); } catch { return false; }
		this.ctx = ctx;
		this.master = ctx.createGain();
		this.master.gain.value = this.muted ? 0 : 0.72;
		this.master.connect(ctx.destination);

		// shared noise buffer (2 s of brown-ish noise)
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		let last = 0;
		for (let i = 0; i < len; i++) {
			const white = Math.random() * 2 - 1;
			last = (last + 0.035 * white) / 1.035;
			data[i] = last * 3.2;
		}
		this.noiseBuf = buf;

		// wind: looping noise through a lowpass with a slow LFO
		const wind = ctx.createBufferSource();
		wind.buffer = buf; wind.loop = true;
		const windFilter = ctx.createBiquadFilter();
		windFilter.type = 'lowpass'; windFilter.frequency.value = 380; windFilter.Q.value = 0.4;
		const windGain = ctx.createGain(); windGain.gain.value = 0;
		const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
		const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
		lfo.connect(lfoGain).connect(windFilter.frequency);
		wind.connect(windFilter).connect(windGain).connect(this.master);
		this._trackSource(wind, [wind, windFilter, windGain], true);
		this._trackSource(lfo, [lfo, lfoGain], true);
		wind.start(); lfo.start();
		this.windGain = windGain;

		// water lapping: bandpassed noise, very quiet
		const lap = ctx.createBufferSource();
		lap.buffer = buf; lap.loop = true;
		const lapFilter = ctx.createBiquadFilter();
		lapFilter.type = 'bandpass'; lapFilter.frequency.value = 480; lapFilter.Q.value = 1.2;
		const lapGain = ctx.createGain(); lapGain.gain.value = 0.02;
		lap.connect(lapFilter).connect(lapGain).connect(this.master);
		this._trackSource(lap, [lap, lapFilter, lapGain], true);
		lap.start();
		this.lapGain = lapGain;

		// rain hiss
		const rain = ctx.createBufferSource();
		rain.buffer = buf; rain.loop = true;
		const rainFilter = ctx.createBiquadFilter();
		rainFilter.type = 'highpass'; rainFilter.frequency.value = 1800;
		const rainGain = ctx.createGain(); rainGain.gain.value = 0;
		rain.connect(rainFilter).connect(rainGain).connect(this.master);
		this._trackSource(rain, [rain, rainFilter, rainGain], true);
		rain.start();
		this.rainGain = rainGain;

		// body of the downpour: a low roar under the hiss
		const rainLow = ctx.createBufferSource();
		rainLow.buffer = buf; rainLow.loop = true;
		const rainLowFilter = ctx.createBiquadFilter();
		rainLowFilter.type = 'lowpass'; rainLowFilter.frequency.value = 520; rainLowFilter.Q.value = 0.5;
		const rainLowGain = ctx.createGain(); rainLowGain.gain.value = 0;
		rainLow.connect(rainLowFilter).connect(rainLowGain).connect(this.master);
		this._trackSource(rainLow, [rainLow, rainLowFilter, rainLowGain], true);
		rainLow.start();
		this.rainLowGain = rainLowGain;

		this.ready = true;
		this.setEnvironment(this.environment);
		return this.resume();
	}

	setListener(camera) {
		this.hasListener = !!camera;
		if (!camera) return;
		if (camera.updateWorldMatrix) camera.updateWorldMatrix(true, false);
		const e = camera.matrixWorld?.elements;
		const listener = this.listener;
		if (e) {
			listener.x = finite(e[12]); listener.y = finite(e[13]); listener.z = finite(e[14]);
			listener.rightX = finite(e[0], 1); listener.rightY = finite(e[1]); listener.rightZ = finite(e[2]);
		} else {
			listener.x = finite(camera.position?.x); listener.y = finite(camera.position?.y); listener.z = finite(camera.position?.z);
			const q = camera.quaternion;
			const x = finite(q?.x), y = finite(q?.y), z = finite(q?.z), w = finite(q?.w, 1);
			listener.rightX = 1 - 2 * (y * y + z * z);
			listener.rightY = 2 * (x * y + w * z);
			listener.rightZ = 2 * (x * z - w * y);
		}
	}

	spatialAt(x = 0, z = 0, out = this._spatial) {
		return computeSpatialAudio(this.hasListener ? this.listener : null, x, z, out);
	}

	_canPlay() {
		return this.ready && !this.muted && !this.suspended && !this.disposed && this.ctx.state === 'running';
	}

	_trackSource(source, nodes, loop = false) {
		// A pathological event stream still has a finite live-voice budget.
		if (this._sources.size >= 96) {
			for (const [oldSource, record] of this._sources) {
				if (!record.loop) { this._stopSource(oldSource); break; }
			}
		}
		this._sources.set(source, { nodes, loop });
		source.onended = () => this._releaseSource(source);
	}

	_releaseSource(source) {
		const record = this._sources.get(source);
		if (!record) return;
		source.onended = null;
		for (const node of record.nodes) node.disconnect();
		this._sources.delete(source);
	}

	_stopSource(source) {
		try { source.stop(); } catch { /* Already stopped or not started. */ }
		this._releaseSource(source);
	}

	_stopTransient() {
		for (const [source, record] of this._sources) if (!record.loop) this._stopSource(source);
		for (const timer of this._timers) clearTimeout(timer);
		this._timers.clear();
	}

	_schedule(callback, delay) {
		if (!this._canPlay()) return;
		const timer = setTimeout(() => {
			this._timers.delete(timer);
			if (this._canPlay()) callback();
		}, delay);
		this._timers.add(timer);
	}

	_connectEvent(node, pan) {
		if (pan === null || !this.ctx.createStereoPanner) { node.connect(this.master); return null; }
		const panner = this.ctx.createStereoPanner();
		panner.pan.value = Math.max(-1, Math.min(1, finite(pan)));
		node.connect(panner).connect(this.master);
		return panner;
	}

	_applyMaster() {
		if (!this.master || !this.ctx) return;
		const gain = this.master.gain, t = this.ctx.currentTime;
		gain.cancelScheduledValues(t);
		if (this.muted || this.suspended || this.disposed) gain.setValueAtTime(0, t);
		else gain.setTargetAtTime(0.72, t, 0.03);
	}

	async suspend() {
		this.suspended = true;
		this._lifecycle++;
		this._applyMaster();
		this._stopTransient();
		if (!this.ctx || this.disposed) return false;
		try { if (this.ctx.state !== 'closed') await this.ctx.suspend(); } catch { return false; }
		return true;
	}

	async resume() {
		if (!this.ctx || this.disposed || this.ctx.state === 'closed') return false;
		const request = ++this._lifecycle;
		this.suspended = false;
		this._lastStir = -Infinity;
		try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch { this.suspended = true; this._applyMaster(); return false; }
		if (this.disposed || request !== this._lifecycle) return false;
		this._applyMaster();
		return this.ctx.state === 'running';
	}

	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.ready = false;
		this.suspended = true;
		this._lifecycle++;
		this._applyMaster();
		this._stopTransient();
		for (const source of this._sources.keys()) this._stopSource(source);
		if (this.master) this.master.disconnect();
		const ctx = this.ctx;
		this.ctx = null;
		this.master = this.noiseBuf = this.windGain = this.lapGain = this.rainGain = this.rainLowGain = null;
		try { if (ctx && ctx.state !== 'closed') await ctx.close(); } catch { /* Resources have already been disconnected. */ }
	}

	setEnvironment(env = {}) {
		for (const key of ['night', 'rain', 'wind']) {
			if (Number.isFinite(env[key])) this.environment[key] = clamp01(env[key]);
		}
		if (!this.ready) return;
		const t = this.ctx.currentTime;
		const wind = 0.03 + this.environment.wind * 0.145;
		this.windGain.gain.setTargetAtTime(wind, t, 1.5);
		this.rainGain.gain.setTargetAtTime(this.environment.rain * 0.20, t, 1.0);
		this.rainLowGain.gain.setTargetAtTime(this.environment.rain * 0.13, t, 1.4);
		this.lapGain.gain.setTargetAtTime(0.018 + this.environment.wind * 0.015, t, 2.0);
	}

	setMuted(m) {
		this.muted = !!m;
		this._applyMaster();
		if (this.muted) this._stopTransient();
	}

	// short filtered noise burst
	burst({ freq = 700, q = 1, dur = 0.3, gain = 0.2, sweep = 0, type = 'bandpass', pan = null, attenuation = 1 }) {
		if (!this._canPlay()) return;
		dur = Math.max(0.03, Math.min(8, finite(dur, 0.3)));
		gain = Math.max(0, Math.min(2, finite(gain))) * clamp01(finite(attenuation, 1));
		if (gain <= 0.0001) return;
		freq = Math.max(30, Math.min(18000, finite(freq, 700)));
		sweep = finite(sweep);
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.setValueAtTime(freq, t);
		if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
		f.Q.value = Math.max(0.01, Math.min(24, finite(q, 1)));
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g);
		const panner = this._connectEvent(g, pan);
		this._trackSource(src, panner ? [src, f, g, panner] : [src, f, g]);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	// sine blip with optional pitch slide — used for plops and bubbles
	blip({ f0 = 300, f1 = 140, dur = 0.18, gain = 0.18, type = 'sine', pan = null, attenuation = 1 }) {
		if (!this._canPlay()) return;
		dur = Math.max(0.025, Math.min(4, finite(dur, 0.18)));
		gain = Math.max(0, Math.min(2, finite(gain))) * clamp01(finite(attenuation, 1));
		if (gain <= 0.0001) return;
		f0 = Math.max(30, Math.min(18000, finite(f0, 300)));
		f1 = Math.max(30, Math.min(18000, finite(f1, 140)));
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		const panner = this._connectEvent(g, pan);
		this._trackSource(o, panner ? [o, g, panner] : [o, g]);
		o.start(t);
		o.stop(t + dur + 0.03);
	}

	splash(impact = 0.2, x = 0, z = 0, type = 'default') {
		if (!this._canPlay()) return;
		const k = Math.min(1, 0.25 + Math.max(0, finite(impact, 0.2)) * 2.2);
		const spatial = this.spatialAt(x, z);
		const pan = spatial.pan, attenuation = spatial.gain;
		const leaf = type === 'leaf', pebble = type === 'pebble';
		const floater = type === 'apple' || type === 'duck' || type === 'ball' || type === 'floater';
		const softness = leaf ? 0.14 : (floater ? 0.6 : (pebble ? 0.72 : 1));
		const pitch = leaf ? 1.65 : (pebble ? 1.45 : (floater ? 0.8 : (type === 'stone' ? 0.85 : 1)));
		const tail = leaf ? 0.35 : (pebble ? 0.65 : (floater ? 0.85 : 1));
		this.burst({ freq: (900 + 500 * k) * pitch, q: 0.8, dur: (0.24 + 0.35 * k) * tail, gain: (0.10 + 0.24 * k) * softness, sweep: -700, type: 'bandpass', pan, attenuation });
		if (!leaf) this.burst({ freq: 2600 * pitch, q: 0.6, dur: (0.12 + 0.15 * k) * tail, gain: (0.05 + 0.12 * k) * softness, sweep: -1200, type: 'highpass', pan, attenuation });
		this.blip({ f0: (170 - 40 * k) * pitch, f1: 60 * pitch, dur: 0.22 * tail, gain: (0.10 + 0.16 * k) * softness * (pebble ? 0.5 : 1), pan, attenuation });
	}

	// Rolling thunder: a filtered noise body with a short sharp crack for close
	// strikes. `delay` is the sound travel time from the flash.
	thunder(delay = 0, intensity = 0.8) {
		if (!this._canPlay()) return;
		delay = Math.max(0, Math.min(30, finite(delay)));
		intensity = clamp01(finite(intensity, 0.8));
		if (delay > 0.01) {
			this._schedule(() => this.thunder(0, intensity), delay * 1000);
			return;
		}
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const k = Math.min(1, Math.max(0, intensity));
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		src.loop = true;
		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.setValueAtTime(110 + 80 * k, t);
		lp.frequency.exponentialRampToValueAtTime(48, t + 4.0);
		lp.Q.value = 0.7;
		const g = ctx.createGain();
		const peak = 0.15 + 0.24 * k;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(peak, t + 0.22 + (1 - k) * 0.5);
		g.gain.exponentialRampToValueAtTime(peak * 0.55, t + 1.3);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 5.2 + k * 2.4);
		src.connect(lp).connect(g).connect(this.master);
		this._trackSource(src, [src, lp, g]);
		src.start(t, Math.random() * 1.4);
		src.stop(t + 8);

		// sub-bass pressure wave
		const o = ctx.createOscillator();
		o.type = 'sine';
		o.frequency.setValueAtTime(52, t);
		o.frequency.exponentialRampToValueAtTime(34, t + 1.6);
		const og = ctx.createGain();
		og.gain.setValueAtTime(0.0001, t);
		og.gain.exponentialRampToValueAtTime(0.06 + 0.10 * k, t + 0.12);
		og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
		o.connect(og).connect(this.master);
		this._trackSource(o, [o, og]);
		o.start(t);
		o.stop(t + 2.4);

		// close strike: a bright tearing crack before the rumble
		if (k > 0.6) {
			this.burst({ freq: 1500, q: 0.45, dur: 0.55, gain: 0.10 + 0.16 * k, sweep: -1200, type: 'lowpass' });
			this._schedule(() => this.burst({ freq: 700, q: 0.6, dur: 1.2, gain: 0.08 * k, sweep: -450, type: 'lowpass' }), 260);
		}
	}

	stir(speed = 1, x = 0, z = 0) {
		if (!this._canPlay() || !Number.isFinite(speed) || speed <= 0) return false;
		const now = this.ctx.currentTime;
		if (now - this._lastStir < 0.08 - 1e-6) return false;
		this._lastStir = now;
		const k = clamp01(speed / 3);
		const spatial = this.spatialAt(x, z);
		this.burst({ freq: 420 + 220 * k, q: 1.3, dur: 0.16 + 0.12 * k, gain: 0.03 + 0.08 * k, sweep: 260, type: 'bandpass', pan: spatial.pan, attenuation: spatial.gain });
		return true;
	}

	plop(x = 0, z = 0) {
		const spatial = this.spatialAt(x, z);
		this.blip({ f0: 520, f1: 190, dur: 0.1, gain: 0.07, pan: spatial.pan, attenuation: spatial.gain });
	}

	bubble() {
		this.blip({ f0: 380 + Math.random() * 500, f1: 700 + Math.random() * 600, dur: 0.07, gain: 0.03 });
	}

	chirp() {
		if (!this._canPlay()) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const n = 2 + Math.floor(Math.random() * 3);
		for (let i = 0; i < n; i++) {
			const o = ctx.createOscillator();
			o.type = 'sine';
			const f0 = 2200 + Math.random() * 1900;
			o.frequency.setValueAtTime(f0, t + i * 0.075);
			o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.4), t + i * 0.075 + 0.05);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t + i * 0.075);
			g.gain.exponentialRampToValueAtTime(0.02 + Math.random() * 0.015, t + i * 0.075 + 0.008);
			g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.075 + 0.07);
			o.connect(g).connect(this.master);
			this._trackSource(o, [o, g]);
			o.start(t + i * 0.075);
			o.stop(t + i * 0.075 + 0.09);
		}
	}

	frog() {
		this.blip({ f0: 160, f1: 95, dur: 0.14, gain: 0.05, type: 'square' });
		this._schedule(() => this.blip({ f0: 140, f1: 88, dur: 0.12, gain: 0.04, type: 'square' }), 160);
	}

	tick(dt) {
		if (!this._canPlay() || !Number.isFinite(dt) || dt <= 0) return;
		dt = Math.min(dt, 1);
		this.nextBird -= dt;
		this.nextFrog -= dt;
		const day = 1 - this.environment.night;
		if (this.nextBird <= 0) {
			this.nextBird = 4 + Math.random() * 9;
			if (day > 0.35 && this.environment.rain < 0.6) this.chirp();
		}
		if (this.nextFrog <= 0) {
			this.nextFrog = 3 + Math.random() * 7;
			if (this.environment.night > 0.4 && this.environment.rain < 0.5) this.frog();
		}
		if (Math.random() < dt * 0.25) this.bubble();
	}
}
