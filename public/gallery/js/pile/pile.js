// Draws the shared pile from room messages. The room decides what is on the pile
// and where; this module mirrors it into the DOM and animates the motion between
// room updates: other visitors' drags play back through a smoothing buffer, throws
// follow the shared flight formula.
import { r2Url } from '../media.js';
import { borderFor } from './borders.js';
import { createTrack, DELAY_MS } from '../net/track.js';
import { flight } from '../shared/physics.js';
import { WORLD } from '../shared/protocol.js';

const FADE_MS = 300;
// Tossing a taken card into the Chest tab (see flyAway).
const TAKE_MS = 420;
// Closest the arc may come to the top of the page, in px.
const ARC_MARGIN = 6;
// Share of the flight spent rising; the rest is the drop into the tab.
const APEX_AT = 0.62;
// How much the card swells toward the viewer mid-flight (0.35 peaks at ~1.2x).
const SWELL = 0.35;

// onTaken(card) is called for each card this visitor takes off the pile, and may
// return a page (client) point for it to fly to: the Chest tab. The flight runs in
// fxLayer, an overlay above the whole page, because the table clips at its edges.
export function initPile({ room, layer, stage, fxLayer, onTaken }) {
  // id -> entry. An entry is { card, el, x, y, rot } plus its motion: local (this
  // visitor is dragging it), remote (a playback track of another visitor's drag),
  // and/or flight (a throw; it may start in the future, see launch()).
  const entries = new Map();
  // Thrown off the table: gone from the room already, still animating here.
  const leaving = new Set();
  let me = null;

  function render(entry) {
    const { el, card, x, y, rot } = entry;
    el.style.transform = `translate(${x - card.w / 2}px, ${y - card.h / 2}px) rotate(${rot}deg)`;
  }

  function add(card, { fadeIn }) {
    const el = document.createElement('div');
    el.className = 'kjg-card';
    el.dataset.id = card.id;
    el.dataset.kind = card.kind;
    el.style.width = `${card.w}px`;
    el.style.height = `${card.h}px`;
    const border = borderFor(card.id);
    el.style.border = `${border.width}px ${border.style} ${border.color}`;
    if (border.image) el.style.borderImage = border.image;

    const img = document.createElement('img');
    img.src = r2Url(card.src);
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.addEventListener('load', () => el.classList.add('is-loaded'), { once: true });
    el.append(img);

    const entry = { card, el, x: card.x, y: card.y, rot: card.rot, local: false, remote: null, flight: null };
    render(entry);
    markHeld(entry);

    if (fadeIn) {
      el.classList.add('is-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-entering')));
    }
    layer.append(el);
    entries.set(card.id, entry);
    return entry;
  }

  function fadeOut(el) {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), FADE_MS);
  }

  // Tosses the card into `target` (client coords) like a basketball into a hoop.
  // It moves across at a steady speed while its height follows a ballistic arc:
  // rising fast, slowing to a peak just above the tab, then dropping into it.
  // There is little room above the tab (it sits at the top of the page), so depth
  // does the rest: the card swells as it rises toward the viewer, then shrinks to
  // nothing as it falls away into the chest.
  function flyAway(entry, target) {
    const { el, card } = entry;
    const origin = fxLayer.getBoundingClientRect();
    const from = stage.toScreen(entry.x, entry.y);
    const p0 = { x: from.x - origin.left, y: from.y - origin.top };
    const p1 = { x: target.x - origin.left, y: target.y - origin.top };
    const lift = Math.max(60, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.35);
    const peak = Math.min(Math.max(ARC_MARGIN, Math.min(p0.y, p1.y) - lift), p0.y, p1.y);
    const startScale = stage.scale();
    const startRot = entry.rot;

    el.classList.add('is-taken');
    el.style.zIndex = '';
    fxLayer.append(el);

    const t0 = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - t0) / TAKE_MS);
      const x = p0.x + (p1.x - p0.x) * t;
      // Two half-parabolas meeting at the peak with zero vertical speed: up to it
      // by APEX_AT, then down into the tab.
      const y =
        t < APEX_AT
          ? peak + (p0.y - peak) * ((APEX_AT - t) / APEX_AT) ** 2
          : peak + (p1.y - peak) * ((t - APEX_AT) / (1 - APEX_AT)) ** 2;
      const scale = startScale * (1 + SWELL * Math.sin(Math.PI * t)) * (1 - t ** 2.5);
      el.style.transform =
        `translate(${x - card.w / 2}px, ${y - card.h / 2}px) rotate(${startRot * (1 - t)}deg) scale(${scale})`;
      if (t < 1) requestAnimationFrame(step);
      else el.remove();
    })(t0);
  }

  function markHeld(entry) {
    entry.el.classList.toggle('is-held', Boolean(entry.card.heldBy));
    entry.el.classList.toggle('is-held-by-other', Boolean(entry.card.heldBy && entry.card.heldBy !== me));
  }

  // Room z values are unbounded (new cards go ever deeper), so stack by rank:
  // bottom card is 1, top card is the pile size. --depth (0 on top, 1 at the
  // bottom) drives how far each card's image is shaded.
  function restack() {
    const ordered = [...entries.values()].sort((a, b) => a.card.z - b.card.z);
    const last = Math.max(1, ordered.length - 1);
    ordered.forEach(({ el }, i) => {
      el.style.zIndex = i + 1;
      el.style.setProperty('--depth', (ordered.length - 1 - i) / last);
    });
    // Cards on their way off the table fly over everything.
    for (const { el } of leaving) el.style.zIndex = ordered.length + 1;
  }

  // Starts a throw. `off` means the card leaves the pile when it lands.
  // A card another visitor was dragging is shown DELAY_MS behind, so its flight
  // starts that much later, from the launch pose its playback track ends on.
  function launch(entry, start, off) {
    const path = flight(start);
    let t0 = performance.now();
    if (entry.remote) {
      entry.remote.push({ x: start.x, y: start.y, rot: start.rot });
      t0 += DELAY_MS;
    }
    entry.local = false;
    entry.flight = { t0, path, off };
    entry.card.heldBy = null;
    markHeld(entry);
    if (off) {
      entries.delete(entry.card.id);
      leaving.add(entry);
      entry.el.classList.add('is-gone');
    } else {
      Object.assign(entry.card, path.end);
    }
    restack();
  }

  room.on('welcome', ({ id, pile }) => {
    me = id;
    for (const { el } of entries.values()) el.remove();
    entries.clear();
    for (const card of pile) add(card, { fadeIn: false });
    restack();
  });
  room.on('pile:add', ({ cards: added }) => {
    for (const card of added) add(card, { fadeIn: true });
    restack();
  });
  room.on('pile:remove', ({ ids, by }) => {
    for (const id of ids) {
      const entry = entries.get(id);
      if (!entry) continue;
      entries.delete(id);
      const target = by === me ? onTaken?.(entry.card) : null;
      if (target) flyAway(entry, target);
      else fadeOut(entry.el);
    }
    restack();
  });
  room.on('grab', ({ id, by, z }) => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.card.z = z;
    entry.card.heldBy = by;
    if (by !== me) {
      entry.flight = null;
      entry.remote = null;
      entry.local = false;
    }
    markHeld(entry);
    restack();
  });
  room.on('move', ({ id, x, y, rot }) => {
    const entry = entries.get(id);
    if (!entry || entry.local) return;
    entry.flight = null;
    entry.remote ??= createTrack({ x: entry.x, y: entry.y, rot: entry.rot });
    entry.remote.push({ x, y, rot });
  });
  room.on('throw', ({ id, x, y, rot, vx, vy, va, off }) => {
    const entry = entries.get(id);
    if (!entry) return;
    launch(entry, { x, y, rot, vx, vy, va }, off);
  });
  room.on('release', ({ id }) => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.card.heldBy = null;
    markHeld(entry);
  });

  (function frame(now) {
    for (const entry of [...entries.values(), ...leaving]) {
      if (entry.flight && now >= entry.flight.t0) {
        const { t0, path, off } = entry.flight;
        const t = (now - t0) / 1000;
        entry.remote = null;
        // Finish exactly on the resting pose the room stored, not the last sample.
        Object.assign(entry, t >= path.duration ? path.end : path.at(t));
        if (t >= path.duration || (off && beyondTable(entry))) {
          entry.flight = null;
          if (off) {
            leaving.delete(entry);
            fadeOut(entry.el);
          }
        }
        render(entry);
      } else if (entry.remote) {
        Object.assign(entry, entry.remote.sample(now));
        render(entry);
      }
    }
    requestAnimationFrame(frame);
  })(performance.now());

  // True once no corner of the card can still be over the table.
  function beyondTable({ x, y, card }) {
    const r = Math.hypot(card.w, card.h) / 2;
    return x < -r || y < -r || x > WORLD.width + r || y > WORLD.height + r;
  }

  return {
    get: (id) => entries.get(id),
    me: () => me,
    render,
    launch,
    restack,
    markHeld,
    topZ: () => Math.max(0, ...[...entries.values()].map((e) => e.card.z)),
  };
}
