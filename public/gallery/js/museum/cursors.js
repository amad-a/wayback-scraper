// Other visitors' cursors in the museum.
//
// Everyone's wall is a different size (cells follow the window height) and
// scrolled to a different place, so cursors travel in wall coordinates: the day
// section under the pointer and a fractional column and row within its grid. Each
// viewer maps them back to their own pixels. A visitor placing an item carries a
// small faded preview of it at the bottom-left of their cursor. Visitors scrolled
// out of view show as markers at the left or right edge; click one to go there.
import { CURSOR_INTERVAL_MS } from '../shared/protocol.js';
import { ROWS } from '../shared/museum.js';
import { createTrack } from '../net/track.js';
import { r2Url } from '../media.js';
import { borderFor } from '../pile/borders.js';

// Preview frames are drawn thinner than the real ones, to suit the small thumbnail.
const PREVIEW_BORDER_SCALE = 0.5;

export function initMuseumCursors({ room, view, scroller, gridFor, cellSize, placingPreview, onCountChange }) {
  const layer = document.createElement('div');
  layer.className = 'kjg-museum-cursors';
  view.append(layer);

  const remote = new Map(); // id -> { id, el, preview, marker, track, day, placing }

  // --- outgoing

  let pointer = null; // last client position over the wall, for re-sending on scroll
  let pending = null;
  let lastSent = 0;
  let timer = null;

  function wallPosition(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    const wing = target?.closest?.('.kjg-wing');
    if (!wing) return null;
    const rect = wing.querySelector('.kjg-wing-grid').getBoundingClientRect();
    const cell = cellSize();
    const x = (clientX - rect.left) / cell;
    const y = (clientY - rect.top) / cell;
    if (x < 0 || y < 0 || x * cell > rect.width || y > ROWS) return null;
    return { day: wing.dataset.day, x, y };
  }

  function update() {
    const pos = pointer && wallPosition(pointer.x, pointer.y);
    const preview = placingPreview();
    queue(pos ? { ...pos, placing: preview } : { day: null });
  }

  function queue(msg) {
    pending = msg;
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, CURSOR_INTERVAL_MS - (performance.now() - lastSent)));
  }

  function flush() {
    timer = null;
    lastSent = performance.now();
    room.send({ t: 'cursor', ...pending });
  }

  scroller.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    update();
  });
  scroller.addEventListener('pointerleave', () => {
    pointer = null;
    update();
  });
  // Scrolling moves the wall under a still pointer.
  scroller.addEventListener('scroll', () => pointer && update(), { passive: true });

  // --- incoming

  function add(id) {
    const el = document.createElement('div');
    el.className = 'kjg-cursor kjg-museum-cursor';
    el.hidden = true;
    el.innerHTML =
      '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">' +
      '<path d="M1 1v16l4.5-4.5 3 6.5 2.5-1.2-3-6.3H14z"/></svg>';
    const label = document.createElement('span');
    label.textContent = id.slice(0, 4);
    const preview = document.createElement('div');
    preview.className = 'kjg-cursor-preview';
    preview.hidden = true;
    preview.append(document.createElement('img'));
    el.append(label, preview);

    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'kjg-cursor-marker';
    marker.hidden = true;

    layer.append(el, marker);
    const cursor = { id, el, preview, marker, track: null, day: null, placing: null };
    marker.addEventListener('click', () => goTo(cursor));
    remote.set(id, cursor);
    onCountChange?.(remote.size);
    return cursor;
  }

  function remove(id) {
    const cursor = remote.get(id);
    if (!cursor) return;
    cursor.el.remove();
    cursor.marker.remove();
    remote.delete(id);
    onCountChange?.(remote.size);
  }

  function move(id, { day, x, y, placing }) {
    const cursor = remote.get(id) ?? add(id);
    if (!day) {
      cursor.day = null;
      return;
    }
    // A different section is a different coordinate space: snap, don't glide.
    if (cursor.day === day) cursor.track.push({ x, y });
    else cursor.track = createTrack({ x, y });
    cursor.day = day;
    setPlacing(cursor, placing ?? null);
  }

  function setPlacing(cursor, placing) {
    if (placing?.src === cursor.placing?.src && placing?.card === cursor.placing?.card) return;
    cursor.placing = placing;
    cursor.preview.hidden = !placing;
    if (!placing) return;
    const border = borderFor(placing.card);
    const width = Math.max(1, Math.round(border.width * PREVIEW_BORDER_SCALE));
    cursor.preview.style.border = `${width}px ${border.style} ${border.color}`;
    cursor.preview.style.borderImage = border.image ?? '';
    cursor.preview.dataset.kind = placing.kind;
    cursor.preview.querySelector('img').src = r2Url(placing.src);
  }

  // Scrolls the wall so a visitor's cursor is in the middle of the screen.
  function goTo(cursor) {
    const grid = cursor.day && gridFor(cursor.day);
    const pos = grid && cursor.track?.sample();
    if (!pos) return;
    const rect = grid.getBoundingClientRect();
    const target = rect.left + pos.x * cellSize();
    const box = scroller.getBoundingClientRect();
    scroller.scrollBy({ left: target - (box.left + box.width / 2), behavior: 'smooth' });
  }

  function clear() {
    for (const id of [...remote.keys()]) remove(id);
  }

  room.on('welcome', ({ peers }) => {
    clear();
    for (const peer of peers) move(peer.id, peer);
  });
  room.on('join', ({ id }) => remote.has(id) || add(id));
  room.on('leave', ({ id }) => remove(id));
  room.on('cursor', (msg) => move(msg.id, msg));
  room.on('close', clear);

  // --- drawing

  (function frame(now) {
    // Scheduled first, so an error drawing one cursor can't stop the loop for all.
    requestAnimationFrame(frame);
    const box = view.getBoundingClientRect();
    const wallBox = scroller.getBoundingClientRect();
    for (const cursor of remote.values()) {
      const grid = cursor.day && gridFor(cursor.day);
      const pos = grid && cursor.track?.sample(now);
      if (!pos || !box.width) {
        cursor.el.hidden = true;
        // A day that isn't loaded is older than anything shown: it's to the left.
        const offWall = cursor.day && !grid;
        cursor.marker.hidden = !offWall;
        if (offWall) placeMarker(cursor, 'left', wallBox.top + wallBox.height / 2 - box.top);
        continue;
      }
      const rect = grid.getBoundingClientRect();
      const cell = cellSize();
      const x = rect.left + pos.x * cell - box.left;
      const y = rect.top + pos.y * cell - box.top;
      const side = x < wallBox.left - box.left ? 'left' : x > wallBox.right - box.left ? 'right' : null;
      cursor.el.hidden = Boolean(side);
      cursor.marker.hidden = !side;
      if (side) placeMarker(cursor, side, y);
      else cursor.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  })(performance.now());

  function placeMarker(cursor, side, y) {
    const { marker } = cursor;
    const id = cursor.id.slice(0, 4);
    marker.dataset.side = side;
    marker.textContent = side === 'left' ? `← ${id}` : `${id} →`;
    marker.setAttribute('aria-label', `Go to visitor ${id}`);
    const clamped = Math.max(40, Math.min(view.clientHeight - 30, y));
    marker.style.top = `${clamped}px`;
  }

  return { update, count: () => remote.size };
}
