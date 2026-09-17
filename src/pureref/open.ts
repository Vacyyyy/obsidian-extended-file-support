import { App, FileSystemAdapter, Notice, Platform, TFile } from 'obsidian';

interface ExternalAppInfo { name: string; icon?: string }
let cachedApp: { key: string; expires: number; value: Promise<ExternalAppInfo> } | undefined;
let readIcon: ((path: string) => Promise<string | undefined>) | undefined;

function iconDataURL(path: string): Promise<string | undefined> {
	if (!readIcon) {
		const { remote } = require('electron') as {
			remote?: {
				app: unknown;
				require(name: 'node:vm'): {
					compileFunction(source: string, parameters: string[]):
						(app: unknown, path: string) => Promise<string | undefined>;
				};
			};
		};
		if (!remote) return Promise.resolve(undefined);
		// Obsidian's @electron/remote serializes NativeImage bitmaps with logical
		// dimensions. At fractional DPI this corrupts the pixel stride. Encode in
		// the main process and transfer only a string. This constant helper receives
		// paths as arguments; no settings or file content are evaluated as code.
		const encode = remote.require('node:vm').compileFunction(
			"return app.getFileIcon(path, { size: 'normal' }).then(icon => icon.isEmpty() ? undefined : icon.toDataURL());",
			['app', 'path'],
		);
		readIcon = path => encode(remote.app, path);
	}
	return readIcon(path);
}

/** Best effort: Electron's remote bridge is host-internal and may be unavailable. */
export function externalAppInfo(app: App, file: TFile, executable: string): Promise<ExternalAppInfo> {
	const fallback = { name: executable.trim() ? 'PureRef' : 'Default app' };
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) return Promise.resolve(fallback);
	const filePath = app.vault.adapter.getFullPath(file.path);
	const key = executable.trim() || '.pur';
	if (cachedApp?.key === key && cachedApp.expires > Date.now()) return cachedApp.value;
	const value = (async () => {
		try {
			const iconPath = executable.trim() || filePath;
			return { ...fallback, icon: await iconDataURL(iconPath) };
		} catch { return fallback; }
	})();
	cachedApp = { key, expires: Date.now() + 60_000, value };
	return value;
}

/** Desktop-only. Arguments are passed directly, never interpolated into a shell. */
export async function openPureRef(app: App, file: TFile, executable: string): Promise<void> {
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) return;
	try {
		const filePath = app.vault.adapter.getFullPath(file.path);
		if (!executable.trim()) {
			const { shell } = require('electron') as { shell: { openPath(path: string): Promise<string> } };
			const error = await shell.openPath(filePath);
			if (error) throw new Error(`${error} Set the PureRef executable path in plugin settings.`);
			return;
		}
		const path = require('path') as typeof import('path');
		const fs = require('fs') as typeof import('fs');
		const { spawn } = require('child_process') as typeof import('child_process');
		const executablePath = executable.trim();
		if (!path.isAbsolute(executablePath)) throw new Error('Choose an absolute PureRef executable path in plugin settings.');
		if (!(await fs.promises.stat(executablePath)).isFile()) throw new Error('The PureRef executable path must point to a file.');
		await new Promise<void>((resolve, reject) => {
			const child = spawn(executablePath, [filePath], { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
			child.once('error', reject);
			child.once('spawn', () => { child.unref(); resolve(); });
		});
	} catch (error) {
		new Notice(`Could not open PureRef: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}
