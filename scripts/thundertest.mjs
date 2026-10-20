import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(1200);
await page.mouse.click(450, 300);
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.chip[data-preset="rain"]')?.click());
await page.waitForTimeout(1800);
const setup = await page.evaluate(() => {
  const a = window.__pond;
  a.__thunderCalls = [];
  const orig = a.audio.thunder.bind(a.audio);
  a.audio.thunder = (delay, intensity) => {
    a.__thunderCalls.push({ delay: +delay.toFixed(2), intensity: +intensity.toFixed(2), t: +a.time.toFixed(2) });
    return orig(delay, intensity);
  };
  a.sky.nextFlash = 0.01;
  return { audioReady: a.audio.ready, ctx: a.audio.ctx?.state, storm: a.sky.storm, muted: a.audio.muted };
});
await page.waitForTimeout(4500);
const result = await page.evaluate(() => {
  const a = window.__pond;
  return {
    calls: a.__thunderCalls,
    flashAge: a.sky.flashAge,
    flash: a.sky.flash,
    boltVisible: a.sky.bolt.visible,
    boltChildren: a.sky.bolt.children.length,
    ctx: a.audio.ctx?.state,
    rain: a.sim.rain,
    wind: a.sim.windStrength,
  };
});
console.log(JSON.stringify({ setup, result, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
