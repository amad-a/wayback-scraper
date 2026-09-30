// WebSocket connection to a shared room (the pile by default, or the museum), with
// reconnect and keepalive.
// Messages are JSON objects tagged by `t`; subscribe with room.on(t, fn).
// 'open' and 'close' are emitted for connection state.
import { ROOM_PATH, PING_INTERVAL_MS } from '../shared/protocol.js';
import { config } from '../config.js';

export function connectRoom(path = ROOM_PATH) {
  const handlers = new Map();
  const url = new URL(path, config.roomOrigin || location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  let ws;
  let attempt = 0;
  let pingTimer;

  function emit(type, msg) {
    for (const fn of handlers.get(type) ?? []) fn(msg);
  }

  function open() {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      attempt = 0;
      pingTimer = setInterval(() => ws.send('ping'), PING_INTERVAL_MS);
      emit('open');
    });
    ws.addEventListener('message', ({ data }) => {
      if (data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (typeof msg?.t === 'string') emit(msg.t, msg);
    });
    ws.addEventListener('close', () => {
      clearInterval(pingTimer);
      emit('close');
      // Jittered, so a room restart does not bring every visitor back at once.
      setTimeout(open, Math.min(500 * 2 ** attempt++, 15_000) * (0.5 + Math.random()));
    });
  }

  open();

  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
