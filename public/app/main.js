// Wiring only. Every listener the original page registered is here and live;
// each one calls straight into api.js, where the bodies are still empty.
// Add behaviour there, not here.
import {
  addFavorite,
  addressBar,
  hideBookmarksPanel,
  hideHistoryPanel,
  historyNav,
  iframe,
  onAddressInput,
  openRandomPage,
  openWaybackSource,
  printIframe,
  sharePage,
  toggleAddressDropdown,
  toggleFavorites,
  toggleHistory,
  watchFrame,
} from './api.js';

// Tracks the frame: title bar, address bar, and the injected scrollbars.
watchFrame();

addressBar.addEventListener('input', (e) =>
  onAddressInput(e.target.value.trim()),
);

document
  .getElementById('address-dropdown-button')
  .addEventListener('click', () => toggleAddressDropdown());

document
  .getElementById('source')
  .addEventListener('click', () => openWaybackSource());

document
  .getElementById('favorites')
  .addEventListener('click', () => toggleFavorites());

document
  .getElementById('random')
  .addEventListener('click', () => openRandomPage());

document
  .getElementById('share')
  .addEventListener('click', () => sharePage());

document
  .getElementById('history')
  .addEventListener('click', () => toggleHistory());

document
  .getElementById('favorites-exit')
  .addEventListener('click', () => hideBookmarksPanel());

document
  .getElementById('history-exit')
  .addEventListener('click', () => hideHistoryPanel());

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
  .querySelector('.print-button')
  .addEventListener('click', () => printIframe());
