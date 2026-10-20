import { chromium } from 'playwright';
const sets = [
  ['--disable-gpu-vsync', '--disable-frame-rate-limit'],
  ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
];
for (const extra of sets) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...extra] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const a = await page.evaluate(() => ({ frame: window.__pond.frame, time: window.__pond.time, steps: window.__pond.sim.totalSteps }));
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => ({ frame: window.__pond.frame, time: window.__pond.time, steps: window.__pond.sim.totalSteps }));
  console.log(JSON.stringify({ extra, a, b }));
  await browser.close();
}
