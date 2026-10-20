import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('console', m => { if (m.type()==='error') console.log('err', m.text().slice(0,300)); });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
console.log('three import', await page.evaluate(async () => {
	try {
		const m = await import('/node_modules/three/build/three.module.js');
		window.__THREE = m;
		return { ok: true, rev: m.REVISION };
	} catch (e) { return { ok: false, err: String(e) }; }
}));
await page.evaluate(() => {
	const a = window.__pond;
	a.controls.autoRotate = false;
	a.camera.position.set(3.4, 2.0, 3.4);
	a.controls.target.set(0.1, 0.05, 0.1);
	a.controls.update();
	const THREE = window.__THREE;
	const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
	const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
	const cube = new THREE.Mesh(geo, mat);
	cube.position.set(0.3, 0.35, 0.2);
	cube.renderOrder = 25;
	a.scene.add(cube);
	window.__cube = cube;
});
await page.waitForTimeout(300);
// pause loop, screenshot with cube and water
await page.evaluate(() => { const a = window.__pond; cancelAnimationFrame(a._raf); a._raf = 0; });
await page.screenshot({ path: '/tmp/depth-cube.png' });
// hide cube, rerender same frame, screenshot
await page.evaluate(() => {
	const a = window.__pond;
	window.__cube.visible = false;
	a.engine.renderScene(a.scene, a.camera, a.sky);
	a.engine.renderComposite(a.scene, a.water.scene, null, a.camera);
	a.engine.post(a.time, a.sunScreen);
});
await page.screenshot({ path: '/tmp/depth-nocube.png' });
await browser.close();
