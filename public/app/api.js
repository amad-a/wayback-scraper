// Behaviour for the Explorer shell. Every function here is a deliberate no-op:
// the markup and the wiring in main.js are complete, only these bodies are not.
// Fill them in one at a time; main.js should not need to change.
//
// Shared handles, so implementations don't each re-query the DOM.
export const iframe = document.getElementById('frame');
export const addressBar = document.getElementById('address-input');
export const dropdown = document.getElementById('dropdown');
export const favoritesPanel = document.querySelector('.favorites');
export const favoriteStar = document.getElementById('favorite-star');

// --- chrome ----------------------------------------------------------------

const TITLE_SUFFIX = 'Palestine Online';

function setChrome({ title, url }) {
	document.querySelector('.window-title').textContent = title
		? `${title} - ${TITLE_SUFFIX}`
		: TITLE_SUFFIX;
	if (url) addressBar.value = url;
}

// Runs on every iframe navigation, in two passes.
//
// The DOM pass is synchronous, so the chrome is never briefly blank or stale. But it can
// only report what the page itself carries: a title, and the data-wayback-url stamp the
// scraper added -- and around a thousand pages have no stamp at all, leaving nothing to
// put in the address bar.
//
// The database pass fills those in, and is the only source of your title_override, so a
// page with a mangled <title> shows the one you corrected rather than the original.
export async function onFrameLoad() {
	const doc = iframe.contentDocument;
	const localPath = decodeURIComponent(iframe.contentWindow.location.pathname);

	const stamped = doc?.body?.dataset.waybackUrl;
	setChrome({
		title: doc?.title || '',
		// Strip the archive prefix back off to recover the address the page had
		// originally; without a stamp there is nothing honest to show yet.
		url: stamped ? stamped.replace(/^.*?\/web\/\d+id_\//, '').replace(/(\/\/[^/]+):80(?=\/|$)/, '$1') : '',
	});

	let page;
	try {
		const res = await fetch(`/api/page?path=${encodeURIComponent(localPath)}`);
		if (!res.ok) return; // 404 for an unindexed page, 503 before the first build
		page = await res.json();
	} catch {
		return; // server not running; the DOM pass already did what it could
	}

	// A slow response for a page the user has already navigated away from must not
	// overwrite the chrome for the page they are on now.
	if (decodeURIComponent(iframe.contentWindow.location.pathname) !== localPath) return;

	setChrome({ title: page.display_title, url: page.display_url });
}

// --- address bar -----------------------------------------------------------

// Fires on every keystroke. Was a Fuse.js lookup over a prebuilt page index;
// that index is gone, so this needs a new source of pages -- most likely
// generated from src/build-index.js, which already walks /sites.
export function onAddressInput(query) {}

// Paints `results` into .dropdown-content. The old implementation emitted
// `<li onclick="setFrame(...)">` markup, which is why setFrame has to stay a
// global (see main.js). Attaching listeners here instead would let it stop
// being one.
export function render(results) {}

// Called from the dropdown markup render() emits. Navigates the iframe.
export function setFrame(url) {}

// --- toolbar ---------------------------------------------------------------

// The scraper stamps each archived page with the snapshot it came from:
//
//   https://web.archive.org/web/19970614162415id_/http://www.birzeit.edu:80/x.html
//
// `id_` asks the Wayback Machine for the raw original bytes, which is what the
// scraper wanted but not what a person clicking "Source" wants -- dropping it
// gives the normal replay view with the archive's own toolbar. The `:80` is a
// leftover of how 90s URLs were recorded and only makes the link look strange.
// Every attribute in /sites matches this shape, and none carry a port other
// than 80 or a `:80` anywhere in the path, so both edits are safe.
export function waybackSourceUrl(raw) {
	return raw
		.replace(/(\/web\/\d+)id_\//, '$1/')
		.replace(/(\/\/[^/]+):80(?=\/|$)/g, '$1');
}

// Opens that snapshot in a new tab. Pages the scraper didn't stamp -- anything
// hand-added to /sites -- simply do nothing rather than opening a broken tab.
export function openWaybackSource() {
	const raw = iframe.contentDocument?.body?.dataset.waybackUrl;
	if (!raw) return;

	window.open(waybackSourceUrl(raw), '_blank', 'noopener');
}

// Jumps to the top of the page currently in the frame. Deliberately does not
// re-fetch: the archived pages are static, so there is nothing to re-fetch,
// and a real reload would cost a round trip and lose the scroll position it
// was supposed to control.
export function refreshFrame() {
	// 'instant' rather than the default: an archived page setting
	// scroll-behavior: smooth would otherwise animate the jump.
	iframe.contentWindow.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

// Iframe navigations land in the parent's joint session history, so the shell's
// own history is already the iframe's. dir is 'back' or 'forward'.
export function historyNav(win, dir = 'back') {
	if (dir === 'back') win.history.back();
	else win.history.forward();
}

// focus() first: without it the print dialog targets the shell, not the page.
export function printIframe() {
	iframe.contentWindow.focus();
	iframe.contentWindow.print();
}

// --- favorites -------------------------------------------------------------

export function toggleFavorites() {}

export function hideBookmarksPanel() {}

export function addFavorite() {}
