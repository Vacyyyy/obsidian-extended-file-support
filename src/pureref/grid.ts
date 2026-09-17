import { Menu, MenuItem } from 'obsidian';

export type GridMode = 'none' | 'lines' | 'dots';

/** Viewport-sized background, positioned from the scene matrix so it never affects fitting. */
export class BoardGrid {
	mode: GridMode;
	private previousMode: Exclude<GridMode, 'none'> = 'lines';
	private layer: HTMLDivElement;
	private menu?: Menu;
	private frame = 0;
	private observer: ResizeObserver;
	private win: Window;
	private doc: Document;

	constructor(
		private viewport: HTMLElement,
		private svg: SVGSVGElement,
		mode: GridMode = 'none',
		private onChange?: () => void,
		private onOpenSettings?: () => void,
		private onToggleComments?: () => void,
		private commentsVisible?: () => boolean,
	) {
		this.mode = mode;
		if (mode !== 'none') this.previousMode = mode;
		this.doc = viewport.ownerDocument;
		this.win = this.doc.defaultView!;
		this.layer = this.doc.createElement('div');
		this.layer.className = 'pureref-grid';
		this.layer.setAttribute('aria-hidden', 'true');
		viewport.prepend(this.layer);
		viewport.addEventListener('contextmenu', this.open);
		viewport.addEventListener('keydown', this.keyboardOpen);
		svg.addEventListener('panzoomchange', this.refresh);
		this.doc.addEventListener('scroll', this.dismiss, true);
		this.win.addEventListener('blur', this.dismiss);
		this.win.addEventListener('resize', this.dismiss);
		this.observer = new ResizeObserver(this.refresh);
		this.observer.observe(viewport);
		this.refresh();
	}

	setMode(mode: GridMode): void {
		this.mode = mode;
		if (mode !== 'none') this.previousMode = mode;
		this.onChange?.();
		this.refresh();
	}

	toggle(): void {
		this.setMode(this.mode === 'none' ? this.previousMode : 'none');
	}

	cycle(): void {
		const modes: GridMode[] = ['none', 'lines', 'dots'];
		this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
	}

	refresh = (): void => {
		if (this.frame) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.layer.dataset.grid = this.mode;
			this.layer.hidden = this.mode === 'none';
			if (this.mode === 'none') return;
			const matrix = this.svg.getScreenCTM();
			if (!matrix) return;
			const scale = Math.hypot(matrix.a, matrix.b);
			if (!Number.isFinite(scale) || scale <= 0) return;
			// Use coarser/finer powers of five when zoomed far out/in to avoid a dense moiré.
			let step = 20;
			while (step * scale < 10) step *= 5;
			while (step * scale > 100) step /= 5;
			const spacing = step * scale;
			const rect = this.viewport.getBoundingClientRect();
			this.layer.style.backgroundSize = `${spacing}px ${spacing}px`;
			this.layer.style.backgroundPosition = `${matrix.e - rect.left}px ${matrix.f - rect.top}px`;
		});
	};

	private dismiss = (): void => {
		this.menu?.hide();
		this.menu = undefined;
	};
	private keyboardOpen = (event: KeyboardEvent): void => {
		if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = this.viewport.getBoundingClientRect();
		this.show(rect.left + rect.width / 2, rect.top + rect.height / 2);
	};
	private open = (event: MouseEvent): void => {
		event.preventDefault();
		event.stopPropagation();
		this.show(event.clientX, event.clientY);
	};

	private show(x: number, y: number): void {
		this.dismiss();
		const menu = new Menu();
		this.menu = menu;
		menu.setUseNativeMenu(false);
		menu.addItem(item => {
			item.setTitle('Grid').setIcon('grid');
			// Obsidian's submenu API is available at runtime but absent from public typings.
			const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();
			for (const [value, title] of [['none', 'None'], ['lines', 'Lines'], ['dots', 'Dots']] as const) {
				submenu.addItem(option => option.setTitle(title).setChecked(value === this.mode).onClick(() => {
					this.setMode(value);
					this.viewport.focus({ preventScroll: true });
				}));
			}
		});
		if (this.onToggleComments) menu.addItem(item => item
			.setTitle(this.commentsVisible?.() ? 'Hide comments' : 'Show comments')
			.setIcon('message-square')
			.onClick(() => {
				this.onToggleComments!();
				this.viewport.focus({ preventScroll: true });
			}));
		if (this.onOpenSettings) {
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle('Settings')
				.setIcon('settings')
				.onClick(this.onOpenSettings!));
		}
		menu.onHide(() => {
			if (this.menu === menu) this.menu = undefined;
		});
		menu.showAtPosition({ x, y }, this.doc);
	}

	dispose(): void {
		this.dismiss();
		this.win.cancelAnimationFrame(this.frame);
		this.observer.disconnect();
		this.viewport.removeEventListener('contextmenu', this.open);
		this.viewport.removeEventListener('keydown', this.keyboardOpen);
		this.svg.removeEventListener('panzoomchange', this.refresh);
		this.doc.removeEventListener('scroll', this.dismiss, true);
		this.win.removeEventListener('blur', this.dismiss);
		this.win.removeEventListener('resize', this.dismiss);
		this.layer.remove();
	}
}
