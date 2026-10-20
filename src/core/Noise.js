// Deterministic, seedable noise utilities. No dependencies.
export function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const fract = (x) => x - Math.floor(x);
export const TAU = Math.PI * 2;

// A fast 2D value noise with cubic interpolation, seeded permutation.
export class Noise2D {
	constructor(seed = 1337) {
		const rand = mulberry32(seed);
		this.p = new Uint8Array(512);
		const perm = new Uint8Array(256);
		for (let i = 0; i < 256; i++) perm[i] = i;
		for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
		for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
		this.grad = [];
		for (let i = 0; i < 256; i++) {
			const a = rand() * TAU;
			this.grad.push([Math.cos(a), Math.sin(a)]);
		}
	}
	noise(x, y) {
		const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
		const xf = x - Math.floor(x), yf = y - Math.floor(y);
		const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
		const p = this.p;
		const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
		const g = this.grad;
		const d00 = g[aa][0] * xf + g[aa][1] * yf;
		const d10 = g[ba][0] * (xf - 1) + g[ba][1] * yf;
		const d01 = g[ab][0] * xf + g[ab][1] * (yf - 1);
		const d11 = g[bb][0] * (xf - 1) + g[bb][1] * (yf - 1);
		const x1 = d00 + u * (d10 - d00);
		const x2 = d01 + u * (d11 - d01);
		return (x1 + v * (x2 - x1)) * 1.4;
	}
	fbm(x, y, octaves = 4, lac = 2.03, gain = 0.5) {
		let amp = 0.5, sum = 0, norm = 0;
		for (let i = 0; i < octaves; i++) {
			sum += amp * this.noise(x, y);
			norm += amp;
			x = x * lac + 17.3; y = y * lac - 9.1; amp *= gain;
		}
		return sum / norm;
	}
	ridged(x, y, octaves = 4) {
		let amp = 0.5, sum = 0, norm = 0;
		for (let i = 0; i < octaves; i++) {
			sum += amp * (1 - Math.abs(this.noise(x, y)) * 2);
			norm += amp;
			x = x * 2.07 + 5.2; y = y * 2.07 + 1.7; amp *= 0.5;
		}
		return sum / norm;
	}
}

export function hash2(x, y) {
	let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function randRange(rand, a, b) { return a + (b - a) * rand(); }
export function randInt(rand, a, b) { return Math.floor(a + (b - a + 1) * rand()); }

export function catmullRom(p0, p1, p2, p3, t) {
	const t2 = t * t, t3 = t2 * t;
	return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
