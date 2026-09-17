import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { PurFile } from 'pur-2-file-format';
import { finishScene, renderScene, RenderedScene, updateCorners } from './scene';
import { BoardGrid, GridMode } from './grid';

export interface ViewportState {
	x: number;
	y: number;
	scale: number;
	grid?: GridMode;
}

export interface PureRefControls {
	pur_show_zoom?: boolean;
	pur_show_fit?: boolean;
	pur_show_open?: boolean;
	pur_open_display?: 'icon' | 'text' | 'both';
}

/** Host-independent viewer shared by file tabs, embeds and the browser tests. */
export class PureRefViewer {
	readonly element: HTMLDivElement;
	readonly ready: Promise<void>;
	private scene: RenderedScene;
	private panzoom: PanzoomObject;
	private viewport: HTMLDivElement;
	private listeners: (() => void)[] = [];
	private disposed = false;
	private grid: BoardGrid;
	private toolbar: HTMLDivElement;
	private controls: { key: keyof PureRefControls; button: HTMLButtonElement }[] = [];
	private openButton?: HTMLButtonElement;
	private openDisplay: 'icon' | 'text' | 'both' = 'icon';
	private openLabel = 'PureRef';
	private openIcon?: string;
	private interacted = false;

	constructor(
		container: HTMLElement,
		board: PurFile,
		state?: ViewportState,
		options: PureRefControls & {
			onOpenEditor?: () => void;
			onStateChange?: (state: ViewportState) => void;
		} = {},
	) {
		const doc = container.ownerDocument;
		this.element = doc.createElement('div');
		this.element.className = 'pureref-viewer';
		const toolbar = this.toolbar = doc.createElement('div');
		toolbar.className = 'pureref-toolbar';
		toolbar.setAttribute('role', 'group');
		toolbar.setAttribute('aria-label', 'PureRef preview controls');
		const button = (text: string, title: string, action: () => void) => {
			const el = doc.createElement('button');
			el.type = 'button';
			el.textContent = text;
			el.title = title;
			el.setAttribute('aria-label', title);
			this.listen(el, 'click', (event) => {
				event.stopPropagation();
				this.interacted = true;
				action();
			});
			toolbar.append(el);
			return el;
		};
		this.controls.push(
			{ key: 'pur_show_zoom', button: button('−', 'Zoom out', () => this.panzoom.zoomOut({ animate: false })) },
			{ key: 'pur_show_zoom', button: button('+', 'Zoom in', () => this.panzoom.zoomIn({ animate: false })) },
			{ key: 'pur_show_fit', button: button('Fit', 'Fit board', () => this.fit()) },
		);
		if (options.onOpenEditor) {
			this.openButton = button('', 'Open in PureRef', options.onOpenEditor);
			this.openButton.className = 'pureref-open-button';
			this.controls.push({ key: 'pur_show_open', button: this.openButton });
		}
		this.setControls(options);
		this.viewport = doc.createElement('div');
		this.viewport.className = 'pureref-viewport';
		this.viewport.tabIndex = 0;
		this.viewport.setAttribute(
			'aria-label',
			'Read-only PureRef board. Scroll to zoom, middle-mouse drag to pan. Right-click for grid options. Touch drag and pinch are supported.',
		);
		this.element.append(this.viewport, toolbar);
		this.scene = renderScene(board, doc);
		this.viewport.append(this.scene.svg);
		container.append(this.element);
		try {
			finishScene(this.scene);
			this.panzoom = Panzoom(this.scene.svg, {
				canvas: true,
				noBind: true,
				minScale: 0.1,
				maxScale: 32,
				touchAction: 'none',
				cursor: 'auto',
				pinchAndPan: true,
				startX: state?.x ?? 0,
				startY: state?.y ?? 0,
				startScale: state?.scale ?? 1,
			});
			const saveState = () => {
				if (this.interacted && !this.disposed) options.onStateChange?.(this.getState());
			};
			this.grid = new BoardGrid(this.viewport, this.scene.svg, state?.grid, () => {
				this.interacted = true;
				saveState();
			});
			this.listen(this.scene.svg, 'panzoomchange', saveState);
			const corners = () => updateCorners(this.scene);
			this.listen(this.scene.svg, 'panzoomchange', corners);
			const resize = new ResizeObserver(corners);
			resize.observe(this.viewport);
			this.listeners.push(() => resize.disconnect());
			const pointers = new Map<number, PointerEvent>();
			this.listen(this.viewport, 'pointerdown', (event) => {
				const pointer = event as PointerEvent;
				if (pointer.pointerType === 'mouse' && pointer.button !== 1) return;
				this.interacted = true;
				pointers.set(pointer.pointerId, pointer);
				this.viewport.setPointerCapture(pointer.pointerId);
				this.viewport.focus({ preventScroll: true });
				this.viewport.classList.add('is-panning');
				this.panzoom.handleDown(pointer);
			});
			this.listen(this.viewport, 'pointermove', (event) => {
				const pointer = event as PointerEvent;
				if (!pointers.has(pointer.pointerId)) return;
				pointers.set(pointer.pointerId, pointer);
				this.panzoom.handleMove(pointer);
			});
			const endPointer = (event: Event) => {
				const pointer = event as PointerEvent;
				if (!pointers.delete(pointer.pointerId)) return;
				this.panzoom.handleUp(pointer);
				if (this.viewport.hasPointerCapture(pointer.pointerId))
					this.viewport.releasePointerCapture(pointer.pointerId);
				if (pointers.size === 1) this.panzoom.handleDown(pointers.values().next().value!);
				this.viewport.classList.toggle('is-panning', pointers.size > 0);
			};
			for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
				this.listen(this.viewport, type, endPointer);
			const cancel = () => {
				for (const pointer of Array.from(pointers.values())) endPointer(pointer);
			};
			this.listen(doc.defaultView!, 'blur', cancel);
			this.listeners.push(cancel);
			this.listen(this.viewport, 'auxclick', (event) => {
				if ((event as MouseEvent).button === 1) {
					event.preventDefault();
					event.stopPropagation();
				}
			});
			this.listen(
				this.viewport,
				'wheel',
				(event) => {
					event.stopPropagation();
					this.panzoom.zoomWithWheel(event as WheelEvent);
					this.interacted = true;
					saveState();
				},
				{ passive: false },
			);
			this.listen(this.viewport, 'keydown', (event) => {
				const key = (event as KeyboardEvent).key;
				const pan = this.panzoom.getPan(),
					step = 40 / this.panzoom.getScale();
				if (key === 'Escape') {
					cancel();
					this.viewport.blur();
				} else if (key === '+' || key === '=') this.panzoom.zoomIn({ animate: false });
				else if (key === '-') this.panzoom.zoomOut({ animate: false });
				else if (key === '0' || key.toLowerCase() === 'f') this.fit();
				else if (key === 'ArrowLeft') this.panzoom.pan(pan.x + step, pan.y);
				else if (key === 'ArrowRight') this.panzoom.pan(pan.x - step, pan.y);
				else if (key === 'ArrowUp') this.panzoom.pan(pan.x, pan.y + step);
				else if (key === 'ArrowDown') this.panzoom.pan(pan.x, pan.y - step);
				else return;
				this.interacted = true;
				saveState();
				event.preventDefault();
				event.stopPropagation();
			});
			this.ready = this.scene.ready.then(() => {
				if (this.disposed) return;
				finishScene(this.scene);
				updateCorners(this.scene);
				this.grid.refresh();
				this.element.dataset.ready = 'true';
			});
		} catch (error) {
			this.panzoom?.destroy();
			this.grid?.dispose();
			this.listeners.splice(0).forEach((remove) => remove());
			this.scene.dispose();
			this.element.remove();
			throw error;
		}
	}

