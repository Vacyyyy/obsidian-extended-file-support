import { DecodedRow, PainterPath, PurFile, Variant } from 'pur-2-file-format';
import { noteContent } from './notes';
import { loadNoteFonts } from './fonts';
import { strokeOptions, withArrow } from './strokes';

const NS = 'http://www.w3.org/2000/svg';
let nextSceneId = 0;

export function svgElement<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
	const element = doc.createElementNS(NS, tag);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	return element;
}

export function affine(value: Variant | { kind: 'undecoded' } | null): string {
	if (
		!value ||
		value.kind !== 'transform' ||
		value.is_null ||
		value.value.some((n) => !Number.isFinite(n))
	)
		throw new Error('Invalid transform');
	const m = value.value;
	if (m[2] !== 0 || m[5] !== 0 || m[8] !== 1)
		throw new Error('Perspective transforms are unsupported');
	return `matrix(${m[0]} ${m[1]} ${m[3]} ${m[4]} ${m[6]} ${m[7]})`;
}

export function pathData(path: PainterPath): string {
	const commands: string[] = [];
	for (let i = 0; i < path.elements.length; i++) {
		const [kind, x, y] = path.elements[i];
		if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid path coordinates');
		if (kind === 0 || kind === 1) commands.push(`${kind === 0 ? 'M' : 'L'}${x} ${y}`);
		else if (kind === 2) {
			const second = path.elements[++i],
				end = path.elements[++i];
			if (
				!second ||
				!end ||
				second[0] !== 3 ||
				end[0] !== 3 ||
				![...second, ...end].every(Number.isFinite)
			)
				throw new Error('Invalid cubic path');
			commands.push(`C${x} ${y} ${second[1]} ${second[2]} ${end[1]} ${end[2]}`);
		} else throw new Error('Unsupported path element');
	}
	return commands.join(' ');
}

