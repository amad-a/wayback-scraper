// Behaviour for the Explorer shell. Every function here is a deliberate no-op:
// the markup and the wiring in main.js are complete, only these bodies are not.
// Fill them in one at a time; main.js should not need to change.
//
// Shared handles, so implementations don't each re-query the DOM.
import { bindAudioLinks, updateAudio } from './webamp.js';

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

// On a phone or tablet the shell itself never zooms: a pinch on the toolbars, panels or
// status bar is cancelled rather than magnifying the chrome around the page. Only touches
// on the shell's own document land here -- a pinch over #frame goes to the archived page's
// document, where bindZoom turns it into the frame's zoom. iOS Safari reports a pinch
// through these gesture events, and goes on zooming whatever touch-action says.
//
// Touch screens only, checked per gesture: Safari on a Mac fires the same events for a
// trackpad pinch, and on a desktop zooming the whole window is left to the browser.
const TOUCH_SCREEN = window.matchMedia('(pointer: coarse)');

export function blockShellPinch() {
	for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
		document.addEventListener(
			type,
			(event) => {
				if (TOUCH_SCREEN.matches) event.preventDefault();
			},
			{ passive: false },
		);
	}
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
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

	const doc = link.ownerDocument;
	// <base target> sets the default for a whole document; two pages rely on it.
	const name = (
		link.getAttribute('target') ||
		doc.querySelector('base[target]')?.getAttribute('target') ||
		''
	).toLowerCase();

	// .href rather than the attribute: the DOM has resolved it against the document and
	// its <base href> already, so relative links come out right. javascript: links are
	// the page's own business.
	const { href } = link;
	if (!href || /^javascript:/i.test(href)) return;

	// Anything that would leave the archive goes nowhere: mail, news and ftp links that
	// would hand off to another app, and links to the live web. The scraper marks almost
	// all of these dead already (dead-links.js cancels those); this catches the 223 it
	// missed -- 188 live-web links, mostly malformed markup like `http://host</A`, and 35
	// mailto:s.
	if (!sitesPathOf(href) && !isSamePageAnchor(href, doc)) {
		event.preventDefault();
		return;
	}

	// A link that names no window, clicked in a pane, goes to the pane its page belongs
	// in -- which is how the nav frame's links reach "main" again (see paneFor).
	const here = doc.defaultView;
	const root = iframe.contentWindow;
	if (!name && here !== root) {
		const pane = paneFor(here, href);
		if (pane) {
			event.preventDefault();
			pane.location.href = href;
			return;
		}
	}

	// A new window -- _blank, _new, or a name no frame has, which a browser opens a window
	// for -- becomes the whole frame instead: 86 pages open links that way, and a new tab
	// would be a page outside the shell.
	let win;
	if (!name || name === '_self') win = here === root ? root : null;
	else if (NEW_WINDOW.has(name)) win = root;
	else win = targetWindow(here, name) || root;
	if (!win) return;

	// Whatever replaces the whole frame goes through openPlaced, so a page that belongs
	// in a frameset arrives inside it rather than bare.
	if (win === root) {
		const path = sitesPathOf(href);
		if (path) {
			event.preventDefault();
			openPlaced(path);
			return;
		}
	}

	event.preventDefault();
	win.location.href = href;
}

const NEW_WINDOW = new Set(['_blank', '_new', '_newtab']);

// A link to a spot on the page it is on, like href="#top": same document, so not a
// navigation the archive needs to have anything to say about.
function isSamePageAnchor(href, doc) {
	try {
		const to = new URL(href);
		const here = new URL(doc.URL);
		return to.hash !== '' && to.origin === here.origin && to.pathname === here.pathname && to.search === here.search;
	} catch {
		return false;
	}
}

function bindTargets(doc) {
	if (!doc || doc[TARGET_BOUND]) return;
	doc[TARGET_BOUND] = true;

	doc.addEventListener('click', onArchiveClick, true);
}

// --- framesets ---------------------------------------------------------------

// Pages that belong inside a frameset are never shown bare. `npm run db` works out, for
// each page that was only ever seen inside a frame, the frameset and frame it opened in
// (frame_home and frame_slot). Three things here act on that:
//
//   openPlaced     every way of opening a page in #frame -- the address bar, search,
//                  favorites, history, Random, a link that replaces the whole frame --
//                  asks /api/place first, loads the outermost frameset, and then fills
//                  each frame on the way down to the page.
//   paneFor        a link clicked in one pane that names no window goes to the pane its
//                  page belongs in. The scraper stripped <base target="main"> from the
//                  nav frames, so without this their links open inside the nav.
//   the catch-all  a page that still arrives bare in #frame -- Back into an old entry,
//                  a link we could not see -- is swapped for its frameset in place.
//
// The address bar and ?p= name the page that was asked for, not the frameset around it,
// and follow it as it changes in its frame, so a shared link reopens what you were
// reading.

// Which frame of each frameset its pages go in: frameset path -> { page path: slot }.
const framesetMaps = new Map();
// The page last placed into a frameset, and the frame it is in: { top, frame, path }.
let placed = null;
// Steps waiting for #frame to load the frameset they are for, from openPlaced or the
// server's data-place: { top, steps }. Tied to the frameset because the load that fires
// next may still be the page being replaced -- the catch-all starts the swap before a
// slow bare page has finished loading, and that load must not use the steps up.
let pendingSteps = null;

