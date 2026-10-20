import { Noise2D, clamp, smoothstep, lerp, TAU } from '../core/Noise.js';

// Single source of truth for the pond basin and surrounding meadow.
export class TerrainHeight {
	constructor(seed = 1337) {
		this.noise = new Noise2D(seed);
		this.noise2 = new Noise2D(seed + 91);
		this.waterLevel = 0;
		this.domain = 20;
		this.half = 10;
		this.deckY = 0.52;
	}

	pondRadius(theta) {
		const n = this.noise.noise(Math.cos(theta) * 1.35 + 11.2, Math.sin(theta) * 1.35 - 4.7);
		return 6.35
			+ 0.55 * Math.sin(3 * theta + 1.7)
			+ 0.33 * Math.sin(5 * theta + 0.35)
			+ 0.22 * Math.sin(8 * theta + 2.1)
			+ 0.24 * n;
	}

	height(x, z) {
		const r = Math.hypot(x, z) + 1e-6;
		const theta = Math.atan2(z, x);
		const R = this.pondRadius(theta);
		const F = R - r; // metres inside the nominal shoreline

		const detail = this.noise.fbm(x * 0.65 + 3.1, z * 0.65 - 1.8, 4, 2.02, 0.5);
		const detail2 = this.noise2.fbm(x * 2.4, z * 2.4, 3, 2.1, 0.45);

		let y;
		if (F > 0) {
			// bowl: shallow shelf -> steepening slope -> flat muddy bottom
			const t = clamp(F / 1.55, 0, 1);
			const s = smoothstep(0, 1, t);
			let depth = 1.48 * Math.pow(s, 0.82);
			// a deep hole slightly off centre
			depth += 0.28 * Math.exp(-(((x - 1.7) ** 2 + (z + 1.0) ** 2) / 5.2));
			depth *= 0.91 + 0.13 * detail;
			depth += 0.035 * detail2 * (1 - t);
			y = -depth;
		} else {
			const d = -F;
			const bank = 0.52 * smoothstep(0, 2.4, d);
			const meadow = (
				0.32 * this.noise.fbm(x * 0.105 + 4.4, z * 0.105 - 7.7, 4, 2.05, 0.5)
				+ 0.055 * detail
				+ 0.4 * smoothstep(8, 16, r)
			) * smoothstep(0.15, 2.2, d);
			y = bank + meadow;
			// gentle natural hollow at the south bank, and a flat sandy spit
			y -= 0.18 * smoothstep(0.6, 2.4, d) * Math.exp(-((x - 4.8) ** 2 + (z - 5.2) ** 2) / 9.0);
		}

		// pebbly micro-relief, faded right at the waterline to keep it clean
		y += 0.016 * detail2 * smoothstep(0.03, 0.5, Math.abs(F));
		return y;
	}

	normal(x, z, eps = 0.08) {
		const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
		const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
		const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
		const l = Math.hypot(nx, ny, nz) || 1;
		return [nx / l, ny / l, nz / l];
	}

	slope(x, z) {
		const n = this.normal(x, z);
		return 1 - n[1];
	}

	inPond(x, z) {
		const R = this.pondRadius(Math.atan2(z, x));
		return Math.hypot(x, z) < R;
	}

	waterDepth(x, z, surface = 0) {
		return Math.max(0, surface - this.height(x, z));
	}

	// Wind/wave-free waterline point for a given angle.
	shorePoint(theta, inset = 0) {
		const R = this.pondRadius(theta) - inset;
		return { x: Math.cos(theta) * R, z: Math.sin(theta) * R };
	}

	// Sample a walkable ring path for placement.
	randomShorePoint(rand, inset = 0) {
		const theta = rand() * TAU;
		return { ...this.shorePoint(theta, inset), theta };
	}
}
