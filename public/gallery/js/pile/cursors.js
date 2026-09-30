// Shares this visitor's cursor with the room and draws everyone else's.
import { CURSOR_INTERVAL_MS } from '../shared/protocol.js';
import { createTrack } from '../net/track.js';

export function initCursors({ room, stage, viewport, layer, onCountChange }) {
  const remote = new Map(); // id -> { el, track, visible }

  // --- outgoing: throttled to CURSOR_INTERVAL_MS, always sending the latest position
  let pending = null;
  let lastSent = 0;
  let timer = null;

  function queue(pos) {
    pending = pos;
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, CURSOR_INTERVAL_MS - (performance.now() - lastSent)));
  }

  function flush() {
    timer = null;
    lastSent = performance.now();
    room.send({ t: 'cursor', ...pending });
  }

  viewport.addEventListener('pointermove', (e) => {
    const pos = stage.toWorld(e.clientX, e.clientY);
    queue(stage.contains(pos) ? pos : { x: null, y: null });
  });
  viewport.addEventListener('pointerleave', () => queue({ x: null, y: null }));

  // --- incoming
  function add(id) {
    const el = document.createElement('div');
    el.className = 'kjg-cursor';
    el.hidden = true;
    el.innerHTML =
      '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">' +
      '<path d="M1 1v16l4.5-4.5 3 6.5 2.5-1.2-3-6.3H14z"/></svg>';
    const label = document.createElement('span');
    label.textContent = id.slice(0, 4);
    el.append(label);
    layer.append(el);
    const cursor = { el, track: null, visible: false };
    remote.set(id, cursor);
    onCountChange?.(remote.size);
    return cursor;
  }

  function remove(id) {
    remote.get(id)?.el.remove();
    remote.delete(id);
    onCountChange?.(remote.size);
  }

  function move(id, x, y) {
    const cursor = remote.get(id) ?? add(id);
    if (x === null) {
      cursor.visible = false;
      cursor.el.hidden = true;
      return;
    }
    // Snap rather than glide in from wherever the cursor was last seen.
    if (cursor.visible) cursor.track.push({ x, y });
    else cursor.track = createTrack({ x, y });
    cursor.visible = true;
    cursor.el.hidden = false;
  }

  function clear() {
    for (const id of [...remote.keys()]) remove(id);
  }

  room.on('welcome', ({ peers }) => {
    clear();
    for (const { id, x, y } of peers) {
      add(id);
      move(id, x, y);
    }
  });
  room.on('join', ({ id }) => remote.has(id) || add(id));
  room.on('leave', ({ id }) => remove(id));
  room.on('cursor', ({ id, x, y }) => move(id, x, y));
  room.on('close', clear);

  (function frame(now) {
    for (const c of remote.values()) {
      if (!c.visible) continue;
      const { x, y } = c.track.sample(now);
      c.el.style.transform = `translate(${x}px, ${y}px) scale(var(--inv-scale, 1))`;
    }
    requestAnimationFrame(frame);
  })(performance.now());
}
