// The desktop wallpaper: one of the tiles in /assets/tiles, repeated behind the window.
//
// Clicking the background steps through the tiles in name order, wrapping round at either
// end: the right half of the screen moves forward one, the left half back one. The tile
// showing is remembered, so the next visit opens on it; a first visit, or one whose
// remembered tile has since been removed, gets a random one. The stylesheet's own tile
// stays as the fallback for when none of this runs.
//
// The first tile is put up by the inline script at the top of index.html, before the
// first paint, from the list the server writes into the page. This takes over from there.

const TILES_URL = '/assets/tiles/';
const WALLPAPER_KEY = 'palestine-online:wallpaper';

let tiles = [];
let current = '';

function show(name) {
	current = name;
	document.documentElement.style.setProperty('--wallpaper', `url('${TILES_URL}${encodeURIComponent(name)}')`);
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

export function initWallpaper() {
	try {
		tiles = JSON.parse(document.getElementById('wallpaper-tiles')?.textContent || '[]');
	} catch {
		tiles = [];
	}
	if (!tiles.length) return;

	// Remembered here rather than by the inline script, so a first visit's random pick
	// is the one the next visit opens on.
	const chosen = document.documentElement.dataset.wallpaper;
	show(tiles.includes(chosen) ? chosen : tiles[0]);

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
