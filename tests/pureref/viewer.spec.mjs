import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
});

test('mixed board renders original images, notes and drawings', async ({ page }) => {
	await expect(page.locator('svg image')).toHaveCount(3);
	expect(await page.locator('svg image').evaluateAll(images => images.map(image => ({
		id: image.closest('g[data-item-id]')?.getAttribute('data-item-id'),
		label: image.getAttribute('aria-label'),
	})))).toEqual([
		{ id: '3', label: 'Gradient' },
		{ id: '4', label: 'Checks' },
		{ id: '5', label: 'Cropped duplicate' },
	]);
	await expect(page.locator('.pureref-item-tooltip-target')).toHaveCount(0);
	await expect(page.locator('.pureref-viewport')).not.toHaveAttribute('aria-label', /.+/);
	await expect(page.locator('svg foreignObject')).toHaveCount(2);
	expect(
		await page
			.locator('svg foreignObject')
			.evaluateAll((elements) =>
				elements.every(
					(el) => el.firstElementChild.scrollHeight <= Number(el.getAttribute('height')),
				),
			),
	).toBe(true);
	expect(
		await page
			.locator('svg foreignObject')
			.first()
			.evaluate(
				(el) =>
					Number(el.getAttribute('x')) === -Number(el.getAttribute('width')) / 2 &&
					Number(el.getAttribute('y')) === -Number(el.getAttribute('height')) / 2,
			),
	).toBe(true);
	await expect(page.locator('svg > g path:not(.pureref-image-outline)')).toHaveCount(1);
	await expect(page.locator('.pureref-image-outline')).toHaveCount(3);
	expect(await page.evaluate(() => window.pureref.urls())).toBe(2); // shared resources
	await expect(page.locator('.pureref-notices, .pureref-viewer details')).toHaveCount(0);
	await page.locator('.pureref-viewer').screenshot({ path: 'test-results/pureref-demo.png' });
});

test('hover wheel zoom, middle-mouse pan, outside scrolling and keyboard', async ({ page }) => {
	const viewport = page.locator('.pureref-viewport');
	await expect(page.getByRole('button', { name: 'Toggle board interaction' })).toHaveCount(0);
	await page.locator('h1').hover();
	await page.mouse.wheel(0, 100);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
	expect(await page.evaluate(() => window.pureref.state().scale)).toBe(1);
	await viewport.hover();
	const scroll = await page.evaluate(() => scrollY);
	await page.mouse.wheel(0, -300);
	await expect.poll(() => page.evaluate(() => window.pureref.state().scale)).toBeGreaterThan(1);
	expect(await page.evaluate(() => scrollY)).toBe(scroll);
	const old = await page.evaluate(() => window.pureref.state());
	const box = await viewport.boundingBox();
	await page.mouse.move(box.x + 150, box.y + 150);
	await page.mouse.down({ button: 'left' });
	await page.mouse.move(box.x + 220, box.y + 170, { steps: 4 });
	await page.mouse.up({ button: 'left' });
	expect(await page.evaluate(() => window.pureref.state())).toEqual(old);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.move(box.x - 40, box.y + 180, { steps: 4 }); // capture continues outside
	await page.mouse.up({ button: 'middle' });
	await expect.poll(() => page.evaluate(() => window.pureref.state().x)).not.toBe(old.x);
	const released = await page.evaluate(() => window.pureref.state());
	await page.mouse.move(box.x - 50, box.y + 190);
	expect(await page.evaluate(() => window.pureref.state())).toEqual(released);
	await page.mouse.wheel(0, 100); // focus is still in the board; only hover matters
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll);
	expect(await page.evaluate(() => window.pureref.state().scale)).toBe(released.scale);
	await viewport.hover();
	await page.getByRole('button', { name: 'Fit board' }).click();
	expect(await page.evaluate(() => window.pureref.state())).toEqual({
		x: 0,
		y: 0,
		scale: 1,
		grid: 'none',
		locked: false,
		canvasGrayscale: false,
		grayscaleItems: [],
		commentsVisible: false,
	});
	await viewport.press('+');
	expect(await page.evaluate(() => window.pureref.state().scale)).toBeGreaterThan(1);
	await viewport.press('Escape');
	await expect(viewport).not.toBeFocused();
});

