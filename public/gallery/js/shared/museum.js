// Museum wall rules, shared by the browser and the Worker (worker/ imports this
// file) so both agree on the grid, what a valid hanging is, and what "today" is.
//
// The wall is a row of day sections, oldest on the left. Each section is a grid
// ROWS cells tall that grows to the right; items occupy whole cells, so random
// sizes still line up. Only today's section (UTC) accepts new hangings.

export const MUSEUM_PATH = '/museum/ws';

export const ROWS = 24;
// Each side of a hanging spans MIN_SPAN..MAX_SPAN cells; the minimum keeps items
// from becoming slivers.
export const MIN_SPAN = 2;
export const MAX_SPAN = 10;
// Random sizes are drawn by area, in cells, so portrait and landscape images get
// the same visual weight (a tall 6x10 matches a wide 10x6) rather than landscape
// ones hogging the width.
const AREAS = [16, 88];
// Today's section keeps at least this much empty wall past its rightmost item, and
// is never narrower than MIN_OPEN_COLS, so there is always room to hang.
export const FREE_COLS = 32;
export const MIN_OPEN_COLS = 64;
// Hard ceiling on a section's width, so a bad request cannot stretch the wall.
export const MAX_COLS = 8000;

export function isValidSize(w, h) {
  return [w, h].every((n) => Number.isInteger(n) && n >= MIN_SPAN && n <= MAX_SPAN);
}

// A random size for an image of the given aspect ratio (width / height): a random
// area, shaped like the image and rounded to whole cells within the span limits.
export function randomSize(aspect, random = Math.random) {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const area = AREAS[0] + random() * (AREAS[1] - AREAS[0]);
  const span = (n) => Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.round(n)));
  return { w: span(Math.sqrt(area * safe)), h: span(Math.sqrt(area / safe)) };
}

// Width in columns of a section holding `items`.
export function sectionCols(items, { open }) {
  const used = items.reduce((max, { col, w }) => Math.max(max, col + w), 0);
  return open ? Math.min(MAX_COLS, Math.max(MIN_OPEN_COLS, used + FREE_COLS)) : Math.max(1, used);
}

export function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

// Whether `spot` ({ col, row, w, h }) can hang in an open section holding `items`.
export function canHang(items, spot) {
  const { col, row, w, h } = spot;
  if (!isValidSize(w, h) || !Number.isInteger(col) || !Number.isInteger(row)) return false;
  if (col < 0 || row < 0 || row + h > ROWS) return false;
  if (col + w > sectionCols(items, { open: true })) return false;
  return !items.some((item) => overlaps(item, spot));
}

// 'YYYY-MM-DD' for the UTC day containing `date`.
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// '28 Sep 2026' for a 'YYYY-MM-DD' day, the same for every visitor.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(day) {
  const [year, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}
