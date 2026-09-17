import type { ViewportState } from './viewer';

export interface StoredViewportState {
	state: ViewportState;
	updatedAt: number;
}

export function validViewportState(value: unknown): ViewportState | undefined {
	if (!value || typeof value !== 'object') return;
	const state = value as Record<string, unknown>;
	if (!Number.isFinite(state.x) || !Number.isFinite(state.y) ||
		!Number.isFinite(state.scale) || (state.scale as number) < 0.1 ||
		(state.scale as number) > 32 || !['none', 'lines', 'dots'].includes(state.grid as string)) return;
	return {
		x: state.x as number, y: state.y as number, scale: state.scale as number,
		grid: state.grid as ViewportState['grid'], locked: state.locked === true,
		canvasGrayscale: state.canvasGrayscale === true,
		commentsVisible: state.commentsVisible === true,
		grayscaleItems: Array.isArray(state.grayscaleItems)
			? state.grayscaleItems.filter(Number.isSafeInteger) as number[] : [],
	};
}

/** Window-local UI state survives app reloads without changing vault files. */
export function viewportSession(doc: Document, vault: string, file: string) {
	const key = `extended-file-support:pureref:${JSON.stringify([vault, file])}`;
	return {
		read(): ViewportState | undefined {
			try {
				return validViewportState(JSON.parse(doc.defaultView!.sessionStorage.getItem(key) ?? 'null'));
			} catch { return undefined; }
		},
		write(state: ViewportState): void {
			try { doc.defaultView!.sessionStorage.setItem(key, JSON.stringify(state)); }
			catch { /* Storage may be unavailable; the live viewport still works. */ }
		},
	};
}
