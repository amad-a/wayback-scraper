// Smooth playback of motion that arrives over the network in steps.
//
// Snapshots are stamped when they arrive and drawn DELAY_MS in the past, always
// between two real samples, so a remote drag or cursor sent at 20 Hz moves at the
// display's frame rate instead of stepping or rubber-banding.
export const DELAY_MS = 100;
const MAX_SNAPSHOTS = 30;
// The starting position is stamped one typical network interval before now, so
// playback eases from it into the first real snapshot instead of jumping.
const SEED_LEAD_MS = 50;

export function createTrack(initial) {
  const snaps = [];

  function push(values, t = performance.now()) {
    snaps.push({ t, values });
    if (snaps.length > MAX_SNAPSHOTS) snaps.shift();
  }

  if (initial) push(initial, performance.now() - SEED_LEAD_MS);

  return {
    push,

    // Values at `now - DELAY_MS`: interpolated between the snapshots around that
    // moment, or held at the first/last one outside the buffered range.
    sample(now = performance.now()) {
      const at = now - DELAY_MS;
      while (snaps.length > 2 && snaps[1].t <= at) snaps.shift();
      const [a, b] = snaps;
      if (!a) return null;
      if (!b || at <= a.t) return a.values;
      if (at >= b.t) return b.values;
      const k = (at - a.t) / (b.t - a.t);
      const out = {};
      for (const key in a.values) out[key] = a.values[key] + (b.values[key] - a.values[key]) * k;
      return out;
    },
  };
}
