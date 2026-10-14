// Plays the audio an archived page links to, in Webamp.
//
// A page "has audio" when it links to an .mp3 or .wav under /sites -- the recordings
// `npm run media` restored, converted from RealAudio, plus the few that were MP3 or WAV
// to begin with. For those pages the status bar shows a Play audio button, and clicking
// one of the links opens the player at that track instead of letting the browser take
// over the tab. Either way the queue is every recording on the page, in page order.
//
// Webamp belongs to the page it was opened for: leaving that page closes it, and closing
// it -- either way -- stops the audio. One instance serves the whole session, hidden when
// closed and reopened by the next Play with that page's recordings: Webamp cannot really
// be disposed of (its own docs say dispose() leaks the instance), and a second instance
// built after a dispose came up with an empty display, never starting its track. The
// ~900 KB bundle is imported the first time it is needed, so pages without audio never
// load it.
//
// Desktop only. On a phone the status bar is hidden and Webamp's fixed-size, mouse-sized
// windows do not fit, so audio links are left to the browser's own player.

const WEBAMP_URL = '/vendor/webamp/webamp.bundle.min.mjs';
const AUDIO_HREF = /\.(mp3|wav)(?:[?#]|$)/i;
const PHONE = window.matchMedia('(max-width: 480px)');
const BOUND = '__palestineOnlineAudioBound';

// Where Webamp sits: it centres its windows inside the element it is rendered over, so
// a fixed, full-height column at the left edge, exactly Webamp's width, puts it at the
// middle left. The 16px inset keeps it off the edge of the window.
const LEFT_INSET = 16;
const WEBAMP_WIDTH = 275;
const MAIN_HEIGHT = 116;
// The playlist's height grows in 29px steps; four of them shows ten tracks at a time.
const PLAYLIST_EXTRA_ROWS = 4;

const button = document.getElementById('status-bar-audio');
const label = document.getElementById('status-bar-audio-label');

let player = null; // { webamp, queueKey, open, layout } once built; kept for the session
let opening = null; // the in-flight first load, so a double click builds one player
let durations = null; // href -> seconds, from /api/media, fetched once
let currentTracks = []; // the page in the frame's recordings
let currentKey = '';
let currentWin = null;

// --- finding the recordings ---------------------------------------------------

// Every audio link in a frame's documents, framesets included, in page order. Each
// recording appears once: Out Loud links every show twice, the .ram stream and the .rm
// download, and both now point at the same MP3.
function collect(win, out = new Map(), depth = 0) {
	if (!win || depth > 3) return out;
	let doc;
	try {
		doc = win.document;
	} catch {
		return out; // cross-origin
	}
	if (!doc) return out;

	for (const link of doc.querySelectorAll('a[href], area[href]')) {
		const url = link.href;
		if (!AUDIO_HREF.test(url) || !new URL(url).pathname.startsWith('/sites/')) continue;
		if (link.classList.contains('dead')) continue;
		if (!out.has(url)) out.set(url, describe(link, url));
	}

	for (let i = 0; i < win.frames.length; i++) {
		try {
			collect(win.frames[i], out, depth + 1);
		} catch {
			// cross-origin child; skip it
		}
	}
	return out;
}

// Webamp shows "artist - title". The link text names the recording ("Arabic Show");
// the site stands in for the artist. A recording the archive only kept the start of
// says so, from the tooltip `npm run media` put on its links.
function describe(link, url) {
	const path = decodeURIComponent(new URL(url).pathname);
	const file = path.split('/').pop().replace(/(\.(rm|ra|ram|wma|au|aiff?))?\.(mp3|wav)$/i, '');
	const text = (link.textContent || link.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim();
	const partial = /^Partial recording/i.test(link.getAttribute('title') || '');
	return {
		url,
		metaData: {
			artist: path.split('/')[2] || '',
			title: (text && text.length < 80 ? text : file) + (partial ? ' (partial)' : ''),
		},
	};
}

// --- the status bar ------------------------------------------------------------

// Called on every frame navigation, once the page is readable. The button replaces
// whatever is playing with this page's recordings.
export function updateAudio(win, key) {
	currentWin = win;
	currentKey = key;
	// Left the page the player was opened for. Called twice per page (early, and once
	// loaded), so only a different page closes it.
	if (player?.open && player.queueKey !== key) player.webamp.close();
	currentTracks = PHONE.matches ? [] : [...collect(win).values()];
	if (!button) return;
	button.hidden = currentTracks.length === 0;
	label.textContent = `Play audio (${currentTracks.length})`;
}

button?.addEventListener('click', () => play(currentTracks, currentKey, 0));

// --- links in the page -----------------------------------------------------------

// Capturing, and bound before the shell's target handler: an audio link with
// target="main" would otherwise navigate a pane to the raw file. Modified clicks --
// new tab, save as -- are left to the browser.
function onAudioClick(event) {
	if (PHONE.matches) return;
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	const link = event.target?.closest?.('a[href], area[href]');
	if (!link || link.classList.contains('dead') || !AUDIO_HREF.test(link.href)) return;
	if (!new URL(link.href).pathname.startsWith('/sites/')) return;

	event.preventDefault();
	event.stopImmediatePropagation();

	// The page's queue, starting at the clicked recording. Rescanned rather than trusting
	// the last scan, which may have run before the rest of the page had loaded.
	if (currentWin) updateAudio(currentWin, currentKey);
	const tracks = currentTracks.some((t) => t.url === link.href) ? currentTracks : [describe(link, link.href)];
	const index = Math.max(0, tracks.findIndex((t) => t.url === link.href));
	play(tracks, currentKey, index);
}

export function bindAudioLinks(doc) {
	if (!doc || doc[BOUND]) return;
	doc[BOUND] = true;
	doc.addEventListener('click', onAudioClick, true);
}

// --- the player -------------------------------------------------------------------

// --- dragging over the frame --------------------------------------------------------

// Webamp tracks a drag (moving a window, the seek and volume sliders, resizing the
// playlist) through mousemove/mouseup on this document. Once the cursor crosses the
// iframe those events go to the archived page instead, and the drag stalls or never
// ends. So from a press inside Webamp until the button is let go, the frame ignores the
// mouse and every event stays here. Released by mouseup, and by losing the window too,
// for a button let go outside the browser.
const DRAGGING = 'webamp-dragging';

function endDrag() {
	document.documentElement.classList.remove(DRAGGING);
}

document.addEventListener(
	'mousedown',
	(event) => {
		if (event.button === 0 && event.target.closest?.('#webamp')) {
			document.documentElement.classList.add(DRAGGING);
		}
	},
	true,
);
window.addEventListener('mouseup', endDrag, true);
window.addEventListener('blur', endDrag);

async function loadDurations() {
	if (durations) return durations;
	try {
		const res = await fetch('/api/media');
		durations = res.ok ? await res.json() : {};
	} catch {
		durations = {};
	}
	return durations;
}

function withDurations(tracks, known) {
	return tracks.map((t) => {
		const seconds = known[new URL(t.url).pathname];
		return seconds ? { ...t, duration: seconds } : t;
	});
}

function anchor() {
	let el = document.getElementById('webamp-anchor');
	if (!el) {
		el = document.createElement('div');
		el.id = 'webamp-anchor';
		el.style.cssText = `position:fixed;top:0;bottom:0;left:${LEFT_INSET}px;width:${WEBAMP_WIDTH}px;pointer-events:none;`;
		document.body.appendChild(el);
	}
	return el;
}

async function open(tracks) {
	const [{ default: Webamp }, known] = await Promise.all([import(WEBAMP_URL), loadDurations()]);
	if (!Webamp.browserIsSupported()) return null;

	const webamp = new Webamp({
		initialTracks: withDurations(tracks, known),
		windowLayout: {
			main: { position: { top: 0, left: 0 } },
			playlist: {
				position: { top: MAIN_HEIGHT, left: 0 },
				size: { extraHeight: PLAYLIST_EXTRA_ROWS, extraWidth: 0 },
			},
		},
		// Off: the shell has its own keys (/ for search, arrows in the panels), and
		// Webamp's global ones would take them.
		enableHotkeys: false,
		zIndex: 1000,
	});

	// Closing is the off switch: stop the sound and keep the instance for the next Play,
	// which reopens it where it was left.
	webamp.onClose(() => {
		webamp.stop();
		if (player) player.open = false;
	});

	await webamp.renderWhenReady(anchor());
	return webamp;
}

// --- the starting layout ------------------------------------------------------------

// Webamp's windows can be dragged apart, closed, shaded, resized or doubled, and since the
// instance is kept for the session that would all carry over to the next Play. So the
// layout it first rendered with is recorded, and put back on every reopen. These are
// Webamp's own store actions -- the same ones its window menus dispatch -- since its
// public API has no "reset layout".
function snapshotLayout(webamp) {
	const { windows, display } = webamp.store.getState();
	return {
		anchor: anchor().getBoundingClientRect(),
		doubled: display.doubled,
		windows: Object.fromEntries(
			Object.entries(windows.genWindows).map(([id, w]) => [
				id,
				{ open: w.open, shade: w.shade, size: [...w.size], position: { ...w.position } },
			]),
		),
	};
}

function restoreLayout(webamp, layout) {
	const { dispatch } = webamp.store;
	const now = () => webamp.store.getState();

	if (now().display.doubled !== layout.doubled) dispatch({ type: 'TOGGLE_DOUBLESIZE_MODE' });

	for (const [id, saved] of Object.entries(layout.windows)) {
		const current = now().windows.genWindows[id];
		if (!current) continue;
		if (current.open !== saved.open) dispatch({ type: 'TOGGLE_WINDOW', windowId: id });
		if (current.canShade && current.shade !== saved.shade) {
			dispatch({ type: 'TOGGLE_WINDOW_SHADE_MODE', windowId: id });
		}
		if (current.canResize && String(current.size) !== String(saved.size)) {
			dispatch({ type: 'WINDOW_SIZE_CHANGED', windowId: id, size: saved.size });
		}
	}

	// The same arrangement, moved by however far the anchor has moved since -- a resized
	// browser window -- so it still opens at the middle left.
	const here = anchor().getBoundingClientRect();
	const dx = here.left - layout.anchor.left;
	const dy = here.top + here.height / 2 - (layout.anchor.top + layout.anchor.height / 2);
	const positions = Object.fromEntries(
		Object.entries(layout.windows).map(([id, w]) => [
			id,
			{ x: Math.round(w.position.x + dx), y: Math.max(0, Math.round(w.position.y + dy)) },
		]),
	);
	dispatch({ type: 'UPDATE_WINDOW_POSITIONS', positions, absolute: true });
}

async function play(tracks, key, index) {
	if (!tracks.length) return;

	// Built once, on the first Play; a second click while it loads waits for the same build.
	if (!player) {
		opening ||= open(tracks)
			.then((webamp) => {
				if (webamp) player = { webamp, queueKey: key, open: true, layout: snapshotLayout(webamp) };
				return webamp;
			})
			.finally(() => {
				opening = null;
			});
		await opening;
		if (!player) return;
		// Navigated away while it was loading: close it rather than play to a page
		// that is no longer there.
		if (player.queueKey !== currentKey) {
			player.webamp.close();
			return;
		}
	} else {
		// Reused: load this page's recordings if it holds another page's, and bring it
		// back if it was closed.
		if (player.queueKey !== key) {
			player.webamp.setTracksToPlay(withDurations(tracks, await loadDurations()));
			player.queueKey = key;
		}
		if (!player.open) {
			restoreLayout(player.webamp, player.layout);
			player.webamp.reopen();
			player.open = true;
		}
	}

	// setCurrentTrack takes a track id despite documenting an index. Ids keep counting
	// across playlists -- the first page's tracks are 0..50, the next page's start at 51 --
	// so an index only works on the first playlist. Passing the id at that position is what
	// it actually needs; passing the index after a switch selected a track no longer in
	// the list, and the display showed "0." and the previous page's title.
	const { webamp } = player;
	const id = webamp.store.getState().playlist.trackOrder[index];
	if (id !== undefined) webamp.setCurrentTrack(id);
	webamp.play();
}
