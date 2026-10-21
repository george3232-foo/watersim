const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

// Pure camera-relative stereo for events on the pond's XZ plane. The listener
// record contains a world position and the camera's world-space right vector.
// With no listener, legacy calls remain centred at their original gain.
export function computeSpatialAudio(listener, x = 0, z = 0, out = {}) {
	if (!listener) {
		out.pan = 0; out.gain = 1; out.distance = 0;
		return out;
	}
	const dx = finite(x) - finite(listener.x);
	const dy = -finite(listener.y);
	const dz = finite(z) - finite(listener.z);
	let rx = finite(listener.rightX, 1), ry = finite(listener.rightY), rz = finite(listener.rightZ);
	const rightLength = Math.hypot(rx, ry, rz);
	if (rightLength > 1e-6) { rx /= rightLength; ry /= rightLength; rz /= rightLength; }
	else { rx = 1; ry = 0; rz = 0; }
	const distance = Math.hypot(dx, dy, dz);
	out.pan = Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / Math.max(1, distance)));
	// Broad near field keeps the full pond audible from the default camera;
	// beyond 1.5 m a 10 m rolloff radius gives smooth, bounded attenuation.
	out.gain = 1 / (1 + (Math.max(0, distance - 1.5) / 10) ** 2);
	out.distance = distance;
	return out;
}