function sitesPathOf(href) {
	try {
		const url = new URL(href, location.href);
		if (url.origin !== location.origin || !url.pathname.startsWith('/sites/')) return '';
		return decodeURIComponent(url.pathname.slice('/sites/'.length));
	} catch {
		return '';
	}
}

function localPathOf(win) {
	try {
		return sitesPathOf(win.location.href);
	} catch {
		return '';
	}
}

// A frame's name as the database knows it: lowercased, or '#2' for the third, unnamed.
function slotOf(win) {
	try {
		const panes = [...win.parent.document.querySelectorAll('frame, iframe')];
		const at = panes.findIndex((el) => el.contentWindow === win);
		return (panes[at]?.getAttribute('name') || '').trim().toLowerCase() || `#${at}`;
	} catch {
		return '';
	}
}

function paneElement(win, slot) {
	try {
		const panes = [...win.document.querySelectorAll('frame, iframe')];
		if (slot.startsWith('#')) return panes[Number(slot.slice(1))] || null;
		return panes.find((el) => (el.getAttribute('name') || '').trim().toLowerCase() === slot) || null;
	} catch {
		return null;
	}
}

function loadFrameset(win) {
	const path = localPathOf(win);
	if (!path || framesetMaps.has(path)) return;
	framesetMaps.set(path, {}); // in flight; a click before it lands just goes untouched
	fetchJson(`/api/frameset?path=${encodeURIComponent(path)}`, {}).then((map) => {
		framesetMaps.set(path, map);
	});
}

// The pane a link should open in, when that is not the one it was clicked in.
function paneFor(win, href) {
	const page = sitesPathOf(href).toLowerCase();
	if (!page) return null;
	let frameset;
	try {
		frameset = win.parent;
	} catch {
		return null;
	}
	const slot = framesetMaps.get(localPathOf(frameset))?.[page];
	if (!slot || slot === slotOf(win)) return null;
	return paneElement(frameset, slot)?.contentWindow || null;
}

// --- scripted navigation --------------------------------------------------------

// Scripts in the archived pages navigate frames too, and the sandbox refuses them the same
// way it refuses a link: a pane may navigate only itself and what it contains, so
// Dreamweaver's `parent.main.location = 'pages/purpose.html'` (Deir Yassin's menu),
// `parent.frames['dwn'].location = ...` (omayya.com), `window.open(url, 'main')` (492
// pages) and every Flash button -- Ruffle opens getURL targets with window.open -- all
// fail. The shell is not sandboxed, and a navigation counts as coming from whoever's code
// performs it, so each of those routes is handed to shell code:
//
//   window.open    replaced in every archived document with the shell's own: a named
//                  frame is navigated by name, _top goes through openPlaced, and _blank
//                  stays refused, as the scraper's guard script already refused it.
//   frame names    a frameset's window gets a stand-in for each named frame, so
//                  `parent.main` and `parent.frames['main']` return an object that reads
//                  through to the real frame but navigates through the shell when its
//                  location is set.
//
// Not covered: `top.<name>` and `top.location` -- 24 pages between them. In the shell,
// top is the Explorer window rather than the frameset the page was written for.

const NAV_BOUND = '__palestineOnlineNavBound';
// The document a click or key last happened in. A relative URL given to location is
// resolved against the page whose script set it, and that is almost always the one the
// reader just clicked in.
let activeDoc = null;

function noteActive(event) {
	activeDoc = event.currentTarget;
}

// How many history entries this visit has added behind the page now showing -- so a
// page's own Back link can go back through them and no further. Counted from growth in
// history.length on each load; Back taken through stepBack takes from it. The browser's
// own Back button is not seen, so this can only overcount, never strand the reader.
let entriesBehind = 0;
let lastHistoryLength = window.history.length;

function countEntries() {
	const length = window.history.length;
	if (length > lastHistoryLength) entriesBehind += length - lastHistoryLength;
	lastHistoryLength = length;
}

function stepBack(n) {
	const steps = Math.min(n, entriesBehind);
	if (steps <= 0) return;
	entriesBehind -= steps;
	window.history.go(-steps);
}

// Navigates `win` to `url` from shell code. The whole frame goes through openPlaced, so a
// page that belongs in a frameset still arrives inside it.
function navigateFrom(win, url, { base = activeDoc, replace = false } = {}) {
	let href;
	try {
		href = new URL(String(url), base?.baseURI || win.document.baseURI).href;
	} catch {
		return;
	}
	// Never off the archive: a script pointing a frame at the live web goes nowhere.
	if (!sitesPathOf(href)) return;
	if (win === iframe.contentWindow) {
		const path = sitesPathOf(href);
		if (path) {
			openPlaced(path, { replace });
			return;
		}
	}
	if (replace) win.location.replace(href);
	else win.location.href = href;
}

function shellOpen(win) {
	return (url, target) => {
		if (!url) return null;
		const name = String(target || '').trim().toLowerCase();
		const root = iframe.contentWindow;
		let to = null;
		if (!name || name === '_self') to = win;
		else if (name === '_top') to = root;
		else if (name === '_parent') to = win === root ? root : win.parent;
		else if (!NEW_WINDOW.has(name)) to = findFrameNamed(root, name);
		// A new window, asked for by a click, becomes the whole frame. Asked for by a page
		// on its own -- the welcome popups and ad windows of the period -- it is refused, as
		// the scraper's guard script already refused it.
		if (!to && win.navigator?.userActivation?.isActive) to = root;
		if (!to) return null;
		navigateFrom(to, url, { base: win.document });
		return to;
	};
}

