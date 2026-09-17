const documents = new WeakMap<Document, Promise<void>>();

/** Request the CSS font only when rendering a note, then measure with its real metrics. */
export function loadNoteFonts(doc: Document): Promise<void> {
	let ready = documents.get(doc);
	if (!ready) {
		ready = doc.fonts.load('22px "PureRef Open Sans"').then(() => undefined);
		documents.set(doc, ready);
	}
	return ready;
}
