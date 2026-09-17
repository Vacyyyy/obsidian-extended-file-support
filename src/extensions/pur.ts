import { PurFile } from 'pur-2-file-format';
import { EventRef, Platform } from 'obsidian';
import { AltTextParsed, ExtensionComponent } from '../extensionComponent';
import { ExtensionView } from '../extensionView';
import { getSQLite } from '../pureref/sqlite';
import { PureRefViewer } from '../pureref/viewer';
import { externalAppInfo, openPureRef } from '../pureref/open';
import { viewportSession } from '../pureref/viewport-state';

export const VIEW_TYPE_PUR = 'extended-file-support-pur';

export class PURComponent extends ExtensionComponent {
	private viewer?: PureRefViewer;
	private generation = 0;
	private disposed = false;
	private settingsRef?: EventRef;
	private iconGeneration = 0;

	constructor(...args: ConstructorParameters<typeof ExtensionComponent>) {
		super(...args);
		this.settingsRef = this.plugin.purerefSettingsEvents?.on('change', () => {
			this.updateSettings();
		});
	}

	private updateSettings(): void {
		const viewer = this.viewer, settings = this.plugin.settings;
		if (!viewer || !settings) return;
		const generation = ++this.iconGeneration;
		const executable = settings.pur_executable_path;
		const label = executable.trim() ? 'PureRef' : 'Default app';
		viewer.setControls(settings);
		viewer.setOpenAppearance(label);
		if (settings.pur_show_open) {
			void externalAppInfo(this.plugin.app, this.file, executable).then(info => {
				if (!this.disposed && this.viewer === viewer && this.iconGeneration === generation)
					viewer.setOpenAppearance(info.name, info.icon);
			});
		}
	}

	parseLinkText(_: AltTextParsed): void {}

	protected onFileModified(): void {
		void this.loadFile();
	}

	async loadFile(): Promise<void> {
		if (this.disposed) return;
		const generation = ++this.generation;
		this.contentEl.setAttribute('aria-busy', 'true');
		let board: PurFile | undefined;
		try {
			if (this.file.stat.size > 128 * 1024 * 1024)
				throw new Error('This preview supports files up to 128 MiB.');
			const [data, SQL] = await Promise.all([
				this.plugin.app.vault.readBinary(this.file),
				getSQLite(),
			]);
			if (generation !== this.generation || this.disposed) return;
			if (data.byteLength > 128 * 1024 * 1024)
				throw new Error('This preview supports files up to 128 MiB.');
			board = new PurFile(data, SQL);
			const session = viewportSession(this.contentEl.ownerDocument,
				this.plugin.app.vault.getName?.() ?? '', this.file.path);
			const state = this.viewer?.getState() ?? session.read();
			this.viewer?.destroy();
			this.viewer = undefined;
			this.contentEl.empty();
			this.contentEl.removeClass('extended-file-loading');
			this.viewer = new PureRefViewer(this.contentEl, board, state, {
				...this.plugin.settings,
				onStateChange: session.write,
				onOpenEditor: Platform.isDesktopApp
					? () => { void openPureRef(this.plugin.app, this.file, this.plugin.settings.pur_executable_path); }
					: undefined,
			});
			this.updateSettings();
			if (this.width && this.width > 0) this.viewer.element.style.width = `${this.width}px`;
			if (this.height && this.height > 0)
				this.viewer.element.style.setProperty('--pureref-height', `${this.height}px`);
			board.close();
			board = undefined;
			await this.viewer.ready;
		} catch (error) {
			if (generation !== this.generation || this.disposed) return;
			this.viewer?.destroy();
			this.viewer = undefined;
			this.contentEl.empty();
			this.contentEl.removeClass('extended-file-loading');
			const message = this.contentEl.createEl('p', { cls: 'pureref-error' });
			message.textContent = `Could not preview ${this.file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
		} finally {
			board?.close();
			if (generation === this.generation) this.contentEl.removeAttribute('aria-busy');
		}
	}

	cleanup(): void {
		if (this.settingsRef) this.plugin.purerefSettingsEvents.offref(this.settingsRef);
		this.settingsRef = undefined;
		this.disposed = true;
		this.generation++;
		this.viewer?.destroy();
		this.viewer = undefined;
		this.contentEl.removeAttribute('aria-busy');
	}
}

export class PURView extends ExtensionView<PURComponent> {
	getIcon(): string {
		return 'image';
	}
	getComponent(): new (
		...args: ConstructorParameters<typeof ExtensionComponent>
	) => PURComponent {
		return PURComponent;
	}
	getViewType(): string {
		return VIEW_TYPE_PUR;
	}
	async onOpen(): Promise<void> {
		await super.onOpen();
		this.contentEl.addClass('pureref-file-view');
	}
}
