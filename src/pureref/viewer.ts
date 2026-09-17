import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { Keymap, Scope, setIcon } from 'obsidian';
import { PurFile } from 'pur-2-file-format';
import { finishScene, renderScene, RenderedScene, updateCorners } from './scene';
import { BoardGrid, GridMode } from './grid';

let nextViewportId = 0;

export interface ViewportState {
	x: number;
	y: number;
	scale: number;
	grid?: GridMode;
	locked?: boolean;
	canvasGrayscale?: boolean;
	grayscaleItems?: number[];
	commentsVisible?: boolean;
}

export interface PureRefControls {
	pur_show_fit?: boolean;
}

interface HistorySnapshot {
	state: ViewportState;
	imageIndex: number;
}

/** Host-independent viewer shared by file tabs, embeds and the browser tests. */
export class PureRefViewer {
	private static activeByDocument = new WeakMap<Document, PureRefViewer>();

	static active(doc: Document = document): PureRefViewer | undefined {
		const viewer = this.activeByDocument.get(doc);
		return viewer && !viewer.disposed && viewer.element.isConnected ? viewer : undefined;
	}

	readonly element: HTMLDivElement;
	readonly ready: Promise<void>;
	private scene: RenderedScene;
	private panzoom: PanzoomObject;
	private viewport: HTMLDivElement;
	private listeners: (() => void)[] = [];
	private disposed = false;
	private grid: BoardGrid;
	private toolbar: HTMLDivElement;
	private fitButton: HTMLButtonElement;
	private openButton?: HTMLButtonElement;
	private openLabel = 'PureRef';
	private openIcon?: string;
	private interacted = false;
	private imageIndex = -1;
	private locked = false;
	private canvasGrayscale = false;
	private grayscaleItems = new Set<number>();
	private lockButton: HTMLButtonElement;
	private onStateChange?: (state: ViewportState) => void;
	private undoStack: HistorySnapshot[] = [];
	private redoStack: HistorySnapshot[] = [];
	private gestureStart?: HistorySnapshot;
	private wheelStart?: HistorySnapshot;
	private wheelTimer = 0;
	private applyingHistory = false;
	private commentTargets: {
		target: HTMLDivElement;
		group: SVGGElement;
	}[] = [];
	private cornerScale = Number.NaN;
	private commentsVisible = false;

