import { PurFile } from 'pur-2-file-format';
import { AltTextParsed, ExtensionComponent } from '../extensionComponent';
import { ExtensionView } from '../extensionView';
import { getSQLite } from '../pureref/sqlite';
import { PureRefViewer } from '../pureref/viewer';

export const VIEW_TYPE_PUR = 'extended-file-support-pur';

export class PURComponent extends ExtensionComponent {
	private viewer?: PureRefViewer;
	private generation = 0;
	private disposed = false;

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
			const state = this.viewer?.getState();
			this.viewer?.destroy();
			this.viewer = undefined;
			this.contentEl.empty();
			this.contentEl.removeClass('extended-file-loading');
			this.viewer = new PureRefViewer(this.contentEl, board, state);
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
