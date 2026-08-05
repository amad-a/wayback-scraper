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

// --- link targets -----------------------------------------------------------

const TARGET_BOUND = '__palestineOnlineTargetBound';

// The window an archived link means, or null to let the browser handle the click.
//
// Every one of these is a navigation the sandbox on #frame forbids. A sandboxed document
// may navigate itself and its descendants and nothing else, so a nav pane can no longer
// reach the pane beside it -- and reaching the pane beside it is what a frameset is. What
// the sandbox is there to stop is only the last case.
//
//   target="main"   the sibling pane, on 498 pages: the ordinary frameset idiom.
//   _parent         the frameset holding this pane, on 254.
//   _top            in 1999 the frameset, on 1,562. The shell put a browsing context
//                   above that, so today the browser reads it as the Explorer window.
//
// _self and an absent target navigate the pane itself, which a sandboxed document is
// always allowed to do. _blank opens a tab, which allow-popups already permits. Both are
// left alone. So is a name matching no frame -- the browser opens a window for it, and
// second-guessing that would change behaviour the sandbox never broke.
function targetWindow(win, name) {
	const root = iframe.contentWindow;

	if (!name || name === '_self' || name === '_blank') return null;
	if (name === '_top') return root;

	// Clamped at the root: for a pane _parent is the frameset, which is what its author
	// meant, but for a page sitting directly in #frame it is the Explorer window.
	if (name === '_parent') return win === root ? root : win.parent;

	return findFrame(root, name);
}

// Depth-first, because a name can belong to a pane of a nested frameset. Bounded like
// prepareFrame: framesets nest, but not indefinitely.
function findFrame(win, name, depth = 0) {
	if (!win || depth > 3) return null;

	for (let i = 0; i < win.frames.length; i++) {
		try {
			const child = win.frames[i];
			if (child.name === name) return child;

			const found = findFrame(child, name, depth + 1);
			if (found) return found;
		} catch {
			// cross-origin; skip it and carry on with its siblings
		}
	}

	return null;
}

// Performs the navigation the sandbox refused.
//
// This listener belongs to the shell, and the shell is not sandboxed. A navigation is
// attributed to whoever runs the code rather than to the document the click happened in,
// so assigning location here is permitted where the same assignment inside the pane is
// not.
//
// Capturing, so a page that stops propagation in its own handler cannot swallow it.
function onArchiveClick(event) {
	const link = event.target?.closest?.('a[href], area[href]');
	if (!link) return;

	const doc = link.ownerDocument;
	// <base target> sets the default for a whole document; two pages rely on it.
	const name = (
		link.getAttribute('target') ||
		doc.querySelector('base[target]')?.getAttribute('target') ||
		''
	).toLowerCase();

	const win = targetWindow(doc.defaultView, name);
	if (!win) return;

	// .href rather than the attribute: the DOM has resolved it against the document and
	// its <base href> already, so relative links come out right. Schemes that do not
	// navigate are left to the page -- the scraper rewrites mailto: to '#', but not every
	// page went through it.
	const { href } = link;
	if (!href || /^(javascript|mailto):/i.test(href)) return;

	event.preventDefault();
	win.location.href = href;
}

function bindTargets(doc) {
	if (!doc || doc[TARGET_BOUND]) return;
	doc[TARGET_BOUND] = true;

	doc.addEventListener('click', onArchiveClick, true);
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
		bindTargets(win.document);
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
		? `${title}`
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

	// Held for the favorites star, which wants the corrected title and the real address
	// rather than what the document happens to claim about itself.
	currentPage = page;

	// Now that frame_parent is known, the star can describe the page that would actually
	// be bookmarked. syncChrome already guessed from the path alone; this is the refinement
	// for the rare document that turns out to be a frame.
	syncStar(page.frame_parent || page.local_path);
	refreshFavorite(page);
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
	currentPage = null;

	const localPath = path.slice('/sites/'.length);
	syncShareUrl(localPath);
	// Straight away, from the path alone: the database pass in applyChrome is a round trip
	// away and the star should not spend it showing the last page's state.
	syncStar(localPath);
	applyChrome();
}

