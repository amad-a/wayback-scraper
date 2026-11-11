// Demo mode: after five minutes with no one at the controls, the shell tours the
// archive by itself -- each page tagged "entry" once a round, in a fresh random order
// each round, opened and slowly scrolled to the bottom -- under a card with the Palestine
// Online logo, in the bottom left of the page. For a screen left
// running in a room. Any real input ends it at once, on whatever page it had reached.
// ?mode=demo in the address starts it straight away, for a screen set up to show it.
//
// The five minutes count only while the site is in front of someone: its tab showing and
// its window focused. Switching to another tab, window or app pauses the count, and ends
// a tour already running.
//
// Input is watched in the shell and in every page and pane (prepareFrame in api.js calls
// watchActivity). A mouse move counts only if the pointer really moved: Chrome sends one
// when a page scrolls under a still cursor, which would otherwise end the tour it is
// running. The tour replaces history entries rather than adding them, so Back afterwards
// goes where it went before.

import { entryTour, hideAddressDropdown, hideBookmarksPanel, hideHistoryPanel, iframe, openPlaced } from './api.js';

// The wait before the tour starts. window.__palestineOnlineDemoIdleMs overrides it, for
// testing.
const IDLE_MS = 5 * 60 * 1000;
const SPEED = 40; // px a second
const LONGEST_SCROLL_S = 90; // a long page scrolls faster, to be done in this
const AT_TOP_MS = 3000;
const AT_BOTTOM_MS = 4000;
const UNSCROLLED_MS = 10000; // a page with nowhere to scroll stays this long
const LOAD_WAIT_MS = 20000;
const PANES_MS = 1500; // after load, for a frameset's panes to fill

let idleFor = 0; // ms of idle time while in front of someone, since the last input
let lastTick = Date.now();
let lastPointer = null;
let run = 0; // the current tour; a stopped one sees a newer number and gives up
let touring = false;
let overlay = null;

const watched = new WeakSet();

function activity() {
	idleFor = 0;
	if (touring) stop();
}

// The tab showing and the window focused. hasFocus() is true while focus is inside one of
// the page's frames too, so clicking into an archived page doesn't count as leaving.
function inFront() {
	return !document.hidden && document.hasFocus();
}

// The first move seen only sets where the pointer is: Chrome sends one as a page loads
// under a still cursor too.
function onPointerMove(event) {
	const at = [event.screenX, event.screenY];
	const moved = lastPointer && Math.abs(at[0] - lastPointer[0]) + Math.abs(at[1] - lastPointer[1]) > 2;
	lastPointer = at;
	if (moved) activity();
}

export function watchActivity(doc) {
	if (!doc || watched.has(doc)) return;
	watched.add(doc);
	for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
		doc.addEventListener(type, activity, { capture: true, passive: true });
	}
	doc.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
}

function showOverlay(shown) {
	if (!overlay) {
		overlay = document.createElement('div');
		overlay.className = 'demo-overlay';
		overlay.hidden = true;
		const card = document.createElement('div');
		card.className = 'demo-card';
		const logo = document.createElement('img');
		logo.src = '/sites/p-ol.com/images/top.gif';
		logo.alt = 'Palestine Online';
		logo.className = 'demo-logo';
		card.append(logo);
		overlay.append(card);
		document.getElementById('content').append(overlay);
	}
	overlay.hidden = !shown;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loaded() {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(done, LOAD_WAIT_MS);
		iframe.addEventListener('load', done, { once: true });
	});
}

// The window to scroll: the biggest one, the page or a frameset pane, with anywhere to go.
function scrollTarget(win = iframe.contentWindow, depth = 0, best = null) {
	try {
		const doc = win.document;
		const range = (doc.scrollingElement?.scrollHeight || 0) - win.innerHeight;
		const area = win.innerWidth * win.innerHeight;
		if (range > 20 && (!best || area > best.area)) best = { win, range, area };
		if (depth < 3) {
			for (const pane of doc.querySelectorAll('frame, iframe')) best = scrollTarget(pane.contentWindow, depth + 1, best);
		}
	} catch {
		// cross-origin: not ours to scroll
	}
	return best;
}

function scrollDown(target, mine) {
	const { win, range } = target;
	const speed = Math.max(SPEED, range / LONGEST_SCROLL_S);
	return new Promise((resolve) => {
		let y = win.scrollY;
		let then = performance.now();
		const step = (now) => {
			if (mine !== run || win.closed) return resolve();
			y = Math.min(range, y + ((now - then) / 1000) * speed);
			then = now;
			try {
				win.scrollTo(0, y);
			} catch {
				return resolve();
			}
			if (y >= range) resolve();
			else requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
}

// A new order, not starting on the page the last one ended on.
function shuffled(pages, after) {
	const order = [...pages];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	if (order.length > 1 && order[0] === after) order.push(order.shift());
	return order;
}

async function tour(mine) {
	const pages = await entryTour();
	if (!pages.length) return stop();
	let order = shuffled(pages);
	for (let i = 0; mine === run; i++) {
		if (i === order.length) {
			order = shuffled(pages, order.at(-1));
			i = 0;
		}
		openPlaced(order[i], { replace: true });
		await loaded();
		await wait(PANES_MS);
		if (mine !== run) return;
		const target = scrollTarget();
		if (!target) {
			await wait(UNSCROLLED_MS);
			continue;
		}
		target.win.scrollTo(0, 0);
		await wait(AT_TOP_MS);
		if (mine !== run) return;
		await scrollDown(target, mine);
		await wait(AT_BOTTOM_MS);
	}
}

function start() {
	touring = true;
	hideAddressDropdown();
	hideBookmarksPanel();
	hideHistoryPanel();
	showOverlay(true);
	tour(++run);
}

function stop() {
	touring = false;
	idleFor = 0; // and the five minutes start again
	run++;
	showOverlay(false);
}

export function initDemo() {
	watchActivity(document);
	if (new URLSearchParams(location.search).get('mode') === 'demo') start();
	// Checked each second rather than on blur: the shell's window blurs whenever focus moves
	// into the page in the frame, which is not leaving. A background tab's timers run late,
	// so a tick counts for at most two seconds.
	setInterval(() => {
		const now = Date.now();
		const elapsed = Math.min(now - lastTick, 2000);
		lastTick = now;
		if (!inFront()) {
			if (touring) stop();
			return;
		}
		idleFor += elapsed;
		const idle = window.__palestineOnlineDemoIdleMs ?? IDLE_MS;
		if (!touring && idleFor >= idle) start();
	}, 1000);
	document.addEventListener('visibilitychange', () => {
		if (document.hidden && touring) stop();
	});
}
