import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({
  readback: window.__pond.sim.readbackCount,
  frames: window.__pond.frameCount, steps: window.__pond.sim.stepsThisFrame,
  pending: window.__pond.sim.pending.length,
  surf: window.__pond.sim.surfaceAt(0.5, 0.5),
}));
console.log({ errors, state });
await browser.close();
