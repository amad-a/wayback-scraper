import { connectRoom } from './net/room.js';
import { createStage } from './pile/stage.js';
import { initCursors } from './pile/cursors.js';
import { initPile } from './pile/pile.js';
import { initInteract } from './pile/interact.js';
import { createChestStore } from './chest/store.js';
import { initChest } from './chest/chest.js';
import { initMuseum } from './museum/museum.js';

const root = document.querySelector('.kjg');
const viewport = root.querySelector('.kjg-viewport');
const world = root.querySelector('.kjg-world');
const presence = root.querySelector('.kjg-presence');

// --- chest and museum
const store = createChestStore();
const chestLink = root.querySelector('.kjg-nav a[href="#chest"]');

// "N here" counts the visitors in whichever shared view is showing.
const others = { pile: 0, museum: 0 };
let currentView = 'pile';
function renderPresence() {
  if (root.classList.contains('is-offline')) return;
  const n = currentView === 'museum' ? others.museum : others.pile;
  presence.textContent = n === 0 ? 'Only you here' : `${n + 1} here`;
}

// A hung item goes back into public, so it leaves the chest.
const museum = initMuseum({
  root,
  onHung: (item) => store.remove(item.key),
  onPresence(n) {
    others.museum = n;
    renderPresence();
  },
});

const chest = initChest({
  store,
  grid: root.querySelector('.kjg-chest-grid'),
  empty: root.querySelector('.kjg-empty'),
  detail: root.querySelector('.kjg-detail'),
  count: root.querySelector('.kjg-count'),
  onHang(item) {
    location.hash = '#museum';
    museum.startPlacement(item);
  },
});

// --- views: #pile (default), #chest and #museum
const VIEWS = ['pile', 'chest', 'museum'];
function showView() {
  const hash = location.hash.slice(1);
  const current = VIEWS.includes(hash) ? hash : 'pile';
  currentView = current;
  if (current !== 'chest') chest.close(); // also stops any playing video
  if (current !== 'museum') museum.hide(); // cancels a placement in progress
  for (const view of root.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== current;
  }
  if (current === 'museum') museum.show(); // after unhiding, so it can measure the wall
  for (const link of root.querySelectorAll('.kjg-nav a')) {
    link.setAttribute('aria-current', link.hash === `#${current}` ? 'page' : 'false');
  }
  renderPresence();
}
addEventListener('hashchange', showView);
showView();

// --- shared room
const room = connectRoom();
const stage = createStage(viewport, world);

// The pile room sends the taker a signature for each card just before removing
// it; it travels with the card into the chest, and the museum checks it.
const tokens = new Map();
room.on('took', ({ id, token }) => tokens.set(id, token));

// A card taken off the pile goes into the chest and is tossed into the Chest tab.
const pile = initPile({
  room,
  stage,
  layer: root.querySelector('.kjg-cards'),
  fxLayer: root.querySelector('.kjg-fx'),
  onTaken(card) {
    store.add({ ...card, token: tokens.get(card.id) });
    tokens.delete(card.id);
    const rect = chestLink.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },
});
initInteract({ room, stage, viewport, pile });

room.on('open', () => {
  root.classList.remove('is-offline');
  renderPresence();
});
room.on('close', () => {
  root.classList.add('is-offline');
  presence.textContent = 'Reconnecting…';
});

initCursors({
  room,
  stage,
  viewport,
  layer: root.querySelector('.kjg-cursors'),
  onCountChange(n) {
    others.pile = n;
    renderPresence();
  },
});
