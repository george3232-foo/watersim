// Fully procedural pond ambience and interaction sounds: no samples, only
// oscillators and filtered noise. The context is created on the first gesture
// so browsers allow playback.

export class PondAudio {
	constructor() {
		this.ctx = null;
		this.ready = false;
		this.muted = false;
		this.environment = { night: 0, rain: 0, wind: 0.3 };
		this.nextBird = 2;
		this.nextFrog = 3;
	}

	init() {
		if (this.ctx) return;
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		const ctx = new AC();
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
		wind.start(); lfo.start();
		this.windGain = windGain;

		// water lapping: bandpassed noise, very quiet
		const lap = ctx.createBufferSource();
		lap.buffer = buf; lap.loop = true;
		const lapFilter = ctx.createBiquadFilter();
		lapFilter.type = 'bandpass'; lapFilter.frequency.value = 480; lapFilter.Q.value = 1.2;
		const lapGain = ctx.createGain(); lapGain.gain.value = 0.02;
		lap.connect(lapFilter).connect(lapGain).connect(this.master);
		lap.start();
		this.lapGain = lapGain;

		// rain hiss
		const rain = ctx.createBufferSource();
		rain.buffer = buf; rain.loop = true;
		const rainFilter = ctx.createBiquadFilter();
		rainFilter.type = 'highpass'; rainFilter.frequency.value = 1800;
		const rainGain = ctx.createGain(); rainGain.gain.value = 0;
		rain.connect(rainFilter).connect(rainGain).connect(this.master);
		rain.start();
		this.rainGain = rainGain;

		// body of the downpour: a low roar under the hiss
		const rainLow = ctx.createBufferSource();
		rainLow.buffer = buf; rainLow.loop = true;
		const rainLowFilter = ctx.createBiquadFilter();
		rainLowFilter.type = 'lowpass'; rainLowFilter.frequency.value = 520; rainLowFilter.Q.value = 0.5;
		const rainLowGain = ctx.createGain(); rainLowGain.gain.value = 0;
		rainLow.connect(rainLowFilter).connect(rainLowGain).connect(this.master);
		rainLow.start();
		this.rainLowGain = rainLowGain;

		this.ready = true;
	}

	setEnvironment(env) {
		Object.assign(this.environment, env);
		if (!this.ready) return;
		const t = this.ctx.currentTime;
		const wind = 0.03 + this.environment.wind * 0.145;
		this.windGain.gain.setTargetAtTime(wind, t, 1.5);
		this.rainGain.gain.setTargetAtTime(this.environment.rain * 0.20, t, 1.0);
		this.rainLowGain.gain.setTargetAtTime(this.environment.rain * 0.13, t, 1.4);
		this.lapGain.gain.setTargetAtTime(0.018 + this.environment.wind * 0.015, t, 2.0);
	}

	setMuted(m) {
		this.muted = m;
		if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.72, this.ctx.currentTime, 0.15);
	}

	// short filtered noise burst
	burst({ freq = 700, q = 1, dur = 0.3, gain = 0.2, sweep = 0, type = 'bandpass' }) {
		if (!this.ready || this.muted) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.setValueAtTime(freq, t);
		if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g).connect(this.master);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	// sine blip with optional pitch slide — used for plops and bubbles
	blip({ f0 = 300, f1 = 140, dur = 0.18, gain = 0.18, type = 'sine' }) {
		if (!this.ready || this.muted) return;
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
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + dur + 0.03);
	}

	splash(impact = 0.2, x = 0, z = 0) {
		const k = Math.min(1, 0.25 + impact * 2.2);
		this.burst({ freq: 900 + 500 * k, q: 0.8, dur: 0.24 + 0.35 * k, gain: 0.10 + 0.24 * k, sweep: -700, type: 'bandpass' });
		this.burst({ freq: 2600, q: 0.6, dur: 0.12 + 0.15 * k, gain: 0.05 + 0.12 * k, sweep: -1200, type: 'highpass' });
		this.blip({ f0: 170 - 40 * k, f1: 60, dur: 0.22, gain: 0.10 + 0.16 * k });
	}

	// Rolling thunder: a filtered noise body with a short sharp crack for close
	// strikes. `delay` is the sound travel time from the flash.
	thunder(delay = 0, intensity = 0.8) {
		if (!this.ready || this.muted) return;
		if (delay > 0.01) {
			setTimeout(() => this.thunder(0, intensity), delay * 1000);
			return;
		}
		if (!this.ready || this.muted) return;
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
		o.start(t);
		o.stop(t + 2.4);

		// close strike: a bright tearing crack before the rumble
		if (k > 0.6) {
			this.burst({ freq: 1500, q: 0.45, dur: 0.55, gain: 0.10 + 0.16 * k, sweep: -1200, type: 'lowpass' });
			setTimeout(() => this.burst({ freq: 700, q: 0.6, dur: 1.2, gain: 0.08 * k, sweep: -450, type: 'lowpass' }), 260);
		}
	}

	stir(speed = 1) {
		const k = Math.min(1, speed / 3);
		this.burst({ freq: 420 + 220 * k, q: 1.3, dur: 0.16 + 0.12 * k, gain: 0.03 + 0.08 * k, sweep: 260, type: 'bandpass' });
	}

	plop() {
		this.blip({ f0: 520, f1: 190, dur: 0.1, gain: 0.07 });
	}

	bubble() {
		this.blip({ f0: 380 + Math.random() * 500, f1: 700 + Math.random() * 600, dur: 0.07, gain: 0.03 });
	}

	chirp() {
		if (!this.ready || this.muted) return;
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
			o.start(t + i * 0.075);
			o.stop(t + i * 0.075 + 0.09);
		}
	}

	frog() {
		this.blip({ f0: 160, f1: 95, dur: 0.14, gain: 0.05, type: 'square' });
		setTimeout(() => this.blip({ f0: 140, f1: 88, dur: 0.12, gain: 0.04, type: 'square' }), 160);
	}

	tick(dt) {
		if (!this.ready) return;
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
