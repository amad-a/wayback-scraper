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

// --- injected into the archived pages --------------------------------------

const SCROLLBAR_CSS = '/styles/iframe-scrollbars.css';
const INJECTED_ID = 'palestine-online-scrollbars';

// Give an archived document the shell's scrollbars.
//
// A <link> rather than inlining the rules: the browser caches one request across every
// page you visit, and it keeps the CSS in a file you can edit instead of a string here.
// Appended to <head>, or to documentElement for the pages old enough to have no <head>.
function injectScrollbars(doc) {
	if (!doc || doc.getElementById(INJECTED_ID)) return;

	const link = doc.createElement('link');
	link.id = INJECTED_ID;
	link.rel = 'stylesheet';
	link.href = SCROLLBAR_CSS;
	(doc.head || doc.documentElement)?.appendChild(link);
}

// --- zoom -------------------------------------------------------------------

const ZOOM_KEY = 'palestine-online:zoom';
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_BOUND = '__palestineOnlineZoomBound';

const clampZoom = (v) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));

function readZoom() {
	try {
		const stored = Number.parseFloat(localStorage.getItem(ZOOM_KEY));
		if (Number.isFinite(stored)) return clampZoom(stored);
	} catch {
		// storage disabled; fall through to the default
	}
	return 1;
}

// One level for the whole archive, like a browser's own zoom, rather than per page --
// re-pinching after every navigation would make it useless for reading a whole site.
let zoom = readZoom();

// Sets the level on a document. Cleared rather than set to '1' at the default, so pages
// that were never zoomed carry no trace of us.
function setScale(doc) {
	doc.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
}

// `zoom` rather than `transform: scale`.
//
// Both scroll correctly -- Chrome counts a transformed root element's overflow in the
// scrollable area -- and both keep text sharp, since a transform re-rasterises at the
// final scale rather than stretching a bitmap. The difference is reflow. `zoom` relayouts
// at the new size so text rewraps; `scale` magnifies the layout untouched. On one page at
// 2x that is 25725x1056 against 23522x1780.
//
// Magnifying is the more faithful treatment of a fixed-width 2001 layout, but it forces
// horizontal panning in proportion to the scale, and panning left and right to read a
// single line costs more than the rewrap does. Reflow keeps the reading column inside the
// window. Swapping back is one line in setScale.
function applyZoom(win, depth = 0) {
	if (!win || depth > 3) return;

	try {
		setScale(win.document);
	} catch {
		return; // cross-origin
	}

	for (let i = 0; i < win.frames.length; i++) {
		try {
			applyZoom(win.frames[i], depth + 1);
		} catch {
			// cross-origin; carry on with its siblings
		}
	}
}

// The level asked for, which runs ahead of `zoom`, the level actually applied. Steps
// accumulate here so a burst of events inside one frame is not lost when only the last
// one gets painted.
let targetZoom = zoom;
let pendingAnchor = null;
let frameQueued = false;
let persistTimer = 0;

// Moves toward a new level, keeping whatever sits under the pointer where it is.
//
// Coalesced to one relayout per animation frame. `zoom` triggers a full relayout of the
// document, which costs a median 7.6ms in Chrome and 11ms in Safari on a table-heavy
// archived page. A pinch delivers events faster than that, so applying each one
// synchronously does the work several times per frame and the engine falls behind --
// which is why Safari, 45% slower to lay out, stuttered first. One frame, one layout.
function zoomTo(next, win, clientX, clientY) {
	targetZoom = clampZoom(next);
	pendingAnchor = { win, clientX, clientY };

	if (frameQueued) return;
	frameQueued = true;
	requestAnimationFrame(flushZoom);
}

function flushZoom() {
	frameQueued = false;

	const { win, clientX, clientY } = pendingAnchor;
	const previous = zoom;
	if (targetZoom === previous) return; // already at a limit

	// Read the anchor before the change, against the level and scroll still in effect.
	// Without this the page grows from its top-left and what you were reading slides off.
	const anchorX = (win.scrollX + clientX) / previous;
	const anchorY = (win.scrollY + clientY) / previous;

	zoom = targetZoom;
	applyZoom(iframe.contentWindow);
	win.scrollTo(anchorX * zoom - clientX, anchorY * zoom - clientY);

	// Debounced: a synchronous storage write on every frame of a pinch is exactly the
	// kind of thing that makes one stutter.
	clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		try {
			localStorage.setItem(ZOOM_KEY, String(zoom));
		} catch {
			// storage disabled: zoom still works, it just will not persist
		}
	}, 250);
}