// findFrame, but ignoring case: these pages' scripts and markup rarely agree on it.
function findFrameNamed(win, name, depth = 0) {
	if (!win || depth > 3) return null;
	for (let i = 0; i < win.frames.length; i++) {
		try {
			const child = win.frames[i];
			if ((child.name || '').toLowerCase() === name) return child;
			const found = findFrameNamed(child, name, depth + 1);
			if (found) return found;
		} catch {
			// cross-origin
		}
	}
	return null;
}

// What `parent.main` returns: the frame, read through as it is, except that setting its
// location -- or href, or calling assign or replace on it -- navigates through the shell.
function framePortal(pane) {
	const real = () => pane.contentWindow;
	const location = new Proxy({}, {
		get(_, key) {
			const loc = real().location;
			if (key === 'assign' || key === 'replace') {
				return (url) => navigateFrom(real(), url, { replace: key === 'replace' });
			}
			if (key === 'toString' || key === Symbol.toPrimitive || key === 'valueOf') return () => loc.href;
			const value = loc[key];
			return typeof value === 'function' ? value.bind(loc) : value;
		},
		set(_, key, value) {
			if (key === 'href') {
				navigateFrom(real(), value);
			} else {
				const next = new URL(real().location.href);
				next[key] = value;
				navigateFrom(real(), next.href);
			}
			return true;
		},
	});
	return new Proxy({}, {
		get(_, key) {
			if (key === 'location') return location;
			const win = real();
			const value = Reflect.get(win, key, win);
			return typeof value === 'function' && !/^[A-Z]/.test(String(key)) ? value.bind(win) : value;
		},
		set(_, key, value) {
			if (key === 'location') navigateFrom(real(), value);
			else real()[key] = value;
			return true;
		},
		has(_, key) {
			return key in real();
		},
	});
}

// Installs both on one archived document's window. Frame names that would shadow
// something a window already has -- `top`, `status`, `name` -- are left alone.
function bindNavigation(win) {
	const doc = win.document;
	if (doc[NAV_BOUND]) return;
	doc[NAV_BOUND] = true;

	for (const type of ['mousedown', 'click', 'keydown']) doc.addEventListener(type, noteActive, true);

	try {
		win.open = shellOpen(win);
	} catch {
		// read-only in some odd document; leave the guard's version
	}

	// No dialogs: the scraper's guard already silences alert, confirm and prompt, but
	// three files never went through it, and nothing stopped a page asking "are you sure
	// you want to leave?" -- 22 set onbeforeunload or onunload. allow-modals stays on the
	// sandbox only because the toolbar's Print button needs it.
	try {
		win.alert = () => {};
		win.confirm = () => false;
		win.prompt = () => null;
		Object.defineProperty(win, 'onbeforeunload', { configurable: true, get: () => null, set() {} });
		const add = win.addEventListener.bind(win);
		win.addEventListener = (type, ...rest) => {
			if (String(type).toLowerCase() === 'beforeunload') return;
			add(type, ...rest);
		};
	} catch {
		// leave the page's own
	}

	// A page sending itself to the live web -- 18 meta refreshes and 12 scripts do -- is
	// stopped before it starts, where the browser offers a way to: the frame stays on the
	// page. Elsewhere the archive's Content-Security-Policy (serve.js) still blocks it, at
	// the cost of the browser's own blocked-page notice in the frame.
	try {
		win.navigation?.addEventListener('navigate', (event) => {
			if (event.cancelable && !sitesPathOf(event.destination.url)) event.preventDefault();
		});
	} catch {
		// no Navigation API here
	}

	// The page's Back links walk the shell's history only as far back as this visit
	// went: 19 pages have a javascript:history.back(), and from the first page of a visit
	// that would leave the site.
	try {
		win.history.back = () => stepBack(1);
		win.history.go = (n = 0) => (n < 0 ? stepBack(-n) : n > 0 ? window.history.go(n) : win.location.reload());
		win.history.forward = () => window.history.forward();
	} catch {
		// leave the page's own
	}

	const builtIn = (key) =>
		Object.prototype.hasOwnProperty.call(win, key) ||
		[win.Window?.prototype, win.EventTarget?.prototype, win.Object?.prototype].some(
			(proto) => proto && Object.prototype.hasOwnProperty.call(proto, key),
		);
	for (const pane of doc.querySelectorAll('frame[name], iframe[name]')) {
		const name = pane.getAttribute('name');
		if (!name || builtIn(name)) continue;
		try {
			Object.defineProperty(win, name, { configurable: true, get: () => framePortal(pane) });
		} catch {
			// not definable here; scripts fall back to the real frame
		}
	}
}

// Opens a page in #frame, inside its frameset if it belongs in one. `replace` swaps the
// current history entry instead of adding one: the catch-all uses it, so Back does not
// land on the bare page again and bounce straight back.
export async function openPlaced(path, { replace = false } = {}) {
	const where = await fetchJson(`/api/place?path=${encodeURIComponent(path)}`, { top: path, steps: [] });
	const top = where.top || path;
	const steps = where.steps?.length ? where.steps : null;
	pendingSteps = steps ? { top, steps } : null;
	placed = steps ? { top, frame: steps.at(-1).frame, path } : null;

	const url = sitesUrl(top);
	if (replace) iframe.contentWindow.location.replace(url);
	else iframe.src = url;
}

