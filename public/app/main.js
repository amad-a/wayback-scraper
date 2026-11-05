// Wiring only. Every listener the original page registered is here and live;
// each one calls straight into api.js, where the bodies are still empty.
// Add behaviour there, not here.
import {
  addFavorite,
  addressBar,
  blockShellPinch,
  hideBookmarksPanel,
  hideHistoryPanel,
  historyNav,
  iframe,
  onAddressInput,
  openHome,
  openRandomPage,
  openWaybackSource,
  printIframe,
  sharePage,
  toggleAddressDropdown,
  toggleFavorites,
  toggleHistory,
  watchFrame,
} from './api.js';
import { initDemo } from './demo.js';
import { initReveal } from './reveal.js';
import { initTranslate } from './translate.js';
import { initTutorial } from './tutorial.js';
import { initWallpaper } from './wallpaper.js';

// Tracks the frame: title bar, address bar, and the injected scrollbars.
watchFrame();

// On a touch screen, pinching the chrome does nothing; pinching the page zooms the page.
blockShellPinch();

// The tiled background, and clicking it for the next tile.
initWallpaper();

// Translate, in browsers that can do it on their own.
initTranslate();

// The How To Use page lighting up the part of the shell each step is about.
initTutorial();

// Links from the site's own pages to where a picture was found scroll to the picture.
initReveal();

// After five idle minutes, a tour of the entry pages until someone touches something.
initDemo();

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
  .querySelector('.home-button')
  .addEventListener('click', () => openHome());

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

document
  .querySelector('#internet-buttons .back-button')
  .addEventListener('click', () => historyNav(window));

document
  .querySelector('#internet-buttons .forward-button')
  .addEventListener('click', () => historyNav(window, 'forward'));

document
  .querySelector('.print-button')
  .addEventListener('click', () => printIframe());
