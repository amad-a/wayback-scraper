// The desktop wallpaper: one of the tiles in /assets/tiles, repeated behind the window.
//
// Clicking the background steps through the tiles in name order, wrapping round at either
// end: the right half of the screen moves forward one, the left half back one. The tile
// showing is remembered, so the next visit opens on it; a first visit, or one whose
// remembered tile has since been removed, gets a random one. The stylesheet's own tile
// stays as the fallback for when none of this runs.

const TILES_URL = '/assets/tiles/';
const WALLPAPER_KEY = 'palestine-online:wallpaper';

let tiles = [];
let current = '';

function readStored() {
	try {
		return localStorage.getItem(WALLPAPER_KEY) || '';
	} catch {
		return ''; // storage disabled
	}
}

function show(name) {
	current = name;
	document.body.style.backgroundImage = `url('${TILES_URL}${encodeURIComponent(name)}')`;
	try {
		localStorage.setItem(WALLPAPER_KEY, name);
	} catch {
		// storage disabled: the tile still changes, it just will not be remembered
	}
	// Both neighbours fetched ahead, so the next click either way swaps tiles without a
	// flash of the bare background.
	const at = tiles.indexOf(name);
	for (const step of [1, -1]) {
		const neighbour = tiles[(at + step + tiles.length) % tiles.length];
		if (neighbour) new Image().src = TILES_URL + encodeURIComponent(neighbour);
	}
}

export async function initWallpaper() {
	// The remembered tile goes up straight away, before the list arrives, so a returning
	// visitor never sees the default first.
	const stored = readStored();
	if (stored) document.body.style.backgroundImage = `url('${TILES_URL}${encodeURIComponent(stored)}')`;

	try {
		const res = await fetch('/api/tiles');
		tiles = res.ok ? await res.json() : [];
	} catch {
		tiles = [];
	}
	if (!tiles.length) return;

	show(tiles.includes(stored) ? stored : tiles[Math.floor(Math.random() * tiles.length)]);

	const back = (event) => event.clientX < window.innerWidth / 2;

	// The cursor says which way a click will go: a left-pointing arrow over the left half,
	// a right-pointing one over the right. The stylesheet shows it on the background only.
	document.addEventListener('mousemove', (event) => {
		const root = document.documentElement.classList;
		root.toggle('wallpaper-back', back(event));
		root.toggle('wallpaper-forward', !back(event));
	});

	// The background only: the body and the page around it, never the window or anything
	// floating over it.
	document.addEventListener('click', (event) => {
		if (event.target !== document.body && event.target !== document.documentElement) return;
		const step = back(event) ? -1 : 1;
		show(tiles[(tiles.indexOf(current) + step + tiles.length) % tiles.length]);
	});
}