// A trackpad pinch is delivered as a wheel event with ctrlKey set -- there is no pinch
// event to bind. Ctrl+scroll on a mouse produces the same thing, so that works too.
//
// The browser's own response to this is to zoom the visual viewport, which is the whole
// window by definition and cannot be scoped to an element. So it has to be cancelled and
// replaced, which is only possible with passive: false -- wheel listeners default to
// passive, where preventDefault is ignored and you would get both zooms at once.
function onZoomWheel(event) {
	if (!event.ctrlKey) return;
	event.preventDefault();

	const win = event.currentTarget.defaultView;
	if (!win) return;

	// A pinch arrives as a stream of small deltas, a mouse wheel as one notch of 100 or
	// 120. Both land here as deltaY in pixels with no flag to tell them apart, so the
	// step is capped: a pinch delta passes through untouched and stays smooth, while a
	// notch saturates at ~10% per click instead of e^1 -- nearly tripling per click.
	const step = Math.max(-10, Math.min(10, event.deltaY));

	// Exponential, so a step is the same ratio in as out. Compounded on targetZoom
	// rather than zoom, or events arriving inside one frame would each be measured from
	// the same stale applied level and all but the last would be thrown away.
	zoomTo(targetZoom * Math.exp(-step * 0.01), win, event.clientX, event.clientY);
}

// Safari's pinch.
//
// Chrome and Firefox report a trackpad pinch as ctrl+wheel; Safari does not, and reports
// it through these non-standard gesture events instead. Without them a pinch on Safari
// falls through to the browser and zooms the whole window -- the exact thing this is
// meant to prevent. Ctrl+scroll on a mouse is a real wheel event, so that path already
// works there.
//
// event.scale is cumulative from the start of the gesture, not incremental, so the level
// is computed against where the gesture began rather than compounding per event.
let gestureBaseZoom = 1;

function onGestureStart(event) {
	event.preventDefault();
	gestureBaseZoom = targetZoom;
}

function onGestureChange(event) {
	event.preventDefault();
	const win = event.currentTarget.defaultView;
	if (!win) return;
	zoomTo(gestureBaseZoom * event.scale, win, event.clientX, event.clientY);
}

function bindZoom(doc) {
	if (!doc || doc[ZOOM_BOUND]) return;
	doc[ZOOM_BOUND] = true;

	doc.addEventListener('wheel', onZoomWheel, { passive: false });

	// No-ops on Chrome and Firefox, which never fire these.
	doc.addEventListener('gesturestart', onGestureStart, { passive: false });
	doc.addEventListener('gesturechange', onGestureChange, { passive: false });
	doc.addEventListener('gestureend', (event) => event.preventDefault(), { passive: false });
}

// --- applying both to a frame ----------------------------------------------

