// The museum view: a horizontal wall of day sections where visitors hang items
// from their chest. Today's section (UTC) is live, through the museum room; older
// days are read from Supabase a week at a time as the visitor scrolls back.
import { connectRoom } from '../net/room.js';
import { supabase } from '../supabase.js';
import { TABLES } from '../db.js';
import { r2Url } from '../media.js';
import { borderFor } from '../pile/borders.js';
import { createDetailsPanel } from '../chest/details-panel.js';
import { initMuseumCursors } from './cursors.js';
import {
  MUSEUM_PATH,
  ROWS,
  canHang,
  dayLabel,
  randomSize,
  sectionCols,
} from '../shared/museum.js';

const COLUMNS = 'id,day,col,row,w,h,card_id,media_key,kind,src,hung_at';
// Days fetched per step back in time.
const PAGE_DAYS = 7;
const CELL_MIN = 11;
const CELL_MAX = 46; // px; cells follow the wall's height up to this
// How long a failed hanging's message stays up.
const ERROR_MS = 3500;
// Start loading older days when the visitor is within this distance of the start.
const LOAD_AHEAD_PX = 800;

// onPresence(n) reports how many other visitors are in the museum.
export function initMuseum({ root, onHung, onPresence }) {
  const view = root.querySelector('.kjg-museum-view');
  const scroller = root.querySelector('.kjg-museum');
  const wall = root.querySelector('.kjg-wall');
  const note = root.querySelector('.kjg-museum-note');
  const bar = root.querySelector('.kjg-museum-bar');
  const barText = bar.querySelector('.kjg-museum-bar-text');
  const detail = root.querySelector('.kjg-museum-detail');
  const panel = createDetailsPanel(detail, { onStep: step });
  let openId = null; // the hanging shown in the panel (a media key can hang twice)
  const hungById = new Map(); // item id -> item, for the details panel

  const sections = new Map(); // day -> { day, open, items, el, grid }
  let room = null;
  let cursors = null;
  let today = null;
  let cursor = null; // older days are fetched strictly before this day
  let exhausted = false;
  let loadingOlder = false;
  let placing = null; // { item, size, spot, valid, pending, ghost }
  // Set when we want to show today but the view is hidden and can't scroll yet.
  let scrollToTodayPending = false;

  // --- sizing: the grid's cell size follows the wall's height

  function fitCells() {
    const height = scroller.clientHeight;
    const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((height - 72) / ROWS)));
    wall.style.setProperty('--cell', `${cell}px`);
  }
  new ResizeObserver(fitCells).observe(scroller);
  fitCells();

  const cellSize = () => parseFloat(getComputedStyle(wall).getPropertyValue('--cell')) || CELL_MIN;

  // --- sections

  function section(day, { open = false } = {}) {
    let s = sections.get(day);
    if (!s) {
      const el = document.createElement('section');
      el.className = 'kjg-wing';
      el.dataset.day = day;
      const label = document.createElement('h2');
      label.className = 'kjg-wing-label';
      const time = document.createElement('time');
      time.dateTime = day;
      time.textContent = dayLabel(day);
      // While placing an item, the date and arrows give way to a Cancel button.
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'kjg-wing-cancel';
      cancel.textContent = 'Cancel';
      label.append(wingNav(-1), time, wingNav(1), cancel);
      const grid = document.createElement('div');
      grid.className = 'kjg-wing-grid';
      el.append(label, grid);
      s = { day, open, items: [], el, grid };
      sections.set(day, s);
      insertInOrder(s);
    }
    s.open = open;
    s.el.classList.toggle('is-open', open);
    layout(s);
    return s;
  }

  // Sections sit oldest to newest, left to right, after the load-more sentinel.
  function insertInOrder(s) {
    const later = [...sections.values()]
      .filter((other) => other !== s && other.day > s.day)
      .sort((a, b) => a.day.localeCompare(b.day))[0];
    wall.insertBefore(s.el, later ? later.el : null);
    updateWingNav();
  }

  // --- ← date → : jump between day sections

  function wingNav(dir) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kjg-wing-nav';
    button.dataset.dir = dir;
    button.textContent = dir < 0 ? '←' : '→';
    button.setAttribute('aria-label', dir < 0 ? 'Previous day' : 'Next day');
    return button;
  }

  const ordered = () => [...sections.values()].sort((a, b) => a.day.localeCompare(b.day));

  // The newest day has no →; the oldest has no ←, unless older days may still load.
  function updateWingNav() {
    const list = ordered();
    list.forEach((s, i) => {
      s.el.querySelector('.kjg-wing-nav[data-dir="-1"]').hidden = i === 0 && exhausted;
      s.el.querySelector('.kjg-wing-nav[data-dir="1"]').hidden = i === list.length - 1;
    });
  }

  // Smooth-scrolls so the neighbouring day's section starts at the left edge (the
  // browser stops at the end of the wall if it's narrower than the screen).
  async function jumpDay(day, dir) {
    let list = ordered();
    let i = list.findIndex((s) => s.day === day);
    if (i + dir < 0 && !exhausted) {
      await loadOlder();
      list = ordered();
      i = list.findIndex((s) => s.day === day);
    }
    const target = list[i + dir];
    if (!target) return;
    const start = target.el.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    scroller.scrollTo({ left: start, behavior: 'smooth' });
  }

  function layout(s) {
    s.grid.style.gridTemplateRows = `repeat(${ROWS}, var(--cell))`;
    s.grid.style.gridTemplateColumns = `repeat(${sectionCols(s.items, { open: s.open })}, var(--cell))`;
  }

  function addItem(item) {
    const s = sections.get(item.day) ?? section(item.day);
    if (s.items.some((existing) => existing.id === item.id)) return;
    s.items.push(item);
    hungById.set(String(item.id), item);
    s.grid.append(renderItem(item));
    if (openId) updateNav(); // a new hanging may be the next one
    layout(s);
  }

  // Hung items open the details panel, by click or keyboard.
  function renderItem(item) {
    const el = document.createElement('figure');
    el.className = 'kjg-hung';
    el.dataset.id = item.id;
    el.dataset.kind = item.kind;
    el.dataset.key = item.media_key;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Open item ${item.media_key}`);
    place(el, item);
    frame(el, item.card_id);
    const img = document.createElement('img');
    img.src = r2Url(item.src);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    el.append(img);
    return el;
  }

  function place(el, { col, row, w, h }) {
    el.style.gridColumn = `${col + 1} / span ${w}`;
    el.style.gridRow = `${row + 1} / span ${h}`;
  }

  function frame(el, cardId) {
    const border = borderFor(cardId);
    el.style.border = `${border.width}px ${border.style} ${border.color}`;
    if (border.image) el.style.borderImage = border.image;
  }

  // --- today, live

  function connect() {
    if (room) return;
    room = connectRoom(MUSEUM_PATH);
    cursors = initMuseumCursors({
      room,
      view,
      scroller,
      gridFor: (day) => sections.get(day)?.grid ?? null,
      cellSize,
      // While placing, others see a small faded preview of the item by our cursor.
      placingPreview: () => (placing ? { src: placing.item.src, card: placing.item.id, kind: placing.item.kind } : null),
      onCountChange: onPresence,
    });

    room.on('welcome', ({ today: day, items, error }) => {
      setToday(day, items);
      note.hidden = !error;
      note.textContent = error ?? '';
      if (cursor === null) {
        cursor = day;
        scrollToToday();
        probeOlder();
        loadOlderIfNeeded();
      }
    });
    room.on('day', ({ today: day, items }) => setToday(day, items));
    room.on('hung', ({ item }) => addItem(item));
    // The room found our copy of a day out of date (rows written or removed outside
    // it): replace that section's items with the database's.
    room.on('wall', ({ day, items }) => {
      const s = sections.get(day);
      if (!s) return;
      for (const el of s.grid.querySelectorAll('.kjg-hung:not(.is-ghost)')) el.remove();
      for (const item of s.items) hungById.delete(String(item.id));
      s.items = [];
      for (const item of items) addItem(item);
      layout(s);
    });
    room.on('hang:ok', ({ cardId, item }) => {
      addItem(item);
      if (placing?.item.id === cardId) {
        const hung = placing.item;
        endPlacement();
        onHung?.(hung);
      }
    });
    room.on('hang:fail', ({ cardId, reason }) => {
      if (placing?.item.id !== cardId) return;
      placing.pending = false;
      placing.ghost.classList.remove('is-pending');
      showError(reason);
    });
  }

  function setToday(day, items) {
    if (today && today !== day) section(today, { open: false }); // yesterday closes
    today = day;
    section(day, { open: true });
    for (const item of items) addItem(item);
    if (placing) attachGhost();
  }

  // --- older days, a week at a time

  async function loadOlder() {
    if (loadingOlder || exhausted || cursor === null) return;
    loadingOlder = true;
    try {
      // The newest day with anything on it before the cursor, then the week ending there.
      const { data: latest, error: e1 } = await supabase
        .from(TABLES.museum)
        .select('day')
        .lt('day', cursor)
        .order('day', { ascending: false })
        .limit(1);
      if (e1) throw e1;
      if (!latest.length) {
        exhausted = true;
        updateWingNav();
        return;
      }
      const end = latest[0].day;
      const start = shiftDay(end, -(PAGE_DAYS - 1));
      const { data: rows, error: e2 } = await supabase
        .from(TABLES.museum)
        .select(COLUMNS)
        .gte('day', start)
        .lte('day', end)
        .order('day')
        .order('id');
      if (e2) throw e2;

      // Prepending widens the wall to the left; keep what the visitor sees still.
      const before = scroller.scrollWidth;
      for (const item of rows) addItem(item);
      scroller.scrollLeft += scroller.scrollWidth - before;
      cursor = start;
      probeOlder();
    } catch (err) {
      console.error('museum history failed:', err.message);
    } finally {
      loadingOlder = false;
    }
  }

  // Whether anything older than the cursor exists, without loading it, so the oldest
  // section's ← is hidden from the start when there's nowhere to go.
  async function probeOlder() {
    const { data, error } = await supabase.from(TABLES.museum).select('day').lt('day', cursor).limit(1);
    if (!error && !data.length) {
      exhausted = true;
      updateWingNav();
    }
  }

  async function loadOlderIfNeeded() {
    // clientWidth is 0 while the museum view is hidden.
    while (!exhausted && scroller.clientWidth && scroller.scrollLeft < LOAD_AHEAD_PX) {
      const had = cursor;
      await loadOlder();
      if (cursor === had) break; // nothing new (or an error): wait for the next scroll
    }
  }
  scroller.addEventListener('scroll', () => loadOlderIfNeeded(), { passive: true });

  // Brings today's section into view from its start (the open wall is often wider
  // than the screen, and its items begin at the left); when it is narrower, the
  // wall's right end lines up with the screen's and earlier days fill the rest.
  // Done immediately, not on the next frame, so history loading sees the real
  // position; deferred until shown if the view is hidden.
  function scrollToToday() {
    const s = today && sections.get(today);
    if (!scroller.clientWidth || !s) {
      scrollToTodayPending = true;
      return;
    }
    const start = s.el.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    scroller.scrollLeft = Math.min(start, scroller.scrollWidth - scroller.clientWidth);
  }

  // --- hanging an item from the chest

  function startPlacement(item) {
    endPlacement();
    closeDetails();
    const ghost = document.createElement('figure');
    ghost.className = 'kjg-hung is-ghost';
    frame(ghost, item.id);
    const img = document.createElement('img');
    img.src = r2Url(item.src);
    img.alt = '';
    ghost.append(img);
    placing = { item, size: randomSize(item.w / item.h), spot: null, valid: false, pending: false, ghost };
    view.classList.add('is-placing');
    ghost.hidden = true;
    hideBar();
    attachGhost();
    scrollToToday();
    cursors?.update();
  }

  function attachGhost() {
    const s = today && sections.get(today);
    if (s && placing) s.grid.append(placing.ghost);
  }

  // The bar only appears when a hanging fails, and clears itself after a moment.
  // Placing needs no instructions: the item follows the pointer, Esc cancels.
  let barTimer = null;
  function showError(reason) {
    clearTimeout(barTimer);
    barText.textContent = reason;
    bar.classList.add('is-error');
    bar.hidden = false;
    barTimer = setTimeout(hideBar, ERROR_MS);
  }
  function hideBar() {
    clearTimeout(barTimer);
    bar.hidden = true;
  }

  function endPlacement() {
    if (!placing) return;
    placing.ghost.remove();
    placing = null;
    hideBar();
    view.classList.remove('is-placing');
    cursors?.update();
  }

  // The spot under the pointer, centred on it and kept inside today's grid.
  function spotAt(event) {
    const s = sections.get(today);
    const rect = s.grid.getBoundingClientRect();
    const cell = cellSize();
    const { w, h } = placing.size;
    const cols = sectionCols(s.items, { open: true });
    const col = Math.round((event.clientX - rect.left) / cell - w / 2);
    const row = Math.round((event.clientY - rect.top) / cell - h / 2);
    return {
      col: Math.max(0, Math.min(cols - w, col)),
      row: Math.max(0, Math.min(ROWS - h, row)),
      w,
      h,
      inside: event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
    };
  }

  wall.addEventListener('pointermove', (e) => {
    if (!placing || placing.pending || !today) return;
    const spot = spotAt(e);
    const { ghost } = placing;
    ghost.hidden = !spot.inside;
    if (!spot.inside) return;
    placing.spot = spot;
    placing.valid = canHang(sections.get(today).items, spot);
    place(ghost, spot);
    // Over another item (or off the open wall) the ghost fades: it can't hang there.
    ghost.classList.toggle('is-blocked', !placing.valid);
  });

  // --- details for a hung item

  function openDetails(el) {
    const item = hungById.get(el.dataset.id);
    if (!item) return;
    openId = String(item.id);
    for (const other of wall.querySelectorAll('.kjg-hung[aria-current]')) other.removeAttribute('aria-current');
    el.setAttribute('aria-current', 'true');
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    detail.querySelector('.kjg-detail-note').textContent = item.hung_at ? `Hung ${hungLabel(item.hung_at)}` : '';
    panel.open(item.media_key);
    updateNav();
  }

  function closeDetails() {
    openId = null;
    panel.close();
    for (const el of wall.querySelectorAll('.kjg-hung[aria-current]')) el.removeAttribute('aria-current');
  }

  // ← → move through every hanging in the order they were hung (← earlier),
  // across days; stepping back past the oldest loaded day loads older ones.
  function chronological() {
    return [...hungById.values()].sort(
      (a, b) => (a.hung_at ?? '').localeCompare(b.hung_at ?? '') || Number(a.id) - Number(b.id),
    );
  }

  async function step(dir) {
    let items = chronological();
    let i = items.findIndex((item) => String(item.id) === openId);
    if (i < 0) return;
    if (i + dir < 0 && !exhausted) {
      const id = openId;
      await loadOlder();
      if (openId !== id) return; // closed or moved on meanwhile
      items = chronological();
      i = items.findIndex((item) => String(item.id) === openId);
    }
    const target = items[i + dir];
    const el = target && wall.querySelector(`.kjg-hung[data-id="${target.id}"]`);
    if (el) openDetails(el);
  }

  function updateNav() {
    const items = chronological();
    const i = items.findIndex((item) => String(item.id) === openId);
    panel.setNav({ hasPrev: i > 0 || (i === 0 && !exhausted), hasNext: i >= 0 && i < items.length - 1 });
  }

  detail.querySelector('[data-action="close"]').addEventListener('click', closeDetails);
  wall.addEventListener('keydown', (e) => {
    const el = e.target.closest('.kjg-hung:not(.is-ghost)');
    if (el && !placing && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDetails(el);
    }
  });

  wall.addEventListener('click', (e) => {
    if (e.target.closest('.kjg-wing-cancel')) {
      if (placing && !placing.pending) endPlacement();
      return;
    }
    const nav = e.target.closest('.kjg-wing-nav');
    if (nav) {
      jumpDay(nav.closest('.kjg-wing').dataset.day, Number(nav.dataset.dir));
      return;
    }
    const hung = e.target.closest('.kjg-hung:not(.is-ghost)');
    if (hung && !placing) {
      openDetails(hung);
      return;
    }
    if (!placing || placing.pending || !placing.valid || !placing.spot) return;
    // Only a click on today's grid itself hangs (not its label or the gaps).
    if (!e.target.closest('.kjg-wing.is-open .kjg-wing-grid')) return;
    const { item, spot } = placing;
    placing.pending = true;
    placing.ghost.classList.add('is-pending');
    hideBar();
    room.send({ t: 'hang', cardId: item.id, key: item.key, token: item.token, col: spot.col, row: spot.row, w: spot.w, h: spot.h });
  });

  bar.querySelector('[data-action="cancel"]').addEventListener('click', endPlacement);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (placing && !placing.pending) endPlacement();
    else if (panel.key()) closeDetails();
  });

  return {
    show() {
      connect();
      fitCells();
      if (scrollToTodayPending) {
        scrollToTodayPending = false;
        scrollToToday();
      }
      loadOlderIfNeeded();
    },
    hide() {
      endPlacement();
      closeDetails();
    },
    startPlacement,
  };
}

// '29 Sep 2026' for a hanging's timestamp, by its UTC day like the wall's sections.
function hungLabel(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : dayLabel(date.toISOString().slice(0, 10));
}

// 'YYYY-MM-DD' shifted by n days.
function shiftDay(day, n) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}
