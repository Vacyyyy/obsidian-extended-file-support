// Only the lifecycle/DOM surfaces needed by PURComponent/PURView in browser tests.
// This harness does not claim to be a full Obsidian integration test.
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
