import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1152, height: 720 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const rects = await page.evaluate(() => {
  const ids = ['toolbar', 'hint', 'conditions', 'brand', 'right-stack'];
  const out = { viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } };
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[id] = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, display: cs.display, opacity: cs.opacity, bottomCss: cs.bottom };
  }
  const row = document.querySelector('.throwables');
  const rr = row.getBoundingClientRect();
  out.throwables = { x: rr.x, y: rr.y, w: rr.width, h: rr.height, bottom: rr.bottom };
  out.throwableLabels = [...document.querySelectorAll('.throwable span')].slice(0, 3).map(e => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent, y: r.y, h: r.height, bottom: r.bottom, opacity: getComputedStyle(e).opacity };
  });
  return out;
});
console.log(JSON.stringify(rects, null, 2));
await page.screenshot({ path: '/tmp/ui-measure.png' });
await browser.close();
