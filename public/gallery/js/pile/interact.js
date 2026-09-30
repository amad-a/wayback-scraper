// This visitor's hands on the pile: grab a card, drag it, let go or fling it, or
// click it to take it into the chest.
//
// While dragged, a card is pinned at the grab point and swings so its centre trails
// the pointer (a towed-trailer model: paper pulled across a table by a corner).
// On release its recent peak velocity and spin become a throw, which the room and
// every other visitor evaluate with the same flight formula.
import { POSE_BOUNDS, clampLaunch, flight, isOffTable } from '../shared/physics.js';

const TAP_SLOP_PX = 6;
const MOVE_INTERVAL_MS = 50;
// Release velocity: the fastest motion over any SPAN_MS stretch in the last
// PEAK_WINDOW_MS, scaled down by how long ago it was (halving about every 50ms).
// Averaging instead lets a hand that eases off just before letting go turn a
// flick into a nudge; a deliberate stop before release still throws nothing.
const PEAK_WINDOW_MS = 100;
const SPAN_MS = 25;
const RELEASE_DECAY_MS = 75;
// How strongly a dragged card turns to trail the pointer (1 = pure towing).
const TOW = 0.5;
// World units squared; stops cards grabbed near their centre from spinning wildly.
const TOW_SOFTEN = 400;
const MAX_TURN_PER_FRAME_DEG = 30;

