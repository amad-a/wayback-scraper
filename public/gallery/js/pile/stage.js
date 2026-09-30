// Fits the fixed-size world into the viewport (letterboxed, centred) and converts
// between world coordinates and the page (client) coordinates pointers use.
import { WORLD } from '../shared/protocol.js';

export function createStage(viewport, world) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  world.style.width = `${WORLD.width}px`;
  world.style.height = `${WORLD.height}px`;

  function fit() {
    const { width, height } = viewport.getBoundingClientRect();
    scale = Math.min(width / WORLD.width, height / WORLD.height);
    offsetX = (width - WORLD.width * scale) / 2;
    offsetY = (height - WORLD.height * scale) / 2;
    world.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    // Lets overlays (cursors, labels) cancel the scale and stay a constant size.
    world.style.setProperty('--inv-scale', 1 / scale);
  }

  new ResizeObserver(fit).observe(viewport);
  fit();

  return {
    toWorld(clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale,
      };
    },
    toScreen(x, y) {
      const rect = viewport.getBoundingClientRect();
      return { x: rect.left + offsetX + x * scale, y: rect.top + offsetY + y * scale };
    },
    scale: () => scale,
    contains({ x, y }) {
      return x >= 0 && y >= 0 && x <= WORLD.width && y <= WORLD.height;
    },
  };
}
