// Nonblocking, bounded whole-frame timing. Never nest TIME_ELAPSED queries.
export class GpuTimer {
	constructor(renderer, enabled = true) {
		this.gl = renderer.getContext();
		this.ext = enabled && renderer.extensions.has('EXT_disjoint_timer_query_webgl2')
			? renderer.extensions.get('EXT_disjoint_timer_query_webgl2') : null;
		this.pending = [];
		this.active = null;
		this.stats = {
			supported: !!this.ext, label: 'GPU elapsed (asynchronous)', unit: 'ms',
			frame: null, frameId: null, samples: 0, pending: 0, disjoint: false,
		};
	}

	begin(frameId) {
		if (!this.ext || this.gl.isContextLost()) return;
		const gl = this.gl;
		if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
			this.stats.disjoint = true;
			this.stats.frame = null;
			for (const entry of this.pending) gl.deleteQuery(entry.query);
			this.pending.length = 0;
		} else {
			while (this.pending.length && gl.getQueryParameter(this.pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
				const entry = this.pending.shift();
				this.stats.frame = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6;
				this.stats.frameId = entry.frameId;
				this.stats.samples++;
				this.stats.disjoint = false;
				gl.deleteQuery(entry.query);
			}
			// Sample one frame in four, with at most four unresolved queries.
			if (frameId % 4 === 0 && this.pending.length < 4 && !this.active && !gl.getQuery(this.ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
				const query = gl.createQuery();
				if (query) {
					gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
					this.active = { query, frameId };
				}
			}
		}
		this.stats.pending = this.pending.length + (this.active ? 1 : 0);
	}

	end() {
		if (!this.active) return;
		if (!this.gl.isContextLost()) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
		this.pending.push(this.active);
		this.active = null;
		this.stats.pending = this.pending.length;
	}

	dispose() {
		this.end();
		for (const entry of this.pending) this.gl.deleteQuery(entry.query);
		this.pending.length = 0;
		this.stats.pending = 0;
		this.ext = null;
	}
}