// Fills the frames on the way down to the placed page, one level at a time: a nested
// frameset's panes only exist once it has loaded.
function placeFrames(steps, win = iframe.contentWindow) {
	if (!steps?.length) return;
	const [step, ...rest] = steps;
	const pane = paneElement(win, step.frame);
	if (!pane) return;
	const next = () => placeFrames(rest, pane.contentWindow);
	if (localPathOf(pane.contentWindow).toLowerCase() === step.page.toLowerCase()) {
		next();
		return;
	}
	if (rest.length) pane.addEventListener('load', next, { once: true });
	pane.contentWindow.location.replace(sitesUrl(step.page));
}

// A pane finished loading. The address bar and ?p= follow whichever pane was last sent
// somewhere new, since that is the page being read: a nav link that loads a report into
// "main" makes the report the address. A pane going back to the page its frameset starts
// it on gives the address back to the frameset.
function onPaneLoad(pane) {
	const top = localPathOf(iframe.contentWindow);
	const path = localPathOf(pane);
	if (!top || !path) return;

	let start = '';
	try {
		const el = [...pane.parent.document.querySelectorAll('frame, iframe')].find((f) => f.contentWindow === pane);
		start = sitesPathOf(el?.getAttribute('src') || '');
	} catch {
		return;
	}
	const slot = slotOf(pane);

	if (path.toLowerCase() === start.toLowerCase()) {
		if (placed?.top === top && placed.frame === slot) {
			placed = null;
			syncChrome(true);
		}
		return;
	}
	if (placed?.top === top && placed.frame === slot && placed.path === path) return;
	placed = { top, frame: slot, path };
	describePlaced();
}

// Puts the placed page into the address bar and ?p=, under the frameset's title.
async function describePlaced() {
	if (!placed) return;
	const { path, top } = placed;
	syncShareUrl(path);
	const page = await fetchJson(`/api/page?path=${encodeURIComponent(path)}`, null);
	if (!page || placed?.path !== path || localPathOf(iframe.contentWindow) !== top) return;
	setChrome({ title: document.querySelector('.window-title').textContent, url: page.display_url });
	setCaptured(page.timestamp);
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
		// Before bindTargets: both listen in the capture phase on the same document, so
		// registration order decides, and an audio link with target="main" must open the
		// player rather than send a pane to the raw file.
		bindAudioLinks(win.document);
		bindTargets(win.document);
		bindNavigation(win);
		setScale(win.document);
	} catch {
		return; // a cross-origin child: nothing we can or should do
	}

	// Listening on the <frame> elements rather than their windows: a pane's window is
	// replaced each time it navigates, taking its listeners with it, while the element
	// stays -- so every later page in the pane is prepared too, not just the first.
	const panes = win.document.querySelectorAll('frame, iframe');
	if (panes.length) loadFrameset(win);
	for (const pane of panes) {
		try {
			prepareFrame(pane.contentWindow, depth + 1);
		} catch {
			// cross-origin; skip it and carry on with its siblings
		}
		if (pane[PANE_BOUND]) continue;
		pane[PANE_BOUND] = true;
		pane.addEventListener('load', () => {
			countEntries();
			try {
				prepareFrame(pane.contentWindow, depth + 1);
				onPaneLoad(pane.contentWindow);
			} catch {
				// cross-origin
			}
		});
	}
}

const PANE_BOUND = '__palestineOnlinePaneBound';

// --- chrome ----------------------------------------------------------------

const TITLE_SUFFIX = 'Palestine Online';