function color(value: string | null, fallback: string): string {
	if (!value) return fallback;
	if (/^#[\da-f]{8}$/i.test(value)) return `#${value.slice(3)}${value.slice(1, 3)}`; // Qt ARGB -> CSS RGBA
	if (/^#[\da-f]{6}$/i.test(value)) return value;
	return fallback;
}

type Bounds = { x: number; y: number; width: number; height: number };
function pointBounds(points: [number, number][], padding = 0): Bounds {
	if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
	let left = Infinity,
		top = Infinity,
		right = -Infinity,
		bottom = -Infinity;
	for (const [x, y] of points) {
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x);
		bottom = Math.max(bottom, y);
	}
	return {
		x: left - padding,
		y: top - padding,
		width: right - left + 2 * padding,
		height: bottom - top + 2 * padding,
	};
}
function setBounds(group: SVGGElement, bounds: Bounds): void {
	group.dataset.bounds = JSON.stringify(bounds);
}

/** Tight cubic extrema, matching path geometry rather than its control-point hull. */
function pathBounds(path: PainterPath, padding = 0): Bounds {
	const points: [number, number][] = [];
	let previous: [number, number] = [0, 0];
	for (let i = 0; i < path.elements.length; i++) {
		const [kind, x, y] = path.elements[i];
		if (kind !== 2) {
			previous = [x, y];
			points.push(previous);
			continue;
		}
		const [, x2, y2] = path.elements[++i],
			[, x3, y3] = path.elements[++i];
		const [x0, y0] = previous;
		const at = (a: number, b: number, c: number, d: number, t: number) =>
			(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
		for (const [a, b, c, d] of [
			[x0, x, x2, x3],
			[y0, y, y2, y3],
		]) {
			const A = -a + 3 * b - 3 * c + d,
				B = 2 * (a - 2 * b + c),
				C = b - a;
			const discriminant = B * B - 4 * A * C;
			const roots =
				Math.abs(A) < 1e-12
					? Math.abs(B) < 1e-12
						? []
						: [-C / B]
					: discriminant < 0
						? []
						: [
								(-B + Math.sqrt(discriminant)) / (2 * A),
								(-B - Math.sqrt(discriminant)) / (2 * A),
							];
			for (const t of roots)
				if (t > 0 && t < 1) points.push([at(x0, x, x2, x3, t), at(y0, y, y2, y3, t)]);
		}
		previous = [x3, y3];
		points.push(previous);
	}
	return pointBounds(points, padding);
}

// SVG getBBox includes clipped-away source pixels. Fit from the visible geometry
// instead, composing local matrices without depending on the viewport's size.
function visibleBounds(root: SVGGElement, eligibleChildrenOnly = false): Bounds {
	const points: [number, number][] = [];
	for (const item of Array.from(root.querySelectorAll<SVGGElement>('g[data-bounds]'))) {
		if (
			eligibleChildrenOnly &&
			(item.parentNode !== root || item.dataset.groupEligible !== 'true')
		)
			continue;
		const box: Bounds = JSON.parse(item.dataset.bounds!);
		let matrix = new DOMMatrix();
		for (let node: Element | null = item; node && node !== root; node = node.parentElement) {
			if (node.tagName.toLowerCase() === 'g') {
				const local = (node as SVGGElement).transform.baseVal.consolidate()?.matrix;
				if (local)
					matrix = new DOMMatrix([
						local.a,
						local.b,
						local.c,
						local.d,
						local.e,
						local.f,
					]).multiply(matrix);
			}
		}
		for (const [x, y] of [
			[box.x, box.y],
			[box.x + box.width, box.y],
			[box.x, box.y + box.height],
			[box.x + box.width, box.y + box.height],
		]) {
			const point = matrix.transformPoint({ x, y });
			points.push([point.x, point.y]);
		}
	}
	return pointBounds(points);
}

export interface RenderedScene {
	svg: SVGSVGElement;
	content: SVGGElement;
	warnings: Set<string>;
	ready: Promise<void>;
	dispose(): void;
}

/** Build a read-only scene. All URLs are owned by this instance and revoked on dispose. */
export function renderScene(board: PurFile, doc: Document): RenderedScene {
	const svg = svgElement(doc, 'svg', {
		width: '100%',
		height: '100%',
		role: 'img',
		preserveAspectRatio: 'xMidYMid meet',
	});
	const defs = svgElement(doc, 'defs');
	const content = svgElement(doc, 'g');
	svg.append(defs, content);
	const prefix = `pureref-${nextSceneId++}`;
	const warnings = new Set<string>();
	const urls: string[] = [];
	const loads: Promise<unknown>[] = [];
	const cleanups: (() => void)[] = [];
	const layouts: (() => void)[] = [];
	let disposed = false;
	const dispose = () => {
		disposed = true;
		cleanups.splice(0).forEach((fn) => fn());
		urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
	};
	try {
		if (!board.header.checksum_valid)
			warnings.add('File checksum does not match; the board may be damaged.');
		if (board.header.application_version !== '2.1.3')
			warnings.add('This PureRef application version has not been verified.');
		const items = board.decodedRows('items');
		if (items.length > 10000) throw new Error('This preview supports up to 10,000 items.');
		const images = new Map(board.decodedRows('items_images').map((row) => [row.id, row]));
		const notes = new Map(board.decodedRows('items_notes').map((row) => [row.id, row]));
		if (notes.size)
			loads.push(
				loadNoteFonts(doc).catch(() => {
					warnings.add('The bundled note font could not load; system fonts are used.');
				}),
			);
		const groups = new Map(board.rows('items_groups').map((row) => [row.id, row]));
		const drawings = new Map(board.decodedRows('items_drawings').map((row) => [row.id, row]));
		const resources = new Map<number, { url: string; width: number; height: number }>();
		let pixels = 0;
		for (const resource of board.rows('images')) {
			const { data, width, height } = resource;
			if (
				resource.source_type !== 1 ||
				!data?.length ||
				!width ||
				!height ||
				width <= 0 ||
				height <= 0
			) {
				warnings.add('Linked or invalid image resources were omitted.');
				continue;
			}
			const png = data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
			const jpeg = data[0] === 255 && data[1] === 216;
			if (!png && !jpeg) {
				warnings.add('Only embedded PNG and JPEG images are supported.');
				continue;
			}
			if (width * height > 64000000 || pixels + width * height > 128000000) {
				warnings.add("Some images exceed the preview's decoded-image budget.");
				continue;
			}
			pixels += width * height;
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(data)], { type: png ? 'image/png' : 'image/jpeg' }),
			);
			urls.push(url);
			resources.set(resource.id, { url, width, height });
		}
		const children = new Map<number, DecodedRow<'items'>[]>();
		for (const item of items) {
			const parent = item.parent ?? -1;
			const siblings = children.get(parent) ?? [];
			siblings.push(item);
			children.set(parent, siblings);
		}
		for (const siblings of children.values())
			siblings.sort((a, b) => {
				const z = (a.z ?? 0) - (b.z ?? 0);
				if (z) return z;
				const order = (item: DecodedRow<'items'>) => {
					const r = item.sort_order;
					if (
						r?.kind === 'rational' &&
						r.numerator !== undefined &&
						r.denominator &&
						!r.is_null
					)
						return r.numerator / r.denominator;
					warnings.add(
						'Some stacking order values are unsupported; item order is used as a fallback.',
					);
					return item.id;
				};
				return order(a) - order(b);
			});
		const seen = new Set<number>();
		const render = (item: DecodedRow<'items'>, parent: SVGGElement, depth: number) => {
			if (seen.has(item.id) || depth > 128) {
				warnings.add('Cyclic or excessively deep groups were omitted.');
				return;
			}
			seen.add(item.id);
			const group = svgElement(doc, 'g', { 'data-item-id': item.id });
			try {
				group.setAttribute('transform', affine(item.transform));
				group.setAttribute('opacity', String(Math.max(0, Math.min(1, item.opacity ?? 1))));
				const description = svgElement(doc, 'desc');
				description.textContent = item.name ?? `Item ${item.id}`;
				group.append(description);
				parent.append(group);
				const instance = images.get(item.id),
					note = notes.get(item.id),
					drawing = drawings.get(item.id),
					folder = groups.get(item.id);
				group.dataset.groupEligible = String(Boolean(instance || note || folder));
				if (instance) {
					const resource =
						instance.image === null ? undefined : resources.get(instance.image);
					if (!resource) throw new Error('Missing or unsupported image resource');
					if (instance.flags !== 1 || instance.playback_state !== 0)
						warnings.add('Image filters and animation are not reproduced.');
					const bounds = instance.image_bounds;
					if (bounds?.kind !== 'path' || bounds.is_null)
						throw new Error('Unsupported image crop');
					const clipId = `${prefix}-clip-${item.id}`;
					const clip = svgElement(doc, 'clipPath', {
						id: clipId,
						clipPathUnits: 'userSpaceOnUse',
					});
					clip.append(
						svgElement(doc, 'path', {
							d: pathData(bounds),
							'clip-rule': bounds.fill_rule === 1 ? 'nonzero' : 'evenodd',
						}),
					);
					defs.append(clip);
					setBounds(group, pathBounds(bounds));
					const clipped = svgElement(doc, 'g', { 'clip-path': `url(#${clipId})` });
					const image = svgElement(doc, 'image', {
						width: resource.width,
						height: resource.height,
						transform: affine(instance.image_transform),
						preserveAspectRatio: 'none',
					});
					loads.push(
						new Promise<void>((resolve) => {
							const finish = () => {
								clearTimeout(timer);
								image.onload = null;
								image.onerror = null;
								resolve();
							};
							image.onload = finish;
							image.onerror = () => {
								warnings.add('An embedded image could not be decoded.');
								finish();
							};
							const timer = setTimeout(() => {
								warnings.add('An embedded image did not finish loading.');
								finish();
							}, 10000);
							cleanups.push(finish);
						}),
					);
					image.setAttribute('href', resource.url);
					clipped.append(image);
					group.append(clipped);
					group.append(
						svgElement(doc, 'path', {
							class: 'pureref-image-outline',
							d: pathData(bounds),
							fill: 'none',
							stroke: '#15191d',
							'stroke-opacity': 0.4,
							'clip-path': `url(#${clipId})`,
							'stroke-width': 1,
							'pointer-events': 'none',
						}),
					);
				} else if (note) {
					warnings.add(
						'Note typography may differ from Qt; unavailable fonts use a fallback.',
					);
					const size = note.fixed_size;
					const fixedWidth =
						size?.kind === 'size' && size.value[0] > 0 ? size.value[0] : undefined;
					const fixedHeight =
						size?.kind === 'size' && size.value[1] > 0 ? size.value[1] : undefined;
					const foreign = svgElement(doc, 'foreignObject', {
						width: fixedWidth ?? 400,
						height: fixedHeight ?? 200,
					});
					const body = doc.createElement('div');
					body.className = 'pureref-note';
					// Standard-dark reference color; scene theme preferences are not stored per item.
					body.style.backgroundColor = color(note.background_color, '#131518');
					body.style.color = color(note.text_color, '#eaeaea');
					body.style.padding = note.style === 1 ? '4px' : '16px';
					body.style.borderRadius = note.style === 1 ? '8px' : '4px';
					foreign.dataset.radius = note.style === 1 ? '8' : '4';
					if (note.style !== 0 && note.style !== 1)
						warnings.add('An unknown note style uses default padding.');
					body.append(noteContent(doc, note.text ?? ''));
					foreign.append(body);
					group.append(foreign);
					// Measure in an untransformed HTML container: SVG transforms must not affect layout sizes.
					const layout = () => {
						const measure = doc.createElement('div');
						measure.className = 'pureref-note-measure';
						const clone = body.cloneNode(true) as HTMLElement;
						clone.style.height = 'auto';
						clone.style.width = fixedWidth ? `${fixedWidth}px` : 'max-content';
						clone.style.maxWidth = fixedWidth ? 'none' : '800px';
						measure.append(clone);
						doc.body.append(measure);
						try {
							// Round outward: a fractional pixel lost here can wrap the last word
							// into a clipped second line when rendered in foreignObject.
							const measured = clone.getBoundingClientRect();
							const width =
									fixedWidth ??
									Math.min(800, Math.max(24, Math.ceil(measured.width) + 1)),
								height = Math.max(fixedHeight ?? 0, 24, Math.ceil(measured.height));
							if (
								!Number.isFinite(width) ||
								!Number.isFinite(height) ||
								width > 10000 ||
								height > 10000
							)
								throw new Error('Note dimensions exceed the preview limit');
							foreign.setAttribute('width', String(width));
							foreign.setAttribute('height', String(height));
							foreign.setAttribute('x', String(-width / 2));
							foreign.setAttribute('y', String(-height / 2));
							body.style.height = `${height}px`;
							setBounds(group, { x: -width / 2, y: -height / 2, width, height });
						} finally {
							measure.remove();
						}
					};
					layout();
					layouts.push(layout);
				} else if (drawing) {
					const strokes = drawing.strokes;
					if (strokes?.kind !== 'strokes' || strokes.is_null)
						throw new Error('Unsupported drawing encoding');
					const points: [number, number][] = [];
					for (const stroke of strokes.strokes) {
						if (!Number.isFinite(stroke.width) || stroke.width <= 0)
							throw new Error('Invalid stroke width');
						const { point, option } = strokeOptions(stroke.options_hex);
						if (option < 0 || option > 2)
							warnings.add('An unknown drawing style is rendered as a solid stroke.');
						const [r, g, b, a] = stroke.rgba16;
						const ink = `rgba(${r / 257},${g / 257},${b / 257},${a / 65535})`;
						// Validate before inspecting cubic segments or calculating arrow directions.
						pathData(stroke.path);
						if (stroke.path.elements.length < 2) {
							group.append(
								svgElement(doc, 'circle', {
									cx: point[0],
									cy: point[1],
									r: stroke.width / 2,
									fill: ink,
								}),
							);
							points.push(
								[point[0] - stroke.width / 2, point[1] - stroke.width / 2],
								[point[0] + stroke.width / 2, point[1] + stroke.width / 2],
							);
							continue;
						}
						const path =
							option === 2 ? withArrow(stroke.path, stroke.width) : stroke.path;
						group.append(
							svgElement(doc, 'path', {
								d: pathData(path),
								fill: 'none',
								stroke: ink,
								'stroke-width': stroke.width,
								'stroke-linecap': 'round',
								'stroke-linejoin': 'round',
								'stroke-dasharray':
									option === 1
										? `${3 * stroke.width} ${2 * stroke.width}`
										: 'none',
							}),
						);
						const box = pathBounds(path, stroke.width / 2);
						points.push([box.x, box.y], [box.x + box.width, box.y + box.height]);
					}
					setBounds(group, pointBounds(points));
				} else if (!folder) warnings.add('Unknown item types were omitted.');
				for (const child of children.get(item.id) ?? []) render(child, group, depth + 1);
				if (folder) {
					// Background bounds are measured after the SVG is attached below.
					group.dataset.background = color(folder.background_color, '#131518');
				}
			} catch (error) {
				group.remove();
				warnings.add(
					`Item ${item.id}: ${error instanceof Error ? error.message : 'could not render'}.`,
				);
			}
		};
		for (const item of children.get(-1) ?? []) render(item, content, 0);
		if (seen.size !== items.length)
			warnings.add('Items with missing, cyclic, or unsupported parents were omitted.');
		return {
			svg,
			content,
			warnings,
			ready: Promise.all(loads).then(() => {
				if (!disposed) layouts.forEach((layout) => layout());
			}),
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}

/** Called while attached, from deepest groups outward. */
export function finishScene(scene: RenderedScene): void {
	const groups = Array.from(
		scene.content.querySelectorAll<SVGGElement>('g[data-background]'),
	).reverse();
	for (const group of groups) {
		group.querySelector(':scope > .pureref-group-background')?.remove();
		const box = visibleBounds(group, true);
		group.prepend(
			svgElement(group.ownerDocument, 'rect', {
				class: 'pureref-group-background',
				x: box.x - 10,
				y: box.y - 10,
				width: box.width + 20,
				height: box.height + 20,
				rx: 8,
				'data-radius': 8,
				fill: group.dataset.background!,
			}),
		);
		setBounds(group, {
			x: box.x - 10,
			y: box.y - 10,
			width: box.width + 20,
			height: box.height + 20,
		});
	}
	const box = visibleBounds(scene.content);
	const padding = Math.max(20, Math.max(box.width, box.height) * 0.03);
	scene.svg.setAttribute(
		'viewBox',
		`${box.x - padding} ${box.y - padding} ${Math.max(1, box.width) + padding * 2} ${Math.max(1, box.height) + padding * 2}`,
	);
	if (!scene.content.querySelector('image, foreignObject, path, circle'))
		scene.warnings.add('The board is empty or has no supported visible items.');
}

/** Qt caps corner radii in screen space while retaining smaller radii when zoomed out. */
export function updateCorners(scene: RenderedScene): void {
	for (const element of Array.from(
		scene.content.querySelectorAll<SVGGraphicsElement>('[data-radius]'),
	)) {
		const matrix = element.getScreenCTM();
		if (!matrix) continue;
		const scale = Math.hypot(matrix.a, matrix.b),
			nominal = Number(element.dataset.radius);
		const radius = Math.min(nominal, nominal / scale);
		if (element.tagName === 'rect') element.setAttribute('rx', String(radius));
		else (element.firstElementChild as HTMLElement).style.borderRadius = `${radius}px`;
	}
	for (const outline of Array.from(
		scene.content.querySelectorAll<SVGPathElement>('.pureref-image-outline'),
	)) {
		const matrix = outline.getScreenCTM();
		if (matrix)
			outline.setAttribute('stroke-width', String(1 / Math.hypot(matrix.a, matrix.b)));
	}
}
