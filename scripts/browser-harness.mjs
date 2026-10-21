import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportedWarningRules = [{
	pattern: /GL Driver Message \(OpenGL, Performance, [^)]+\): GPU stall due to ReadPixels/,
	reason: 'Driver readback-stall diagnostic; explicitly reported, never treated as performance evidence.',
}, {
	pattern: /EXT_color_buffer_float extension not supported/,
	reason: 'Expected capability-mask diagnostic in the half-float compatibility test.',
}, {
	pattern: /Failed to load resource: net::ERR_NETWORK_CHANGED/,
	reason: 'Transient loopback/Vite navigation diagnostic; navigation is retried before the readiness assertion.',
}];

function argument(name) {
	const index = process.argv.indexOf(name);
	if (index >= 0) {
		assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${name} requires a value`);
		return process.argv[index + 1];
	}
	return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function positiveNumber(value, fallback, name) {
	const number = Number(value ?? fallback);
	assert.ok(Number.isFinite(number) && number > 0, `${name} must be a positive number`);
	return number;
}

export function browserOptions() {
	const requested = argument('--gpu') || (process.argv.includes('--software') ? 'swiftshader' : process.env.POND_BROWSER_GPU) || 'hardware';
	const gpu = requested === 'software' ? 'swiftshader' : requested;
	assert.ok(['hardware', 'swiftshader'].includes(gpu), 'POND_BROWSER_GPU/--gpu must be hardware or swiftshader');
	return {
		gpu,
		headless: !process.argv.includes('--headed') && process.env.POND_HEADLESS !== '0',
		args: [
			'--use-gl=angle', `--use-angle=${gpu === 'hardware' ? 'gl' : 'swiftshader'}`,
			'--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-sandbox',
			...(gpu === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
		],
		...(process.env.POND_CHROMIUM_EXECUTABLE ? { executablePath: process.env.POND_CHROMIUM_EXECUTABLE } : {}),
	};
}

export function outputDirectory() {
	return path.resolve(argument('--output-dir') || process.env.POND_OUTPUT_DIR || path.join(root, 'tests/artifacts'));
}

export function viewportFromEnvironment(defaultWidth = 1152, defaultHeight = 720) {
	return {
		width: Math.round(positiveNumber(process.env.W, defaultWidth, 'W')),
		height: Math.round(positiveNumber(process.env.H, defaultHeight, 'H')),
	};
}

export async function readStats(page) {
	return page.evaluate(() => window.__pond.getStats());
}

export async function waitForFrames(page, count = 3) {
	const frame = await page.evaluate(() => window.__pond.frame);
	await page.waitForFunction((target) => window.__pond.frame >= target, frame + count);
}

export async function navigate(session, url, options = {}) {
	const { attempts = 3, ...gotoOptions } = options;
	let lastError = null;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await session.page.goto(url, {
				waitUntil: 'domcontentloaded', timeout: session.readyTimeout, ...gotoOptions,
			});
		} catch (error) {
			lastError = error;
			if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED/.test(String(error))) throw error;
			await session.page.waitForTimeout(150 * (attempt + 1));
		}
	}
	throw lastError;
}

export async function openPond(session, query = '?quality=low') {
	const { page, baseURL, readyTimeout } = session;
	const response = await navigate(session, `${baseURL}/${query}`);
	assert.ok(response?.ok(), `Vite returned ${response?.status()} for the application`);
	return waitForPond(session);
}

export async function waitForPond(session) {
	const { page, readyTimeout } = session;
	await page.waitForFunction(() => window.__pond?.ready === true, null, { timeout: readyTimeout });
	await page.waitForFunction(() => {
		const loading = document.getElementById('loading');
		return !loading || getComputedStyle(loading).display === 'none'
			|| (getComputedStyle(loading).pointerEvents === 'none' && Number(getComputedStyle(loading).opacity) < 0.1);
	}, null, { timeout: readyTimeout });
	await page.evaluate(() => {
		window.__pond.controls.autoRotate = false;
		window.__pond.controls.update();
	});
	await waitForFrames(page);
	session.runtime = await page.evaluate(() => {
		const gl = window.__pond.engine.renderer.getContext();
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		return {
			userAgent: navigator.userAgent,
			renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
			vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
		};
	});
	return readStats(page);
}

// Each invocation owns its server, Chromium, context, and page. Port 0 asks the
// OS for an available loopback port, avoiding both races and unrelated dev servers.
async function withBrowserSessionOnce(name, run, options = {}) {
	assert.match(name, /^[a-z0-9-]+$/, 'artifact run name must be a safe slug');
	const launch = browserOptions();
	const { gpu, ...launchOptions } = launch;
	const outputDir = options.outputDir || outputDirectory();
	const readyTimeout = positiveNumber(process.env.POND_READY_TIMEOUT_MS, 60000, 'POND_READY_TIMEOUT_MS');
	const consoleMessages = [];
	const pageErrors = [];
	const failures = [];
	const started = performance.now();
	let server, browser, context, result;
	const session = {
		outputDir, gpu, readyTimeout,
		async report(filename, data) {
			assert.equal(path.basename(filename), filename, 'report filename cannot escape the output directory');
			await mkdir(outputDir, { recursive: true });
			const destination = path.join(outputDir, filename);
			await writeFile(destination, `${JSON.stringify(data, null, 2)}\n`);
			return destination;
		},
		async screenshot(filename) {
			assert.equal(path.basename(filename), filename, 'screenshot filename cannot escape the output directory');
			await mkdir(outputDir, { recursive: true });
			const destination = path.join(outputDir, filename);
			await session.page.screenshot({ path: destination, timeout: readyTimeout });
			return destination;
		},
	};
	try {
		server = await createServer({
			root,
			clearScreen: false,
			server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
		});
		await server.listen();
		const address = server.httpServer.address();
		assert.ok(address && typeof address === 'object');
		session.baseURL = `http://127.0.0.1:${address.port}`;
		browser = await chromium.launch(launchOptions);
		context = await browser.newContext({
			viewport: options.viewport || viewportFromEnvironment(),
			deviceScaleFactor: 1,
			...(options.hasTouch ? { hasTouch: true, isMobile: true } : {}),
		});
		const page = await context.newPage();
		session.page = page;
		session.context = context;
		page.setDefaultTimeout(readyTimeout);
		page.on('console', (message) => {
			if (!['warning', 'error'].includes(message.type())) return;
			const rule = message.type() === 'warning' && reportedWarningRules.find(({ pattern }) => pattern.test(message.text()));
			consoleMessages.push({ type: message.type(), text: message.text(), location: message.location(), reportedReason: rule?.reason });
		});
		page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
		result = await run(session);
	} catch (error) {
		failures.push(error);
	} finally {
		// A failed assertion, navigation, screenshot, or browser launch still closes
		// every resource that was successfully created. Cleanup errors also fail.
		for (const resource of [context, browser, server]) {
			if (!resource) continue;
			try { await resource.close(); } catch (error) { failures.push(error); }
		}
		for (const message of consoleMessages) {
			if (message.reportedReason) console.warn(`[reported browser warning] ${message.text}\n${message.reportedReason}`);
			else failures.push(new Error(`Browser console ${message.type}: ${message.text}`));
		}
		for (const error of pageErrors) failures.push(new Error(`Browser pageerror: ${error}`));
		try {
			await session.report(`${name}-diagnostics.json`, {
				name, url: session.baseURL, gpu, args: launch.args,
				viewport: options.viewport || viewportFromEnvironment(), runtime: session.runtime,
				elapsedMs: performance.now() - started,
				console: consoleMessages, pageErrors,
				passed: failures.length === 0,
				failures: failures.map((error) => error.stack || String(error)),
			});
		} catch (error) { failures.push(error); }
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, `${name} failed; see ${outputDir}/${name}-diagnostics.json`);
	return result;
}

function isTransientLoopbackFailure(error) {
	const errors = error?.errors || [];
	const text = [error, ...errors].map((item) => item?.stack || item?.message || String(item)).join('\n');
	return /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED/.test(text);
}

// Chromium occasionally reports a transient network change while a loopback
// Vite server is being replaced between isolated sessions. Retry the entire
// owned session once, but never retry assertion failures or browser errors that
// are not clearly transport-level. A persistent failure still exits nonzero.
export async function withBrowserSession(name, run, options = {}) {
	try {
		return await withBrowserSessionOnce(name, run, options);
	} catch (error) {
		if (!isTransientLoopbackFailure(error)) throw error;
		await new Promise((resolve) => setTimeout(resolve, 250));
		return withBrowserSessionOnce(name, run, options);
	}
}
