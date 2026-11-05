// Points out a part of the shell for the How To Use page
// (sites/palestineonline.net/howtouse.html).
//
// As each step sticks to the top of that page, the page posts the name of the part the
// step is about, and the part is pointed out here (styles at the end of explorer.css): a
// toolbar button shows its hovered state, the address bar and its dropdown button turn
// the title bar's green, the wallpaper takes a green wash. Only the shell knows its own
// markup, so the page sends a name, not a selector. Posting null, or the frame loading another page, puts everything back.

const MESSAGE = 'palestine-online:point';

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

function point(part) {
	for (const el of document.querySelectorAll('.tutorial-pointed')) {
		el.classList.remove('tutorial-pointed');
	}
	document.documentElement.classList.toggle('tutorial-wallpaper', part === 'background');
	const selector = PARTS[part];
	if (!selector) return;
	for (const el of document.querySelectorAll(selector)) el.classList.add('tutorial-pointed');
}

export function initTutorial() {
	window.addEventListener('message', (event) => {
		if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
		if (event.data?.type !== MESSAGE) return;
		point(event.data.part ?? null);
	});
	iframe.addEventListener('load', () => point(null));
}
