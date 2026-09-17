import type { ViewportState } from './viewer';

/** Window-local UI state survives app reloads without changing vault files. */
export function viewportSession(doc: Document, vault: string, file: string) {
	const key = `extended-file-support:pureref:${JSON.stringify([vault, file])}`;
	return {
		read(): ViewportState | undefined {
			try {
				const value = JSON.parse(doc.defaultView!.sessionStorage.getItem(key) ?? 'null');
				if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) ||
					!Number.isFinite(value.scale) || value.scale < 0.1 || value.scale > 32 ||
					!['none', 'lines', 'dots'].includes(value.grid)) return undefined;
				return { x: value.x, y: value.y, scale: value.scale, grid: value.grid };
			} catch { return undefined; }
		},
		write(state: ViewportState): void {
			try { doc.defaultView!.sessionStorage.setItem(key, JSON.stringify(state)); }
			catch { /* Storage may be unavailable; the live viewport still works. */ }
		},
	};
}
