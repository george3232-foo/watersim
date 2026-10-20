import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const a = window.__pond;
  const s = a.terrain.material.userData.shader;
  const vs = s.vertexShader;
  const idx = vs.indexOf('vWPos =');
  const begin = vs.indexOf('#include <begin_vertex>');
  const pos = a.terrain.geometry.attributes.position;
  let minY=1e9,maxY=-1e9;
  for (let i=0;i<pos.count;i++){ const y=pos.getY(i); if(y<minY)minY=y; if(y>maxY)maxY=y; }
  return {
    assignment: vs.slice(idx-500, idx+400),
    begin: vs.slice(begin-100, begin+200),
    bounds: { minY, maxY },
    sceneTransform: a.terrain.mesh.matrixWorld.elements,
    vWPosUniformTest: a.terrain.uniforms.uWaterLevel.value,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
