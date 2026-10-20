import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D, mulberry32, smoothstep, lerp, TAU, clamp } from '../core/Noise.js';
import { createFoliageTexture } from './FoliageTexture.js';

const INNER_RADIUS = 16.95;
const OUTER_RADIUS = 360;
const RING_ANGULAR = 320;
const RING_RADIAL = 66;

// Everything beyond the detailed pond disk: rolling meadow, distant hills and
// the forest that closes off the horizon. Heights are sampled from the same
// height field at the seam so there is never a visible edge.
export class Landscape {
	constructor(heightField) {
		this.hf = heightField;
		this.noise = new Noise2D(777);
		this.noise2 = new Noise2D(1729);
		this.sunHour = 18.8;
		this.group = new THREE.Group();
		this.group.name = 'landscape';
		this.windUniforms = {
			uWindTime: { value: 0 },
			uWindPower: { value: 0.4 },
			uWindDir: { value: new THREE.Vector2(1, 0.35) },
		};
		this.buildGround();
		this.buildForest();
	}

	// Wind displacement is applied after instancing, so a whole tree crown
	// leans and flutters while individual leaf cards stay attached to it.
	addWind(mat) {
		const prev = mat.onBeforeCompile;
		const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
		const u = this.windUniforms;
		mat.onBeforeCompile = (shader, renderer) => {
			if (prev) prev(shader, renderer);
			shader.uniforms.uWindTime = u.uWindTime;
			shader.uniforms.uWindPower = u.uWindPower;
			shader.uniforms.uWindDir = u.uWindDir;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>
uniform float uWindTime;
uniform float uWindPower;
uniform vec2 uWindDir;`)
				.replace('#include <project_vertex>', `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec3 swWorld = (modelMatrix * mvPosition).xyz;
float swHeight = max(swWorld.y - 0.9, 0.0);
float swPhase = swWorld.x * 0.27 + swWorld.z * 0.33;
float swGust = 0.72
  + 0.28 * sin(uWindTime * 0.63 + swPhase * 0.17)
  + 0.16 * sin(uWindTime * 1.9 + swPhase * 0.41);
float swAmt = uWindPower * 0.050 * swHeight * swGust;
mvPosition.x += uWindDir.x * swAmt;
mvPosition.z += uWindDir.y * swAmt;
mvPosition.x += sin(uWindTime * 3.2 + swPhase * 1.6 + swWorld.y * 0.9) * uWindPower * 0.014 * swHeight;
mvPosition.z += cos(uWindTime * 2.7 + swPhase * 1.3 + swWorld.y * 0.7) * uWindPower * 0.011 * swHeight;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`);
		};
		mat.customProgramCacheKey = () => prevKey + '-wind';
	}

	sunAzimuth() {
		return Math.PI * (this.sunHour - 6) / 14;
	}

	height(x, z) {
		const r = Math.hypot(x, z);
		const inner = this.hf.height(x, z);
		if (r <= INNER_RADIUS + 0.4) return inner;

		const blend = smoothstep(INNER_RADIUS, 31, r);
		const n1 = this.noise.fbm(x * 0.033 + 4.7, z * 0.033 - 8.1, 4, 2.03, 0.52);
		const n2 = this.noise2.fbm(x * 0.14 - 2.9, z * 0.14 + 6.4, 3, 2.05, 0.5);
		const ridge = this.noise.ridged(x * 0.0075 + 1.3, z * 0.0075 - 3.8, 4);

		const rolling = 1.35 + 1.9 * n1 + 0.45 * n2;
		const rise = smoothstep(22, 75, r) * (0.8 + 1.7 * n1);
		const hills = smoothstep(55, 230, r) * (3.5 + 12.5 * (0.5 + 0.5 * ridge));
		const outer = rolling + rise + hills;
		return lerp(inner, outer, blend);
	}

	buildGround() {
		const angular = RING_ANGULAR;
		const radial = RING_RADIAL;
		const verts = [];
		const colors = [];
		const indices = [];

		const cNear = new THREE.Color(0x436024);
		const cNearDry = new THREE.Color(0x707638);
		const cFar = new THREE.Color(0x354d2b);
		const cDeep = new THREE.Color(0x2a4026);

		for (let j = 0; j <= radial; j++) {
			const t = j / radial;
			// logarithmic radial spacing: detail near the pond, broad strides far out
			const r = INNER_RADIUS * Math.pow(OUTER_RADIUS / INNER_RADIUS, t);
			for (let i = 0; i < angular; i++) {
				const a = (i / angular) * TAU;
				const x = Math.cos(a) * r;
				const z = Math.sin(a) * r;
				const y = this.height(x, z);
				verts.push(x, y, z);

				const n = this.noise.fbm(x * 0.11 + 3.0, z * 0.11 - 2.0, 3, 2.05, 0.5);
				const dry = smoothstep(0.52, 0.85, n);
				const farT = smoothstep(30, 170, r);
				const c = cNear.clone().lerp(cNearDry, dry * 0.38).lerp(cFar, farT * 0.7).lerp(cDeep, smoothstep(0.6, 0.9, n) * 0.25);
				const shade = 0.82 + 0.3 * this.noise2.noise(x * 0.45, z * 0.45);
				colors.push(c.r * shade, c.g * shade, c.b * shade);
			}
		}

		for (let j = 0; j < radial; j++) {
			const rowA = j * angular;
			const rowB = (j + 1) * angular;
			for (let i = 0; i < angular; i++) {
				const i2 = (i + 1) % angular;
				const a = rowA + i;
				const b = rowA + i2;
				const c = rowB + i;
				const d = rowB + i2;
				indices.push(a, b, c, b, d, c);
			}
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geo.setIndex(indices);
		geo.computeVertexNormals();
		geo.computeBoundingSphere();

		const mat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			roughness: 1.0,
			metalness: 0.0,
			side: THREE.FrontSide,
		});
		this.ground = new THREE.Mesh(geo, mat);
		this.ground.receiveShadow = true;
		this.ground.name = 'outer-landscape';
		this.group.add(this.ground);
	}

	// -- procedural tree geometry ------------------------------------------

	paint(input, color, variation, rand, topLight = 0) {
		const geo = input.index ? input.toNonIndexed() : input;
		const count = geo.attributes.position.count;
		const arr = new Float32Array(count * 3);
		const c = new THREE.Color();
		const p = geo.attributes.position;
		for (let i = 0; i < count; i++) {
			const v = 0.86 + (rand ? rand() : 0.5) * variation;
			c.copy(color).multiplyScalar(v);
			if (topLight > 0) {
				// gentle sky-light gradient across the crown
				const t = clamp((p.getY(i) - 2.2) / 2.8, 0, 1);
				const lift = lerp(0.68, 1.28, t * t);
				c.multiplyScalar(lerp(1.0, lift, topLight));
			}
			arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
		}
		geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
		return geo;
	}

	// Crown dimensions shared by the blob canopy and the leaf-card shell. The
	// cards sit on a slightly expanded ellipsoid so they overlay the visible
	// surface of the blobs rather than being swallowed by them.
	crownShape(large = false) {
		return large
			? { rx: 2.0, ry: 1.45, rz: 1.75, cy: 4.0, blobs: 30, inner: 7 }
			: { rx: 1.7, ry: 1.25, rz: 1.5, cy: 3.8, blobs: 20, inner: 5 };
	}

	broadleafGeometry(seed = 1, large = false) {
		const rand = mulberry32(seed);
		const parts = [];

		const trunkColor = new THREE.Color(0x4c3a26);
		const trunk = new THREE.CylinderGeometry(0.10, 0.21, 2.9, 6, 1);
		trunk.translate(0, 1.45, 0);
		parts.push(this.paint(trunk, trunkColor, 0.22, rand));

		// a couple of visible limbs
		for (let i = 0; i < 3; i++) {
			const branch = new THREE.CylinderGeometry(0.035, 0.08, 1.7, 5, 1);
			branch.translate(0, 0.85, 0);
			branch.rotateZ((i % 2 ? 1 : -1) * (0.5 + rand() * 0.25));
			branch.rotateY(rand() * TAU);
			branch.translate(0, 2.1 + rand() * 0.35, 0);
			parts.push(this.paint(branch, trunkColor, 0.22, rand));
		}

		const greens = [
			new THREE.Color(0x365323),
			new THREE.Color(0x425f28),
			new THREE.Color(0x4f702e),
			new THREE.Color(0x5c7d34),
		];
		// canopy: blobs clustered on an ellipsoid shell so the crown reads as
		// one lumpy mass instead of a pile of balls
		const shape = this.crownShape(large);
		const { rx, ry, rz, cy, blobs } = shape;
		const outerBlobs = [];
		for (let i = 0; i < blobs; i++) {
			const k = i + 0.5;
			const phi = Math.acos(1 - 2 * k / blobs);
			const theta = Math.PI * (1 + Math.sqrt(5)) * k;
			const sx = Math.sin(phi) * Math.cos(theta);
			const sy = Math.cos(phi);
			const sz = Math.sin(phi) * Math.sin(theta);
			const shell = 0.68 + rand() * 0.34;
			const bx = sx * rx * shell;
			const by = cy + sy * ry * shell;
			const bz = sz * rz * shell;
			const s = (large ? 0.56 : 0.49) + rand() * 0.58;
			const blob = new THREE.IcosahedronGeometry(s, 1);
			const p = blob.attributes.position;
			// IcosahedronGeometry is non-indexed, so the same corner position is
			// repeated on several triangles. Keying the puff by position keeps
			// those copies in sync: per-vertex randomness here tears the shell
			// open and leaves black triangular spikes around the silhouette.
			const puffs = new Map();
			for (let kk2 = 0; kk2 < p.count; kk2++) {
				const ox = p.getX(kk2);
				const oy = p.getY(kk2);
				const oz = p.getZ(kk2);
				const key = `${ox.toFixed(4)},${oy.toFixed(4)},${oz.toFixed(4)}`;
				let puff = puffs.get(key);
				if (puff === undefined) {
					puff = 0.8 + rand() * 0.4;
					puffs.set(key, puff);
				}
				p.setXYZ(kk2, ox * puff, oy * puff * 0.85, oz * puff);
			}
			// Keep the icosahedron's smooth radial normals; recomputing them
			// here would flat-shade every triangle and turn the crown into a
			// pile of hard facets for the leaf cards to fight with.
			blob.translate(bx, by, bz);
			outerBlobs.push({ x: bx, y: by, z: bz, r: s });
			const base = greens[(rand() * greens.length) | 0];
			parts.push(this.paint(blob, base, 0.2, rand, 0.55));
		}
		// a few softer inner clumps to close the gaps
		for (let i = 0; i < shape.inner; i++) {
			const s = 0.8 + rand() * 0.7;
			const blob = new THREE.IcosahedronGeometry(s, 1);
			blob.translate((rand() - 0.5) * 1.5, cy - 0.5 + rand() * 0.8, (rand() - 0.5) * 1.5);
			parts.push(this.paint(blob, greens[(rand() * greens.length) | 0], 0.24, rand, 0.35));
		}

		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		geo.userData.blobs = outerBlobs;
		return geo;
	}

	coniferGeometry(seed = 2) {
		const rand = mulberry32(seed);
		const parts = [];
		const trunkColor = new THREE.Color(0x463522);
		const greens = [new THREE.Color(0x35523a), new THREE.Color(0x3f5f41), new THREE.Color(0x4a6b49)];

		const trunk = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 5, 1);
		trunk.translate(0, 1.1, 0);
		parts.push(this.paint(trunk, trunkColor, 0.2, rand));

		const layers = [
			{ y: 2.0, r: 1.45, h: 2.4 },
			{ y: 3.5, r: 1.06, h: 2.0 },
			{ y: 4.85, r: 0.68, h: 1.65 },
		];
		for (const L of layers) {
			const cone = new THREE.ConeGeometry(L.r, L.h, 7, 1);
			cone.translate(0, L.y + L.h * 0.5, 0);
			parts.push(this.paint(cone, greens[(rand() * greens.length) | 0], 0.28, rand));
		}
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		return geo;
	}

	shrubGeometry(seed = 3) {
		const rand = mulberry32(seed);
		const parts = [];
		const greens = [new THREE.Color(0x405f2a), new THREE.Color(0x4e6d32), new THREE.Color(0x5c7c38)];
		for (let i = 0; i < 5; i++) {
			const s = 0.35 + rand() * 0.45;
			const blob = new THREE.IcosahedronGeometry(s, 1);
			blob.scale(1.15, 0.8, 1.15);
			blob.translate((rand() - 0.5) * 1.0, s * 0.55 + rand() * 0.15, (rand() - 0.5) * 1.0);
			parts.push(this.paint(blob, greens[(rand() * greens.length) | 0], 0.3, rand));
		}
		const geo = mergeGeometries(parts, false);
		geo.computeBoundingSphere();
		return geo;
	}

	// -- leaf cards ---------------------------------------------------------
	//
	// The blob canopy supplies shadow and volume; the cards supply the actual
	// leaf detail. Cards are pushed out onto the visible skin of the blob
	// cloud, tangent to it, and collected into a single InstancedMesh for all
	// broadleaf trees (near, mid-distance, and hero) so this costs one draw
	// call. They never cast shadows.

	collectLeafCards(list, rand, out, density = 1, hero = false) {
		const { cy, ry } = this.crownShape(true);
		const blobs = this.leafBlobs;
		// pick blobs by surface area, otherwise small blobs soak up cards while
		// the big protrusions (the ones that read as bare masses) stay sparse
		const cdf = [];
		let cdfTotal = 0;
		for (const b of blobs) {
			cdfTotal += b.r * b.r;
			cdf.push(cdfTotal);
		}
		const up = new THREE.Vector3(0, 1, 0);
		const xAxis = new THREE.Vector3(1, 0, 0);
		const zAxis = new THREE.Vector3(0, 0, 1);
		const helper = new THREE.Vector3();
		const n = new THREE.Vector3();
		const tangentX = new THREE.Vector3();
		const tangentY = new THREE.Vector3();
		const basis = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const qTilt = new THREE.Quaternion();
		const qSpin = new THREE.Quaternion();
		const palette = [
			new THREE.Color(0x6b8f40),
			new THREE.Color(0x769c49),
			new THREE.Color(0x82a853),
			new THREE.Color(0x8eb35d),
			new THREE.Color(0x9bbd68),
		];

		for (const t of list) {
			const scale = t.scale;
			// Roughly area-proportional density. A leafy crown needs many small
			// clusters; one card covers only ~0.2 m² of a 50-70 m² canopy.
			const count = Math.max(18, Math.round(600 * scale * scale * (0.82 + rand() * 0.36) * density));
			const cosR = Math.cos(t.rot);
			const sinR = Math.sin(t.rot);
			const groundY = (t.y !== undefined ? t.y : this.hf.height(t.x, t.z)) - (hero ? 0.08 : 0.06);

			for (let i = 0; i < count; i++) {
				// sample the actual blob cloud. Cards anchored to a blob's
				// visible skin cannot be swallowed by the canopy the way a
				// card on a generic shell was.
				const pick = rand() * cdfTotal;
				let lo = 0;
				let hi = cdf.length - 1;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (pick < cdf[mid]) hi = mid;
					else lo = mid + 1;
				}
				const blob = blobs[lo];
				let ox = blob.x;
				let oy = blob.y - cy;
				let oz = blob.z;
				let inv = 1 / Math.max(0.001, Math.hypot(ox, oy, oz));
				ox *= inv; oy *= inv; oz *= inv;

				let dx = rand() * 2 - 1;
				let dy = rand() * 2 - 1;
				let dz = rand() * 2 - 1;
				inv = 1 / Math.max(0.001, Math.hypot(dx, dy, dz));
				dx *= inv; dy *= inv; dz *= inv;
				// bias toward the outside of the crown so most cards face the
				// open air rather than the inside of a neighbouring blob
				dx = dx * 0.75 + ox * 0.95;
				dy = dy * 0.75 + oy * 0.95;
				dz = dz * 0.75 + oz * 0.95;
				inv = 1 / Math.max(0.001, Math.hypot(dx, dy, dz));
				dx *= inv; dy *= inv; dz *= inv;

				const rr = blob.r * (1.08 + rand() * 0.12);
				let px = blob.x + dx * rr;
				let py = blob.y + dy * rr * 0.9;
				let pz = blob.z + dz * rr;
				// small extra lift away from the crown centre clears the
				// neighbouring blobs without making cards float
				let qx = px;
				let qy = py - cy;
				let qz = pz;
				inv = 1 / Math.max(0.001, Math.hypot(qx, qy, qz));
				const lift = 0.02 + rand() * 0.1;
				px += qx * inv * lift;
				py += qy * inv * lift;
				pz += qz * inv * lift;
				// no leaf clusters hanging in the clear trunk zone
				if (py < 1.9 && Math.hypot(px, pz) < 0.95) py += 0.8;

				const wx = t.x + (px * cosR + pz * sinR) * scale;
				const wy = groundY + py * scale;
				const wz = t.z + (-px * sinR + pz * cosR) * scale;

				// random card orientation with an outward bias, so the crown
				// reads as leaves from every angle instead of edge-on slivers
				n.set(dx * 0.9 + ox * 0.45, dy * 0.9 + oy * 0.45, dz * 0.9 + oz * 0.45);
				n.normalize();
				n.applyAxisAngle(up, t.rot);
				n.x += (rand() - 0.5) * 0.68;
				n.y += (rand() - 0.5) * 0.55;
				n.z += (rand() - 0.5) * 0.68;
				n.normalize();

				helper.copy(Math.abs(n.y) > 0.92 ? xAxis : up);
				tangentX.crossVectors(helper, n).normalize();
				tangentY.crossVectors(n, tangentX).normalize();
				basis.makeBasis(tangentX, tangentY, n);
				q.setFromRotationMatrix(basis);
				qTilt.setFromAxisAngle(xAxis, (rand() - 0.5) * 0.55);
				q.multiply(qTilt);
				qSpin.setFromAxisAngle(zAxis, rand() * TAU);
				q.multiply(qSpin);

				const size = (0.38 + rand() * 0.17) * (0.88 + 0.12 * Math.min(scale, 1.3));
				const tint = palette[(rand() * palette.length) | 0].clone();
				const top = clamp((py - cy + ry) / (2 * ry), 0, 1);
				tint.multiplyScalar((0.9 + rand() * 0.3) * lerp(0.9, 1.2, top * top));

				out.push({
					x: wx, y: wy, z: wz,
					q: q.clone(),
					sx: size,
					sy: size * (0.82 + rand() * 0.34),
					r: tint.r, g: tint.g, b: tint.b,
					variant: (rand() * 4) | 0,
				});
			}
		}
	}

	buildLeafCards(cards) {
		if (!cards.length) return null;
		// single quad per card: 2 triangles instead of 8, and the leaf texture
		// supplies all of the silhouette detail anyway
		const geo = new THREE.PlaneGeometry(1, 1);

		const uvOffsets = new Float32Array(cards.length * 2);
		const m = new THREE.Matrix4();
		const p = new THREE.Vector3();
		const s = new THREE.Vector3();
		const c = new THREE.Color();

		const tex = createFoliageTexture();
		const mat = new THREE.MeshStandardMaterial({
			map: tex,
			alphaTest: 0.42,
			side: THREE.DoubleSide,
			roughness: 0.92,
			metalness: 0.0,
		});
		// choose one of four atlas cells per instance (no extra draw calls)
		mat.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader.replace(
				'#include <common>',
				'#include <common>\nattribute vec2 aUvOffset;'
			);
			shader.vertexShader = shader.vertexShader.replace(
				'#include <uv_vertex>',
				'#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * 0.5 + aUvOffset;\n#endif'
			);
			// Thin leaves transmit light: add a warm backlight term when the
			// sun is behind the canopy from the camera's point of view. This
			// keeps silhouetted foliage luminous instead of reading as black
			// spikes, which is the single biggest cue for real leaves.
			shader.fragmentShader = shader.fragmentShader.replace(
				'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
				`vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
				#if NUM_DIR_LIGHTS > 0
					vec3 leafView = normalize( vViewPosition );
					vec3 leafLightDir = directionalLights[ 0 ].direction;
					float leafTrans = pow( clamp( dot( -leafView, leafLightDir ), 0.0, 1.0 ), 2.6 );
					outgoingLight += diffuseColor.rgb * directionalLights[ 0 ].color * leafTrans * 0.32;
				#endif`
			);
		};
		mat.customProgramCacheKey = () => 'leaf-card-atlas';
		this.addWind(mat);

