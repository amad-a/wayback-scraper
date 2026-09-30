// Patterned borders drawn as SVG and applied with CSS border-image.
//
// Each pattern is a 40x40 tile sliced at 10: four 10x10 corners and four 20x10
// edge cells, which the browser repeats along each side (`round` fits a whole
// number of repeats). A motif is drawn once, for the top edge, in a 20x10 cell
// whose y = 0 is the outside; the other edges are the same drawing flipped or
// rotated, so every side faces outward and the repeats join end to end.

const SLICE = 10;

// Motif and corner markup; `c` is the colour. Strokes stay within their cell.
const PATTERNS = {
  diamonds: {
    edge: (c) =>
      `<polygon fill="${c}" points="5,1 9,5 5,9 1,5"/><polygon fill="${c}" points="15,1 19,5 15,9 11,5"/>`,
    corner: (c) => `<polygon fill="${c}" points="5,0.5 9.5,5 5,9.5 0.5,5"/>`,
  },
  zigzag: {
    edge: (c) =>
      `<polyline fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="miter" points="0,8 5,2 10,8 15,2 20,8"/>`,
    corner: (c) => `<rect fill="${c}" x="1.5" y="1.5" width="7" height="7"/>`,
  },
  squiggle: {
    edge: (c) =>
      `<path fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" d="M0,5 C2.5,0 7.5,0 10,5 S17.5,10 20,5"/>`,
    corner: (c) => `<circle fill="${c}" cx="5" cy="5" r="3.5"/>`,
  },
  scallops: {
    edge: (c) => `<path fill="${c}" d="M0,10 L0,9 A5,5 0 0 1 10,9 A5,5 0 0 1 20,9 L20,10 Z"/>`,
    corner: (c) => `<circle fill="${c}" cx="5" cy="5" r="4.5"/>`,
  },
  checker: {
    edge: (c) =>
      `<g fill="${c}"><rect x="0" y="0" width="5" height="5"/><rect x="10" y="0" width="5" height="5"/>` +
      `<rect x="5" y="5" width="5" height="5"/><rect x="15" y="5" width="5" height="5"/></g>`,
    corner: (c) => `<g fill="${c}"><rect x="0" y="0" width="5" height="5"/><rect x="5" y="5" width="5" height="5"/></g>`,
  },
  stitches: {
    edge: (c) =>
      `<path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" ` +
      `d="M2.5,2.5 L7.5,7.5 M7.5,2.5 L2.5,7.5 M12.5,2.5 L17.5,7.5 M17.5,2.5 L12.5,7.5"/>`,
    corner: (c) =>
      `<path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M2.5,2.5 L7.5,7.5 M7.5,2.5 L2.5,7.5"/>`,
  },
  sawtooth: {
    edge: (c) => `<polygon fill="${c}" points="0,0 10,0 5,9"/><polygon fill="${c}" points="10,0 20,0 15,9"/>`,
    corner: (c) => `<rect fill="${c}" x="0" y="0" width="10" height="10"/>`,
  },
};

export const PATTERN_NAMES = Object.keys(PATTERNS);

// Places the top-edge drawing on all four sides and the corner in all four corners.
const EDGES = [
  'translate(10,0)', // top
  'translate(10,40) scale(1,-1)', // bottom, flipped to face down
  'translate(0,30) rotate(-90)', // left
  'translate(40,10) rotate(90)', // right
];
const CORNERS = ['translate(0,0)', 'translate(30,0)', 'translate(0,30)', 'translate(30,30)'];

const cache = new Map();

// CSS border-image value for a pattern in a colour.
export function patternBorderImage(name, color) {
  const key = `${name}|${color}`;
  if (!cache.has(key)) {
    const { edge, corner } = PATTERNS[name];
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
      EDGES.map((t) => `<g transform="${t}">${edge(color)}</g>`).join('') +
      CORNERS.map((t) => `<g transform="${t}">${corner(color)}</g>`).join('') +
      '</svg>';
    cache.set(key, `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${SLICE} round`);
  }
  return cache.get(key);
}
