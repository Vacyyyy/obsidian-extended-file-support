import { PainterPath } from 'pur-2-file-format';

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

/** The tag-100 stroke trailer is a QPointF followed by one big-endian option integer. */
export function strokeOptions(hex: string): { point: Point; option: number } {
	if (!/^[\da-f]{40}$/i.test(hex)) throw new Error('Unsupported drawing options');
	const bytes = Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
	const view = new DataView(bytes.buffer);
	const point: Point = [view.getFloat64(0), view.getFloat64(8)];
	if (!point.every(Number.isFinite)) throw new Error('Invalid drawing point');
	return { point, option: view.getInt32(16) };
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function cubicLength([a, b, c, d]: Cubic, depth = 0): number {
	const chord = distance(a, d),
		polygon = distance(a, b) + distance(b, c) + distance(c, d);
	if (depth === 12 || polygon - chord < 0.01) return (polygon + chord) / 2;
	const ab = midpoint(a, b),
		bc = midpoint(b, c),
		cd = midpoint(c, d);
	const abc = midpoint(ab, bc),
		bcd = midpoint(bc, cd),
		middle = midpoint(abc, bcd);
	return (
		cubicLength([a, ab, abc, middle], depth + 1) + cubicLength([middle, bcd, cd, d], depth + 1)
	);
}

/** PureRef's open arrow: two wings at ±2.4 radians, each 2.5 pen widths long. */
export function withArrow(path: PainterPath, width: number): PainterPath {
	const elements = path.elements;
	const n = elements.length;
	if (n < 2) return path;
	const point = (index: number): Point => [elements[index][1], elements[index][2]];
	const end = point(n - 1);
	let tangent: Point;
	if (elements[n - 1][0] === 1) {
		const previous = point(n - 2);
		tangent = [end[0] - previous[0], end[1] - previous[1]];
	} else if (n >= 4 && elements[n - 3][0] === 2 && elements[n - 1][0] === 3) {
		let cubic: Cubic = [point(n - 4), point(n - 3), point(n - 2), end];
		let length = cubicLength(cubic),
			backward = width;
		if (width > length && n >= 7 && elements[n - 6][0] === 2) {
			backward -= length;
			cubic = [point(n - 7), point(n - 6), point(n - 5), point(n - 4)];
			length = cubicLength(cubic);
		}
		if (!length) return path;
		const t = 1 - backward / length,
			u = 1 - t;
		const [a, b, c, d] = cubic;
		tangent = [0, 1].map(
			(axis) =>
				3 * u * u * (b[axis] - a[axis]) +
				6 * u * t * (c[axis] - b[axis]) +
				3 * t * t * (d[axis] - c[axis]),
		) as Point;
	} else return path;
	const magnitude = Math.hypot(...tangent);
	if (!magnitude || !Number.isFinite(magnitude)) return path;
	const wings = [2.4, -2.4].map(
		(angle) =>
			[
				end[0] +
					(2.5 * width * (tangent[0] * Math.cos(angle) - tangent[1] * Math.sin(angle))) /
						magnitude,
				end[1] +
					(2.5 * width * (tangent[0] * Math.sin(angle) + tangent[1] * Math.cos(angle))) /
						magnitude,
			] as Point,
	);
	return { ...path, elements: [...elements, [1, ...wings[0]], [0, ...end], [1, ...wings[1]]] };
}
