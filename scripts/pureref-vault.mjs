import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const vault = new URL('.test-vault/', root);
const plugin = new URL('.obsidian/plugins/extended-file-support/', vault);
await mkdir(plugin, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
	await copyFile(new URL(name, root), new URL(name, plugin));
}
for (const name of await readdir(new URL('tests/pureref/fixtures/', root))) {
	if (name.endsWith('.pur'))
		await copyFile(new URL(`tests/pureref/fixtures/${name}`, root), new URL(name, vault));
}
const initial = async (path, text) => {
	try { await writeFile(new URL(path, vault), text, { flag: 'wx' }); }
	catch (error) { if (error.code !== 'EEXIST') throw error; }
};
await initial('.obsidian/community-plugins.json', '["extended-file-support"]\n');
await initial('.obsidian/app.json', '{"showUnsupportedFiles":true}\n');
await initial('.obsidian/appearance.json', '{"theme":"obsidian"}\n');
await initial('PureRef preview.md', `# PureRef plugin test vault

This isolated vault contains synthetic fixtures and the three release assets.
Enable community plugins if prompted. Test this note in Reading view and Live
Preview, and open the .pur files directly. Hover to zoom; middle-drag to pan.
Right-click for grids. The editor button opens the system application for .pur.

## Mixed board

![[demo.pur|600x400]]

## Typography

![[rich.pur]]

![[wrapped.pur]]

## Drawings

![[drawings.pur]]

## Images

![[two-images.pur]]

Text below the boards should scroll normally when the cursor is outside them.
`);
// Reading these verifies we copied real artifacts, rather than a development link.
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
	console.log(`${name}: ${(await readFile(new URL(name, plugin))).byteLength} bytes`);
}
console.log(`Open this folder as an Obsidian vault: ${fileURLToPath(vault)}`);
