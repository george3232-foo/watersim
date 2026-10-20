import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);

const result = await page.evaluate(async () => {
  const a = window.__pond, sim = a.sim, renderer = sim.renderer;
  const N = sim.macroSize;
  const buf = new Float32Array(N * N * 4);
  const read = async () => {
    await renderer.readRenderTargetPixelsAsync(sim.macroRT[sim.macroIndex], 0, 0, N, N, buf);
    return buf;
  };
  const scan = (b) => {
    let min = Infinity, max = -Infinity, bad = 0, vol = 0, wet = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 4;
        const h = b[k];
        if (!Number.isFinite(h) || !Number.isFinite(b[k + 1]) || !Number.isFinite(b[k + 2]) || !Number.isFinite(b[k + 3])) bad++;
        const bed = sim.hf.height(-10 + (i + 0.5) * 20 / N, -10 + (j + 0.5) * 20 / N);
        const d = Math.max(0, h - bed);
        if (d > 0) { wet++; vol += d * (20 / N) ** 2; }
        if (h < min) min = h; if (h > max) max = h;
      }
    }
    return { min: +min.toFixed(4), max: +max.toFixed(4), bad, vol: +vol.toFixed(4), wet };
  };
  sim.setWind(1.0, 2.75);
  sim.setRain(1.0);
  sim.init();
  await new Promise(r => setTimeout(r, 100));
  const b0 = await read();
  const before = scan(b0);
  const t0 = performance.now();
  while (performance.now() - t0 < 7000) {
    await new Promise(r => requestAnimationFrame(r));
  }
  const b1 = await read();
  const after = scan(b1);
  const M = sim.microSize;
  const mbuf = new Float32Array(M * M * 4);
  await renderer.readRenderTargetPixelsAsync(sim.microRT[sim.microIndex], 0, 0, M, M, mbuf);
  let microBad = 0, microMax = 0;
  for (let i = 0; i < mbuf.length; i++) {
    if (!Number.isFinite(mbuf[i])) microBad++;
    if (Math.abs(mbuf[i]) > microMax && (i % 4) === 0) microMax = Math.abs(mbuf[i]);
  }
  return { before, after, microBad, microMax: +microMax.toFixed(4), steps: sim.totalSteps, readback: sim.readbackCount, hasReadback: sim.hasReadback, wind: sim.windStrength, rain: sim.rain, errors: [] };
});
console.log(JSON.stringify({ result, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
