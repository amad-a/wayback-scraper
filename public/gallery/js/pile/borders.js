// A vivid border for each card, derived from its id: random-looking, but the same
// for every visitor and across reloads, with nothing extra to store or sync.
import { PATTERN_NAMES, patternBorderImage } from './border-patterns.js';

// Bright, saturated colours that hold up against the yellow table. Yellows and
// yellow-greens are left out on purpose: they disappear into the background.
const COLORS = [
  '#FF1F5A', // hot red-pink
  '#FF2EC4', // magenta
  '#B026FF', // violet
  '#5B2CFF', // ultramarine
  '#1F5BFF', // electric blue
  '#00A8FF', // sky
  '#00D4C8', // turquoise
  '#00C853', // emerald
  '#FF6A00', // orange
  '#FF3D00', // vermilion
  '#E4002B', // red
  '#000000', // one house black, so the pile keeps a little of the archive's line
];

// Each style gets the width range it reads best at, in world units: ridges and
// double lines need body, dots and dashes get heavy fast, and drawn patterns
// (border-patterns.js) need the most room for their motif to read.
const STYLES = [
  { style: 'solid', width: [3, 7] },
  { style: 'dashed', width: [3, 5] },
  { style: 'dotted', width: [4, 6] },
  { style: 'double', width: [6, 10] },
  { style: 'groove', width: [6, 10] },
  { style: 'ridge', width: [6, 10] },
  { style: 'inset', width: [5, 8] },
  { style: 'outset', width: [5, 8] },
  ...PATTERN_NAMES.map((pattern) => ({ pattern, width: [9, 14] })),
];

// { width, style, color, image }: image is a CSS border-image value for drawn
// patterns (style is then 'solid' and only reserves the space), otherwise null.
export function borderFor(id) {
  const random = mulberry32(hash(id));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const { style = 'solid', pattern, width } = pick(STYLES);
  const color = pick(COLORS);
  return {
    style,
    color,
    width: Math.round(width[0] + random() * (width[1] - width[0])),
    image: pattern ? patternBorderImage(pattern, color) : null,
  };
}

// FNV-1a: string -> 32-bit seed.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Small seeded PRNG, uniform in [0, 1).
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
