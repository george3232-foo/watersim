import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0,300)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  const a = window.__pond, sim = a.sim, renderer = sim.renderer;
  sim.setWind(0, 0); sim.rain = 0;
  const N = 256, HALF = 10, DX = 20 / N;
  const buf = new Float32Array(N * N * 4);
  const read = async () => {
    const rt = sim.macroRT[sim.macroIndex];
    await renderer.readRenderTargetPixelsAsync(rt, 0, 0, N, N, buf);
    return buf;
  };
  const at = (b, x, z) => {
    const i = Math.floor((x + HALF) / 20 * N);
    const j = Math.floor((z + HALF) / 20 * N);
    return b[(j * N + i) * 4];
  };
  const stats = (b) => {
    let vol = 0, mx = 0, bad = 0, min = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const eta = b[(j * N + i) * 4];
        if (!Number.isFinite(eta)) { bad++; continue; }
        const x = (i + 0.5) / N * 20 - HALF;
        const z = (j + 0.5) / N * 20 - HALF;
        const h = eta - a.hf.height(x, z);
        if (h > 0) vol += h * DX * DX;
        mx = Math.max(mx, Math.abs(eta));
        min = Math.min(min, eta);
      }
    }
    return { vol: +vol.toFixed(4), maxAbs: +mx.toFixed(4), min: +min.toFixed(4), bad };
  };
  // settle
  for (let s = 0; s < 120; s++) sim.stepMacro(s / 120);
  let b = await read();
  const v0 = stats(b);
  const calm = { center: +at(b, 0, 0).toFixed(5), r1: +at(b, 1, 0).toFixed(5), r2: +at(b, 2, 0).toFixed(5) };
  // strong central impulse
  sim.addImpulse({ x: 0, z: 0, radius: 0.26, amp: -0.10, foam: 0.3, microScale: 1.2 });
  sim.applyImpulses();
  const series = [];
  for (let k = 0; k < 12; k++) {
    for (let s = 0; s < 15; s++) sim.stepMacro(2 + (k * 15 + s) / 120);
    b = await read();
    series.push({ t: +(((k + 1) * 15) / 120).toFixed(3),
      c: +at(b, 0, 0).toFixed(4), r1: +at(b, 1, 0).toFixed(4),
      r2: +at(b, 2, 0).toFixed(4), r3: +at(b, 3, 0).toFixed(4) });
  }
  const v1 = stats(b);
  // max impulse stress
  for (let i = 0; i < 24; i++) sim.addImpulse({ x: -2 + (i % 6) * 0.8, z: -1 + Math.floor(i / 6) * 0.8, radius: 0.32, amp: -0.14, flowX: 1, flowZ: 0, flowStrength: 0.6, foam: 0.7, microScale: 1.7 });
  for (let n = 0; n < 4; n++) { sim.applyImpulses(); for (let s = 0; s < 60; s++) sim.stepMacro(4 + n * 0.5 + s / 120); }
  b = await read();
  const v2 = stats(b);
  return { v0, calm, series, v1, v2 };
});
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
