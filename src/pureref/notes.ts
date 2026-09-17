import { sanitizeHTMLToDom } from 'obsidian';

const textTags = new Set([
	'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SPAN', 'DIV',
	'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE',
]);

const textStyles: Record<string, RegExp> = {
	'font-family': /^[\w\s,'"-]{1,100}$/,
	'font-size': /^\d+(?:\.\d+)?(?:px|pt)$/,
	'font-weight': /^(?:normal|bold|[1-9]00)$/,
	'font-style': /^(?:normal|italic|oblique)$/,
	'text-decoration': /^(?:none|underline|line-through|overline)$/,
	'white-space': /^(?:normal|pre|pre-wrap|pre-line)$/,
	'text-align': /^(?:left|center|right|justify)$/,
	'margin-top': /^\d+(?:\.\d+)?px$/,
	'margin-bottom': /^\d+(?:\.\d+)?px$/,
	'margin-left': /^\d+(?:\.\d+)?px$/,
	'margin-right': /^\d+(?:\.\d+)?px$/,
	'text-indent': /^-?\d+(?:\.\d+)?px$/,
	color: /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i,
};

/** Preserve basic Qt rich text without links, resources, arbitrary CSS or executable markup. */
export function noteContent(doc: Document, html: string): HTMLElement {
	// Template contents stay inert: even resource URLs must not be fetched while
	// processing a note. Fragment parsing drops <body> attributes, so preserve Qt's
	// body typography on an ordinary wrapper; discard the document head entirely.
	const template = doc.createElement('template');
	template.innerHTML = html
		.replace(/<body(?=[\s>])/gi, '<div data-pureref-body=""')
		.replace(/<\/body\s*>/gi, '</div>')
		.replace(/<head(?=[\s>])/gi, '<template')
		.replace(/<\/head\s*>/gi, '</template>');
	for (const node of Array.from(template.content.querySelectorAll<HTMLElement>('*'))) {
		if (node.namespaceURI === 'http://www.w3.org/1999/xhtml' && node.tagName === 'A') {
			node.replaceWith(...Array.from(node.childNodes));
			continue;
		}
		if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !textTags.has(node.tagName)) {
			node.remove();
			continue;
		}
		for (const attribute of Array.from(node.attributes)) {
			if (!['style', 'start', 'value', 'dir', 'data-pureref-body'].includes(attribute.name))
				node.removeAttribute(attribute.name);
		}
		// Qt rejects decimal pixel font sizes (even 24.0px), while the browser
		// normalizes them to integers. Check the original declaration before normalization.
		const rawSize = (node.getAttribute('style') ?? '')
			.split(';')
			.filter((declaration) => /^\s*font-size\s*:/i.test(declaration))
			.pop()
			?.replace(/^\s*font-size\s*:\s*/i, '')
			.trim();
		const rejectedPixelSize = /^\d+\.\d+px(?:\s*!important)?$/i.test(rawSize ?? '');
		const styles = Object.entries(textStyles).map(
			([key, pattern]) => [key, node.style.getPropertyValue(key), pattern] as const,
		);
		node.removeAttribute('style');
		for (const [key, value, pattern] of styles) {
			if (!pattern.test(value)) continue;
			if (key === 'font-size' && rejectedPixelSize) continue;
			if (key === 'font-size' && (parseFloat(value) > 256 || parseFloat(value) < 1)) continue;
			if (
				(key.startsWith('margin-') || key === 'text-indent') &&
				Math.abs(parseFloat(value)) > 1000
			)
				continue;
			const family = value
				.split(',')
				.map((name) =>
					/^(['"]?)Open Sans\1$/i.test(name.trim()) ? '"PureRef Open Sans"' : name,
				)
				.join(',');
			node.style.setProperty(key, key === 'font-family' ? `${family}, sans-serif` : value);
		}
	}
	// Use the host's security boundary, after applying our stricter no-resources
	// rich-text policy. No independent sanitizer is shipped with the plugin.
	const clean = sanitizeHTMLToDom(template.innerHTML);
	const body = clean.querySelector<HTMLElement>('[data-pureref-body]');
	const content = doc.createElement('div');
	content.className = 'pureref-note-content';
	content.style.cssText = body?.getAttribute('style') ?? '';
	for (const node of Array.from((body ?? clean).childNodes)) content.append(doc.importNode(node, true));
	return content;
}