test('arrows fit cropped images and wrap in both directions', async ({ page }) => {
	const viewport = page.locator('.pureref-viewport');
	const fitted = async index => {
		await expect.poll(() => page.evaluate(index => {
			const viewport = document.querySelector('.pureref-viewport').getBoundingClientRect();
			const group = document.querySelectorAll('.pureref-viewport image')[index].closest('g[data-bounds]');
			const b = JSON.parse(group.dataset.bounds), m = group.getScreenCTM();
			const points = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
				.map(([x,y]) => new DOMPoint(x,y).matrixTransform(m));
			const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
			const l=Math.min(...xs),r=Math.max(...xs),t=Math.min(...ys),d=Math.max(...ys);
			return Math.abs((l+r)/2-(viewport.x+viewport.width/2)) < 1 &&
				Math.abs((t+d)/2-(viewport.y+viewport.height/2)) < 1 &&
				Math.abs(Math.max((r-l)/viewport.width,(d-t)/viewport.height)-1) < .01;
		}, index)).toBe(true);
	};
	await viewport.press('ArrowRight');
	await expect(viewport).toBeFocused();
	await fitted(0);
	await viewport.press('ArrowRight'); await fitted(1);
	await viewport.press('ArrowRight'); await fitted(2);
	await viewport.press('ArrowRight'); await fitted(0);
	await viewport.press('ArrowLeft'); await fitted(2);
	await viewport.press('f');
	expect((await page.evaluate(() => window.pureref.state())).scale).toBe(1);
	await viewport.press('ArrowLeft'); await fitted(2);
});

