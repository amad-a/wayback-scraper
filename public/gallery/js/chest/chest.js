// The chest view: the cards this visitor has taken, grouped by the day they took
// them (in their own timezone), and a details panel for the one they open.
import { r2Url } from '../media.js';
import { borderFor } from '../pile/borders.js';
import { createDetailsPanel } from './details-panel.js';

// Chest tiles are smaller than pile cards, so their borders are scaled down too.
const TILE_BORDER_SCALE = 0.7;

// onHang(item) is called when the visitor chooses to hang the open item.
export function initChest({ store, grid, empty, detail, count, onHang }) {
  const panel = createDetailsPanel(detail, { onStep: step });
  const hangButton = detail.querySelector('[data-action="hang"]');

  function renderGrid(items) {
    count.textContent = items.length ? String(items.length) : '';
    empty.hidden = items.length > 0;
    grid.replaceChildren(
      ...groupByDay(items).map(({ day, items: dayItems }) => {
        const section = document.createElement('section');
        section.className = 'kjg-day';
        const label = document.createElement('h2');
        label.className = 'kjg-day-label';
        if (day) {
          const time = document.createElement('time');
          time.dateTime = day.key;
          time.textContent = day.label;
          label.append(time);
        } else {
          label.textContent = 'Earlier';
        }
        const tiles = document.createElement('div');
        tiles.className = 'kjg-day-grid';
        tiles.append(...dayItems.map(renderTile));
        section.append(label, tiles);
        return section;
      }),
    );
  }

  // A tile is its frame holding buttons: the image opens the details, and on hover
  // or focus an × (top right) and a hang button (bottom left, signed items only)
  // appear.
  // Buttons can't nest, hence the wrapper.
  function renderTile(item) {
    const tile = document.createElement('div');
    tile.className = 'kjg-tile';
    tile.dataset.key = item.key;
    tile.dataset.kind = item.kind;
    if (item.key === panel.key()) tile.setAttribute('aria-current', 'true');

    const border = borderFor(item.id);
    const width = Math.max(2, Math.round(border.width * TILE_BORDER_SCALE));
    tile.style.border = `${width}px ${border.style} ${border.color}`;
    if (border.image) tile.style.borderImage = border.image;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'kjg-tile-open';
    open.setAttribute('aria-label', `Open item ${item.key}`);
    const img = document.createElement('img');
    img.src = r2Url(item.src);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    open.append(img);

    let hang = null;
    if (item.token) {
      hang = document.createElement('button');
      hang.type = 'button';
      hang.className = 'kjg-tile-action kjg-tile-hang';
      hang.setAttribute('aria-label', `Hang item ${item.key} in the museum`);
      hang.title = 'Hang in museum';
      // A frame on a nail.
      hang.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
        '<path d="M8 1.5 3 6.5M8 1.5l5 5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
        '<circle cx="8" cy="1.8" r="1.2" fill="currentColor"/>' +
        '<rect x="2.5" y="6.5" width="11" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'kjg-tile-action kjg-tile-remove';
    remove.setAttribute('aria-label', `Remove item ${item.key} from chest`);
    remove.title = 'Remove from chest';
    remove.textContent = '×';

    tile.append(open, remove);
    if (hang) tile.append(hang);
    return tile;
  }

  function open(key) {
    // Only items signed by the pile can hang; ones taken before signing existed can't.
    const signed = Boolean(store.get(key)?.token);
    hangButton.disabled = !signed;
    hangButton.title = signed ? '' : 'Taken before the museum opened, so it can’t be hung';
    for (const tile of grid.querySelectorAll('.kjg-tile')) {
      const selected = tile.dataset.key === key;
      tile.toggleAttribute('aria-current', selected);
      if (selected) tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    panel.open(key);
    updateNav();
  }

  // ← → follow the grid: newest first, so → steps to the next older item.
  const chronological = () => [...store.items()].sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));
  const prevButton = detail.querySelector('[data-action="prev"]');
  const nextButton = detail.querySelector('[data-action="next"]');
  prevButton.title = 'Newer (←)';
  prevButton.setAttribute('aria-label', 'Newer item');
  nextButton.title = 'Older (→)';
  nextButton.setAttribute('aria-label', 'Older item');

  function step(dir) {
    const items = chronological();
    const target = items[items.findIndex((item) => item.key === panel.key()) + dir];
    if (target) open(target.key);
  }

  function updateNav() {
    const items = chronological();
    const i = items.findIndex((item) => item.key === panel.key());
    panel.setNav({ hasPrev: i > 0, hasNext: i >= 0 && i < items.length - 1 });
  }

  function close() {
    panel.close();
    for (const tile of grid.querySelectorAll('.kjg-tile')) tile.removeAttribute('aria-current');
  }

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.kjg-tile');
    if (!tile) return;
    if (e.target.closest('.kjg-tile-hang')) {
      const item = store.get(tile.dataset.key);
      if (!item?.token) return;
      close();
      onHang?.(item);
    } else if (e.target.closest('.kjg-tile-remove')) {
      if (tile.dataset.key === panel.key()) close();
      store.remove(tile.dataset.key);
    } else if (e.target.closest('.kjg-tile-open')) {
      open(tile.dataset.key);
    }
  });
  detail.querySelector('[data-action="close"]').addEventListener('click', close);
  hangButton.addEventListener('click', () => {
    const item = panel.key() && store.get(panel.key());
    if (!item?.token) return;
    close();
    onHang?.(item);
  });
  detail.querySelector('[data-action="remove"]').addEventListener('click', () => {
    if (panel.key()) store.remove(panel.key());
    close();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.key()) close();
  });

  store.subscribe((items) => {
    renderGrid(items);
    if (panel.key()) updateNav();
  });
  renderGrid(store.items());

  return { close };
}

// Items (newest first) in runs by local calendar day: [{ day, items }], where day
// is { key: 'YYYY-MM-DD', label } in the viewer's timezone, or null if unknown.
function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const day = dayOf(item.takenAt);
    const last = groups.at(-1);
    if (last && last.day?.key === day?.key) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

function dayOf(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return null;
  return {
    key: localDayKey(date),
    // "28 Sep 2026" for every visitor; only the day boundary follows their timezone.
    label: `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
