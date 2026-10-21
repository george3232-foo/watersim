// CPU actors share the solver's sampled height, including its current level
// offset. Caller-owned scratch records keep repeated sampling allocation-free.
export function surfaceHeight(sim, x, z, out) {
	out.height = NaN;
	if (sim && sim.sampleSurface) sim.sampleSurface(x, z, out);
	if (!Number.isFinite(out.height)) {
		out.height = Number.isFinite(sim?.levelOffset) ? sim.levelOffset : 0;
	}
	return out.height;
}

export function waterColumn(hf, sim, x, z, out) {
	const height = surfaceHeight(sim, x, z, out);
	const bed = hf.height(x, z);
	// Invalid terrain is dry rather than a source of NaN forces.
	out.bed = Number.isFinite(bed) ? bed : height;
	out.depth = Math.max(0, height - out.bed);
	return out;
}