// The status bar's right pane, beside the Internet-zone icon: when the page in the frame
// was captured, read off its Wayback timestamp. Blank for anything without one -- a page
// the database has never heard of and the scraper never stamped -- rather than a guess.
const capturedText = document.getElementById('status-bar-right-text');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function setCaptured(timestamp) {
	if (!capturedText) return;
	const match = /^(\d{4})(\d{2})(\d{2})/.exec(timestamp || '');
	capturedText.textContent = match
		? `Captured ${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
		: '';
}

function setChrome({ title, url }) {
	document.querySelector('.window-title').textContent = title
		? `${title}`
		: TITLE_SUFFIX;
	if (url) addressBar.value = url;
	// A new page in the frame: whatever was typed before it is no longer worth restoring.
	addressBeforeTyping = null;
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
	const stampedUrl = stamped
		? stamped.replace(/^.*?\/web\/\d+id_\//, '').replace(/(\/\/[^/]+):80(?=\/|$)/, '$1')
		: '';
	setChrome({
		title: doc?.title || '',
		// Strip the archive prefix back off to recover the address the page had
		// originally; without a stamp there is nothing honest to show yet.
		url: stampedUrl,
	});
	// The stamp carries the capture time too, so the date shows before the database
	// answers -- and, for a page it has never heard of, instead of it.
	setCaptured(/\/web\/(\d{8,14})/.exec(stamped || '')?.[1]);

	// Filed from the DOM first, so a page the database has never heard of still lands in
	// history. The database pass below files it again with better labels.
	recordVisit(localPath.replace(/^\/sites\//, ''), doc?.title || '', stampedUrl);

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

	// Arrived bare, though it belongs in a frameset: swapped for the frameset in place.
	if (page.frame_home) {
		openPlaced(page.local_path, { replace: true });
		return;
	}

	setChrome({ title: page.display_title, url: page.display_url });
	setCaptured(page.timestamp);
	if (placed && placed.top === page.local_path) describePlaced();

	// Held for the favorites star, which wants the corrected title and the real address
	// rather than what the document happens to claim about itself.
	currentPage = page;

	// Now that frame_parent is known, the star can describe the page that would actually
	// be bookmarked. syncChrome already guessed from the path alone; this is the refinement
	// for the rare document that turns out to be a frame.
	syncStar(page.frame_parent || page.local_path);
	refreshFavorite(page);
	recordVisit(page.local_path, page.display_title, page.display_url);
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
	// A first look, so the last page's Play button goes as soon as the frame moves on;
	// the load handler looks again once the whole page, frames and all, is there.
	updateAudio(iframe.contentWindow, localPath);
	// The frame moved on from the frameset a page was placed in: nothing is placed now.
	if (placed && placed.top !== localPath) placed = null;
	syncShareUrl(placed ? placed.path : localPath);
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
// Falls back to leaving the home page alone.
//
// Normally this finds nothing to do: serve.js resolves ?p= into the frame's src before
// the HTML is sent, so the right page is already loading by the time any of this runs.
// Assigning the same URL again would reload it -- the exact stutter the server-side
// resolution removes -- hence the comparison. What remains is the path for index.html
// served without that handler, opened straight off disk say.
async function openSharedPage() {
	const path = sharedPath();
	if (!path) return;

	// The server already opened the frameset this page belongs in, and left the steps to
	// put the page in its frame. If the frameset has loaded already, they run now.
	if (iframe.dataset.place) {
		let steps = null;
		try {
			steps = JSON.parse(iframe.dataset.place);
		} catch {
			// malformed: leave the frameset as it is
		}
		delete iframe.dataset.place;
		if (steps?.length) {
			placed = { top: sitesPathOf(iframe.src), frame: steps.at(-1).frame, path };
			if (iframe.contentDocument?.readyState === 'complete' && localPathOf(iframe.contentWindow) === placed.top) {
				placeFrames(steps);
			} else {
				pendingSteps = { top: placed.top, steps };
			}
		}
		return;
	}

	const url = sitesUrl(path);
	const current = new URL(iframe.src, location.href).pathname;
	if (current === new URL(url, location.href).pathname) return;

	if (!(await stillOnDisk(path))) return;

	iframe.src = url;
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
		countEntries();
		// Re-injected because pages of this era use document.write, which can replace
		// the whole document after we styled it. Idempotent, so this is cheap.
		prepareFrame(iframe.contentWindow);
		if (pendingSteps && localPathOf(iframe.contentWindow) === pendingSteps.top) {
			const { steps } = pendingSteps;
			pendingSteps = null;
			placeFrames(steps);
			describePlaced();
		}
		if (chromeFor) updateAudio(iframe.contentWindow, chromeFor.slice('/sites/'.length));

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
// The address bar's dropdown, opened two ways. The ▼ button lists the pages tagged
// "entry" -- the list a browser of the era kept of addresses typed before. Typing searches
// every page in the archive by address and title (see /api/search), the list following
// each keystroke. Both are fetched fresh, so a page tagged or rebuilt a moment ago is
// already there.
const dropdownContent = dropdown?.querySelector('.dropdown-content');
const dropdownButton = document.getElementById('address-dropdown-button');

dropdownContent?.setAttribute('role', 'listbox');
dropdownContent?.setAttribute('aria-label', 'Pages');

// Paints rows into the dropdown. They look and behave like the Favorites and History
// panels' -- the same class, so markCurrent lights up the page you are on -- and carry
// their own listeners, which is what lets setFrame stop being a global.
export function render(pages) {
	if (!dropdownContent) return;
	dropdownContent.replaceChildren();

	for (const page of pages) {
		const row = document.createElement('div');
		row.className = 'bookmark-list-entry';
		row.dataset.path = page.local_path;
		row.setAttribute('role', 'option');
		row.tabIndex = -1;
		const address = page.display_url || page.local_path;
		row.textContent = page.display_title ? `${address} - ${page.display_title}` : address;
		row.title = row.textContent;
		row.addEventListener('click', () => setFrame(page.local_path));
		dropdownContent.appendChild(row);
	}

	markCurrent();
}

// Opens a page from the dropdown in the frame, and closes the dropdown.
export function setFrame(path) {
	hideAddressDropdown();
	openPath(path);
}

async function fetchJson(url, fallback) {
	try {
		const res = await fetch(url);
		return res.ok ? await res.json() : fallback;
	} catch {
		return fallback; // server not running: an empty list says so better than a stale one
	}
}

async function loadEntries() {
	return fetchJson('/api/entries', []);
}

// Shows the dropdown, already filled in -- so the slide-open animation runs on the finished
// list rather than on an empty box that then grows. Already open, it just stays open:
// re-rendering while typing must not replay the slide on every keystroke.
function showDropdown() {
	if (!dropdown) return;
	// The panels share this corner of the window, so only one is open at a time.
	favoritesPanel?.classList.add('hidden');
	historyPanel?.classList.add('hidden');
	fitDropdown();
	dropdown.classList.remove('hidden');
	dropdownButton?.setAttribute('aria-expanded', 'true');
}

// The list hangs from the address field and is exactly as wide, as a Windows combo box's
// was -- so its scrollbar sits directly under the ▼ button, the same 16px wide. The list
// is fixed-position, so CSS alone could only guess the field's width; it is measured here
// each time it opens, and again if the window is resized while it is open.
const addressField = document.getElementById('address-compound-input');

function fitDropdown() {
	if (!dropdown || !addressField) return;
	dropdown.style.width = `${addressField.getBoundingClientRect().width}px`;
}

window.addEventListener('resize', () => {
	if (dropdown && !dropdown.classList.contains('hidden')) fitDropdown();
});

// Each open or search takes a ticket; a response is only used if its ticket is still the
// latest. That drops a slow search for "bir" arriving after the one for "birzeit", and a
// load that was cancelled by closing the dropdown in the meantime.
let ticket = 0;

export async function toggleAddressDropdown() {
	if (!dropdown) return;
	if (!dropdown.classList.contains('hidden') || pendingOpen) {
		hideAddressDropdown();
		return;
	}

	await openEntries({ focusList: true });
}
let pendingOpen = false;

// The entry pages, shown: from the ▼ button, with focus going into the list (on the page
// you are on if it is an entry, so the arrows start from somewhere), or while the box
// holds nothing worth searching, with focus left in the box.
async function openEntries({ focusList }) {
	const mine = ++ticket;
	pendingOpen = true;
	const pages = await loadEntries();
	if (mine !== ticket) return;
	pendingOpen = false;
	// Nothing tagged "entry" yet: nothing to show, so it stays closed.
	if (!pages.length) return;
	render(pages);
	showDropdown();

	if (focusList) {
		(dropdownContent?.querySelector('.bookmark-list-entry.current')
			|| dropdownContent?.querySelector('.bookmark-list-entry'))?.focus();
	}
}

// A click in the address box searches for what is in it. Holding the page's address,
// that lists the pages under it -- addresses starting with the text rank first -- so
// clicking on http://art.net/~samia/ shows the rest of art.net/~samia/, and editing the
// address down a folder narrows it. Typed text brings back its matches, or the entries if
// it was cleared down to nothing worth searching.
addressBar?.addEventListener('click', () => {
	if (dropdown && !dropdown.classList.contains('hidden')) return;
	search(addressBar.value.trim());
});

// Nothing worth searching: an empty box, or only the start of an address -- "www.",
// "http://", "http://www." and the letters on the way to them. Those would match every
// page in the archive, so the entries are shown instead.
function isTrivial(query) {
	const q = query.trim().toLowerCase();
	if (!q.replace(/^(https?:\/\/)?(www\d?\.)?/, '')) return true;
	return ['http://www.', 'https://www.', 'www.'].some((prefix) => prefix.startsWith(q));
}

// The address bar as it was before typing started, put back if the dropdown is dismissed
// with Escape, so the bar goes on naming the page in the frame. Taken on focus, before
// the first keystroke has changed it.
let addressBeforeTyping = null;
let addressOnFocus = '';
addressBar?.addEventListener('focus', () => {
	addressOnFocus = addressBar.value;
});

let searchTimer = 0;

// Fires on every keystroke (wired in main.js). Debounced, so a fast typist pays for the
// last keystroke only.
export function onAddressInput(query) {
	if (addressBeforeTyping === null) addressBeforeTyping = addressOnFocus;
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => search(query), 120);
}

async function search(query) {
	// Nothing worth searching: the entries, as the ▼ button shows them, without moving
	// focus out of the box.
	if (isTrivial(query)) {
		await openEntries({ focusList: false });
		return;
	}
	const mine = ++ticket;
	pendingOpen = false;
	const found = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`, { results: [] });
	if (mine !== ticket) return;
	// No matches: the dropdown closes rather than standing open and empty.
	if (!found.results.length) {
		hideAddressDropdown();
		return;
	}
	render(found.results);
	showDropdown();
}

