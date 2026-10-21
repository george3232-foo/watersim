import * as THREE from 'three';

const cache = new WeakMap();

export class UnsupportedDeviceError extends Error {
	constructor(message = 'Stillwater needs WebGL 2 with floating-point render targets.', cause) {
		super(message, cause ? { cause } : undefined);
		this.name = 'UnsupportedDeviceError';
		this.code = 'UNSUPPORTED_DEVICE';
	}
}

// Probe actual RGBA framebuffer completeness, not just extension advertisement.
// Three owns the temporary targets so its framebuffer/texture state stays in sync.
function canRender(renderer, type) {
	const target = new THREE.WebGLRenderTarget(2, 2, {
		type, format: THREE.RGBAFormat,
		minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
		depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
	});
	const previous = renderer.getRenderTarget();
	try {
		renderer.setRenderTarget(target);
		const gl = renderer.getContext();
		return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
	} catch {
		return false;
	} finally {
		renderer.setRenderTarget(previous);
		target.dispose();
	}
}

export function getRenderCapabilities(renderer) {
	if (cache.has(renderer)) return cache.get(renderer);
	const gl = renderer.getContext();
	if (!renderer.capabilities.isWebGL2 || !gl || typeof gl.texStorage2D !== 'function' || gl.isContextLost()) {
		throw new UnsupportedDeviceError('Stillwater needs a working WebGL 2 context.');
	}
	const floatExtension = renderer.extensions.has('EXT_color_buffer_float');
	const halfExtension = renderer.extensions.has('EXT_color_buffer_half_float') || floatExtension;
	const halfFloatRenderable = halfExtension && canRender(renderer, THREE.HalfFloatType);
	const floatRenderable = floatExtension && canRender(renderer, THREE.FloatType);
	if ((!halfFloatRenderable && !floatRenderable) || renderer.capabilities.maxVertexTextures < 3) {
		throw new UnsupportedDeviceError('Stillwater needs renderable RGBA float or half-float textures and vertex texture sampling.');
	}
	// Transparent world/FX passes blend into HDR. RGBA32F blending needs its own extension.
	if (!halfFloatRenderable && !renderer.extensions.has('EXT_float_blend')) {
		throw new UnsupportedDeviceError('Stillwater needs blendable half-float or float HDR render targets.');
	}
	const capabilities = Object.freeze({
		isWebGL2: true,
		floatRenderable,
		halfFloatRenderable,
		floatLinear: renderer.extensions.has('OES_texture_float_linear'),
		// Linear filtering of 16-bit float textures is core in WebGL 2.
		halfFloatLinear: true,
		hdrType: halfFloatRenderable ? THREE.HalfFloatType : THREE.FloatType,
		stateType: floatRenderable ? THREE.FloatType : THREE.HalfFloatType,
		maxTextureSize: renderer.capabilities.maxTextureSize,
	});
	cache.set(renderer, capabilities);
	return capabilities;
}

export function canFilterLinearly(type, capabilities) {
	return type !== THREE.FloatType || capabilities.floatLinear;
}
