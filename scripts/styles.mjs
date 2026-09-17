import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

/** Obsidian installs three release assets; keep the font in CSS, never in main.js. */
export async function buildStyles() {
	const [source, license, font] = await Promise.all([
		readFile(new URL('styles.source.css', root), 'utf8'),
		readFile(new URL('docs/open-sans-license.txt', root), 'utf8'),
		readFile(new URL('node_modules/@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2', root)),
	]);
	const css = `${source}\n/*! Open Sans — SIL Open Font License\n${license}\n*/\n` +
		`@font-face {\n  font-family: "PureRef Open Sans";\n  font-style: normal;\n  font-weight: 300 800;\n  font-display: swap;\n  src: url("data:font/woff2;base64,${font.toString('base64')}") format("woff2");\n}\n`;
	await writeFile(new URL('styles.css', root), css);
}