// --- shareable URL ----------------------------------------------------------

const PAGE_PARAM = 'p';

// Puts the page you are looking at into the shell's own address, so the link in your
// browser bar is the link you send someone.
//
// replaceState, never pushState. An iframe navigation already creates a history entry --
// that is what makes the Back button work -- so pushing another would cost two entries
// per page and Back would need two presses. This relabels the entry that already exists.
//
// The path is encoded per segment and dropped in by hand rather than through
// URLSearchParams, which would percent-encode the slashes into %2F. A slash is legal in
// a query string, and a readable link was the whole reason for preferring a path over an
// opaque hash.
function syncShareUrl(localPath) {
	const others = new URLSearchParams(location.search);
	others.delete(PAGE_PARAM);
	const rest = others.toString();

	const encoded = localPath.split('/').map(encodeURIComponent).join('/');
	const query = `?${PAGE_PARAM}=${encoded}` + (rest ? `&${rest}` : '');

	history.replaceState(history.state, '', location.pathname + query);
}

function sharedPath() {
	const match = /[?&]p=([^&]*)/.exec(location.search);
	if (!match) return '';

	let path;
	try {
		path = decodeURIComponent(match[1]);
	} catch {
		return ''; // malformed escape
	}

	// The value becomes a URL under /sites, so it must not be able to climb out of it or
	// name an absolute path of its own.
	if (!path || path.startsWith('/') || path.split('/').includes('..')) return '';
	return path;
}

// The status bar's left pane, used for transient messages. Nothing else writes to it.
const statusText = document.getElementById('status-bar-left-text');
let statusTimer = 0;

function flashStatus(message) {
	if (!statusText) return;
	statusText.textContent = message;
	clearTimeout(statusTimer);
	statusTimer = setTimeout(() => {
		statusText.textContent = '';
	}, 2500);
}

// Hands the current page's link to the OS share sheet, or copies it if there isn't one.
//
// location.href already carries ?p= for whatever the frame is showing, kept current by
// syncShareUrl, so there is nothing to assemble here.
//
// navigator.share must be reached without awaiting anything first. It requires transient
// user activation, and an await before the call spends the activation the click gave us,
// so the sheet would be refused.
export async function sharePage() {
	const url = location.href;
	const title = document.querySelector('.window-title')?.textContent || document.title;

	if (navigator.share) {
		try {
			await navigator.share({ title, url });
			return;
		} catch (error) {
			// A cancelled sheet is a completed action, not a failure. Anything else --
			// no share target, a platform that advertises the API and then refuses --
			// falls through to copying, which is the point of the button either way.
			if (error?.name === 'AbortError') return;
		}
	}

	try {
		await navigator.clipboard.writeText(url);
		flashStatus('Link copied to clipboard');
	} catch {
		// Clipboard access needs a secure context; over plain http on something other
		// than localhost there is nowhere left to go.
		flashStatus('Could not copy link');
	}
}

