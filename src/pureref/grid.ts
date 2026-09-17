export type GridMode = 'none' | 'lines' | 'dots';

/** Viewport-sized background, positioned from the scene matrix so it never affects fitting. */
export class BoardGrid {
	mode: GridMode;
	private layer: HTMLDivElement;
	private menu?: HTMLDivElement;
	private frame = 0;
	private observer: ResizeObserver;
	private win: Window;
	private doc: Document;

	constructor(
		private viewport: HTMLElement,
		private svg: SVGSVGElement,
		mode: GridMode = 'none',
	) {
		this.mode = mode;
		this.doc = viewport.ownerDocument;
		this.win = this.doc.defaultView!;
		this.layer = this.doc.createElement('div');
		this.layer.className = 'pureref-grid';
		this.layer.setAttribute('aria-hidden', 'true');
		viewport.prepend(this.layer);
		viewport.addEventListener('contextmenu', this.open);
		viewport.addEventListener('keydown', this.keyboardOpen);
		svg.addEventListener('panzoomchange', this.refresh);
		this.doc.addEventListener('pointerdown', this.outside, true);
		this.doc.addEventListener('scroll', this.dismiss, true);
		this.win.addEventListener('blur', this.dismiss);
		this.win.addEventListener('resize', this.dismiss);
		this.observer = new ResizeObserver(this.refresh);
		this.observer.observe(viewport);
		this.refresh();
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
		this.menu?.remove();
		this.menu = undefined;
	};
	private outside = (event: Event): void => {
		if (this.menu && !this.menu.contains(event.target as Node)) this.dismiss();
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
		const menu = this.doc.createElement('div');
		this.menu = menu;
		menu.className = 'pureref-grid-menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', 'Board grid');
		const label = this.doc.createElement('div');
		label.className = 'pureref-menu-label';
		label.textContent = 'Grid';
		menu.append(label);
		const buttons: HTMLButtonElement[] = [];
		for (const [value, title] of [
			['none', 'None'],
			['lines', 'Lines'],
			['dots', 'Dots'],
		] as const) {
			const button = this.doc.createElement('button');
			button.type = 'button';
			button.setAttribute('role', 'menuitemradio');
			button.setAttribute('aria-label', title);
			button.setAttribute('aria-checked', String(value === this.mode));
			button.textContent = title;
			button.addEventListener('click', () => {
				this.mode = value;
				this.refresh();
				this.dismiss();
				this.viewport.focus({ preventScroll: true });
			});
			buttons.push(button);
			menu.append(button);
		}
		menu.addEventListener('keydown', (event) => {
			const current = buttons.indexOf(this.doc.activeElement as HTMLButtonElement);
			if (event.key === 'Escape' || event.key === 'Tab') {
				this.dismiss();
				this.viewport.focus({ preventScroll: true });
			} else if (event.key === 'ArrowDown') buttons[(current + 1) % buttons.length].focus();
			else if (event.key === 'ArrowUp')
				buttons[(current + buttons.length - 1) % buttons.length].focus();
			else if (event.key === 'Home') buttons[0].focus();
			else if (event.key === 'End') buttons[buttons.length - 1].focus();
			else return;
			event.preventDefault();
			event.stopPropagation();
		});
		menu.addEventListener('contextmenu', (event) => event.preventDefault());
		this.doc.body.append(menu);
		const bounds = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(4, Math.min(x, this.win.innerWidth - bounds.width - 4))}px`;
		menu.style.top = `${Math.max(4, Math.min(y, this.win.innerHeight - bounds.height - 4))}px`;
		buttons[['none', 'lines', 'dots'].indexOf(this.mode)].focus({ preventScroll: true });
	}

	dispose(): void {
		this.dismiss();
		this.win.cancelAnimationFrame(this.frame);
		this.observer.disconnect();
		this.viewport.removeEventListener('contextmenu', this.open);
		this.viewport.removeEventListener('keydown', this.keyboardOpen);
		this.svg.removeEventListener('panzoomchange', this.refresh);
		this.doc.removeEventListener('pointerdown', this.outside, true);
		this.doc.removeEventListener('scroll', this.dismiss, true);
		this.win.removeEventListener('blur', this.dismiss);
		this.win.removeEventListener('resize', this.dismiss);
		this.layer.remove();
	}
}
