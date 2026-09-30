// Throw physics, shared by the browser and the room (worker/ imports this file).
//
// A thrown card slides with exponential friction, which has a closed form: every
// client and the room evaluate the same formula from the same launch values, so
// they agree on where the card goes and whether it leaves the table, with no
// frame-by-frame simulation to drift apart.
import { WORLD } from './protocol.js';

// Velocity decays as e^(-FRICTION * t); a card thrown at v travels v / FRICTION.
// At 1.7, a card in the middle of the table needs about 1400 units/s to leave it.
const FRICTION = 1.7;
const SPIN_FRICTION = 2.2;
// Below these the card is considered at rest.
const REST_SPEED = 6;
const REST_SPIN = 4;

export const MAX_SPEED = 6000; // world units / s
export const MAX_SPIN = 720; // deg / s

// A drag may carry a card's centre this far past the table edge.
export const POSE_BOUNDS = Object.freeze({
  minX: -WORLD.width / 2,
  maxX: WORLD.width * 1.5,
  minY: -WORLD.height / 2,
  maxY: WORLD.height * 1.5,
});

// Scales the release velocity down to MAX_SPEED (keeping its direction) and caps spin.
export function clampLaunch({ x, y, rot, vx, vy, va }) {
  const speed = Math.hypot(vx, vy);
  const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
  return { x, y, rot, vx: vx * scale, vy: vy * scale, va: Math.max(-MAX_SPIN, Math.min(MAX_SPIN, va)) };
}

// { duration (s), at(t) -> { x, y, rot }, end: { x, y, rot } } for a clamped launch.
export function flight({ x, y, rot, vx, vy, va }) {
  const speed = Math.hypot(vx, vy);
  const duration = Math.max(
    speed > REST_SPEED ? Math.log(speed / REST_SPEED) / FRICTION : 0,
    Math.abs(va) > REST_SPIN ? Math.log(Math.abs(va) / REST_SPIN) / SPIN_FRICTION : 0,
  );

  const at = (t) => {
    const travel = (1 - Math.exp(-FRICTION * t)) / FRICTION;
    const turn = (1 - Math.exp(-SPIN_FRICTION * t)) / SPIN_FRICTION;
    return { x: x + vx * travel, y: y + vy * travel, rot: rot + va * turn };
  };

  // The limit as t -> infinity, so the resting place does not depend on when a
  // client happens to stop animating.
  const end = { x: x + vx / FRICTION, y: y + vy / FRICTION, rot: rot + va / SPIN_FRICTION };

  return { duration, at, end };
}

// A card leaves the pile when it comes to rest with its centre off the table.
export function isOffTable({ x, y }) {
  return x < 0 || y < 0 || x > WORLD.width || y > WORLD.height;
}
