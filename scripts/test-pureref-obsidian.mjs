import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Opt-in test against an already running Obsidian with remote debugging enabled.
// Refuse to touch any vault except the generated development vault in this repo.
const root = new URL('../', import.meta.url);
const vaultPath = fileURLToPath(new URL('.test-vault', root));
const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_CDP ?? 'http://127.0.0.1:9229');
let page;
try {
	for (const candidate of browser.contexts().flatMap(context => context.pages())) {
		const path = await candidate.evaluate(() => window.app?.vault?.adapter?.basePath).catch(() => null);
		if (path && resolve(path) === resolve(vaultPath)) { page = candidate; break; }
	}
	assert(page, `Open the generated vault first: ${vaultPath}`);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const probe = new URL('.test-vault/.obsidian/plugins/pureref-test-probe/', root);
	await mkdir(probe, { recursive: true });
	await writeFile(new URL('manifest.json', probe), JSON.stringify({
		id: 'pureref-test-probe', name: 'PureRef test probe', version: '0.0.0',
		minAppVersion: '1.0.0', author: 'Local tests', description: 'Native sanitizer smoke test.', isDesktopOnly: true,
	}));
	await build({ entryPoints: [fileURLToPath(new URL('tests/pureref/obsidian-probe.ts', root))],
		bundle: true, format: 'cjs', platform: 'node', external: ['obsidian', 'electron'], outfile: fileURLToPath(new URL('main.js', probe)) });
	await page.evaluate(async () => {
		await app.plugins.unloadPlugin('extended-file-support');
		await app.plugins.loadPlugin('extended-file-support');
		await app.plugins.loadManifests();
		await app.plugins.loadPlugin('pureref-test-probe');
	});
	const requests = [];
	await page.route('https://example.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
	const sanitized = await page.evaluate(() => {
		const node = app.plugins.plugins['pureref-test-probe'].noteContent(document,
			`<!doctype html><html><head><style>body{display:none}</style></head><body style="font-family:'Open Sans';font-size:22px">
			<p onclick="window.purerefPwned=1">Safe Ω 中 <b>bold</b> <a href="https://example.invalid/link">link text</a></p>
			<img src="https://example.invalid/image" onerror="window.purerefPwned=1"><iframe src="https://example.invalid/frame"></iframe>
			<script>window.purerefPwned=1</script><span style="background:url(https://example.invalid/css);font-size:24.0px">decimal</span>
			<svg><foreignObject><img src="https://example.invalid/nested"></foreignObject></svg></body></html>`);
		document.body.append(node);
		const result = { text: node.textContent, html: node.innerHTML, family: node.style.fontFamily,
			size: node.style.fontSize, decimal: node.querySelector('span').style.fontSize,
			unsafe: node.querySelectorAll('img,iframe,script,style,svg,a,[onclick]').length,
			pwned: !!window.purerefPwned };
		node.remove();
		return result;
	});
	assert.equal(sanitized.unsafe, 0);
	assert.equal(sanitized.pwned, false);
	assert.equal(sanitized.size, '22px');
	assert.equal(sanitized.decimal, '');
	assert.match(sanitized.family, /PureRef Open Sans/);
	assert.match(sanitized.text, /Safe Ω 中 bold link text/);
	assert(!sanitized.html.includes('example.invalid'));
	assert.deepEqual(requests, []);
	console.log('PASS native sanitizer: typography retained; no scripts, resource requests, or links');
	const explicitLaunch = await page.evaluate(async () => {
		const childProcess = require('child_process'), original = childProcess.spawn;
		let invocation;
		childProcess.spawn = (executable, args, options) => {
			invocation = { executable, args, options };
			const child = new (require('events').EventEmitter)();
			child.unref = () => {};
			queueMicrotask(() => child.emit('spawn'));
			return child;
		};
		try {
			// An existing executable, intercepted before launch; a path that needs
			// quoting in a shell must remain one untouched argument here.
			await app.plugins.plugins['pureref-test-probe'].openPureRef(app, { path: 'board with spaces & Ω.pur' }, process.execPath);
			return { invocation, expectedPath: app.vault.adapter.getFullPath('board with spaces & Ω.pur'), executable: process.execPath };
		} finally { childProcess.spawn = original; }
	});
	assert.equal(explicitLaunch.invocation.executable, explicitLaunch.executable);
	assert.deepEqual(explicitLaunch.invocation.args, [explicitLaunch.expectedPath]);
	assert.equal(explicitLaunch.invocation.options.shell, false);
	console.log('PASS executable override: spaces and Unicode passed as one argument, no shell');

	const open = async (file, mode) => {
		await page.evaluate(async ({ file, mode }) => {
			const leaf = app.workspace.getLeaf();
			await leaf.openFile(app.vault.getAbstractFileByPath(file));
			if (mode) await leaf.setViewState({ type: 'markdown', state: { file, mode, source: false } });
		}, { file, mode });
		await page.locator('.workspace-leaf.mod-active .pureref-viewer[data-ready="true"]:visible').first().waitFor();
		assert.equal(await page.locator('.workspace-leaf.mod-active .pureref-error').count(), 0);
	};
	await open('PureRef preview.md', 'preview');
	const embed = page.locator('.markdown-reading-view .pureref-viewer').first();
	await embed.scrollIntoViewIfNeeded();
	const size = await embed.evaluate(el => ({ width: el.style.width, height: el.querySelector('.pureref-viewport').getBoundingClientRect().height }));
	assert.equal(size.width, '600px');
	assert.equal(size.height, 400);
	await page.screenshot({ path: fileURLToPath(new URL('test-results/obsidian-reading.png', root)) });
	console.log('PASS Reading view: sized embeds and real CSS font');
	await open('PureRef preview.md', 'source');
	assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getMode()), 'source');
	assert(await page.locator('.markdown-source-view .pureref-viewer').count() > 0);
	console.log('PASS Live Preview: embedded boards render');
	await open('demo.pur');
	assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getViewType()), 'extended-file-support-pur');
	const active = page.locator('.workspace-leaf.mod-active .pureref-viewer');
	await active.locator('.pureref-viewport').click({ button: 'right' });
	await page.getByRole('menuitemradio', { name: 'Dots', exact: true }).click();
	await active.hover();
	await active.getByRole('button', { name: 'Zoom in', exact: true }).click();
	const before = await page.evaluate(() => app.workspace.activeLeaf.view.component.viewer.getState());
	await page.evaluate(async () => { await app.workspace.activeLeaf.view.component.loadFile(); });
	const after = await page.evaluate(() => app.workspace.activeLeaf.view.component.viewer.getState());
	assert.deepEqual(after, before);
	// Exercise the host callback without launching a real external editor during tests.
	await page.evaluate(() => { const shell = require('electron').shell; window.purerefOriginalOpen = shell.openPath; shell.openPath = async path => { window.purerefOpenedPath = path; return ''; }; });
	try {
		await active.hover();
		await active.locator('.pureref-open-button').click();
		assert.equal(await page.evaluate(() => window.purerefOpenedPath), resolve(vaultPath, 'demo.pur'));
	} finally {
		await page.evaluate(() => { require('electron').shell.openPath = window.purerefOriginalOpen; delete window.purerefOriginalOpen; delete window.purerefOpenedPath; });
	}
	const settingsBefore = await page.evaluate(() => ({ ...app.plugins.plugins['extended-file-support'].settings }));
	try {
		for (const key of ['pur_show_zoom', 'pur_show_fit', 'pur_show_open']) {
			await page.evaluate(async key => { const p = app.plugins.plugins['extended-file-support']; p.settings[key] = false; await p.saveSettings(); }, key);
		}
		assert.equal(await active.locator('.pureref-toolbar').isVisible(), false);
		assert.equal(await active.locator('details').count(), 0);
		await page.evaluate(async () => { const p = app.plugins.plugins['extended-file-support']; p.settings.pur_show_open = true; p.settings.pur_open_display = 'text'; await p.saveSettings(); });
		assert.equal(await active.locator('.pureref-open-button img').count(), 0);
		assert(await active.locator('.pureref-open-button').textContent());
		assert.equal(await active.getByRole('button', { name: 'Fit board' }).count(), 0);
		await page.evaluate(async () => { const p = app.plugins.plugins['extended-file-support']; p.settings.pur_open_display = 'both'; await p.saveSettings(); });
		await active.locator('.pureref-open-button img').waitFor({ state: 'attached' });
		assert.match(await active.locator('.pureref-open-button img').getAttribute('src'), /^data:image\/png;base64,/);
		console.log('PASS toolbar settings: live visibility, icon/text modes, native OS icon; no limitations dropdown');
	} finally {
		await page.evaluate(async settings => { const p = app.plugins.plugins['extended-file-support']; p.settings = settings; await p.saveSettings(); }, settingsBefore);
	}
	await page.evaluate(() => { window.purerefPreviousViewer = app.workspace.activeLeaf.view.component.viewer; });
	await open('two-images.pur');
	assert.equal(await page.evaluate(() => window.purerefPreviousViewer.element.isConnected), false);
	await page.evaluate(() => { delete window.purerefPreviousViewer; });
	console.log('PASS file tabs: grid, zoom, reload state, editor callback, and switch cleanup');
	await page.evaluate(() => {
		const plugin = app.plugins.plugins['extended-file-support'];
		plugin.toggleExtension('pur', false);
	});
	assert.equal(await page.evaluate(() => app.viewRegistry.typeByExtension.pur), undefined);
	await page.evaluate(() => app.plugins.plugins['extended-file-support'].toggleExtension('pur', true));
	await open('PureRef preview.md', 'preview');
	console.log('PASS format setting: registration can be disabled and restored');
	// Exercise the exact command that destroys the entire renderer, not just a
	// component reload. Save the open tab before changing its viewport so layout
	// persistence cannot accidentally mask a missing viewport-session write.
	for (const [file, mode, selector] of [
		['demo.pur', undefined, '.workspace-leaf.mod-active .pureref-viewer'],
		['PureRef preview.md', 'preview', '.markdown-reading-view .pureref-viewer'],
	]) {
		await open(file, mode);
		await page.evaluate(async () => { await app.workspace.saveLayout(); });
		const board = page.locator(selector).first();
		await board.scrollIntoViewIfNeeded();
		await board.hover();
		await board.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await board.locator('.pureref-viewport').press('ArrowRight');
		await board.locator('.pureref-viewport').click({ button: 'right' });
		await page.getByRole('menuitemradio', { name: 'Dots', exact: true }).click();
		await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('.pureref-grid')?.dataset.grid === 'dots', selector);
		const transform = await board.locator('.pureref-viewport > svg').evaluate(svg => svg.style.transform);
		await Promise.all([
			page.waitForEvent('domcontentloaded'),
			page.evaluate(() => { setTimeout(() => app.commands.executeCommandById('app:reload'), 0); }),
		]);
		await page.locator(`${selector}[data-ready="true"]`).first().waitFor();
		await page.waitForFunction(({ selector, transform }) =>
			document.querySelector(selector)?.querySelector('.pureref-viewport > svg')?.style.transform === transform,
			{ selector, transform });
		assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), file);
		assert.equal(await board.locator('.pureref-grid').getAttribute('data-grid'), 'dots');
		console.log(`PASS Reload app without saving: pan, zoom, grid retained in ${mode ? 'note embed' : 'file tab'}`);
	}
	assert.deepEqual(errors, []);
} finally {
	if (page) await page.evaluate(async () => { await app.plugins.unloadPlugin('pureref-test-probe'); }).catch(() => {});
	await browser.close();
}