		const mesh = new THREE.InstancedMesh(geo, mat, cards.length);
		cards.forEach((card, i) => {
			uvOffsets[i * 2] = (card.variant % 2) * 0.5;
			uvOffsets[i * 2 + 1] = ((card.variant / 2) | 0) * 0.5;
			p.set(card.x, card.y, card.z);
			s.set(card.sx, card.sy, 1);
			m.compose(p, card.q, s);
			mesh.setMatrixAt(i, m);
			c.setRGB(card.r, card.g, card.b);
			mesh.setColorAt(i, c);
		});
		geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 2));
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.frustumCulled = false;
		mesh.name = 'leaf-cards';
		this.group.add(mesh);
		return mesh;
	}

	buildForest() {
		const treeMat = new THREE.MeshStandardMaterial({
			vertexColors: true,
			roughness: 0.94,
			metalness: 0.0,
		});
		this.addWind(treeMat);

		const broadGeo = this.broadleafGeometry(41, true);
		this.leafBlobs = broadGeo.userData.blobs;
		const coniferGeo = this.coniferGeometry(77);
		const shrubGeo = this.shrubGeometry(133);

		const rand = mulberry32(90210);
		const sunAz = this.sunAzimuth();
		const azOf = (x, z) => {
			let a = Math.atan2(-z, x);
			if (a < 0) a += TAU;
			return a;
		};
		const angularGap = (x, z) => {
			const d = Math.abs(azOf(x, z) - sunAz);
			return d > Math.PI ? TAU - d : d;
		};

		const nearTrees = [];
		const farTrees = [];
		const shrubs = [];

		// mid-distance forest ring
		for (let i = 0; i < 220; i++) {
			const a = rand() * TAU;
			const r = 18.5 + Math.pow(rand(), 0.62) * 52;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			const gap = angularGap(x, z);
			const keep = r > 80 ? 1 : smoothstep(0.16, 0.44, gap);
			if (rand() > keep) continue;
			const y = this.height(x, z);
			const conifer = rand() < 0.34;
			const scale = conifer ? 0.75 + rand() * 0.8 : 0.5 + rand() * 0.72;
			(r > 34 ? farTrees : nearTrees).push({ x, y, z, scale, conifer, rot: rand() * TAU, tint: 0.8 + rand() * 0.38 });
		}

		// a denser, hazier band on the distant hills
		for (let i = 0; i < 300; i++) {
			const a = rand() * TAU;
			const r = 85 + Math.pow(rand(), 0.7) * 105;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			const gap = angularGap(x, z);
			if (gap < 0.11 && rand() < 0.85) continue;
			const y = this.height(x, z);
			farTrees.push({
				x, y, z, scale: 1.7 + rand() * 2.1, conifer: rand() < 0.55,
				rot: rand() * TAU, tint: 0.7 + rand() * 0.3,
			});
		}

		// low shrubs scattered around the bank, kept clear of the camera
		const camAngle = Math.atan2(8.6, 10.6);
		for (let i = 0; i < 70; i++) {
			const a = rand() * TAU;
			const r = 8.2 + Math.pow(rand(), 0.7) * 9.5;
			const x = Math.cos(a) * r;
			const z = Math.sin(a) * r;
			let da = Math.abs(a - camAngle);
			if (da > Math.PI) da = TAU - da;
			if (da < 0.5 && r > 8) continue;
			if (!this.hf.inPond(x, z) && this.hf.height(x, z) > 0.3) {
				shrubs.push({ x, y: this.hf.height(x, z), z, scale: 0.34 + rand() * 0.5, rot: rand() * TAU, tint: 0.85 + rand() * 0.3 });
			}
		}

		const makeInstances = (geo, list, castShadow, receiveShadow) => {
			if (!list.length) return null;
			const mesh = new THREE.InstancedMesh(geo, treeMat, list.length);
			const m = new THREE.Matrix4();
			const q = new THREE.Quaternion();
			const s = new THREE.Vector3();
			const p = new THREE.Vector3();
			const c = new THREE.Color();
			list.forEach((t, i) => {
				p.set(t.x, t.y - 0.06, t.z);
				q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
				s.set(t.scale, t.scale * (0.92 + (i % 7) * 0.025), t.scale);
				m.compose(p, q, s);
				mesh.setMatrixAt(i, m);
				c.setRGB(t.tint, t.tint * (0.97 + (i % 5) * 0.012), t.tint * 0.92);
				mesh.setColorAt(i, c);
			});
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			mesh.castShadow = castShadow;
			mesh.receiveShadow = receiveShadow;
			mesh.frustumCulled = false;
			this.group.add(mesh);
			return mesh;
		};

		const nearBroad = nearTrees.filter((t) => !t.conifer);
		const nearConifer = nearTrees.filter((t) => t.conifer);
		const farBroad = farTrees.filter((t) => !t.conifer);
		const farConifer = farTrees.filter((t) => t.conifer);

		makeInstances(broadGeo, nearBroad, true, false);
		makeInstances(coniferGeo, nearConifer, true, false);
		makeInstances(broadGeo, farBroad, false, false);
		makeInstances(coniferGeo, farConifer, false, false);
		makeInstances(shrubGeo, shrubs, false, true);

		// Hand-placed trees that frame the pond. The large one on screen-left
		// gives the foreground a real silhouette and casts shadows over the bank.
		const heroTrees = [
			{ x: 9.4, z: -1.4, scale: 1.02, rot: 0.6, conifer: false },
			{ x: -1.8, z: -9.8, scale: 1.22, rot: 2.1, conifer: false },
			{ x: -13.6, z: -1.6, scale: 0.88, rot: 4.0, conifer: false },
			{ x: 3.2, z: -12.6, scale: 1.0, rot: 1.3, conifer: false },
			{ x: -8.9, z: -10.4, scale: 0.92, rot: 5.1, conifer: false },
		];

		// a woodland edge right around the far bank: this is what encloses the
		// pond and gives the water something real to reflect
		const rand3 = mulberry32(31415);
		const camAngleShore = Math.atan2(8.6, 10.6);
		const sunShore = Math.atan2(-0.223, -0.975) + TAU;
		for (let i = 0; i < 44; i++) {
			const theta = rand3() * TAU;
			let daCam = Math.abs(theta - camAngleShore);
			if (daCam > Math.PI) daCam = TAU - daCam;
			let daSun = Math.abs(theta - sunShore);
			if (daSun > Math.PI) daSun = TAU - daSun;
			if (daCam < 0.5) continue;
			if (daSun < 0.55 && rand3() < 0.9) continue;
			const R = this.hf.pondRadius(theta);
			const r = R + 0.9 + rand3() * 4.6;
			const x = Math.cos(theta) * r;
			const z = Math.sin(theta) * r;
			const y = this.hf.height(x, z);
			if (y < 0.22) continue;
			heroTrees.push({
				x, z, scale: 0.5 + rand3() * 0.55, rot: rand3() * TAU, conifer: rand3() < 0.22,
			});
		}
		for (const t of heroTrees) {
			const geo = t.conifer ? coniferGeo : broadGeo;
			const mesh = new THREE.Mesh(geo, treeMat);
			mesh.position.set(t.x, this.hf.height(t.x, t.z) - 0.08, t.z);
			mesh.rotation.y = t.rot;
			mesh.scale.setScalar(t.scale);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			this.group.add(mesh);
		}

		// Leaf cards go on every broadleaf crown that is close enough to show
		// detail; the hazy hill band stays as pure silhouette. One instanced
		// mesh covers near, mid-distance and hero trees.
		const cardRand = mulberry32(60613);
		const cards = [];
		this.collectLeafCards(nearBroad, cardRand, cards, 1.0);
		this.collectLeafCards(
			farBroad.filter((t) => Math.hypot(t.x, t.z) < 86),
			cardRand, cards, 0.2
		);
		this.collectLeafCards(heroTrees.filter((t) => !t.conifer), cardRand, cards, 1.7, true);
		this.buildLeafCards(cards);
	}
}