test('embed has no frame or permanent header', async ({ page }) => {
	await page.locator('h1').hover();
	await expect(page.locator('.pureref-viewer')).toHaveCSS('border-top-width', '0px');
	await expect(page.locator('.pureref-viewer')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	await expect(page.locator('.pureref-viewport')).toHaveCSS(
		'background-color',
		'rgb(29, 29, 29)',
	);
	await expect(page.locator('.pureref-toolbar')).toHaveCSS('opacity', '0');
	await expect(page.locator('.pureref-label, .pureref-hint')).toHaveCount(0);
	await page.locator('.pureref-viewport').hover();
	await expect(page.locator('.pureref-toolbar')).toHaveCSS('opacity', '1');
});

test('real fixture transforms, empty boards and multiple viewers clean up', async ({ page }) => {
	await page.evaluate(() => window.pureref.load('two-images.pur'));
	await expect(page.locator('[data-item-id="0"]')).toHaveAttribute(
		'transform',
		'matrix(1 0 0 1 100 200)',
	);
	await expect(page.locator('svg image')).toHaveCount(2);
	await page.evaluate(() => window.pureref.load('empty.pur'));
	expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
	await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
	await page.evaluate(() => window.pureref.load('compact-note.pur'));
	await expect(page.locator('.pureref-note')).toHaveCSS('padding', '4px');
	await page.evaluate(() => window.pureref.destroy());
	await expect(page.locator('.pureref-viewer')).toHaveCount(0);
	expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('note HTML cannot execute scripts or load remote content', async ({ page }) => {
	const unexpected = [];
	page.on('request', (request) => {
		if (
			!request.url().startsWith('http://127.0.0.1:4173') &&
			!request.url().startsWith('blob:') &&
			!request.url().startsWith('data:font/')
		)
			unexpected.push(request.url());
	});
	await page.evaluate(async () => {
		const bytes = await window.pureref.fixture('demo.pur');
		await window.pureref.loadBytes(bytes, (board) => {
			const original = board.decodedRows.bind(board);
			board.decodedRows = (table) =>
				original(table).map((row) =>
					table === 'items_notes'
						? {
								...row,
								text: '<p onclick="window.pwned=1">Safe Ω 中 <b>bold</b></p><img src="https://example.invalid/steal" onerror="window.pwned=1"><script>window.pwned=1</script><style>body{display:none}</style><iframe src="https://example.invalid/frame"></iframe>',
							}
						: row,
				);
		});
	});
	await expect(
		page.locator(
			'foreignObject script, foreignObject img, foreignObject iframe, foreignObject style, foreignObject [onclick]',
		),
	).toHaveCount(0);
	expect(await page.evaluate(() => window.pwned)).toBeUndefined();
	expect(unexpected).toEqual([]);
	await expect(page.locator('.pureref-note').first()).toContainText('Safe Ω 中 bold');
});

test('component sizing, stale loads, reload viewport and cleanup', async ({ page }) => {
	await page.evaluate(() => window.pureref.mountComponent());
	await page.evaluate(() => {
		window.componentTest.start();
		window.componentTest.start();
		window.componentTest.resolve(1);
	});
	await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
	await expect(page.locator('.pureref-viewer')).toHaveCSS('width', '600px');
	await expect(page.locator('.pureref-viewport')).toHaveCSS('height', '400px');
	await page.locator('.pureref-viewport').click({ button: 'right' });
	await page.locator('.menu-item').filter({ hasText: /^Grid$/ }).hover();
	await page.locator('.menu-item').filter({ hasText: /^Dots$/ }).click();
	await page.locator('.pureref-viewport').hover();
	await page.evaluate(() => window.componentTest.zoomIn());
	const before = await page.evaluate(() => window.componentTest.state());
	await page.evaluate(async () => window.componentTest.resolve(0, new ArrayBuffer(0)));
	await expect(page.locator('.pureref-viewer')).toHaveCount(1);
	await page.evaluate(() => {
		window.componentTest.modify();
		window.componentTest.resolve(2);
	});
	await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
	await expect.poll(() => page.evaluate(() => window.componentTest.state())).toEqual(before);
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'dots');
	await page.evaluate(() => {
		window.componentTest.start();
		window.componentTest.close();
		window.componentTest.resolve(3);
	});
	await expect(page.locator('.pureref-viewer')).toHaveCount(0);
	expect(await page.evaluate(() => window.componentTest.activeListeners())).toBe(0);
	expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('detached embeds wait for attachment and cancel on unload', async ({ page }) => {
	await page.evaluate(() => window.pureref.mountComponent());
	await page.evaluate(() => {
		window.detachedBoard = document.querySelector('#board');
		window.detachedBoard.remove();
		window.componentTest.start();
		window.componentTest.resolve(0);
	});
	await expect.poll(() => page.evaluate(() => window.componentTest.waitingForAttachment())).toBe(true);
	expect(await page.evaluate(() => window.detachedBoard.querySelector('.pureref-error, .pureref-viewer'))).toBeNull();
	await page.evaluate(() => document.body.append(window.detachedBoard));
	await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
	await page.evaluate(() => {
		window.detachedBoard.remove();
		window.componentTest.start();
		window.componentTest.resolve(1);
	});
	await expect.poll(() => page.evaluate(() => window.componentTest.waitingForAttachment())).toBe(true);
	await page.evaluate(() => window.componentTest.close());
	expect(await page.evaluate(() => window.componentTest.waitingForAttachment())).toBe(false);
	await page.evaluate(() => document.body.append(window.detachedBoard));
	await expect(page.locator('.pureref-viewer, .pureref-error')).toHaveCount(0);
	expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('movement lock, grids, grayscale and theme-aware canvas controls', async ({ page }) => {
	const viewport = page.locator('.pureref-viewport');
	await viewport.press('ArrowRight');
	await page.evaluate(() => window.pureref.action('toggleImageGrayscale'));
	await expect(page.locator('g[data-item-id="3"]')).toHaveClass(/is-grayscale/);
	await expect(page.locator('g[data-item-id="4"]')).not.toHaveClass(/is-grayscale/);
	await page.evaluate(() => window.pureref.action('toggleCanvasGrayscale'));
	await expect(page.locator('.pureref-viewport > svg > g')).toHaveClass(/is-grayscale/);

	await viewport.press('g');
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'lines');
	await viewport.press('g');
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'none');
	await page.evaluate(() => window.pureref.action('cycleGrid'));
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'lines');
	await page.evaluate(() => window.pureref.action('cycleGrid'));
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'dots');
	await page.evaluate(() => window.pureref.action('cycleGrid'));
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'none');

	const lock = page.getByRole('button', { name: 'Lock canvas movement' });
	await lock.click();
	await expect(lock).toHaveAttribute('aria-pressed', 'true');
	const before = await page.evaluate(() => window.pureref.state());
	await viewport.hover();
	await page.mouse.wheel(0, -300);
	await page.evaluate(() => window.pureref.action('zoomIn'));
	expect(await page.evaluate(() => window.pureref.state())).toEqual(before);

	await page.evaluate(() => document.documentElement.style.setProperty('--background-primary', '#ffffff'));
	await expect(viewport).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('viewer history undoes and redoes atomic changes and wheel bursts', async ({ page }) => {
	const viewport = page.locator('.pureref-viewport');
	await expect(page.getByRole('button', { name: /(?:Undo|Redo) viewer change/ })).toHaveCount(0);

	await page.evaluate(() => window.pureref.action('zoomIn'));
	const zoomed = await page.evaluate(() => window.pureref.state().scale);
	expect(zoomed).toBeGreaterThan(1);
	await page.evaluate(() => window.pureref.action('undo'));
	expect(await page.evaluate(() => window.pureref.state().scale)).toBe(1);
	await page.evaluate(() => window.pureref.action('redo'));
	expect(await page.evaluate(() => window.pureref.state().scale)).toBe(zoomed);

	await viewport.hover();
	const beforeWheel = await page.evaluate(() => window.pureref.state().scale);
	await page.mouse.wheel(0, -100);
	await page.mouse.wheel(0, -100);
	await page.waitForTimeout(300);
	await page.evaluate(() => window.pureref.action('undo'));
	expect(await page.evaluate(() => window.pureref.state().scale)).toBe(beforeWheel);

	await page.evaluate(() => window.pureref.action('toggleLock'));
	expect(await page.evaluate(() => window.pureref.state().locked)).toBe(true);
	await page.evaluate(() => window.pureref.action('undo'));
	expect(await page.evaluate(() => window.pureref.state().locked)).toBe(false);
});

test('comments use Alt-C callouts and the global context menu', async ({ page }) => {
	await page.evaluate(() => window.pureref.load('comments-demo.pur'));
	await expect(page.locator('.pureref-comment-callout:visible')).toHaveCount(0);
	await page.evaluate(() => window.pureref.action('toggleComments'));
	expect(await page.evaluate(() => window.pureref.state().commentsVisible)).toBe(true);
	await expect(page.locator('.pureref-comment-callout')).toHaveCount(2);
	await expect(page.locator('.pureref-comment-callout')).toContainText([
		'Generated entirely by pureref2.py.',
		'234 independently transformed items',
	]);
	await page.locator('.pureref-viewport').click({ button: 'right' });
	await expect(page.locator('.menu-item').filter({ hasText: /^Hide comments$/ })).toHaveCount(1);
});

test('file switches release the previous component', async ({ page }) => {
	expect(await page.evaluate(() => window.pureref.fileSwitch())).toEqual({
		afterSwitch: 1,
		afterClose: 0,
	});
	await expect.poll(() => page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('malformed input shows a clear error', async ({ page }) => {
	await page.evaluate(() => window.pureref.mountComponent());
	await page.evaluate(() => {
		window.componentTest.start();
		window.componentTest.resolve(0, new ArrayBuffer(4));
	});
	await expect(page.locator('.pureref-error')).toContainText('Could not preview');
	expect(await page.evaluate(() => window.pureref.urls())).toBe(0);
});

test('fit uses cropped geometry rather than the full source image', async ({ page }) => {
	await page.evaluate(async () => {
		await window.pureref.loadBytes(await window.pureref.fixture('demo.pur'), (board) => {
			const original = board.decodedRows.bind(board);
			board.decodedRows = (table) =>
				table === 'items'
					? original(table)
							.filter((row) => row.id === 5)
							.map((row) => ({
								...row,
								parent: -1,
								transform: {
									kind: 'transform',
									type_id: 80,
									is_null: false,
									value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
								},
							}))
					: original(table);
		});
	});
	await expect(page.locator('svg image')).toHaveCount(1);
	await expect(page.locator('.pureref-viewport > svg')).toHaveAttribute(
		'viewBox',
		'-60 -70 120 140',
	);
	await expect(page.locator('clipPath path')).toHaveAttribute(
		'd',
		'M-40 -50 L40 -50 L40 50 L-40 50 L-40 -50',
	);
});

test('nested parent transforms are composed when fitting', async ({ page }) => {
	await page.evaluate(async () => {
		await window.pureref.loadBytes(await window.pureref.fixture('demo.pur'), (board) => {
			const original = board.decodedRows.bind(board),
				raw = board.rows.bind(board);
			const transform = (x, y) => ({
				kind: 'transform',
				type_id: 80,
				is_null: false,
				value: [1, 0, 0, 0, 1, 0, x, y, 1],
			});
			const group = original('items').find((row) => row.id === 0);
			const image = original('items').find((row) => row.id === 3);
			board.decodedRows = (table) =>
				table === 'items'
					? [
							{ ...group, parent: -1, transform: transform(100, 50) },
							{ ...group, id: 100, parent: 0, transform: transform(20, 30) },
							{ ...image, parent: 100, transform: transform(5, 7) },
						]
					: original(table);
			board.rows = (table) =>
				table === 'items_groups'
					? [
							{ id: 0, background_color: null, lock_mode: 1 },
							{ id: 100, background_color: null, lock_mode: 1 },
						]
					: raw(table);
		});
	});
	await expect(
		page.locator('[data-item-id="0"] > [data-item-id="100"] > [data-item-id="3"]'),
	).toHaveCount(1);
	await expect(page.locator('.pureref-viewport > svg')).toHaveAttribute(
		'viewBox',
		'5 -3 240 180',
	);
});

test('touch pinch zooms without activation', async ({ browser }) => {
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 900, height: 800 },
	});
	const page = await context.newPage();
	try {
		await page.goto('http://127.0.0.1:4173');
		await expect(page.locator('.pureref-viewer')).toHaveAttribute('data-ready', 'true');
		await page.locator('.pureref-viewport').hover();
		const box = await page.locator('.pureref-viewport').boundingBox();
		const x = box.x + box.width / 2,
			y = box.y + box.height / 2;
		const cdp = await context.newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [
				{ x: x - 30, y, id: 1 },
				{ x: x + 30, y, id: 2 },
			],
		});
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [
				{ x: x - 90, y, id: 1 },
				{ x: x + 90, y, id: 2 },
			],
		});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect
			.poll(() => page.evaluate(() => window.pureref.state().scale))
			.toBeGreaterThan(1);
	} finally {
		await context.close();
	}
});

