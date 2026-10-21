import { App } from './App.js';

const canvas = document.getElementById('scene');
let app;
try {
	app = new App(canvas);
	window.__pond = app;
	app.ready = true;
} catch (err) {
	// Unsupported graphics is an expected, user-facing capability state rather
	// than a recoverable application exception. Keep it out of the console error
	// channel so automated/browser diagnostics can distinguish it from a bug.
	if (err?.code !== 'UNSUPPORTED_DEVICE') console.error(err);
	const status = document.querySelector('.load-status');
	if (status) status.textContent = err.code === 'UNSUPPORTED_DEVICE'
		? 'this browser or device cannot render the pond — ' + err.message
		: 'the pond could not start — ' + err.message;
	if (status) {
		status.setAttribute('role', 'alert');
		status.setAttribute('aria-live', 'assertive');
	}
	const loading = document.getElementById('loading');
	if (loading) loading.setAttribute('aria-busy', 'false');
}

// cursor
const cursor = document.createElement('div');
cursor.id = 'custom-cursor';
document.getElementById('app').appendChild(cursor);
window.addEventListener('pointermove', (e) => {
	cursor.style.left = e.clientX + 'px';
	cursor.style.top = e.clientY + 'px';
	cursor.classList.add('visible');
});
window.addEventListener('pointerleave', () => cursor.classList.remove('visible'));

// UI wiring
const timeSlider = document.getElementById('time-slider');
const timeOut = document.getElementById('time-out');
const windSlider = document.getElementById('wind-slider');
const windOut = document.getElementById('wind-out');
const rainSlider = document.getElementById('rain-slider');
const rainOut = document.getElementById('rain-out');

function fmtTime(h) {
	const hh = Math.floor(h) % 24;
	const mm = Math.round((h - Math.floor(h)) * 60);
	return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}
if (app) {
	timeSlider.addEventListener('input', () => {
		const v = parseFloat(timeSlider.value);
		timeOut.textContent = fmtTime(v);
		app.setTime(v);
		document.querySelectorAll('.chip[data-preset]').forEach((c) => c.classList.remove('active'));
	});
	windSlider.addEventListener('input', () => {
		const v = parseFloat(windSlider.value);
		windOut.textContent = Math.round(v * 100) + '%';
		app.setWind(v, 2.75);
	});
	rainSlider.addEventListener('input', () => {
		const v = parseFloat(rainSlider.value);
		rainOut.textContent = Math.round(v * 100) + '%';
		app.setRain(v);
	});
	document.getElementById('quality-select').addEventListener('change', (e) => app.setQuality(e.currentTarget.value));
	timeOut.textContent = fmtTime(parseFloat(timeSlider.value));
	windOut.textContent = Math.round(parseFloat(windSlider.value) * 100) + '%';

	document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
		document.querySelectorAll('.mode').forEach((x) => x.classList.remove('active'));
		b.classList.add('active');
		const throwables = document.getElementById('throwables');
		throwables.classList.toggle('off', b.dataset.mode !== 'throw');
		app.setMode(b.dataset.mode);
	}));
	document.querySelectorAll('.throwable').forEach((b) => b.addEventListener('click', () => {
		document.querySelectorAll('.throwable').forEach((x) => x.classList.remove('active'));
		b.classList.add('active');
		app.setThrowable(b.dataset.object);
	}));

	document.querySelectorAll('.chip[data-preset]').forEach((b) => b.addEventListener('click', () => {
		const presets = {
			golden: { t: 18.8, wind: 0.4, rain: 0 },
			dawn: { t: 6.6, wind: 0.12, rain: 0 },
			overcast: { t: 14.0, wind: 0.5, rain: 0.05 },
			rain: { t: 16.1, wind: 0.9, rain: 0.8 },
			night: { t: 22.2, wind: 0.18, rain: 0 },
		};
		const p = presets[b.dataset.preset];
		if (!p) return;
		timeSlider.value = p.t; windSlider.value = p.wind; rainSlider.value = p.rain;
		app.setTime(p.t);
		app.setWind(p.wind, 2.75);
		app.setRain(p.rain);
		document.querySelectorAll('.chip[data-preset]').forEach((c) => c.classList.remove('active'));
		b.classList.add('active');
	}));

	document.getElementById('conditions-toggle').addEventListener('click', (e) => {
		const collapsed = document.getElementById('conditions').classList.toggle('collapsed');
		e.currentTarget.textContent = collapsed ? '⚙' : '−';
		e.currentTarget.title = collapsed ? 'Expand' : 'Collapse';
	});
	document.getElementById('sound-btn').addEventListener('click', () => {
		void app.audio.init();
		app.toggleMute();
	});
	document.getElementById('help-btn').addEventListener('click', () => {
		document.getElementById('help').classList.toggle('hidden');
	});
	document.getElementById('help-close').addEventListener('click', () => {
		document.getElementById('help').classList.add('hidden');
	});
	document.getElementById('help').addEventListener('click', (e) => {
		if (e.target.id === 'help') document.getElementById('help').classList.add('hidden');
	});
	document.getElementById('photo-exit').addEventListener('click', () => app.setPhotoMode(false));

	window.addEventListener('keydown', (e) => {
		const target = e.target;
		const editable = target && (target.matches?.('input, select, textarea') || target.isContentEditable);
		if (editable) return;
		if (e.repeat && ['h', 'H', 'p', 'P', 'm', 'M', 'r', 'R'].includes(e.key)) return;
		if (e.key === 'Escape') {
			document.getElementById('help').classList.add('hidden');
			if (document.body.classList.contains('photo')) app.setPhotoMode(false);
			app.cancelPointerInteraction();
			return;
		}
		if (e.key === 'h' || e.key === 'H') document.getElementById('help').classList.toggle('hidden');
		if (e.key === 'p' || e.key === 'P') app.setPhotoMode(!document.body.classList.contains('photo'));
		if (e.key === 'm' || e.key === 'M') { void app.audio.init(); app.toggleMute(); }
		if (e.key === 'r' || e.key === 'R') app.toggleRain();
		const modes = { '1': 'throw', '2': 'touch', '3': 'feed' };
		if (modes[e.key]) {
			const btn = document.querySelector(`.mode[data-mode="${modes[e.key]}"]`);
			btn?.click();
		}
	});
}
