// Only the lifecycle/DOM surfaces needed by PURComponent/PURView in browser tests.
// This harness does not claim to be a full Obsidian integration test.
// noteContent applies its restrictive policy before this host boundary. This
// inert fragment stub is not a sanitizer; native-host tests cover Obsidian's API.
export function sanitizeHTMLToDom(html) {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template.content;
}
export const Platform = { isDesktopApp: false };
export class FileSystemAdapter {}
export class Notice {}
export class Scope {
	constructor(parent) {
		this.parent = parent;
		this.bindings = [];
	}
	register(modifiers, key, callback) {
		this.bindings.push({ modifiers, key, callback });
	}
}
// Small Menu API stand-in for browser tests; real-host tests cover native menus.
export class Menu {
	constructor(parent) {
		this.parent = parent;
		this.el = document.createElement('div');
		this.el.className = 'menu';
		this.el.setAttribute('role', 'menu');
		this.el.style.cssText = 'position:fixed;z-index:10000;background:#262626;color:white;padding:6px;min-width:130px';
		this.items = [];
	}
	setUseNativeMenu() { return this; }
	addItem(callback) {
		const el = document.createElement('button');
		el.className = 'menu-item';
		el.style.cssText = 'display:block;width:100%;color:inherit;background:transparent;border:0;padding:6px;text-align:left';
		el.setAttribute('role', 'menuitem');
		const item = {
			el,
			setTitle: title => { el.textContent = title; return item; },
			setIcon: () => item,
			setChecked: checked => { el.classList.toggle('is-checked', checked); el.setAttribute('aria-checked', String(checked)); return item; },
			onClick: action => { el.addEventListener('click', () => { action(); this.root().hide(); }); return item; },
			setSubmenu: () => {
				item.submenu = new Menu(this);
				el.setAttribute('aria-haspopup', 'menu');
				const open = () => {
					const rect = el.getBoundingClientRect();
					item.submenu.showAtPosition({ x: rect.right, y: rect.top });
				};
				el.addEventListener('mouseenter', open);
				el.addEventListener('click', open);
				el.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); open(); } });
				return item.submenu;
			},
		};
		callback(item);
		this.items.push(item);
		this.el.append(el);
		el.addEventListener('keydown', e => {
			const index = this.items.indexOf(item);
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				this.items[(index + (e.key === 'ArrowDown' ? 1 : this.items.length - 1)) % this.items.length].el.focus();
			} else if (e.key === 'Escape') { this.root().hide(); document.querySelector('.pureref-viewport')?.focus(); }
		});
		return this;
	}
	addSeparator() {
		const separator = document.createElement('hr');
		separator.className = 'menu-separator';
		this.el.append(separator);
		return this;
	}
	root() { return this.parent ? this.parent.root() : this; }
	onHide(callback) { this.onHideCallback = callback; }
	showAtPosition({x,y}, doc = document) {
		this.el.style.left = `${x}px`; this.el.style.top = `${y}px`;
		doc.body.append(this.el);
		(this.items.find(i => i.el.classList.contains('is-checked')) ?? this.items[0])?.el.focus();
		if (!this.parent && !this.outside) {
			this.outside = e => { if (!e.target.closest('.menu')) this.hide(); };
			doc.addEventListener('pointerdown', this.outside, true);
		}
		return this;
	}
	hide() {
		this.items.forEach(i => i.submenu?.hide());
		this.el.remove();
		if (this.outside) document.removeEventListener('pointerdown', this.outside, true);
		this.outside = undefined;
		this.onHideCallback?.();
		return this;
	}
}
// Minimal stand-ins for the host-provided Lucide icons used by this renderer.
// Production calls Obsidian's setIcon; no icon package is bundled.
export function setIcon(element, name) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('class', 'svg-icon');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const paths = {
		minus: ['M5 12h14'],
		plus: ['M5 12h14', 'M12 5v14'],
		maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M16 3h3a2 2 0 0 1 2 2v3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M21 16v3a2 2 0 0 1-2 2h-3'],
		lock: ['M6 10V7a6 6 0 0 1 12 0v3', 'M5 10h14v11H5z'],
		unlock: ['M8 10V7a5 5 0 0 1 9-3', 'M5 10h14v11H5z'],
		'undo-2': ['M9 14 4 9l5-5', 'M4 9h9a7 7 0 1 1 0 14'],
		'redo-2': ['m15 14 5-5-5-5', 'M20 9h-9a7 7 0 1 0 0 14'],
		'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
	};
	for (const d of paths[name] ?? []) {
		const path = document.createElementNS(svg.namespaceURI, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	element.replaceChildren(svg);
}
export function setTooltip(element, tooltip, options = {}) {
	element.setAttribute('aria-label', tooltip);
	element.setAttribute('data-tooltip-position', options.placement ?? 'bottom');
}
export class Component {
	load() {
		this.onload?.();
	}
	unload() {
		this.onunload?.();
	}
}
export class FileView extends Component {
	constructor(leaf) {
		super();
		this.contentEl = leaf.contentEl;
	}
}
HTMLElement.prototype.getAttr = function (name) {
	return this.getAttribute(name);
};
HTMLElement.prototype.addClass = function (name) {
	this.classList.add(name);
};
HTMLElement.prototype.removeClass = function (name) {
	this.classList.remove(name);
};
HTMLElement.prototype.empty = function () {
	this.replaceChildren();
};
HTMLElement.prototype.createEl = function (tag, options = {}) {
	const el = this.ownerDocument.createElement(tag);
	if (options.text) el.textContent = options.text;
	if (options.cls) el.className = options.cls;
	this.append(el);
	return el;
};
