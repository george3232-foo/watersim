import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0,300)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1000);
const out = await page.evaluate(async () => {
  const a = window.__pond, sim = a.sim, renderer = sim.renderer;
  sim.init();
  sim.setWind(0, 0); sim.rain = 0;
  const N = 256, HALF = 10, DX = 20 / N;
  const buf = new Float32Array(N * N * 4);
  const read = async () => {
    await renderer.readRenderTargetPixelsAsync(sim.macroRT[sim.macroIndex], 0, 0, N, N, buf);
    return buf;
  };
  const at = (b, x, z) => {
    const i = Math.floor((x + HALF) / 20 * N), j = Math.floor((z + HALF) / 20 * N);
    return b[(j * N + i) * 4];
  };
  const stats = (b) => {
    let vol = 0, wetMax = -9, wetMin = 9, bad = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const eta = b[(j * N + i) * 4];
      if (!Number.isFinite(eta)) { bad++; continue; }
      const x = (i + 0.5) / N * 20 - HALF, z = (j + 0.5) / N * 20 - HALF;
      const h = eta - a.hf.height(x, z);
      if (h > 0.002) { vol += h * DX * DX; wetMax = Math.max(wetMax, eta); wetMin = Math.min(wetMin, eta); }
    }
    return { vol: +vol.toFixed(3), wetMax: +wetMax.toFixed(4), wetMin: +wetMin.toFixed(4), bad };
  };
  let b = await read();
  const base = stats(b);
  const basePts = { c: at(b,0,0), r05: at(b,0.5,0), r1: at(b,1,0), r15: at(b,1.5,0), r2: at(b,2,0) };
  sim.addImpulse({ x: 0, z: 0, radius: 0.24, amp: -0.12, foam: 0.3, microScale: 1.0 });
  sim.applyImpulses();
  const series = [];
  for (let k = 0; k < 16; k++) {
    for (let s = 0; s < 6; s++) sim.stepMacro((k * 6 + s) / 120);
    b = await read();
    series.push({ t: +(((k + 1) * 6) / 120).toFixed(3),
      c: +(at(b,0,0)-basePts.c).toFixed(4),
      r05: +(at(b,0.5,0)-basePts.r05).toFixed(4),
      r1: +(at(b,1,0)-basePts.r1).toFixed(4),
      r15: +(at(b,1.5,0)-basePts.r15).toFixed(4),
      r2: +(at(b,2,0)-basePts.r2).toFixed(4) });
  }
  const after = stats(b);
  return { base, basePts, series, after };
});
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