// Keys in the address box itself: Down moves into the list, Enter opens the top match,
// Escape closes the list and gives the bar back its address.
addressBar?.addEventListener('keydown', (event) => {
	const open = dropdown && !dropdown.classList.contains('hidden');
	const first = dropdownContent?.querySelector('.bookmark-list-entry');
	if (event.key === 'ArrowDown' && open && first) {
		event.preventDefault();
		first.focus();
	} else if (event.key === 'Enter' && open && first) {
		event.preventDefault();
		addressBeforeTyping = null;
		setFrame(first.dataset.path);
		addressBar.blur();
	} else if (event.key === 'Escape' && (open || addressBeforeTyping !== null)) {
		event.preventDefault();
		clearTimeout(searchTimer);
		hideAddressDropdown();
		if (addressBeforeTyping !== null) addressBar.value = addressBeforeTyping;
		addressBeforeTyping = null;
	}
});

export function hideAddressDropdown() {
	ticket++; // anything still loading is for a dropdown that is no longer wanted
	pendingOpen = false;
	clearTimeout(searchTimer);
	if (!dropdown || dropdown.classList.contains('hidden')) return;
	const hadFocus = dropdown.contains(document.activeElement);
	dropdown.classList.add('hidden');
	dropdownButton?.setAttribute('aria-expanded', 'false');
	// Back to the button, rather than stranding a keyboard user at the top of the page.
	if (hadFocus) dropdownButton?.focus();
}

bindPanelKeys(dropdownContent, {
	rows: '.bookmark-list-entry',
	activate: (row) => {
		addressBeforeTyping = null;
		setFrame(row.dataset.path);
	},
	close: hideAddressDropdown,
});

// A click anywhere outside the dropdown, its button and the address box closes it, as a
// menu would. Clicks inside the archived page land in the frame's document and never
// reach this one, so leaving the frame focused closes it too.
document.addEventListener('mousedown', (event) => {
	if (
		dropdown?.contains(event.target)
		|| dropdownButton?.contains(event.target)
		|| addressBar?.contains(event.target)
	) return;
	hideAddressDropdown();
});
window.addEventListener('blur', () => {
	if (document.activeElement === iframe) hideAddressDropdown();
});

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

	openPlaced(path);
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

