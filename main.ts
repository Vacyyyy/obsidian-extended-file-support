import { App, Events, Platform, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { EXTENSION_REGISTRY } from 'src/extensionsRegistry';
import { DEFAULT_SETTINGS, ExtendedFileSupportSettings } from 'src/settings';
import { EmbedRegistry } from 'obsidian-typings';
import { PureRefViewer } from 'src/pureref/viewer';
import { StoredViewportState, validViewportState } from 'src/pureref/viewport-state';
import type { ViewportState } from 'src/pureref/viewer';

interface PluginData extends Partial<ExtendedFileSupportSettings> {
	pur_viewport_states?: { version: 1; entries: Record<string, StoredViewportState> };
}

export default class ExtendedFileSupport extends Plugin {
	settings: ExtendedFileSupportSettings;
	readonly purerefSettingsEvents = new Events();
	private purViewportStates: Record<string, StoredViewportState> = {};
	private viewportSaveTimer?: number;
	private saveChain = Promise.resolve();

	openSettings(): void {
		const setting = (this.app as App & {
			setting: { open(): void; openTabById(id: string): void };
		}).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ExtendedFileSupportSettingTab(this.app, this));
		this.registerPureRefCommands();

		const embedRegistry = this.app.embedRegistry as EmbedRegistry; 

		for (const extension of EXTENSION_REGISTRY) {
			this.registerView(extension.view_type, (leaf) => new extension.view(leaf, this));

			for (const extension_type of extension.types) {
				// @ts-ignore
				if (this.settings[extension_type]) {
					this.registerExtensions([extension_type], extension.view_type);

					embedRegistry.registerExtension(extension_type, (context, file, _) => {
						return new extension.component(context.containerEl, this, file, context.containerEl.getAttr('alt'));
					});
				}
			}
		}
	}

	private registerPureRefCommands(): void {
		const command = (
			id: string,
			name: string,
			action: (viewer: PureRefViewer) => boolean,
			hotkeys?: { modifiers: ('Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt')[]; key: string }[],
		) => this.addCommand({
			id: `pureref-${id}`,
			name: `PureRef: ${name}`,
			hotkeys,
			checkCallback: checking => {
				const viewer = PureRefViewer.active(document);
				if (!viewer?.hasKeyboardFocus()) return false;
				if (!checking) action(viewer);
				return true;
			},
		});

		command('toggle-movement-lock', 'Toggle canvas movement lock', viewer => viewer.toggleLock(),
			[{ modifiers: ['Mod'], key: 'r' }]);
		command('toggle-image-grayscale', 'Toggle grayscale for selected image', viewer => viewer.toggleImageGrayscale(),
			[{ modifiers: ['Alt'], key: 'g' }]);
		command('toggle-canvas-grayscale', 'Toggle grayscale for canvas', viewer => viewer.toggleCanvasGrayscale(),
			[{ modifiers: ['Mod', 'Alt'], key: 'g' }]);
		command('toggle-comments', 'Toggle comment viewer', viewer => viewer.toggleComments(),
			[{ modifiers: ['Alt'], key: 'c' }]);
		command('toggle-grid', 'Toggle grid', viewer => viewer.toggleGrid(),
			[{ modifiers: [], key: 'g' }]);
		command('cycle-grid', 'Cycle grid', viewer => viewer.cycleGrid(),
			[{ modifiers: ['Mod'], key: 'g' }]);
		command('zoom-in', 'Zoom in', viewer => viewer.zoomIn(),
			[{ modifiers: ['Mod'], key: '+' }]);
		command('zoom-out', 'Zoom out', viewer => viewer.zoomOut(),
			[{ modifiers: ['Mod'], key: '-' }]);
		command('fit-board', 'Fit board', viewer => viewer.fit(),
			[{ modifiers: [], key: 'f' }]);
		command('previous-image', 'Previous image', viewer => viewer.cycleImage(-1),
			[{ modifiers: [], key: 'ArrowLeft' }]);
		command('next-image', 'Next image', viewer => viewer.cycleImage(1),
			[{ modifiers: [], key: 'ArrowRight' }]);
		command('undo', 'Undo viewer change', viewer => viewer.undo(),
			[{ modifiers: ['Mod'], key: 'z' }]);
		command('redo', 'Redo viewer change', viewer => viewer.redo(), [
			{ modifiers: ['Mod', 'Shift'], key: 'z' },
			{ modifiers: ['Ctrl'], key: 'y' },
		]);
	}

	onunload() {
		if (this.viewportSaveTimer !== undefined) window.clearTimeout(this.viewportSaveTimer);
		if (this.settings.pur_persist_viewport) void this.enqueueDataSave();
		const embedRegistry = this.app.embedRegistry as EmbedRegistry; 

		for (const extension of EXTENSION_REGISTRY) {
			for (const extension_type of extension.types) {
				// @ts-ignore
				if (this.settings[extension_type]) {
					this.app.viewRegistry.unregisterExtensions([extension_type]);
					embedRegistry.unregisterExtension(extension_type);
				}
			}
		}
	}

	async loadSettings() {
		const data = (await this.loadData() ?? {}) as PluginData;
		const { pur_viewport_states, ...storedSettings } = data;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
		const storedViewports = pur_viewport_states?.version === 1 ? pur_viewport_states.entries : {};
		for (const [path, entry] of Object.entries(storedViewports)) {
			const state = validViewportState(entry?.state);
			if (state && Number.isFinite(entry.updatedAt))
				this.purViewportStates[path] = { state, updatedAt: entry.updatedAt };
		}
	}

	async saveSettings() {
		await this.enqueueDataSave();
		this.purerefSettingsEvents.trigger('change');
	}

	private enqueueDataSave(): Promise<void> {
		this.saveChain = this.saveChain.catch(() => undefined).then(() => this.saveData({
			...this.settings,
			...(this.settings.pur_persist_viewport ? {
				pur_viewport_states: { version: 1 as const, entries: this.purViewportStates },
			} : {}),
		}));
		return this.saveChain;
	}

	getPurViewportState(path: string): ViewportState | undefined {
		return this.settings.pur_persist_viewport ? this.purViewportStates[path]?.state : undefined;
	}

	setPurViewportState(path: string, state: ViewportState): void {
		if (!this.settings.pur_persist_viewport) return;
		this.purViewportStates[path] = { state, updatedAt: Date.now() };
		const entries = Object.entries(this.purViewportStates);
		if (entries.length > 250) {
			entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
			this.purViewportStates = Object.fromEntries(entries.slice(0, 250));
		}
		if (this.viewportSaveTimer !== undefined) window.clearTimeout(this.viewportSaveTimer);
		this.viewportSaveTimer = window.setTimeout(() => {
			this.viewportSaveTimer = undefined;
			void this.enqueueDataSave();
		}, 750);
	}

	clearPurViewportStates(): void {
		this.purViewportStates = {};
		if (this.viewportSaveTimer !== undefined) window.clearTimeout(this.viewportSaveTimer);
		this.viewportSaveTimer = undefined;
	}

	public toggleExtension(extension: string, enable: boolean): void {
		const e = EXTENSION_REGISTRY.find(e => e.types.contains(extension));
		const embedRegistry = this.app.embedRegistry as EmbedRegistry; 

		if (!e) return;

		if (enable) {
			this.registerExtensions(e.types, e.view_type);

			embedRegistry.registerExtension(extension, (context, file, _) => {
				return new e.component(context.containerEl, this, file, context.containerEl.getAttr('alt'));
			});
		} else {
			this.app.viewRegistry.unregisterExtensions([extension]);
			embedRegistry.unregisterExtension(extension);
		}
	}
}

