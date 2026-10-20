import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const s = window.__pond.terrain.material.userData.shader;
  if (!s) return { err: 'no shader' };
  const vs = s.vertexShader;
  const fs = s.fragmentShader;
  const vsIdx = vs.indexOf('vWPos');
  const fsIdx = fs.indexOf('float y = wp.y');
  return {
    vsLines: vs.slice(Math.max(0,vsIdx-300), vsIdx+500),
    fsLines: fs.slice(Math.max(0,fsIdx-200), fsIdx+700),
    uniforms: Object.keys(s.uniforms),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