test('grid menu supports keyboard, stays anchored during zoom, and cleans up', async ({ page }) => {
	const viewport = page.locator('.pureref-viewport');
	await viewport.click({ button: 'right' });
	await expect(page.getByRole('menu')).toBeVisible();
	await page.locator('.menu-item').filter({ hasText: /^Grid$/ }).hover();
	await expect(page.getByRole('menuitem', { name: 'None', exact: true })).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await page.locator('.menu-item').filter({ hasText: /^Grid$/ }).hover();
	await page.locator('.menu-item').filter({ hasText: /^Dots$/ }).click();
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'dots');
	const spacing = await page
		.locator('.pureref-grid')
		.evaluate((el) => parseFloat(el.style.backgroundSize));
	await viewport.hover();
	await page.mouse.wheel(0, -150);
	await expect
		.poll(() =>
			page.locator('.pureref-grid').evaluate((el) => parseFloat(el.style.backgroundSize)),
		)
		.toBeGreaterThan(spacing);
	const alignment = await page.evaluate(() => {
		const root = document.querySelector('.pureref-viewport');
		const matrix = root.querySelector('svg').getScreenCTM();
		const rect = root.getBoundingClientRect();
		const position = root
			.querySelector('.pureref-grid')
			.style.backgroundPosition.split(' ')
			.map(parseFloat);
		return [
			Math.abs(matrix.e - rect.left - position[0]),
			Math.abs(matrix.f - rect.top - position[1]),
		];
	});
	expect(Math.max(...alignment)).toBeLessThan(0.01);
	await viewport.press('Shift+F10');
	await page.getByRole('menuitem', { name: 'Grid', exact: true }).press('ArrowRight');
	await page.getByRole('menuitem', { name: 'Dots', exact: true }).press('ArrowUp');
	await expect(page.getByRole('menuitem', { name: 'Lines', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('.pureref-grid')).toHaveAttribute('data-grid', 'lines');
	await viewport.click({ button: 'right' });
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
	await expect(viewport).toBeFocused();
	await viewport.click({ button: 'right' });
	await page.locator('h1').click();
	await expect(page.getByRole('menu')).toHaveCount(0);
	await viewport.click({ button: 'right' });
	await page.locator('.menu-item').filter({ hasText: /^Grid$/ }).hover();
	await page.locator('.menu-item').filter({ hasText: /^None$/ }).click();
	await expect(page.locator('.pureref-grid')).toBeHidden();
	await viewport.click({ button: 'right' });
	await page.evaluate(() => window.pureref.destroy());
	await expect(page.getByRole('menu')).toHaveCount(0);
});

test('editor button is explicitly a demo placeholder', async ({ page }) => {
	await page.locator('.pureref-viewport').hover();
	await page.getByRole('button', { name: 'Open in PureRef', exact: true }).click();
	await expect(page.locator('#status')).toContainText('Demo only');
});

test('note layout stays close to native PureRef exports, including overflowing fixed height', async ({
	page,
}) => {
	// Expected dimensions measured from fresh PureRef 2.1.3 exports in references/.
	// Browser and native font advances differ slightly; allow 1% in automatic widths.
	for (const [name, width, height] of [
		['title', 512, 62],
		['compact', 531, 38],
		['wrapped', 200, 242],
		['rich', 260, 176],
	]) {
		await page.evaluate((name) => window.pureref.load(`${name}.pur`), name);
		const box = await page.locator('foreignObject').evaluate((el) => ({
			width: +el.getAttribute('width'),
			height: +el.getAttribute('height'),
		}));
		expect(Math.abs(box.width - width)).toBeLessThanOrEqual(width * 0.01);
		expect(Math.abs(box.height - height)).toBeLessThanOrEqual(1);
		expect(
			await page
				.locator('foreignObject')
				.evaluate((el) => el.firstElementChild.scrollHeight <= +el.getAttribute('height')),
		).toBe(true);
	}
});

test('integer font sizes survive in body and spans while Qt-invalid decimal pixels inherit', async ({
	page,
}) => {
	for (const tag of ['body', 'span']) {
		for (const [size, nativeWidth, nativeHeight] of [
			['24px', 556, 65],
			['24.0px', 512, 62],
		]) {
			await page.evaluate(
				async ({ tag, size }) => {
					await window.pureref.loadBytes(
						await window.pureref.fixture('title.pur'),
						(board) => {
							const original = board.decodedRows.bind(board);
							board.decodedRows = (table) =>
								original(table).map((row) =>
									table !== 'items_notes'
										? row
										: {
												...row,
												text: `<html><${tag} style="font-family:Open Sans;font-size:${size}"><p style="margin:0">.pur encoded from scratch, renderd by PureRef</p></${tag}></html>`,
											},
								);
						},
					);
				},
				{ tag, size },
			);
			const box = await page
				.locator('foreignObject')
				.evaluate((el) => [+el.getAttribute('width'), +el.getAttribute('height')]);
			expect(Math.abs(box[0] - nativeWidth)).toBeLessThanOrEqual(nativeWidth * 0.01);
			expect(Math.abs(box[1] - nativeHeight)).toBeLessThanOrEqual(1);
		}
	}
});

test('moving drawings changes scene fit but not group background geometry', async ({ page }) => {
	const inset = await page.evaluate(() => {
		const group = document.querySelector('[data-item-id="0"]');
		const title = group.querySelector('[data-item-id="1"]');
		const box = JSON.parse(title.dataset.bounds);
		const matrix = title.transform.baseVal.consolidate().matrix;
		return matrix.f + box.y - JSON.parse(group.dataset.bounds).y;
	});
	expect(inset).toBeCloseTo(10, 5);
	const before = await page.locator('[data-item-id="0"]').getAttribute('data-bounds');
	const viewBox = await page.locator('.pureref-viewport > svg').getAttribute('viewBox');
	await page.evaluate(async () => {
		await window.pureref.loadBytes(await window.pureref.fixture('demo.pur'), (board) => {
			const original = board.decodedRows.bind(board);
			board.decodedRows = (table) =>
				original(table).map((row) => {
					if (table !== 'items' || row.id !== 6) return row;
					const value = [...row.transform.value];
					value[7] += 1000;
					return { ...row, transform: { ...row.transform, value } };
				});
		});
	});
	await expect(page.locator('[data-item-id="0"]')).toHaveAttribute('data-bounds', before);
	expect(await page.locator('.pureref-viewport > svg').getAttribute('viewBox')).not.toBe(viewBox);
});

test('dash, arrow and point strokes preserve native option semantics', async ({ page }) => {
	await page.evaluate(async () => {
		await window.pureref.loadBytes(await window.pureref.fixture('demo.pur'), (board) => {
			const original = board.decodedRows.bind(board);
			board.decodedRows = (table) =>
				original(table).map((row) => {
					if (table !== 'items_drawings') return row;
					const stroke = row.strokes.strokes[0];
					const line = {
						...stroke.path,
						elements: [
							[0, 0, 0],
							[1, 200, 0],
						],
					};
					return {
						...row,
						strokes: {
							...row.strokes,
							strokes: [
								{
									...stroke,
									width: 10,
									path: line,
									options_hex: '0'.repeat(39) + '1',
								},
								{
									...stroke,
									width: 10,
									path: line,
									options_hex: '0'.repeat(39) + '2',
								},
								{
									...stroke,
									width: 10,
									path: { ...line, elements: [] },
									options_hex: '4034000000000000404400000000000000000000',
								},
							],
						},
					};
				});
		});
	});
	const paths = page.locator('[data-item-id="6"] > path');
	await expect(paths.nth(0)).toHaveAttribute('stroke-dasharray', '30 20');
	const d = await paths.nth(1).getAttribute('d');
	const coordinates = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
	expect(coordinates[4]).toBeCloseTo(181.565157, 4);
	expect(coordinates[5]).toBeCloseTo(16.88658, 4);
	await expect(page.locator('[data-item-id="6"] > circle')).toHaveAttribute('cx', '20');
	await expect(page.locator('[data-item-id="6"] > circle')).toHaveAttribute('cy', '40');
	await expect(page.locator('[data-item-id="6"] > circle')).toHaveAttribute('r', '5');
});

test('cubic extrema exclude off-curve control points when calculating bounds', async ({ page }) => {
	await page.evaluate(async () => {
		await window.pureref.loadBytes(await window.pureref.fixture('demo.pur'), (board) => {
			const original = board.decodedRows.bind(board);
			board.decodedRows = (table) =>
				original(table).map((row) =>
					table !== 'items_drawings'
						? row
						: {
								...row,
								strokes: {
									...row.strokes,
									strokes: [
										{
											...row.strokes.strokes[0],
											width: 4,
											path: {
												...row.strokes.strokes[0].path,
												elements: [
													[0, 0, 0],
													[2, 0, 100],
													[3, 100, 100],
													[3, 100, 0],
												],
											},
										},
									],
								},
							},
				);
		});
	});
	expect(
		JSON.parse(await page.locator('[data-item-id="6"]').getAttribute('data-bounds')),
	).toEqual({ x: -2, y: -2, width: 104, height: 79 });
});
