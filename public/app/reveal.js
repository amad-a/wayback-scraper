// Scrolls to a picture on the page a link opens, for the site's own pages that link to
// where an image was found: the home page's banner carousel, How To Use's computers.
//
// Just before the link is followed, the page posts the picture's address and the page's.
// Each page and frameset pane that loads after that is searched for it (prepareFrame in
// api.js calls revealPending) -- only the linked page and the frames inside it, since a
// frameset's default pane may show the same picture before the linked page replaces it
// -- and the first one showing it scrolls it to the middle of the view and outlines it a
// moment in the title bar's green. A message rather than a #fragment
// on the link: the shell may swap the page for its frameset, which would drop the
// fragment, and the address bar would have to hide it. Given up after a while, so a
// picture never found doesn't jump out at a page opened later.

const MESSAGE = 'palestine-online:reveal';
const PATIENCE = 20000; // ms
const OUTLINE = '3px solid rgb(12, 145, 18)';
const OUTLINE_FOR = 2500; // ms

const iframe = document.getElementById('frame');

let pending = null; // { page, path, name, until }

const pathOf = (url, base) => {
	try {
		return decodeURIComponent(new URL(url, base).pathname).toLowerCase();
	} catch {
		return '';
	}
};

// The background pictures of a table or cell, written as attributes or inline styles.
function backgroundsOf(el) {
	const urls = [];
	const attr = el.getAttribute('background');
	if (attr) urls.push(attr);
	for (const m of (el.getAttribute('style') || '').matchAll(/url\(\s*['"]?([^'")]+)/gi)) urls.push(m[1]);
	return urls;
}

// The element showing the picture: by its own address first, else by file name -- the
// list may name one copy of a picture a site saved twice, and the page shows the other.
// Failing both, a link to the picture, for a page that only linked to it.
function find(doc) {
	const shown = [];
	for (const el of doc.querySelectorAll('img[src], input[src]')) shown.push([el, [el.getAttribute('src')]]);
	for (const el of doc.querySelectorAll('[background], [style*="url("]')) {
		if (el !== doc.body && el !== doc.documentElement) shown.push([el, backgroundsOf(el)]);
	}
	const linked = [...doc.querySelectorAll('a[href]')].map((el) => [el, [el.getAttribute('href')]]);
	const among = (list, test) => list.find(([, urls]) => urls.some((url) => test(pathOf(url, doc.baseURI))))?.[0];
	const isIt = (p) => p === pending.path;
	const sameName = (p) => p.split('/').pop() === pending.name;
	return among(shown, isIt) || among(shown, sameName) || among(linked, isIt);
}

// The window is the linked page, or a frame inside it.
function withinPage(win) {
	for (let w = win; w; w = w === w.parent ? null : w.parent) {
		if (pathOf(w.location.href, location.href) === pending.page) return true;
		if (w === iframe.contentWindow) return false;
	}
	return false;
}

export function revealPending(win) {
	if (!pending) return;
	if (Date.now() > pending.until) {
		pending = null;
		return;
	}
	if (!withinPage(win)) return;
	const el = find(win.document);
	if (!el) return;
	pending = null;
	el.scrollIntoView({ block: 'center', inline: 'center' });
	const { outline, outlineOffset } = el.style;
	el.style.outline = OUTLINE;
	el.style.outlineOffset = '2px';
	win.setTimeout(() => {
		el.style.outline = outline;
		el.style.outlineOffset = outlineOffset;
	}, OUTLINE_FOR);
}

export function initReveal() {
	window.addEventListener('message', (event) => {
		if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
		const { type, src, page } = event.data ?? {};
		if (type !== MESSAGE || typeof src !== 'string' || typeof page !== 'string') return;
		const path = pathOf(src, location.href);
		pending = { page: pathOf(page, location.href), path, name: path.split('/').pop(), until: Date.now() + PATIENCE };
	});
}
