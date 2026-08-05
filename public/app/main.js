// Wiring only. Every listener the original page registered is here and live;
// each one calls straight into api.js, where the bodies are still empty.
// Add behaviour there, not here.
import {
  addressBar,
  addFavorite,
  hideBookmarksPanel,
  historyNav,
  iframe,
  onAddressInput,
  onFrameLoad,
  openWaybackSource,
  printIframe,
  refreshFrame,
  render,
  setFrame,
  toggleFavorites,
} from './api.js';

// Fires for the initial src too, so the chrome is populated on first paint.
iframe.addEventListener('load', () => onFrameLoad());

addressBar.addEventListener('input', (e) =>
  onAddressInput(e.target.value.trim()),
);

document
  .getElementById('source')
  .addEventListener('click', () => openWaybackSource());

document
  .getElementById('favorites')
  .addEventListener('click', () => toggleFavorites());

document
  .getElementById('favorites-exit')
  .addEventListener('click', () => hideBookmarksPanel());

document
  .getElementById('favorite-star')
  .addEventListener('click', () => addFavorite());

// Index [1] because #standard-buttons and #internet-buttons each carry a
// back/forward pair; only the internet set is visible.
document
  .querySelectorAll('.back-button')[1]
  .addEventListener('click', () => historyNav(window));

document
  .querySelectorAll('.forward-button')[1]
  .addEventListener('click', () => historyNav(window, 'forward'));

document
  .querySelector('.refresh-button')
  .addEventListener('click', () => refreshFrame());

document
  .querySelector('.print-button')
  .addEventListener('click', () => printIframe());

// render() builds dropdown rows with inline onclick="setFrame(...)", so this
// has to be reachable from global scope. Assigned explicitly rather than left
// to happen by accident -- drop this line once render() attaches its own
// listeners.
window.setFrame = setFrame;

// Initial paint. No-op until render() and a page source exist.
render([]);
