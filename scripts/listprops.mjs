import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__pond && window.__pond.ready, null, { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => {
	const a = window.__pond;
	const walk = (o, depth=0) => ({ name:o.name, type:o.type, isMesh:!!o.isMesh, isInstanced:!!o.isInstancedMesh, kids: depth<2 ? o.children.slice(0,8).map(c=>walk(c,depth+1)) : undefined });
	return { props: walk(a.props.group), landscape: walk(a.landscape.group), sceneKids: a.scene.children.map(c=>({name:c.name,type:c.type,vis:c.visible})) };
}), null, 2));
await browser.close();
