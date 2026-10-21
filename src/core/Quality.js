export const QUALITY_PRESETS = Object.freeze({
	low: Object.freeze({
		scale: 0.7, maxDpr: 1, macroSize: 128, microSize: 256, waterRes: 128,
		reflectionScale: 0.35, reflectionInterval: 3, shadowSize: 512, shadowInterval: 4, bloom: false, foliage: 0.38,
	}),
	medium: Object.freeze({
		scale: 0.85, maxDpr: 1.35, macroSize: 192, microSize: 384, waterRes: 192,
		reflectionScale: 0.45, reflectionInterval: 2, shadowSize: 1024, shadowInterval: 2, bloom: true, foliage: 0.7,
	}),
	high: Object.freeze({
		scale: 1, maxDpr: 1.6, macroSize: 256, microSize: 512, waterRes: 256,
		reflectionScale: 0.6, reflectionInterval: 1, shadowSize: 2048, shadowInterval: 1, bloom: true, foliage: 1,
	}),
});

const TIERS = ['low', 'medium', 'high'];
const WARMUP = 4;
const COOLDOWN = 8;
const DOWN_SECONDS = 2.5;
const UP_SECONDS = 12;

export class QualityController {
	constructor(mode = 'auto', initialTier = 'high') {
		this.tier = TIERS.includes(initialTier) ? initialTier : 'high';
		this.mode = 'auto';
		this.setMode(mode);
	}

	get settings() { return QUALITY_PRESETS[this.tier]; }

	setMode(mode) {
		if (mode !== 'auto' && !TIERS.includes(mode)) throw new RangeError(`Unknown quality mode: ${mode}`);
		const previousTier = this.tier;
		this.mode = mode;
		if (mode !== 'auto') this.tier = mode;
		this.resetTiming();
		return this.tier !== previousTier;
	}

	// Call on visibility return; loading/hidden time must not count toward adaptation.
	resetTiming() {
		this._warmup = WARMUP;
		this._cooldown = 0;
		this._lowTime = 0;
		this._highTime = 0;
		this._fps = null;
	}

	update(fps, dt) {
		if (this.mode !== 'auto') return false;
		// Ignore suspended/invalid frames rather than letting one long pause select a tier.
		if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(dt) || dt <= 0 || dt > 1) return false;
		this._fps = this._fps === null ? fps : this._fps + (fps - this._fps) * (1 - Math.exp(-dt / 0.65));
		if (this._warmup > 0 || this._cooldown > 0) {
			this._warmup = Math.max(0, this._warmup - dt);
			this._cooldown = Math.max(0, this._cooldown - dt);
			this._lowTime = this._highTime = 0;
			return false;
		}

		const index = TIERS.indexOf(this.tier);
		const downFps = this.tier === 'high' ? 43 : 37;
		const upFps = this.tier === 'low' ? 57 : 59;
		this._lowTime = index > 0 && this._fps < downFps ? this._lowTime + dt : 0;
		this._highTime = index < TIERS.length - 1 && this._fps > upFps ? this._highTime + dt : 0;
		const next = this._lowTime >= DOWN_SECONDS ? index - 1 : this._highTime >= UP_SECONDS ? index + 1 : index;
		if (next === index) return false;
		this.tier = TIERS[next];
		this._lowTime = this._highTime = 0;
		this._cooldown = COOLDOWN;
		return true;
	}
}
