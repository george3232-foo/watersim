import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
const info = await page.evaluate(async () => {
	window.__THREE = await import('/node_modules/three/build/three.module.js');
	const a = window.__pond;
	a.controls.autoRotate = false;
	a.camera.position.set(3.4, 2.0, 3.4);
	a.controls.target.set(0.1, 0.05, 0.1);
	a.controls.update();
	cancelAnimationFrame(a._raf); a._raf = 0;
	const THREE = window.__THREE;
	const cube = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
	cube.position.set(0, 0.6, 0);
	a.scene.add(cube);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute([0,0.6,0, 0.2,0.8,0, -0.2,0.9,0], 3));
	const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffff00, size: 0.3, sizeAttenuation: true }));
	pts.frustumCulled = false;
	a.scene.add(pts);
	a.scene.updateMatrixWorld(true);
	const v = cube.position.clone().project(a.camera);
	return {
		parent: cube.parent === a.scene,
		visible: cube.visible,
		pos: cube.position.toArray(),
		screen: [v.x, v.y, v.z],
		count: a.scene.children.length,
		callsBefore: a.engine.renderer.info.render.calls,
	};
});
console.log('info', JSON.stringify(info));
console.log('after render', await page.evaluate(() => {
	const a = window.__pond;
	a.engine.renderScene(a.scene, a.camera, a.sky);
	const calls = a.engine.renderer.info.render.calls;
	const tris = a.engine.renderer.info.render.triangles;
	a.engine.renderComposite(a.scene, a.water.scene, null, a.camera);
	a.engine.post(a.time, a.sunScreen);
	return { calls, tris };
}));
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/depth3.png' });
await browser.close();
