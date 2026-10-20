import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
const out = await page.evaluate(async () => {
  const a = window.__pond, sim = a.sim, renderer = sim.renderer;
  sim.init(); sim.setWind(0,0); sim.rain=0;
  const N=256, HALF=10; const buf=new Float32Array(N*N*4);
  const read=async()=>{ await renderer.readRenderTargetPixelsAsync(sim.macroRT[sim.macroIndex],0,0,N,N,buf); return buf; };
  const at=(b,x,z)=>{const i=Math.floor((x+HALF)/20*N),j=Math.floor((z+HALF)/20*N);return b[(j*N+i)*4];};
  sim.addImpulse({ x:0, z:0, radius:1.0, amp:-0.08, foam:0.3, microScale:1.0 });
  sim.applyImpulses();
  const series=[];
  for(let k=0;k<24;k++){
    for(let s=0;s<20;s++) sim.stepMacro((k*20+s)/120);
    const b=await read();
    series.push({t:+((k+1)*20/120).toFixed(2), c:+at(b,0,0).toFixed(4), r1:+at(b,1,0).toFixed(4), r2:+at(b,2,0).toFixed(4), r3:+at(b,3,0).toFixed(4), r4:+at(b,4,0).toFixed(4)});
  }
  return series;
});
console.log(JSON.stringify(out));
await browser.close();
