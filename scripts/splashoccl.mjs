import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
await page.route('**/@vite/client*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext=()=>({on(){},off(){},send(){},accept(){},dispose(){},decline(){},invalidate(){}});export const injectQuery=(u)=>u;export const removeTimestampQuery=(u)=>u;export const updateStyle=()=>{};' }));
const logs=[]; page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push(m.text())}); page.on('pageerror',e=>logs.push('ERR '+e.message));
await page.goto('http://localhost:5173/?quality=low',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__pond&&window.__pond.ready,null,{timeout:90000});
await page.waitForTimeout(900);
await page.evaluate(()=>{
	const a=window.__pond;
	a.controls.autoRotate=false;
	a.camera.position.set(3.4,2.0,3.4);
	a.controls.target.set(0.1,0.05,0.1);
	a.controls.update();
	a.setThrowable('stone');
	a.throwAt(0.3,0.2);
});
await page.waitForFunction(()=>{const a=window.__pond;if(!a)return false;const b=a.throwables.bodies.find(x=>x.type==='stone');return b&&b.submerged>0.1;},null,{timeout:90000,polling:50});
await page.waitForFunction(()=>window.__pond.splash._particleGeo.drawRange.count>0,null,{timeout:30000,polling:50});
const t0=await page.evaluate(()=>window.__pond.time);
await page.waitForFunction(t=>window.__pond.time>=t,null,{timeout:60000,polling:50},t0+0.30);
await page.evaluate(()=>{const a=window.__pond;cancelAnimationFrame(a._raf);a._raf=0;});
const info = await page.evaluate(()=>{
	const a=window.__pond, sp=a.splash;
	let maxY=-9, minY=9, alive=0;
	for(let i=0;i<sp.maxDroplets;i++)if(sp._alive[i]){alive++;maxY=Math.max(maxY,sp._py[i]);minY=Math.min(minY,sp._py[i]);}
	const surf={height:0,depth:0}; a.sim.sampleSurface(0.3,0.2,surf);
	return {alive,minY:+minY.toFixed(3),maxY:+maxY.toFixed(3),simEta:+surf.height.toFixed(3),bed:+a.hf.height(0.3,0.2).toFixed(3),level:+a.sim.levelOffset.toFixed(3), bodies:a.throwables.bodies.map(b=>({y:+b.pos.y.toFixed(2),vy:+b.vel.y.toFixed(2),sub:+b.submerged.toFixed(2)}))};
});
console.log('info', JSON.stringify(info));
await page.screenshot({path:'/tmp/splash-occl-A.png'});
await page.evaluate(()=>{
	const a=window.__pond;
	a.splash.group.visible=false;
	a.engine.renderScene(a.scene,a.camera,a.sky);
	a.engine.renderComposite(a.scene,a.water.scene,null,a.camera);
	a.engine.post(a.time,a.sunScreen);
});
await page.screenshot({path:'/tmp/splash-occl-B.png'});
// (marker test omitted)
console.log('logs',logs.slice(0,6).join(' | '));
await browser.close();