class ExtendedFileSupportSettingTab extends PluginSettingTab {
	plugin: ExtendedFileSupport;

	constructor(app: App, plugin: ExtendedFileSupport) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Image formats")
			.setHeading();

		new Setting(containerEl)
			.setName(".psd")
			.setDesc("Photoshop documents. Generated by Adobe Photoshop or similar programs.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.psd)
				.onChange(async (value) => {
					this.plugin.settings.psd = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("psd", value);
				}));

		new Setting(containerEl)
			.setName(".clip")
			.setDesc("Files generated by Clip Studio Paint.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.clip)
				.onChange(async (value) => {
					this.plugin.settings.clip = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("clip", value);
				}));

		new Setting(containerEl)
			.setName(".kra")
			.setDesc("Files generated by Krita.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.kra)
				.onChange(async (value) => {
					this.plugin.settings.kra = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("kra", value);
				}));

		new Setting(containerEl)
			.setName(".ai")
			.setDesc("Adobe Illustrator files. Only works with PDF compat enabled.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.ai)
				.onChange(async (value) => {
					this.plugin.settings.ai = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("ai", value);
				}));

		new Setting(containerEl)
				.setName(".ai render scale")
				.setDesc("Render scale for Illustrator files. Higher means higher resolution, but longer load times. Default: 1.5.")
				.addDropdown(dropdown => dropdown
					.addOptions({"0.5": "0.5", "1.0": "1.0", "1.5": "1.5", "2.0": "2.0", "2.5": "2.5", "3.0": "3.0"})
					.setValue(this.plugin.settings.ai_render_scale.toFixed(1))
					.onChange(async (value) => {
						this.plugin.settings.ai_render_scale = Number(value);
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName(".pur")
			.setDesc("PureRef boards. Read-only previews; verified with PureRef 2.1.3.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pur)
				.onChange(async (value) => {
					this.plugin.settings.pur = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("pur", value);
				}));

		const settings = this.plugin.settings;
		new Setting(containerEl)
			.setName(".pur remember view state")
			.setDesc("Reloads always preserve zoom and view state. Enable this to also preserve zoom, position, grid, lock, grayscale, and comment visibility across full Obsidian restarts. Turning it off deletes the states saved for restarts.")
			.addToggle(toggle => toggle
				.setValue(settings.pur_persist_viewport)
				.onChange(async value => {
					settings.pur_persist_viewport = value;
					if (!value) this.plugin.clearPurViewportStates();
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(".pur item limit")
			.setDesc("Maximum items per PureRef preview (default: 10000). Higher values use more memory and may slow rendering. Reload Obsidian after changing this.")
			.addText(text => {
				text.setValue(String(settings.pur_item_limit));
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.step = '1';
				text.onChange(async value => {
					const limit = Number(value);
					const valid = value.trim() !== '' && Number.isSafeInteger(limit) && limit > 0;
					text.inputEl.setCustomValidity(valid ? '' : 'Enter a positive whole number.');
					text.inputEl.setAttribute('aria-invalid', String(!valid));
					if (!valid) { text.inputEl.reportValidity(); return; }
					settings.pur_item_limit = limit;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName(".pur fit button")
			.setDesc("Show the Fit button over the board.")
			.addToggle(toggle => toggle
				.setValue(settings.pur_show_fit)
				.onChange(async value => {
					settings.pur_show_fit = value;
					await this.plugin.saveSettings();
				}));
		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName(".pur executable")
				.setDesc("Optional full path to PureRef, without quotes. Leave empty to use the default app.")
				.addText(text => text
					.setPlaceholder("Use default app")
					.setValue(settings.pur_executable_path)
					.onChange(async (value) => {
						settings.pur_executable_path = value.trim();
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName("3D formats")
			.setHeading();

		new Setting(containerEl)
			.setName("Animate")
			.setDesc("Animate 3d objects (Rotate the camera around them).")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.animate_3d_objects)
				.onChange(async (value) => {
					this.plugin.settings.animate_3d_objects = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName(".obj")
			.setDesc("Object file type for 3d models.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.obj)
				.onChange(async (value) => {
					this.plugin.settings.obj = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("obj", value);
				}));

		new Setting(containerEl)
			.setName(".gltf")
			.setDesc("glTF format. Only embedded glTF files are supported.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.gltf)
				.onChange(async (value) => {
					this.plugin.settings.gltf = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("gltf", value);
				}));
		
		new Setting(containerEl)
			.setName(".glb")
			.setDesc("Binary glTF format. Only self-contained glb files are supported.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.glb)
				.onChange(async (value) => {
					this.plugin.settings.glb = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("glb", value);
				}));
		
		new Setting(containerEl)
			.setName(".stl")
			.setDesc("Stereolithography CAD files (Often used for 3d printing).")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.stl)
				.onChange(async (value) => {
					this.plugin.settings.stl = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("stl", value);
				}));

		new Setting(containerEl)
			.setName(".fbx")
			.setDesc("Autodesk FBX format, commonly used for 3d models and animations.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.fbx)
				.onChange(async (value) => {
					this.plugin.settings.fbx = value;
					await this.plugin.saveSettings();
					this.plugin.toggleExtension("fbx", value);
				}));
	}
}
