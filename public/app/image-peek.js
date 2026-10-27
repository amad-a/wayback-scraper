// Shows the image an archived link points to beside the cursor while hovering it.
//
// Pages of this era often list their photos as plain links -- palestine-net.com/media
// has 26 -- so seeing one meant opening it and coming back. Hovering a link to a .jpg,
// .gif or .png under /sites now shows it next to the cursor, until the cursor leaves,
// and turns the cursor into a magnifier.
//
// The preview lives in the shell, not in the archived page: a nav pane is too narrow to
// hold it, and nothing is added to markup the page's own scripts might walk. Mouse only,
// so a tap on a phone still just opens the image. Dead links (class "dead") are skipped,
// since their image was never saved.

const IMAGE_HREF = /^\/sites\/.+\.(jpe?g|gif|png|bmp)$/i;
const BOUND = '__palestineOnlineImagePeekBound';
const GAP = 16; // between the cursor and the preview
const MAX_SIDE = 320; // the preview's longest side, before the window limits it
const LINGER = 100; // ms the preview outlives the link, to reach the next one in a list

const iframe = document.getElementById('frame');

let peek = null; // the floating <div>, built on first use
let current = null; // { link, win, x, y } while hovering an image link
let lingering = 0; // the timer that hides the preview once the cursor has left a link

function build() {
	peek = document.createElement('div');
	peek.className = 'image-peek';
	peek.hidden = true;
	document.body.append(peek);
}

function imageLink(target) {
	const link = target?.closest?.('a[href]');
	if (!link || link.classList.contains('dead')) return null;
	try {
		const url = new URL(link.href);
		return url.origin === location.origin && IMAGE_HREF.test(url.pathname) ? link : null;
	} catch {
		return null;
	}
}

// The cursor in the shell's coordinates: a pane's clientX/Y plus the offset of every
// frame above it, out to #frame itself.
function shellPoint(win, x, y) {
	const root = iframe.contentWindow;
	while (win && win !== root) {
		const el = win.frameElement;
		if (!el) break;
		const rect = el.getBoundingClientRect();
		x += rect.left + el.clientLeft;
		y += rect.top + el.clientTop;
		win = win.parent;
	}
	const rect = iframe.getBoundingClientRect();
	return { x: x + rect.left, y: y + rect.top };
}

// Below right of the cursor, flipped to the other side wherever that would leave the
// frame, so a link near the right edge or the bottom still shows its image whole.
function place() {
	const img = peek.firstChild;
	if (!current || !img) return; // nothing loaded yet; show() calls back once it is

	const bounds = iframe.getBoundingClientRect();
	const scale = Math.min(
		1,
		MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight),
		(bounds.width - 2 * GAP) / img.naturalWidth,
		(bounds.height - 2 * GAP) / img.naturalHeight,
	);
	const width = Math.round(img.naturalWidth * scale);
	const height = Math.round(img.naturalHeight * scale);
	img.style.width = `${width}px`;
	img.style.height = `${height}px`;
	peek.hidden = false;

	const { x, y } = shellPoint(current.win, current.x, current.y);
	const box = peek.getBoundingClientRect();
	let left = x + GAP;
	if (left + box.width > bounds.right) left = x - GAP - box.width;
	let top = y + GAP;
	if (top + box.height > bounds.bottom) top = y - GAP - box.height;
	peek.style.left = `${Math.max(bounds.left, left)}px`;
	peek.style.top = `${Math.max(bounds.top, top)}px`;
}

// The new image is loaded and decoded off to the side and swapped in whole, image and
// size together. Until then whatever is showing stays up and keeps following the cursor:
// swapping the src in place would draw the old picture at the new spot, then jump to
// the new one's size once it arrived.
function show(link, win, event) {
	if (!peek) build();
	clearTimeout(lingering);
	current = { link, win, x: event.clientX, y: event.clientY };
	if (peek.firstChild?.src === link.href) {
		place();
		return;
	}

	const img = new Image();
	img.alt = '';
	img.src = link.href;
	img.decode().then(
		() => {
			if (current?.link !== link) return; // moved on while it loaded
			peek.replaceChildren(img);
			place();
		},
		// Never saved after all, or not an image: show nothing rather than a broken icon.
		() => {
			if (current?.link === link) hide();
		},
	);
}

function hide() {
	clearTimeout(lingering);
	current = null;
	if (peek) peek.hidden = true;
}

export function bindImagePeek(doc) {
	if (!doc || doc[BOUND]) return;
	doc[BOUND] = true;
	const win = doc.defaultView;

	doc.addEventListener('pointerover', (event) => {
		if (event.pointerType !== 'mouse') return;
		const link = imageLink(event.target);
		if (!link) return;
		if (link === current?.link) {
			clearTimeout(lingering); // back onto it before the preview went
			return;
		}
		// Set as it is first hovered, rather than by a stylesheet: which links count is
		// decided from the resolved URL, and a selector on href would miss relative ones.
		link.style.cursor = 'zoom-in';
		show(link, win, event);
	});
	doc.addEventListener('pointermove', (event) => {
		if (!current || current.link.ownerDocument !== doc) return;
		current.x = event.clientX;
		current.y = event.clientY;
		place();
	});
	doc.addEventListener('pointerout', (event) => {
		if (current && !current.link.contains(event.relatedTarget)) {
			clearTimeout(lingering);
			lingering = setTimeout(hide, LINGER);
		}
	});
	// Clicking opens the image itself, and scrolling moves the link out from under it.
	doc.addEventListener('pointerdown', hide, true);
	win?.addEventListener('scroll', hide, true);
	win?.addEventListener('pagehide', hide);
}
