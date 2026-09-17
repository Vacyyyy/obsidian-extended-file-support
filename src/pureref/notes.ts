import createDOMPurify from 'dompurify';

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
	const purifier = createDOMPurify(doc.defaultView!);
	const clean = purifier.sanitize(html, {
		RETURN_DOM: true,
		WHOLE_DOCUMENT: true,
		ALLOWED_TAGS: [
			'html',
			'head',
			'body',
			'p',
			'br',
			'b',
			'strong',
			'i',
			'em',
			'u',
			's',
			'span',
			'div',
			'ul',
			'ol',
			'li',
			'blockquote',
			'pre',
		],
		ALLOWED_ATTR: ['style', 'start', 'value', 'dir'],
	}) as HTMLElement; // WHOLE_DOCUMENT + RETURN_DOM returns the sanitized <html> element.
	for (const node of Array.from(clean.querySelectorAll<HTMLElement>('[style]'))) {
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
	const body = clean.querySelector('body') ?? clean;
	const content = doc.createElement('div');
	content.className = 'pureref-note-content';
	content.style.cssText = body.getAttribute('style') ?? '';
	for (const node of Array.from(body.childNodes)) content.append(doc.importNode(node, true));
	return content;
}
