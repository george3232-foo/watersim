import { chromium } from 'playwright';
const configs = [
  { name: 'headless-angle-gl', headless: true, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] },
  { name: 'headless-egl', headless: true, args: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-gpu'] },
  { name: 'headed-angle-gl', headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'] },
];
for (const cfg of configs) {
  try {
    const browser = await chromium.launch({ headless: cfg.headless, args: ['--no-sandbox', ...cfg.args] });
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await page.goto('data:text/html,<canvas id=c></canvas>');
    const info = await page.evaluate(() => {
      const gl = document.getElementById('c').getContext('webgl2');
      if (!gl) return { webgl2: false };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    console.log(cfg.name, JSON.stringify(info));
    await browser.close();
  } catch (e) { console.log(cfg.name, 'ERR', e.message.split('\n')[0]); }
}
