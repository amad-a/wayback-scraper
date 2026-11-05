// Points out a part of the shell for the How To Use page
// (sites/palestineonline.net/howtouse.html).
//
// As each step sticks to the top of that page, the page posts the name of the part the
// step is about, and the part is pointed out here (styles at the end of explorer.css): a
// toolbar button shows its hovered state, the address bar and its dropdown button turn
// the title bar's green, the wallpaper takes a green wash. Only the shell knows its own
// markup, so the page sends a name, not a selector. Posting null, or the frame loading
// another page, puts everything back.
//
// The page also asks which parts there are to see, and skips the steps for the rest:
// phones hide Back, Forward, Source and Print, full screen hides Source, Share and Print,
// Translate shows only where the browser can translate, and on a phone the window
// covers the wallpaper. Once asked, the answer is sent again whenever it may change.

const POINT = 'palestine-online:point';
const ASK = 'palestine-online:parts?';
const ANSWER = 'palestine-online:parts';

const PARTS = {
	'back-forward': '.back-button, .forward-button',
	home: '.home-button',
	favorites: '#favorites',
	history: '#history',
	random: '#random',
	source: '#source',
	translate: '#translate',
	share: '#share',
	print: '.print-button',
	dropdown: '#address-dropdown-button',
	address: '#address-input',
	favorite: '#favorite-star',
};

const iframe = document.getElementById('frame');
const windowBox = document.querySelector('.window-container');

let askedBy = null; // the address of the page that asked about parts
let queued = false;

function framePath() {
	try {
		return iframe.contentWindow.location.pathname;
	} catch {
		return null;
	}
}

function point(part) {
	for (const el of document.querySelectorAll('.tutorial-pointed')) {
		el.classList.remove('tutorial-pointed');
	}
	document.documentElement.classList.toggle('tutorial-wallpaper', part === 'background');
	const selector = PARTS[part];
	if (!selector) return;
	for (const el of document.querySelectorAll(selector)) el.classList.add('tutorial-pointed');
}

// On screen: drawn at all, and not clipped off the end of its toolbar (on a narrow phone
// with Translate showing, Share is cut off).
function onScreen(el) {
	if (!el.getClientRects().length) return false;
	const bar = el.closest('.toolbar');
	return !bar || el.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 1;
}

function available() {
	const parts = {};
	for (const [part, selector] of Object.entries(PARTS)) {
		parts[part] = [...document.querySelectorAll(selector)].some(onScreen);
	}
	// Some wallpaper beside or below the window to click.
	const box = windowBox.getBoundingClientRect();
	parts.background = innerWidth - box.width > 40 || innerHeight - box.height > 40;
	return parts;
}

function answer() {
	queued = false;
	// Only while the page that asked is still the one in the frame.
	if (!askedBy || askedBy !== framePath()) return;
	iframe.contentWindow?.postMessage({ type: ANSWER, available: available() }, location.origin);
}

function queueAnswer() {
	if (!queued) {
		queued = true;
		requestAnimationFrame(answer);
	}
}

export function initTutorial() {
	window.addEventListener('message', (event) => {
		if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
		if (event.data?.type === POINT) point(event.data.part ?? null);
		else if (event.data?.type === ASK) {
			askedBy = framePath();
			queueAnswer();
		}
	});
	iframe.addEventListener('load', () => point(null));
	// Resizing covers the phone layout and full screen; Translate is unhidden later, once
	// the browser says it can translate.
	window.addEventListener('resize', queueAnswer);
	new MutationObserver(queueAnswer).observe(document.getElementById('internet-buttons'), {
		attributes: true,
		attributeFilter: ['hidden'],
		subtree: true,
	});
}