	private listen(
		target: EventTarget,
		type: string,
		handler: EventListener,
		options?: AddEventListenerOptions,
	): void {
		target.addEventListener(type, handler, options);
		this.listeners.push(() => target.removeEventListener(type, handler, options));
	}

	getState(): ViewportState {
		return { ...this.panzoom.getPan(), scale: this.panzoom.getScale(), grid: this.grid.mode };
	}

	setControls(settings: PureRefControls): void {
		for (const control of this.controls) control.button.hidden = settings[control.key] === false;
		this.toolbar.hidden = this.controls.every(control => control.button.hidden);
		this.openDisplay = settings.pur_open_display ?? 'icon';
		this.setOpenAppearance(this.openLabel, this.openIcon);
	}

	setOpenAppearance(label: string, icon?: string): void {
		this.openLabel = label;
		this.openIcon = icon;
		if (!this.openButton || this.disposed) return;
		const button = this.openButton, doc = button.ownerDocument;
		button.replaceChildren();
		button.title = label === 'Default app' ? 'Open in default app' : `Open in ${label}`;
		button.setAttribute('aria-label', button.title);
		if (this.openDisplay !== 'text') {
			if (icon) {
				const image = doc.createElement('img');
				image.src = icon;
				image.alt = '';
				image.width = image.height = 16;
				button.append(image);
			} else {
				const fallback = doc.createElement('span');
				fallback.textContent = '↗';
				fallback.setAttribute('aria-hidden', 'true');
				button.append(fallback);
			}
		}
		if (this.openDisplay !== 'icon') button.append(doc.createTextNode(label));
	}

	private fit(): void {
		this.panzoom.zoom(1, { animate: false });
		this.panzoom.pan(0, 0, { animate: false });
	}

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.panzoom.destroy();
		this.grid.dispose();
		this.scene.dispose();
		this.listeners.splice(0).forEach((remove) => remove());
		this.element.remove();
	}
}
