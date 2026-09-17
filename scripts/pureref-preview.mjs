import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildStyles } from './styles.mjs';

const root = new URL('../', import.meta.url);
const buildContext = await context({
	entryPoints: [fileURLToPath(new URL('tests/pureref/harness.mjs', root))],
	bundle: true,
	write: false,
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	external: ['fs', 'path', 'crypto', 'child_process', 'electron'],
	loader: { '.wasm': 'binary' },
	alias: { obsidian: fileURLToPath(new URL('tests/pureref/obsidian-stub.mjs', root)) },
});
await buildContext.rebuild();
const html = `<!doctype html><html><head><meta charset="utf-8"><title>PureRef embed proof of concept</title>
<link rel="stylesheet" href="/styles.css"><style>
body{margin:0;background:#18191d;color:#e5e5e5;font:15px/1.5 system-ui;padding:48px 24px}
main{max-width:980px;margin:auto}h1{font-size:28px;margin-bottom:4px}p{color:#b3b3bb}
button,select{background:#35363d;color:#eee;border:1px solid #50515a;border-radius:5px;padding:6px 10px}
.demo-controls{display:flex;gap:12px;align-items:center;margin:24px 0}#board{margin:20px 0}footer{height:650px}
</style></head><body><main><h1>PureRef, inside a note</h1>
<p>Read-only embedded rendering · PureRef 2.1.3 proof of concept</p>
<div class="demo-controls"><select aria-label="Sample board" id="sample"><option value="demo.pur">Mixed board</option><option value="two-images.pur">Two images</option><option value="compact-note.pur">Compact note</option><option value="rich.pur">Rich text</option><option value="wrapped.pur">Wrapped note</option><option value="drawings.pur">Drawing styles</option><option value="empty.pur">Empty board</option></select>
<label>Open local .pur <input type="file" accept=".pur" id="file"></label></div>
<p>Hover to zoom; middle-mouse drag to pan. Right-click for None, Lines or Dots grid. Touch drag and pinch work too. Outside the board, scrolling moves the note.</p>
<div id="board"></div><p id="status" role="status"></p><footer>Content below the embed remains scrollable.</footer>
</main><script src="/harness.js"></script></body></html>`;
const mime = { css: 'text/css', pur: 'application/octet-stream' };
const server = createServer(async (req, res) => {
	try {
		const path = new URL(req.url, 'http://localhost').pathname;
		if (path === '/styles.css') await buildStyles();
		if (path === '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end(html);
			return;
		}
		if (path === '/harness.js') {
			const result = await buildContext.rebuild();
			res.setHeader('Content-Type', 'application/javascript');
			res.setHeader('Cache-Control', 'no-store');
			res.end(result.outputFiles[0].contents);
			return;
		}
		const file =
			path === '/styles.css'
				? 'styles.css'
				: /^\/fixtures\/[a-z\d-]+\.pur$/.test(path)
					? `tests/pureref${path}`
					: null;
		if (!file) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.setHeader('Content-Type', mime[file.split('.').pop()] ?? 'application/octet-stream');
		res.end(await readFile(new URL(file, root)));
	} catch {
		res.writeHead(404);
		res.end();
	}
});
const port = Number(process.env.PUREREF_PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log(`PureRef preview: http://127.0.0.1:${port}`));