// 166 of the archived pages are framesets. Those documents do not scroll -- their child
// frames do -- so dressing only the top document would miss exactly the pages where a
// scrollbar is most visible, the nav sidebars, and would leave a pinch over a nav pane
// doing nothing. Children may not have loaded yet, hence both the immediate pass and the
// listener.
function prepareFrame(win, depth = 0) {
	if (!win || depth > 3) return; // framesets nest, but not indefinitely

	try {
		injectScrollbars(win.document);
		bindZoom(win.document);
		setScale(win.document);
	} catch {
		return; // a cross-origin child: nothing we can or should do
	}

	// Indexed rather than for...of: window.frames is a WindowProxy with a length and
	// numeric keys, not an iterable, and iterating it throws.
	for (let i = 0; i < win.frames.length; i++) {
		try {
			const child = win.frames[i];
			prepareFrame(child, depth + 1);
			child.addEventListener('load', () => prepareFrame(child, depth + 1), {
				once: true,
			});
		} catch {
			// cross-origin; skip it and carry on with its siblings
		}
	}
}

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
async function applyChrome() {
	const doc = iframe.contentDocument;
	const localPath = decodeURIComponent(iframe.contentWindow.location.pathname);

	// Before anything awaits, so the scrollbars are styled on first paint rather than
	// flicking from the browser default a moment later.
	prepareFrame(iframe.contentWindow);

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

// The path the chrome currently describes, so a document is only processed once.
let chromeFor = '';

function syncChrome(force = false) {
	let path;
	try {
		path = decodeURIComponent(iframe.contentWindow.location.pathname);
	} catch {
		return; // mid-navigation, or a document we cannot read into
	}

	// about:blank sits between navigations; describing it would blank the chrome and
	// then immediately refill it, which reads as a flicker.
	if (!path.startsWith('/sites/')) return;
	if (path === chromeFor && !force) return;

	chromeFor = path;
	applyChrome();
}

// Keeps the title bar and address bar tracking the frame.
//
// Polling rather than the load event alone, because load waits for every subresource --
// and 568 archived pages reference images on hosts that stopped existing two decades
// ago, so the browser sits through each failure first. On one such page the title is
// readable at 17ms and load does not fire until 419ms. Reading location and comparing a
// string 20 times a second is far cheaper than that wait, and it also catches
// navigations started by the user clicking a link inside the frame.
export function watchFrame() {
	setInterval(() => syncChrome(), 50);

	iframe.addEventListener('load', () => {
		// Re-injected because pages of this era use document.write, which can replace
		// the whole document after we styled it. Idempotent, so this is cheap.
		prepareFrame(iframe.contentWindow);

		// Only re-runs when the early pass came up empty -- it happens before <body>
		// necessarily exists, so the wayback stamp may not have been readable yet and
		// the database may not have had the page either.
		if (!addressBar.value) syncChrome(true);
	});
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
// The shuffled pool, dealt one page per Random click so a session never repeats.
//
// sessionStorage rather than a variable, so the deck survives a reload of the shell, and
// rather than localStorage, so closing the tab starts a fresh session -- which is what
// "no repeats this session" ought to mean. Each tab deals its own deck.
const DECK_KEY = 'palestine-online:random-deck';

function readDeck() {
	try {
		const deck = JSON.parse(sessionStorage.getItem(DECK_KEY) || 'null');
		return Array.isArray(deck?.paths) ? deck : null;
	} catch {
		return null; // storage disabled or holding something we did not write
	}
}

// Encoded per segment, not whole: archived filenames carry spaces, and one directory
// name contains a literal newline, but the separators have to stay separators.
function sitesUrl(path) {
	return '/sites/' + path.split('/').map(encodeURIComponent).join('/');
}

async function fetchDeck() {
	const res = await fetch('/api/random/deck');
	if (!res.ok) return null; // 503 before the first `npm run db`
	const { paths } = await res.json();
	return paths.length ? { paths, cursor: 0 } : null;
}

function takeNext(deck) {
	const path = deck.paths[deck.cursor];
	deck.cursor += 1;
	try {
		sessionStorage.setItem(DECK_KEY, JSON.stringify(deck));
	} catch {
		// Full or disabled: the click still works, it just will not remember.
	}
	return path;
}

async function stillOnDisk(path) {
	try {
		return (await fetch(sitesUrl(path), { method: 'HEAD' })).ok;
	} catch {
		return false;
	}
}

async function nextRandomPath() {
	let deck = readDeck();

	// Fetch on first use, and again once the deck runs out -- a fresh shuffle, so the
	// next pass through the archive is in a different order.
	if (!deck || deck.cursor >= deck.paths.length) deck = await fetchDeck();
	if (!deck) return null;

	const path = takeNext(deck);
	if (await stillOnDisk(path)) return path;

	// The deck outlived the pool it was dealt from: `npm run db` recreated archive.db,
	// or a crawl was re-run, while this tab held the old shuffle. One stale path is
	// enough to know the whole deck is suspect, so throw it away rather than limping
	// through it a 404 at a time. Bounded to a single retry -- if a freshly fetched
	// deck also misses, something is wrong that another round trip will not fix.
	deck = await fetchDeck();
	if (!deck) return null;

	const fresh = takeNext(deck);
	return (await stillOnDisk(fresh)) ? fresh : null;
}

// Jumps the frame to the next page in the shuffled deck.
//
// Assigning src rather than replacing the location, so each jump leaves a history entry
// and Back walks the trail you actually took. onFrameLoad then updates the chrome, the
// same as any other navigation.
export async function openRandomPage() {
	let path;
	try {
		path = await nextRandomPath();
	} catch {
		return; // server not running
	}
	if (!path) return;

	iframe.src = sitesUrl(path);
}

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
