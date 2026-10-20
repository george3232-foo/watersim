import { chromium } from 'playwright';
for (const headless of [true, false]) {
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await page.goto('data:text/html,<body><canvas id=c width=300 height=200></canvas><script>window.n=0;const g=document.getElementById("c").getContext("2d");function t(){window.n++;g.fillStyle="hsl("+(window.n%360)+",80%,50%)";g.fillRect(0,0,300,200);requestAnimationFrame(t)}requestAnimationFrame(t)</script>');
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => window.n);
  await page.waitForTimeout(1500);
  const second = await page.evaluate(() => window.n);
  console.log(JSON.stringify({headless, first, second}));
  await browser.close();
}
