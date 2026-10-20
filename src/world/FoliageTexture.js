import * as THREE from 'three';
import { mulberry32, TAU } from '../core/Noise.js';

// Procedural leaf-spray atlas for the broadleaf canopies. Four cluster
// variants are packed into a 2x2 canvas atlas so a single instanced draw can
// break up the repetition without any external image assets.

const ATLAS_CELLS = 2;
const CELL_SIZE = 512;
const PAD = 16;

// A single pointed leaf, growing along +X from its stem at the origin.
// Colours stay pale and slightly yellow-green so the per-instance tint has
// plenty of headroom (the texture multiplies the instance colour).
function drawLeaf(ctx, len, wid, hue, sat, light, veinAlpha = 0.5) {
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(len * 0.26, wid, len * 0.98, 0);
	ctx.quadraticCurveTo(len * 0.26, -wid, 0, 0);
	ctx.closePath();
	const g = ctx.createLinearGradient(0, 0, len, 0);
	g.addColorStop(0, `hsl(${hue}, ${sat}%, ${Math.max(34, light - 10)}%)`);
	g.addColorStop(0.5, `hsl(${hue}, ${sat}%, ${light}%)`);
	g.addColorStop(1, `hsl(${hue + 5}, ${sat + 4}%, ${Math.min(96, light + 7)}%)`);
	ctx.fillStyle = g;
	ctx.fill();

	// faint midrib catches the eye at close range, vanishes at distance
	ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${Math.min(96, light + 12)}%, ${veinAlpha})`;
	ctx.lineWidth = Math.max(1, wid * 0.055);
	ctx.beginPath();
	ctx.moveTo(len * 0.12, 0);
	ctx.quadraticCurveTo(len * 0.52, wid * 0.07, len * 0.82, 0);
	ctx.stroke();
}

function stampLeaf(ctx, x, y, angle, len, wid, hue, sat, light) {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	drawLeaf(ctx, len, wid, hue, sat, light);
	ctx.restore();
}

function drawCluster(ctx, size, seed) {
	const rand = mulberry32(seed);
	const cx = size * 0.5;
	const cy = size * 0.5;

	// A darker back layer first. These broad leaves sit behind the sprays and
	// close the centre without filling every gap.
	for (let i = 0; i < 34; i++) {
		const ang = rand() * TAU;
		const rad = Math.sqrt(rand()) * size * 0.3;
		const x = cx + Math.cos(ang) * rad * 1.05;
		const y = cy + Math.sin(ang) * rad * 0.94;
		const len = size * (0.1 + rand() * 0.055);
		stampLeaf(ctx, x, y, ang + (rand() - 0.5) * 0.6, len, len * (0.38 + rand() * 0.14),
			84 + rand() * 18, 24 + rand() * 16, 54 + rand() * 16);
	}

	// Branch sprays radiating in every direction, so a card reads as a
	// roughly round leaf clump rather than a flat fan.
	const sprays = 9;
	for (let i = 0; i < sprays; i++) {
		const dir = (i / sprays) * TAU + (rand() - 0.5) * 0.32;
		const len = size * (0.24 + rand() * 0.1);
		const bx = cx + Math.cos(dir) * size * 0.035;
		const by = cy + Math.sin(dir) * size * 0.035;
		const ex = bx + Math.cos(dir) * len;
		const ey = by + Math.sin(dir) * len;
		const bend = (rand() - 0.5) * size * 0.12;
		const nx = Math.cos(dir + Math.PI * 0.5);
		const ny = Math.sin(dir + Math.PI * 0.5);
		const mx = (bx + ex) * 0.5 + nx * bend;
		const my = (by + ey) * 0.5 + ny * bend;

		ctx.strokeStyle = 'hsl(68, 24%, 38%)';
		ctx.lineWidth = size * 0.008;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(bx, by);
		ctx.quadraticCurveTo(mx, my, ex, ey);
		ctx.stroke();

		const n = 8 + ((rand() * 3) | 0);
		for (let k = 0; k < n; k++) {
			const t = 0.12 + (k / (n - 1)) * 0.82 + (rand() - 0.5) * 0.025;
			const it = 1 - t;
			const px = it * it * bx + 2 * it * t * mx + t * t * ex;
			const py = it * it * by + 2 * it * t * my + t * t * ey;
			const tx = 2 * it * (mx - bx) + 2 * t * (ex - mx);
			const ty = 2 * it * (my - by) + 2 * t * (ey - my);
			const bdir = Math.atan2(ty, tx);
			const side = k % 2 ? 1 : -1;
			const ang = bdir + side * (0.55 + rand() * 0.58) + (rand() - 0.5) * 0.2;
			const sz = size * (0.1 + rand() * 0.045) * (0.74 + 0.32 * Math.sin(t * Math.PI));
			const light = (side > 0 ? 72 : 64) + rand() * 20;
			stampLeaf(ctx, px, py, ang, sz, sz * (0.4 + rand() * 0.14),
				84 + rand() * 20, 25 + rand() * 18, light);
		}

		// terminal burst at the end of each branch
		for (let k = 0; k < 4; k++) {
			const ang = dir + (k - 1.5) * 0.44 + (rand() - 0.5) * 0.18;
			const sz = size * (0.1 + rand() * 0.045);
			stampLeaf(ctx, ex, ey, ang, sz, sz * (0.4 + rand() * 0.15),
				82 + rand() * 20, 26 + rand() * 18, 64 + rand() * 26);
		}
	}

	// inner fill so the middle of the clump does not read as a hole
	for (let i = 0; i < 16; i++) {
		const ang = rand() * TAU;
		const rad = Math.sqrt(rand()) * size * 0.16;
		const len = size * (0.09 + rand() * 0.045);
		stampLeaf(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad,
			ang + (rand() - 0.5) * 0.9, len, len * (0.4 + rand() * 0.14),
			86 + rand() * 18, 26 + rand() * 16, 66 + rand() * 22);
	}

	// a few loose leaves around the rim so the silhouette is ragged
	for (let i = 0; i < 6; i++) {
		const ang = rand() * TAU;
		const rad = size * (0.29 + rand() * 0.06);
		const x = cx + Math.cos(ang) * rad;
		const y = cy + Math.sin(ang) * rad * 0.94;
		const sz = size * (0.075 + rand() * 0.035);
		stampLeaf(ctx, x, y, ang + (rand() - 0.5) * 0.5, sz, sz * (0.4 + rand() * 0.14),
			86 + rand() * 18, 26 + rand() * 16, 62 + rand() * 24);
	}
}

// Returns a CanvasTexture with `userData.atlas = 2` (2x2 cells). All four
// cells are alpha-cutout leaf sprays; the centre of each cell stays a little
// emptier so close-up cards read as lace rather than solid blobs.
export function createFoliageTexture() {
	const size = CELL_SIZE * ATLAS_CELLS;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');

	for (let v = 0; v < ATLAS_CELLS * ATLAS_CELLS; v++) {
		const col = v % ATLAS_CELLS;
		const row = (v / ATLAS_CELLS) | 0;
		ctx.save();
		ctx.beginPath();
		ctx.rect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
		ctx.clip();
		ctx.translate(col * CELL_SIZE, row * CELL_SIZE);
		drawCluster(ctx, CELL_SIZE - PAD * 2, 1811 + v * 137);
		ctx.restore();
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.anisotropy = 4;
	tex.userData.atlas = ATLAS_CELLS;
	tex.needsUpdate = true;
	return tex;
}
