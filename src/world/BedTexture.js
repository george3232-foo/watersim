import * as THREE from 'three';

export function createBedTexture(hf, size = 512, domain = 20) {
	const half = domain * 0.5;
	const data = new Float32Array(size * size * 4);
	for (let j = 0; j < size; j++) {
		const z = -half + ((j + 0.5) / size) * domain;
		for (let i = 0; i < size; i++) {
			const x = -half + ((i + 0.5) / size) * domain;
			const y = hf.height(x, z);
			const k = (j * size + i) * 4;
			data[k] = y;
			data[k + 1] = 0;
			data[k + 2] = 0;
			data[k + 3] = 1;
		}
	}
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	tex.colorSpace = THREE.NoColorSpace;
	return tex;
}