// Opens whatever ?p= names, if it still exists.
//
// Checked before navigating rather than after, because the alternative is showing
// someone else's dead link as a 404 inside the frame with the chrome describing nothing.
// Falls back to leaving the default page alone.
async function openSharedPage() {
	const path = sharedPath();
	if (!path) return;
	if (!(await stillOnDisk(path))) return;

	iframe.src = sitesUrl(path);
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
	// Before the poll starts, so a shared link replaces the default page rather than
	// briefly showing it. Not awaited: the frame's own src is already loading, and this
	// simply overrides it a moment later if ?p= names something that still exists.
	openSharedPage();

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

// localStorage rather than sessionStorage, unlike the Random deck: a favorite is meant to
// outlive the tab. It is the same trade the zoom level makes, and the same failure mode --
// a browser with storage disabled keeps working and simply forgets.
const FAVORITES_KEY = 'palestine-online:favorites';

// The database row for whatever the frame is showing, or null before applyChrome's fetch
// lands and for anything not in the archive.
let currentPage = null;

// An entry is { path, title, url }.
//
// The path is the durable half -- it is the primary key in the database and the thing the
// frame is pointed at. Title and address are a cache of what the database said when the
// page was starred, kept so the panel can be drawn without a request per entry, and
// refreshed whenever you visit a page you have starred. That leaves one stale case: a
// title_override corrected for a page you never open again. Cheap to accept, and it costs
// nothing to be wrong about.
function readFavorites() {
	try {
		const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
		return Array.isArray(stored) ? stored.filter((e) => e?.path) : [];
	} catch {
		return []; // storage disabled, or holding something we did not write
	}
}

let favorites = readFavorites();

// Which page the star is currently describing, so a click knows what to remove without
// re-deriving it, and markCurrent knows which row to light up. Set by syncStar on every
// navigation. Declared here rather than beside syncStar because the first render reads it
// before that point in the file is reached.
let starredPath = '';

// Written on every change rather than at beforeunload, which does not reliably fire on
// iOS Safari and never fires at all if the tab is killed -- a whole list of favorites is
// too much to lose to a page the browser decided to reclaim. Changes are clicks, so there
// is no burst here worth debouncing.
function writeFavorites() {
	try {
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
	} catch {
		// Full or disabled: the list still works for this session.
	}
}

const favoritesEntries = document.querySelector('.favorites-entries');

favoritesEntries?.setAttribute('role', 'listbox');
favoritesEntries?.setAttribute('aria-label', 'Favorites');

function openFavorite(path) {
	iframe.src = sitesUrl(path);
}

function renderFavorites() {
	if (!favoritesEntries) return;

	favoritesEntries.replaceChildren();

	for (const entry of favorites) {
		const row = document.createElement('div');
		row.className = 'bookmark-list-entry';
		row.dataset.path = entry.path;
		row.setAttribute('role', 'option');
		// -1 rather than 0: focusable when something calls focus() on it, but skipped by
		// Tab, which would otherwise walk through every bookmark on the way past the
		// panel. Opening the panel puts focus here, and the arrows take it from there.
		row.tabIndex = -1;
		// The address leads because this archive is full of untitled and mangled titles,
		// and the address is the half that always identifies the page.
		const address = entry.url || entry.path;
		row.textContent = entry.title ? `${address} - ${entry.title}` : address;
		row.addEventListener('click', () => openFavorite(entry.path));
		favoritesEntries.appendChild(row);
	}

	markCurrent();
}

// Shows which entry the frame is currently on, and puts the tab stop there.
//
// Called on navigation rather than folded into renderFavorites, because the list only
// changes when you star something while the current page changes constantly.
function markCurrent() {
	for (const row of favoritesEntries?.children || []) {
		const isCurrent = row.dataset.path === starredPath;
		row.classList.toggle('current', isCurrent);
		row.setAttribute('aria-selected', String(isCurrent));
	}
}

// Where the arrows should start: the page you are already looking at, or the top of the
// list when you are somewhere that is not in it.
function firstFavoriteRow() {
	return favoritesEntries?.querySelector('.bookmark-list-entry.current')
		|| favoritesEntries?.firstElementChild;
}

// Arrows walk the list, Enter and Space open, Escape closes. Bound to the container rather
// than each row, so it survives every re-render without rebinding.
favoritesEntries?.addEventListener('keydown', (event) => {
	const rows = [...favoritesEntries.children];
	if (!rows.length) return;

	const index = rows.indexOf(document.activeElement);

	const focusRow = (next) => {
		event.preventDefault();
		rows[next].focus();
	};

	// With focus on the container rather than a row, treat it as sitting just past the
	// end, so Down enters at the top and Up enters at the bottom.
	const from = index === -1 ? (event.key === 'ArrowUp' ? 0 : rows.length - 1) : index;

	switch (event.key) {
		case 'ArrowDown':
			return focusRow((from + 1) % rows.length);
		case 'ArrowUp':
			return focusRow((from - 1 + rows.length) % rows.length);
		case 'Home':
			return focusRow(0);
		case 'End':
			return focusRow(rows.length - 1);
		case 'Enter':
		case ' ':
			if (index === -1) return;
			event.preventDefault();
			return openFavorite(rows[index].dataset.path);
		case 'Escape':
			event.preventDefault();
			return hideBookmarksPanel();
	}
});

renderFavorites();

// Brings a starred page's cached label back in line with the database, so correcting a
// title_override and then opening the page is enough to fix how it reads in the panel.
//
// Skipped for a frame, whose entry describes its parent -- a page we do not have the row
// for here, and would need a request to describe.
function refreshFavorite(page) {
	if (page.frame_parent) return;

	const entry = favorites.find((e) => e.path === page.local_path);
	if (!entry) return;

	const title = page.display_title || '';
	if (entry.title === title && entry.url === page.display_url) return;

	entry.title = title;
	entry.url = page.display_url;
	writeFavorites();
	renderFavorites();
}

function syncStar(localPath) {
	starredPath = localPath;
	favoriteStar?.classList.toggle('toggled', favorites.some((e) => e.path === localPath));
	markCurrent();
}

// The page a star click should act on, which is not always the page on screen: starring a
// frame would save one pane of a frameset, and reopening it later would show the bare nav
// strip that frame_parent exists to keep out of the archive's front doors.
//
// Falls back to what the frame itself reports for anything the database does not have --
// a page hand-added to /sites, or a request that failed while the server was restarting.
async function favoriteTarget() {
	if (!currentPage) {
		return starredPath
			? { path: starredPath, title: iframe.contentDocument?.title || '', url: starredPath }
			: null;
	}

	if (!currentPage.frame_parent) {
		return {
			path: currentPage.local_path,
			title: currentPage.display_title || '',
			url: currentPage.display_url,
		};
	}

	// One request, and only when starring a page that turns out to be a frame -- rare
	// enough that carrying the parent's row around for every navigation would cost more.
	try {
		const res = await fetch(`/api/page?path=${encodeURIComponent(currentPage.frame_parent)}`);
		if (res.ok) {
			const parent = await res.json();
			return {
				path: parent.local_path,
				title: parent.display_title || '',
				url: parent.display_url,
			};
		}
	} catch {
		// fall through and star the parent under its path alone
	}

	return { path: currentPage.frame_parent, title: '', url: currentPage.frame_parent };
}

export async function addFavorite() {
	const target = await favoriteTarget();
	if (!target) return;

	// The list is the state; the star only reports it. Reading the class instead would let
	// a star that got out of step -- starring a frame stars its parent, not the path the
	// star was last synced to -- add a duplicate.
	const existing = favorites.findIndex((e) => e.path === target.path);
	if (existing === -1) {
		// Newest first: the last thing you starred is the thing you are most likely to
		// want back.
		favorites.unshift(target);
	} else {
		favorites.splice(existing, 1);
	}

	writeFavorites();
	renderFavorites();
	syncStar(starredPath);
}

export function toggleFavorites() {
	favoritesPanel?.classList.toggle('hidden');

	if (favoritesPanel?.classList.contains('hidden')) return;

	// The panel and the address dropdown occupy the same corner of the window, so opening
	// one closes the other.
	dropdown?.classList.add('hidden');

	// Focus goes in with the panel. Tab cannot reach the rows, so this is the only way in
	// and the arrows would have nothing to move from without it.
	firstFavoriteRow()?.focus();
}

export function hideBookmarksPanel() {
	const wasOpen = !favoritesPanel?.classList.contains('hidden');
	favoritesPanel?.classList.add('hidden');

	// Hiding the panel destroys whatever inside it had focus, and the browser drops focus
	// to the body -- which strands a keyboard user at the top of the document rather than
	// on the button they just used.
	if (wasOpen) document.getElementById('favorites')?.focus();
}