export function initInteract({ room, stage, viewport, pile }) {
  let drag = null;

  viewport.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0) return;
    const el = e.target.closest('.kjg-card');
    const entry = el && pile.get(el.dataset.id);
    if (!entry || (entry.card.heldBy && entry.card.heldBy !== pile.me())) return;
    e.preventDefault();

    const pin = stage.toWorld(e.clientX, e.clientY);
    const now = performance.now();
    drag = {
      entry,
      pointerId: e.pointerId,
      // The card centre relative to the grab point, in the card's own frame.
      offset: rotate(entry.x - pin.x, entry.y - pin.y, -entry.rot),
      pin,
      prevPin: pin,
      prevTime: now,
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
      samples: [{ t: now, x: entry.x, y: entry.y, rot: entry.rot }],
      lastSent: 0,
      prevZ: entry.card.z,
    };

    // Optimistic: lift the card now; the room's reply either confirms or denies.
    room.send({ t: 'grab', id: entry.card.id });
    entry.local = true;
    entry.flight = null;
    entry.remote = null;
    entry.card.z = pile.topZ() + 1;
    entry.el.classList.add('is-dragging');
    pile.restack();
    // Keeps moves coming when the pointer leaves the card. It throws for pointers
    // the browser is not tracking (synthetic events), which must not stop the drag.
    try {
      entry.el.setPointerCapture(e.pointerId);
    } catch {}
  });

  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag?.pointerId) return;
    drag.pin = stage.toWorld(e.clientX, e.clientY);
    if (!drag.moved && Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) > TAP_SLOP_PX) {
      drag.moved = true;
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (e.pointerId === drag?.pointerId) release({ fling: true });
  });
  viewport.addEventListener('pointercancel', (e) => {
    if (e.pointerId === drag?.pointerId) release({ fling: false });
  });
  // The pointer can vanish without a pointerup (window switch, OS gesture, the
  // element losing capture); put the card down where it is rather than leave it
  // stuck to a pointer that will never come back.
  viewport.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === drag?.pointerId) release({ fling: false });
  });
  addEventListener('blur', () => drag && release({ fling: false }));

  // Someone else got there first; their moves will carry the card from here.
  room.on('grab:deny', ({ id }) => {
    if (drag?.entry.card.id !== id) return;
    drag.entry.card.z = drag.prevZ;
    cancel();
  });
  room.on('close', () => drag && cancel());
  // The room handed the card to someone else (we held it idle too long).
  room.on('grab', ({ id, by }) => {
    if (drag?.entry.card.id === id && by !== pile.me()) cancel();
  });

  function step(now) {
    const { entry, pin, prevPin } = drag;
    if (pile.get(entry.card.id) !== entry) return cancel(); // taken off the pile meanwhile

    const dt = Math.max(0.001, (now - drag.prevTime) / 1000);
    const vx = (pin.x - prevPin.x) / dt;
    const vy = (pin.y - prevPin.y) / dt;

    const r = rotate(drag.offset.x, drag.offset.y, entry.rot);
    const omega = (TOW * (r.y * vx - r.x * vy)) / (r.x * r.x + r.y * r.y + TOW_SOFTEN);
    const turn = clamp((omega * dt * 180) / Math.PI, -MAX_TURN_PER_FRAME_DEG, MAX_TURN_PER_FRAME_DEG);
    entry.rot += turn;

    const c = rotate(drag.offset.x, drag.offset.y, entry.rot);
    entry.x = clamp(pin.x + c.x, POSE_BOUNDS.minX, POSE_BOUNDS.maxX);
    entry.y = clamp(pin.y + c.y, POSE_BOUNDS.minY, POSE_BOUNDS.maxY);
    pile.render(entry);

    drag.prevPin = pin;
    drag.prevTime = now;
    drag.samples.push({ t: now, x: entry.x, y: entry.y, rot: entry.rot });
    while (drag.samples.length > 2 && now - drag.samples[0].t > PEAK_WINDOW_MS + SPAN_MS) drag.samples.shift();

    if (drag.moved && now - drag.lastSent >= MOVE_INTERVAL_MS) {
      drag.lastSent = now;
      room.send({ t: 'move', id: entry.card.id, x: entry.x, y: entry.y, rot: entry.rot });
    }
  }

  function release({ fling }) {
    // Apply the latest pointer position first: a quick flick can go down, move and
    // up between two animation frames.
    step(performance.now());
    if (!drag) return;
    const { entry, samples, moved } = drag;

    // A click takes the card. It stays held here until the room's pile:remove
    // arrives, which sends it into the chest.
    if (!moved && fling) {
      room.send({ t: 'take', id: entry.card.id });
      entry.el.classList.remove('is-dragging');
      drag = null;
      return;
    }

    const { vx, vy, va } = fling && moved ? releaseVelocity(samples, performance.now()) : { vx: 0, vy: 0, va: 0 };
    const start = clampLaunch({ x: entry.x, y: entry.y, rot: entry.rot, vx, vy, va });
    const off = isOffTable(flight(start).end);
    room.send({ t: 'throw', id: entry.card.id, ...start });
    entry.el.classList.remove('is-dragging');
    pile.launch(entry, start, off);
    drag = null;
  }

  function cancel() {
    const { entry, pointerId } = drag;
    entry.local = false;
    entry.el.classList.remove('is-dragging');
    if (entry.el.hasPointerCapture(pointerId)) entry.el.releasePointerCapture(pointerId);
    drag = null;
    pile.restack();
  }

  (function frame(now) {
    if (drag) step(now);
    requestAnimationFrame(frame);
  })(performance.now());
}

// See PEAK_WINDOW_MS. Each span runs from a sample back to the latest one at least
// SPAN_MS earlier, which smooths over single-frame jitter.
function releaseVelocity(samples, now) {
  let best = null;
  let from = 0;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i];
    while (from + 1 < i && b.t - samples[from + 1].t >= SPAN_MS) from++;
    const a = samples[from];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || now - b.t > PEAK_WINDOW_MS) continue;
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (!best || speed > best.speed) best = { vx, vy, va: (b.rot - a.rot) / dt, speed, t: b.t };
  }
  if (!best) return { vx: 0, vy: 0, va: 0 };
  const keep = Math.exp(-(now - best.t) / RELEASE_DECAY_MS);
  return { vx: best.vx * keep, vy: best.vy * keep, va: best.va * keep };
}

function rotate(x, y, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