// --- panel keyboard ---------------------------------------------------------

// Arrows walk a panel's rows, Home and End jump to its ends, Enter and Space act on a
// row, Escape closes. Bound to the container rather than to each row, so it survives
// every re-render without rebinding, and the rows are re-queried on each key because
// both lists change underneath it -- one as you star, the other as you browse.
//
// `tree` is optional and takes (row, expand): the history panel uses it for Left and
// Right on a day, which a flat list has no use for.
function bindPanelKeys(container, { rows: selector, activate, close, tree }) {
	container?.addEventListener('keydown', (event) => {
		const rows = [...container.querySelectorAll(selector)];
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
			case 'ArrowRight':
			case 'ArrowLeft':
				if (!tree || index === -1) return;
				event.preventDefault();
				return tree(rows[index], event.key === 'ArrowRight');
			case 'Enter':
			case ' ':
				if (index === -1) return;
				event.preventDefault();
				return activate(rows[index]);
			case 'Escape':
				event.preventDefault();
				return close();
		}
	});
}

const favoritesEntries = document.querySelector('.favorites-entries');

favoritesEntries?.setAttribute('role', 'listbox');
favoritesEntries?.setAttribute('aria-label', 'Favorites');

// Both panels open a page the same way, and assigning src rather than replacing the
// location leaves a history entry so Back walks the trail you actually took.
function openPath(path) {
	openPlaced(path);
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
		// The row is cut off at the panel's edge; the tooltip has all of it.
		row.title = row.textContent;
		row.addEventListener('click', () => openPath(entry.path));
		favoritesEntries.appendChild(row);
	}

	markCurrent();
}

// Shows which rows the frame is currently on, across both panels -- a page can be in
// favorites and in today's history at once, and it should read the same in each.
//
// Called on navigation rather than folded into the renders, because the lists only change
// when you star or visit something while the current page changes constantly.
function markCurrent() {
	for (const row of document.querySelectorAll('.bookmark-list-entry')) {
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

bindPanelKeys(favoritesEntries, {
	rows: '.bookmark-list-entry',
	activate: (row) => openPath(row.dataset.path),
	close: hideBookmarksPanel,
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

	// The panels and the address dropdown occupy the same corner of the window, so opening
	// one closes the others.
	historyPanel?.classList.add('hidden');
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

// --- history ----------------------------------------------------------------

const HISTORY_KEY = 'palestine-online:history';

// The only bound. An entry averages 159 bytes of JSON against this archive's real paths,
// addresses and titles, and the longest page in it would make 548, so 500 entries is
// around 78KB typical and 148KB with every title at the cap below -- measured at 1ms to
// write, against a 5MB origin budget already shared with the zoom level and the favorites
// list.
//
// No age cap to go with it: a visit is only dropped when 500 newer ones have pushed it
// out, so a day you have not browsed since stays reachable for as long as it takes.
const HISTORY_MAX_ENTRIES = 500;

// 184 pages carry a title over 100 characters and six run past 200, the longest 440. Every
// row is one line in the panel, so the rest of it is quota spent on text no one sees.
const HISTORY_TITLE_MAX = 120;

const DAY_MS = 86400000;

const historyPanel = document.querySelector('.history');
const historyEntries = document.querySelector('.history-entries');

historyEntries?.setAttribute('role', 'tree');
historyEntries?.setAttribute('aria-label', 'History');

// Local rather than UTC: the grouping is "what did I look at today", and a day ends when
// it ends where you are, not in Greenwich.
function dayKey(ms) {
	const d = new Date(ms);
	const month = String(d.getMonth() + 1).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key) {
	if (key === dayKey(Date.now())) return 'Today';
	if (key === dayKey(Date.now() - DAY_MS)) return 'Yesterday';

	const [year, month, day] = key.split('-').map(Number);
	return new Date(year, month - 1, day).toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});
}

// Newest first, and applied on the way in as well as on the way out, so a list written by
// an older build with a different cap comes back trimmed rather than growing from wherever
// it happened to be.
function pruneVisits(entries) {
	return entries.filter((e) => e?.path && e.at).slice(0, HISTORY_MAX_ENTRIES);
}

function readVisits() {
	try {
		const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
		return Array.isArray(stored) ? pruneVisits(stored) : [];
	} catch {
		return []; // storage disabled, or holding something we did not write
	}
}

// Named visits rather than history: `history` is the window's own, which syncShareUrl
// calls replaceState on a few hundred lines up.
let visits = readVisits();

function writeVisits() {
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(visits));
	} catch {
		// Quota, or storage disabled. Trim hard and try once more -- losing the older half
		// of the list is better than losing the write and with it today's browsing.
		visits = visits.slice(0, Math.floor(HISTORY_MAX_ENTRIES / 2));
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(visits));
		} catch {
			// Nothing left to do; the list still works for this session.
		}
	}
}

