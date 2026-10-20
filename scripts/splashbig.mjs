import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
await page.route('**/@vite/client*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext=()=>({on(){},off(){},send(){},accept(){},dispose(){},decline(){},invalidate(){}});export const injectQuery=(u)=>u;export const removeTimestampQuery=(u)=>u;export const updateStyle=()=>{};' }));
const logs=[]; page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push(m.text())}); page.on('pageerror',e=>logs.push('ERR '+e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
	const a = window.__pond;
	a.controls.autoRotate = false;
	a.camera.position.set(3.4, 2.0, 3.4);
	a.controls.target.set(0.1, 0.05, 0.1);
	a.controls.update();
	cancelAnimationFrame(a._raf); a._raf = 0;
	const sp = a.splash;
	sp.splashAt(0.3, 0.2, 0.5, { radius: 0.075, vy: -8 });
	for (let i = 0; i < 8; i++) sp.update(0.035, a.time + i * 0.035);
	for (let i = 0; i < sp.maxDroplets; i++) if (sp._alive[i]) { sp._size[i] = 0.12; sp._alpha[i] = 1; }
	for (const r of sp._rings) if (r.active) { r.alpha0 = 0.9; }
	sp.update(0.001, a.time + 0.3);
	a.engine.renderScene(a.scene, a.camera, a.sky);
	a.engine.renderComposite(a.scene, a.water.scene, null, a.camera);
	a.engine.post(a.time, a.sunScreen);
});
console.log('state', JSON.stringify(await page.evaluate(() => {
	const sp = window.__pond.splash; let alive = 0;
	for (let i = 0; i < sp.maxDroplets; i++) alive += sp._alive[i];
	return { alive, draw: sp._particleGeo.drawRange.count, rings: sp._rings.filter(r=>r.active).length };
})));
await page.screenshot({ path: '/tmp/splash-big.png' });
console.log('logs', logs.slice(0,5).join(' | '));
await browser.close();
