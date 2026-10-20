import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	// GitHub Pages serves this project from /watersim/. Relative asset URLs keep
	// the production build portable across project pages and custom domains.
	base: command === 'build' ? './' : '/',
}));
