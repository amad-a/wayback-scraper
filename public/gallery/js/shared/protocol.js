// Shared between the browser and the Worker (worker/ imports this file), so both
// sides agree on the room's coordinate space and message limits.

// The pile lives in a fixed world, scaled to fit each viewer's screen, so every
// visitor sees the same arrangement regardless of window size.
export const WORLD = Object.freeze({ width: 1600, height: 1000 });

export const ROOM_PATH = '/pile/ws';

export const PILE_SIZE = 30;

export const CURSOR_INTERVAL_MS = 50;
export const MAX_MESSAGE_BYTES = 1024;
export const PING_INTERVAL_MS = 25_000;