	constructor(
		container: HTMLElement,
		board: PurFile,
		state?: ViewportState,
		options: PureRefControls & {
			pur_item_limit?: number;
			keymap?: Keymap;
			parentScope?: Scope;
			onOpenSettings?: () => void;
			onOpenEditor?: () => void;
			onStateChange?: (state: ViewportState) => void;
		} = {},
	) {
		const doc = container.ownerDocument;
		const viewerId = ++nextViewportId;
		this.element = doc.createElement('div');
		this.element.className = 'pureref-viewer';
		this.onStateChange = options.onStateChange;
		this.locked = state?.locked ?? false;
		this.canvasGrayscale = state?.canvasGrayscale ?? false;
		this.grayscaleItems = new Set(state?.grayscaleItems ?? []);
		this.commentsVisible = state?.commentsVisible ?? false;
		const toolbar = this.toolbar = doc.createElement('div');
		toolbar.className = 'pureref-toolbar';
		toolbar.setAttribute('role', 'group');
		const toolbarLabel = doc.createElement('span');
		toolbarLabel.id = `pureref-toolbar-label-${viewerId}`;
		toolbarLabel.hidden = true;
		toolbarLabel.textContent = 'PureRef preview controls';
		toolbar.setAttribute('aria-labelledby', toolbarLabel.id);
		const button = (text: string, title: string, action: () => void, icon?: string) => {
			const el = doc.createElement('button');
			el.type = 'button';
			el.textContent = text;
			if (icon) setIcon(el, icon);
			el.setAttribute('aria-label', title);
			this.listen(el, 'click', (event) => {
				event.stopPropagation();
				this.interacted = true;
				action();
			});
			toolbar.append(el);
			return el;
		};
		this.fitButton = button('', 'Fit board', () => this.fit(), 'maximize');
		this.lockButton = button('', 'Lock canvas movement', () => this.toggleLock(), 'unlock');
		if (options.onOpenEditor) {
			this.openButton = button('', 'Open in PureRef', options.onOpenEditor);
			this.openButton.className = 'pureref-open-button';
		}
		this.viewport = doc.createElement('div');
		this.viewport.className = 'pureref-viewport';
		this.viewport.tabIndex = 0;
		// A referenced accessible name avoids Obsidian's aria-label hover tooltips.
		const label = doc.createElement('span');
		label.id = `pureref-viewport-label-${viewerId}`;
		label.hidden = true;
		label.textContent = 'Read-only PureRef board. Scroll to zoom, middle-mouse drag to pan. Left and right arrows fit the previous or next image. Right-click for grid options. Touch drag and pinch are supported.';
		this.viewport.setAttribute('role', 'region');
		this.viewport.setAttribute('aria-labelledby', label.id);
		this.setControls(options);
		this.element.append(toolbarLabel, label, this.viewport, toolbar);
		this.scene = renderScene(board, doc, options.pur_item_limit);
		this.applyAppearance();
		this.scene.svg.setAttribute('aria-labelledby', label.id);
		this.viewport.append(this.scene.svg);
		container.append(this.element);
		try {
			finishScene(this.scene);
			this.createCommentTargets();
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
			const saveState = () => this.saveState();
			this.grid = new BoardGrid(this.viewport, this.scene.svg, state?.grid, () => {
				this.interacted = true;
				saveState();
			}, options.onOpenSettings, () => this.toggleComments(), () => this.commentsVisible);
			this.listen(this.scene.svg, 'panzoomchange', saveState);
			const corners = () => {
				const scale = this.panzoom.getScale();
				if (scale !== this.cornerScale) {
					this.cornerScale = scale;
					updateCorners(this.scene, scale);
				}
				this.updateCommentTargets();
			};
			this.listen(this.scene.svg, 'panzoomchange', corners);
			const resize = new ResizeObserver(corners);
			resize.observe(this.viewport);
			this.listeners.push(() => resize.disconnect());
			const pointers = new Map<number, PointerEvent>();
			this.listen(this.viewport, 'pointerdown', (event) => {
				const pointer = event as PointerEvent;
				this.activate();
				if (pointer.pointerType === 'mouse' && pointer.button !== 1) {
					if (pointer.button === 0) this.selectImage(pointer.target);
					return;
				}
				if (this.locked) return;
				if (!pointers.size) this.gestureStart = this.snapshot();
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
				if (!pointers.size && this.gestureStart) {
					this.recordHistory(this.gestureStart);
					this.gestureStart = undefined;
				}
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
					this.activate();
					if (this.locked) return;
					if (!this.wheelStart) this.wheelStart = this.snapshot();
					event.stopPropagation();
					this.panzoom.zoomWithWheel(event as WheelEvent);
					this.interacted = true;
					saveState();
					const win = this.element.ownerDocument.defaultView!;
					win.clearTimeout(this.wheelTimer);
					this.wheelTimer = win.setTimeout(() => this.flushWheelHistory(), 250);
				},
				{ passive: false },
			);
			this.listen(this.element, 'pointerenter', () => this.activate());
			if (options.keymap) {
				const scope = new Scope(options.parentScope);
				let active = false;
				const bind = (modifiers: ('Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt')[], key: string,
					action: () => unknown) => scope.register(modifiers, key, () => {
					action();
					return false;
				});
				bind(['Mod'], 'r', () => this.toggleLock());
				bind(['Alt'], 'g', () => this.toggleImageGrayscale());
				bind(['Mod', 'Alt'], 'g', () => this.toggleCanvasGrayscale());
				bind([], 'g', () => this.toggleGrid());
				bind(['Mod'], 'g', () => this.cycleGrid());
				bind(['Mod'], '+', () => this.zoomIn());
				bind(['Mod'], '-', () => this.zoomOut());
				bind([], 'f', () => this.fit());
				bind([], 'ArrowLeft', () => this.cycleImage(-1));
				bind([], 'ArrowRight', () => this.cycleImage(1));
				bind(['Alt'], 'c', () => this.toggleComments());
				bind(['Mod'], 'z', () => this.undo());
				bind(['Mod', 'Shift'], 'z', () => this.redo());
				bind(['Ctrl'], 'y', () => this.redo());
				const push = () => {
					this.activate();
					if (!active) {
						options.keymap!.pushScope(scope);
						active = true;
					}
				};
				const pop = (event?: FocusEvent) => {
					if (event?.relatedTarget && this.element.contains(event.relatedTarget as Node)) return;
					if (active) {
						options.keymap!.popScope(scope);
						active = false;
					}
				};
				this.listen(this.element, 'focusin', push);
				this.listen(this.element, 'focusout', pop as EventListener);
				this.listeners.push(() => pop());
			} else {
				this.listen(this.element, 'focusin', () => this.activate());
			}
			this.listen(this.viewport, 'keydown', (event) => {
				const keyboard = event as KeyboardEvent;
				if (keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey || keyboard.shiftKey) return;
				const key = (event as KeyboardEvent).key;
				if (key === 'Escape') {
					cancel();
					this.viewport.blur();
				} else if (key === '+' || key === '=') this.zoomIn();
				else if (key === '-') this.zoomOut();
				else if (key === '0' || key.toLowerCase() === 'f') this.fit();
				else if (key.toLowerCase() === 'g') this.toggleGrid();
				else if (key === 'ArrowLeft') this.cycleImage(-1);
				else if (key === 'ArrowRight') this.cycleImage(1);
				else return;
				event.preventDefault();
				event.stopPropagation();
			});
			this.ready = this.scene.ready.then(() => {
				if (this.disposed) return;
				finishScene(this.scene);
				this.cornerScale = this.panzoom.getScale();
				updateCorners(this.scene, this.cornerScale);
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
		return {
			...this.panzoom.getPan(),
			scale: this.panzoom.getScale(),
			grid: this.grid.mode,
			locked: this.locked,
			canvasGrayscale: this.canvasGrayscale,
			grayscaleItems: [...this.grayscaleItems],
			commentsVisible: this.commentsVisible,
		};
	}

	setControls(settings: PureRefControls): void {
		this.fitButton.hidden = settings.pur_show_fit === false;
		this.toolbar.hidden = false;
		this.setOpenAppearance(this.openLabel, this.openIcon);
	}

	setOpenAppearance(label: string, icon?: string): void {
		this.openLabel = label;
		this.openIcon = icon;
		if (!this.openButton || this.disposed) return;
		const button = this.openButton, doc = button.ownerDocument;
		button.replaceChildren();
		button.setAttribute('aria-label', label === 'Default app' ? 'Open in default app' : `Open in ${label}`);
		if (icon) {
			const image = doc.createElement('img');
			image.src = icon;
			image.alt = '';
			image.width = image.height = 20;
			button.append(image);
		} else button.append(doc.createTextNode(label));
	}

	private activate(): void {
		PureRefViewer.activeByDocument.set(this.element.ownerDocument, this);
	}

	hasKeyboardFocus(): boolean {
		return this.element.contains(this.element.ownerDocument.activeElement);
	}

	private saveState(): void {
		if (this.interacted && !this.disposed) this.onStateChange?.(this.getState());
	}

	private changed(): void {
		this.interacted = true;
		this.saveState();
	}

	private snapshot(): HistorySnapshot {
		const state = this.getState();
		state.grayscaleItems = [...(state.grayscaleItems ?? [])].sort((a, b) => a - b);
		return { state, imageIndex: this.imageIndex };
	}

	private snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot): boolean {
		return JSON.stringify(a) === JSON.stringify(b);
	}

	private recordHistory(before: HistorySnapshot): void {
		if (this.applyingHistory || this.snapshotsEqual(before, this.snapshot())) return;
		this.undoStack.push(before);
		if (this.undoStack.length > 100) this.undoStack.shift();
		this.redoStack.length = 0;
		this.changed();
	}

	private atomic(action: () => void): void {
		this.flushWheelHistory();
		const before = this.snapshot();
		action();
		this.recordHistory(before);
	}

	private flushWheelHistory(): void {
		if (this.wheelTimer) {
			this.element.ownerDocument.defaultView!.clearTimeout(this.wheelTimer);
			this.wheelTimer = 0;
		}
		if (!this.wheelStart) return;
		const before = this.wheelStart;
		this.wheelStart = undefined;
		this.recordHistory(before);
	}

	private applySnapshot(snapshot: HistorySnapshot): void {
		this.applyingHistory = true;
		try {
			const state = snapshot.state;
			this.locked = state.locked ?? false;
			this.canvasGrayscale = state.canvasGrayscale ?? false;
			this.grayscaleItems = new Set(state.grayscaleItems ?? []);
			this.commentsVisible = state.commentsVisible ?? false;
			this.imageIndex = snapshot.imageIndex;
			this.grid.setMode(state.grid ?? 'none');
			this.panzoom.zoom(state.scale, { animate: false });
			this.panzoom.pan(state.x, state.y, { animate: false });
			this.applyAppearance();
			this.applyCommentVisibility();
			this.changed();
		} finally {
			this.applyingHistory = false;
		}
	}

	private imageGroups(): SVGGElement[] {
		return Array.from(this.scene.content.querySelectorAll('image'))
			.map(image => image.closest<SVGGElement>('g[data-bounds]'))
			.filter((group): group is SVGGElement => group !== null);
	}

	private selectImage(target: EventTarget | null): void {
		const group = target instanceof Element
			? target.closest<SVGGElement>('g[data-bounds]') : null;
		if (!group?.querySelector(':scope > g[clip-path] > image')) return;
		this.imageIndex = this.imageGroups().indexOf(group);
	}

	private createCommentTargets(): void {
		for (const group of Array.from(this.scene.content.querySelectorAll<SVGGElement>('g[data-comment]'))) {
			const target = group.ownerDocument.createElement('div');
			target.className = 'pureref-comment-callout';
			target.textContent = group.dataset.comment ?? '';
			target.hidden = !this.commentsVisible;
			this.viewport.append(target);
			this.commentTargets.push({ target, group });
		}
	}

	private updateCommentTargets(): void {
		for (const { target, group } of this.commentTargets)
			if (this.commentsVisible) this.positionCommentTarget(target, group);
	}

	private positionCommentTarget(target: HTMLDivElement, group: SVGGElement): void {
		const viewport = this.viewport.getBoundingClientRect();
		const matrix = group.getScreenCTM();
		if (!matrix || !group.dataset.bounds) { target.hidden = true; return; }
		const box = JSON.parse(group.dataset.bounds) as { x: number; y: number; width: number; height: number };
		const topLeft = new DOMPoint(box.x, box.y).matrixTransform(matrix);
		const bottomRight = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
		if (bottomRight.x <= viewport.left || topLeft.x >= viewport.right ||
			bottomRight.y <= viewport.top || topLeft.y >= viewport.bottom) {
			target.hidden = true;
			return;
		}
		target.hidden = false;
		target.style.left = `${Math.max(0, topLeft.x - viewport.left)}px`;
		const above = viewport.bottom - bottomRight.y < 100;
		target.classList.toggle('is-callout-above', above);
		target.style.top = above
			? `${Math.max(0, topLeft.y - viewport.top - target.offsetHeight - 6)}px`
			: `${bottomRight.y - viewport.top + 6}px`;
	}

	private applyAppearance(): void {
		this.element.classList.toggle('is-canvas-locked', this.locked);
		this.scene.content.classList.toggle('is-grayscale', this.canvasGrayscale);
		for (const group of this.imageGroups()) {
			const id = Number(group.dataset.itemId);
			group.classList.toggle('is-grayscale', this.grayscaleItems.has(id));
		}
		if (this.lockButton) {
			this.lockButton.replaceChildren();
			setIcon(this.lockButton, this.locked ? 'lock' : 'unlock');
			this.lockButton.setAttribute('aria-label',
				this.locked ? 'Unlock canvas movement' : 'Lock canvas movement');
			this.lockButton.setAttribute('aria-pressed', String(this.locked));
		}
	}

	private applyCommentVisibility(): void {
		for (const { target, group } of this.commentTargets) {
			target.hidden = !this.commentsVisible;
			if (this.commentsVisible) this.positionCommentTarget(target, group);
		}
	}

	zoomIn(): boolean {
		if (this.locked) return false;
		this.atomic(() => this.panzoom.zoomIn({ animate: false }));
		return true;
	}

	zoomOut(): boolean {
		if (this.locked) return false;
		this.atomic(() => this.panzoom.zoomOut({ animate: false }));
		return true;
	}

	fit(): boolean {
		if (this.locked) return false;
		this.atomic(() => {
			this.imageIndex = -1;
			this.panzoom.zoom(1, { animate: false });
			this.panzoom.pan(0, 0, { animate: false });
		});
		return true;
	}

	cycleImage(direction: number): boolean {
		if (this.locked) return false;
		// Scene order is stable, includes nested images, and skips unsupported resources.
		const images = this.imageGroups();
		if (!images.length) return false;
		const index = this.imageIndex < 0
			? (direction > 0 ? 0 : images.length - 1)
			: (this.imageIndex + direction + images.length) % images.length;
		const image = images[index], matrix = image.getScreenCTM();
		if (!matrix) return false;
		const box = JSON.parse(image.dataset.bounds!) as { x: number; y: number; width: number; height: number };
		// Use the crop, not the underlying image's unclipped source rectangle.
		const points = [[box.x, box.y], [box.x + box.width, box.y],
			[box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
			.map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
		const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
		const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
		const viewport = this.viewport.getBoundingClientRect();
		if (right <= left || bottom <= top || !viewport.width || !viewport.height) return false;
		const scale = this.panzoom.getScale(), pan = this.panzoom.getPan();
		const targetScale = scale * Math.min(viewport.width / (right - left), viewport.height / (bottom - top));
		this.atomic(() => {
			this.panzoom.zoom(targetScale, { animate: false });
			this.panzoom.pan(
				pan.x + (viewport.x + viewport.width / 2 - (left + right) / 2) / scale,
				pan.y + (viewport.y + viewport.height / 2 - (top + bottom) / 2) / scale,
				{ animate: false },
			);
			this.imageIndex = index;
		});
		return true;
	}

	toggleGrid(): boolean {
		this.atomic(() => this.grid.toggle());
		return true;
	}

	cycleGrid(): boolean {
		this.atomic(() => this.grid.cycle());
		return true;
	}

	toggleLock(): boolean {
		this.atomic(() => {
			this.locked = !this.locked;
			this.applyAppearance();
		});
		return true;
	}

	toggleImageGrayscale(): boolean {
		const image = this.imageGroups()[this.imageIndex];
		if (!image) return false;
		const id = Number(image.dataset.itemId);
		this.atomic(() => {
			if (this.grayscaleItems.has(id)) this.grayscaleItems.delete(id);
			else this.grayscaleItems.add(id);
			this.applyAppearance();
		});
		return true;
	}

	toggleCanvasGrayscale(): boolean {
		this.atomic(() => {
			this.canvasGrayscale = !this.canvasGrayscale;
			this.applyAppearance();
		});
		return true;
	}

	toggleComments(): boolean {
		this.atomic(() => {
			this.commentsVisible = !this.commentsVisible;
			this.applyCommentVisibility();
		});
		return true;
	}

	undo(): boolean {
		this.flushWheelHistory();
		const previous = this.undoStack.pop();
		if (!previous) return false;
		this.redoStack.push(this.snapshot());
		this.applySnapshot(previous);
		return true;
	}

	redo(): boolean {
		this.flushWheelHistory();
		const next = this.redoStack.pop();
		if (!next) return false;
		this.undoStack.push(this.snapshot());
		this.applySnapshot(next);
		return true;
	}

	destroy(): void {
		if (this.disposed) return;
		this.element.ownerDocument.defaultView!.clearTimeout(this.wheelTimer);
		this.wheelTimer = 0;
		this.wheelStart = undefined;
		this.disposed = true;
		this.panzoom.destroy();
		this.grid.dispose();
		this.scene.dispose();
		this.listeners.splice(0).forEach((remove) => remove());
		this.element.remove();
	}
}
