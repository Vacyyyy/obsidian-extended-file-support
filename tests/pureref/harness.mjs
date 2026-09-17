import { PurFile } from 'pur-2-file-format';
import { PureRefViewer } from '../../src/pureref/viewer.ts';
import { getSQLite } from '../../src/pureref/sqlite.ts';
import { PURComponent, PURView } from '../../src/extensions/pur.ts';
import { DEFAULT_SETTINGS } from '../../src/settings.ts';

const host = document.querySelector('#board');
const status = document.querySelector('#status');
const SQL = getSQLite();
let viewer,
	component,
	generation = 0;
const urls = new Set();
const createURL = URL.createObjectURL.bind(URL),
	revokeURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
	const url = createURL(blob);
	urls.add(url);
	return url;
};
URL.revokeObjectURL = (url) => {
	urls.delete(url);
	revokeURL(url);
};

async function loadBytes(bytes, mutate) {
	const current = ++generation;
	component?.onunload();
	component = undefined;
	viewer?.destroy();
	viewer = undefined;
	host.replaceChildren();
	let board;
	try {
		board = new PurFile(bytes, await SQL);
		if (current !== generation) return;
		if (mutate) mutate(board);
		viewer = new PureRefViewer(host, board, undefined, {
			onOpenEditor: () => {
				status.textContent =
					'Demo only: this button would open the current file in PureRef.';
			},
		});
		board.close();
		board = undefined;
		await viewer.ready;
		if (current === generation)
			status.textContent = 'Board loaded. Changes here are never written to the file.';
	} catch (error) {
		status.textContent = error.message;
		throw error;
	} finally {
		board?.close();
	}
}
const fixture = async (name) => (await fetch(`/fixtures/${name}`)).arrayBuffer();
const load = async (name = 'demo.pur') => loadBytes(await fixture(name));
document.querySelector('#sample').addEventListener('change', (e) => {
	load(e.target.value).catch(console.error);
});
document.querySelector('#file').addEventListener('change', async (e) => {
	const file = e.target.files[0];
	if (file) {
		if (file.size > 128 * 1024 * 1024) {
			status.textContent = 'This preview supports files up to 128 MiB.';
			return;
		}
		try {
			await loadBytes(await file.arrayBuffer());
		} catch {
			/* Displayed above. */
		}
	}
});

window.pureref = {
	load,
	fixture,
	loadBytes,
	state: () => viewer?.getState(),
	action: (name, ...args) => viewer?.[name](...args),
	destroy: () => {
		viewer?.destroy();
		viewer = undefined;
		component?.onunload();
		component = undefined;
	},
	urls: () => urls.size,
	async mountComponent(name = 'demo.pur', settings) {
		viewer?.destroy();
		viewer = undefined;
		component?.onunload();
		host.replaceChildren();
		const bytes = await fixture(name);
		let pending = [],
			listener;
		const file = { name, path: name, stat: { size: bytes.byteLength } };
		const vault = {
			on: (_event, callback) => {
				listener = callback;
				return callback;
			},
			offref: () => {
				listener = undefined;
			},
			readBinary: () => new Promise((resolve) => pending.push(resolve)),
		};
		component = new PURComponent(host, {
			app: { vault },
			settings: settings ? { ...DEFAULT_SETTINGS, ...settings } : undefined,
			getPurViewportState: () => undefined,
			setPurViewportState: () => {},
		}, file, '600x400');
		window.componentTest = {
			waitingForAttachment: () => Boolean(component.cancelAttachmentWait),
			start: () => {
				void component.loadFile();
			},
			modify: () => listener?.(file),
			resolve: (index, data = bytes) => pending[index](data),
			state: () => component.viewer?.getState(),
			zoomIn: () => component.viewer?.zoomIn(),
			activeListeners: () => Number(Boolean(listener)),
			pending: () => pending.length,
			close: () => component.onunload(),
		};
		return true;
	},
	async fileSwitch() {
		viewer?.destroy();
		viewer = undefined;
		component?.onunload();
		host.replaceChildren();
		const bytes = await fixture('demo.pur');
		const refs = new Set();
		const vault = {
			on: (_, callback) => {
				refs.add(callback);
				return callback;
			},
			offref: (ref) => refs.delete(ref),
			readBinary: async () => bytes,
		};
		const view = new PURView({ contentEl: host }, { app: { vault } });
		const file = { name: 'demo.pur', path: 'demo.pur', stat: { size: bytes.byteLength } };
		await view.onLoadFile(file);
		await view.onLoadFile({ ...file, name: 'second.pur' });
		const count = refs.size;
		await view.onClose();
		return { afterSwitch: count, afterClose: refs.size };
	},
};
load().catch(console.error);