// Records a visit, or updates the one already filed for this page today.
//
// Every navigation the frame makes passes through syncChrome -- a link clicked inside a
// page, a Random draw, a favorite, a shared ?p= link, Back and Forward, and the _top links
// the retarget handler sends here -- so applyChrome is the one place that sees all of
// them, and nothing else has to know history exists.
//
// It is called twice per navigation by design, matching applyChrome's two passes: once
// from the DOM with whatever the document says about itself, then again once the database
// answers with the corrected title and the real address. The second call updates the first
// rather than filing a second row.
//
// A frameset records as itself, not as its panes. Clicking around inside one does not
// change the frame's own address, which is also what stops a nav sidebar filing a visit
// every time it is used.
function recordVisit(path, title, url) {
	if (!path) return;

	const at = Date.now();
	const today = dayKey(at);

	// One row per page per day. Revisiting moves it to the top of that day rather than
	// filling the panel with the page you keep coming back to.
	const index = visits.findIndex((e) => e.path === path && dayKey(e.at) === today);
	const previous = index === -1 ? null : visits[index];
	if (index !== -1) visits.splice(index, 1);

	visits.unshift({
		path,
		// Keep the better of the two passes: the database answer arrives second and wins,
		// but a page the database does not have must not lose the title the document gave.
		title: (title || previous?.title || '').slice(0, HISTORY_TITLE_MAX),
		url: url || previous?.url || '',
		at,
	});

	visits = pruneVisits(visits);
	writeVisits();
	refreshHistory();
}

// Which days are open. Seeded on first sight rather than defaulted at render, so today
// starts expanded and stays however you last left it.
const dayOpen = new Map();

function isDayOpen(key) {
	if (!dayOpen.has(key)) dayOpen.set(key, key === dayKey(Date.now()));
	return dayOpen.get(key);
}

function renderHistory() {
	if (!historyEntries) return;

	historyEntries.replaceChildren();

	if (!visits.length) {
		const empty = document.createElement('div');
		empty.className = 'history-empty';
		empty.textContent = 'Nothing visited yet.';
		historyEntries.appendChild(empty);
		return;
	}

	// visits is already newest-first, so days come out in order and so do the pages
	// inside them without sorting anything.
	const days = new Map();
	for (const entry of visits) {
		const key = dayKey(entry.at);
		if (!days.has(key)) days.set(key, []);
		days.get(key).push(entry);
	}

	for (const [key, entries] of days) {
		const group = document.createElement('div');
		group.className = 'history-group';

		const open = isDayOpen(key);

		const day = document.createElement('div');
		day.className = 'history-day';
		day.dataset.day = key;
		day.setAttribute('role', 'treeitem');
		day.setAttribute('aria-expanded', String(open));
		day.tabIndex = -1;

		const twisty = document.createElement('span');
		twisty.className = 'twisty';
		twisty.textContent = open ? '▾' : '▸';
		day.appendChild(twisty);
		day.appendChild(
			document.createTextNode(`${dayLabel(key)} (${entries.length})`),
		);
		day.addEventListener('click', () => setDayOpen(key, !isDayOpen(key)));

		const pages = document.createElement('div');
		pages.className = open ? 'history-day-pages' : 'history-day-pages collapsed';

		for (const entry of entries) {
			const row = document.createElement('div');
			row.className = 'bookmark-list-entry';
			row.dataset.path = entry.path;
			row.setAttribute('role', 'treeitem');
			row.tabIndex = -1;
			const address = entry.url || entry.path;
			row.textContent = entry.title ? `${address} - ${entry.title}` : address;
			row.title = row.textContent;
			row.addEventListener('click', () => openPath(entry.path));
			pages.appendChild(row);
		}

		group.append(day, pages);
		historyEntries.appendChild(group);
	}

	markCurrent();
}

function setDayOpen(key, open) {
	dayOpen.set(key, open);
	renderHistory();
	// Rendering replaced the row that was focused, so put focus back on its replacement.
	historyEntries?.querySelector(`.history-day[data-day="${key}"]`)?.focus();
}

// Rendering 500 rows on every navigation would be work nobody asked for, since the panel
// is shut almost all the time. Redraw when it is open, and mark it stale when it is not.
let historyStale = true;

function refreshHistory() {
	if (historyPanel?.classList.contains('hidden')) {
		historyStale = true;
		return;
	}
	renderHistory();
	historyStale = false;
}

// Only the pages of an open day are reachable: a collapsed day's rows are display:none,
// and walking onto something invisible is how a keyboard user gets lost.
const HISTORY_ROWS = '.history-day, .history-day-pages:not(.collapsed) .bookmark-list-entry';

bindPanelKeys(historyEntries, {
	rows: HISTORY_ROWS,
	activate: (row) =>
		row.dataset.day ? setDayOpen(row.dataset.day, !isDayOpen(row.dataset.day)) : openPath(row.dataset.path),
	close: hideHistoryPanel,
	// Right opens a day, Left closes it. On a page row, Left goes up to the day holding
	// it, which is the only way back to a parent once you have arrowed down into a long one.
	tree: (row, expand) => {
		if (row.dataset.day) {
			if (expand === isDayOpen(row.dataset.day)) return;
			return setDayOpen(row.dataset.day, expand);
		}
		if (!expand) row.closest('.history-group')?.querySelector('.history-day')?.focus();
	},
});

export function toggleHistory() {
	historyPanel?.classList.toggle('hidden');

	if (historyPanel?.classList.contains('hidden')) return;

	// All three of these live in the same corner of the window.
	favoritesPanel?.classList.add('hidden');
	dropdown?.classList.add('hidden');

	if (historyStale) {
		renderHistory();
		historyStale = false;
	}

	// Focus goes in with the panel, since Tab cannot reach the rows.
	(historyEntries?.querySelector('.bookmark-list-entry.current')
		|| historyEntries?.querySelector('.history-day'))?.focus();
}

export function hideHistoryPanel() {
	const wasOpen = !historyPanel?.classList.contains('hidden');
	historyPanel?.classList.add('hidden');
	if (wasOpen) document.getElementById('history')?.focus();
}
