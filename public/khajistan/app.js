// Khajistan archive browser. Vanilla ES modules, no build step.
//
// Filter state lives in the URL query string, so any view is linkable and the
// back button works without a router. The board in the middle is the exception:
// it is shared, not personal, so it lives in playhtml rather than the URL.

import { playhtml } from 'https://unpkg.com/playhtml@2.14.1';

const BASE = '/khajistan';
const PAGE = 60;

// Our own sync worker, not the public playhtml instance. See DEPLOYMENT.md.
const PLAY_HOST = 'playhtml-selfhost.amad-f2b.workers.dev';
// Pinned, and deliberately not derived from the URL: this page keeps its
// filters in the query string, and the default room includes the query string,
// so every filter click would otherwise land everyone in a different empty room.
const PLAY_ROOM = 'khajistan-table';

// Movement past this many pixels between pointerdown and pointerup counts as a
// drag, not a click. Below it, a chip opens its metadata instead of moving.
const DRAG_SLOP = 4;

// The one place that knows how a stored R2 key becomes a URL. The bucket is
// public, so the browser fetches from Cloudflare's edge directly -- the app
// server is not in the media path at all. Overridable so a future custom domain
// (or a move back behind a proxy) is one env value, not a redeploy of the JS.
const R2_PUBLIC = 'https://pub-717724c730914707b0f97e6bcc443a21.r2.dev';
const mediaUrl = (key) => `${R2_PUBLIC}/${key}`;

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

const state = { kind: null, region: null, account: null, tag: null,
                offset: 0, total: 0, loading: false, done: false };

// --- url <-> state ---------------------------------------------------------

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.kind = q.get('kind');
  state.region = q.get('region');
  state.account = q.get('account');
  state.tag = q.get('tag');
}

function writeUrl(replace = false) {
  const q = new URLSearchParams();
  if (state.kind) q.set('kind', state.kind);
  if (state.region) q.set('region', state.region);
  if (state.account) q.set('account', state.account);
  if (state.tag) q.set('tag', state.tag);
  const url = q.toString() ? `${location.pathname}?${q}` : location.pathname;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

// --- facets ----------------------------------------------------------------

async function loadFacets() {
  const f = await (await fetch(`${BASE}/api/facets`)).json();
  if (f.error) {
    $('#summary').textContent = f.error;
    return;
  }
  const pct = f.totals.media ? Math.round((100 * f.totals.tagged) / f.totals.media) : 0;
  $('#summary').textContent =
    `${f.totals.media.toLocaleString()} media · ${f.totals.tagged.toLocaleString()} tagged (${pct}%) · ${f.accounts.length} accounts`;

  fill('#kinds', f.kinds || [], (k) => [k.kind, k.n, () => toggle('kind', k.kind)]);
  fill('#regions', f.regions, (r) => [r.region, r.media, () => toggle('region', r.region)]);
  fill('#accounts', f.accounts, (a) => [a.slug, a.media, () => toggle('account', a.slug)]);
  fill('#tags', f.tags, (t) => [t.tag, t.n, () => toggleTag(t.tag)]);
  paint();
}

function fill(sel, rows, map) {
  const ul = $(sel);
  ul.replaceChildren();
  for (const row of rows) {
    const [label, count, onclick] = map(row);
    const li = el('li');
    const b = el('button', { className: 'facet-btn', onclick });
    b.dataset.value = label;
    b.append(el('span', { className: 'lbl', textContent: label }));
    b.append(el('span', { className: 'n', textContent: count.toLocaleString() }));
    li.append(b);
    ul.append(li);
  }
}

// Region, account and tag are mutually exclusive: selecting one clears the
// other two, so the feed always answers exactly one question. `kind` is not in
// that group -- it's a modifier that narrows whichever axis is active.
const EXCLUSIVE = ['region', 'account', 'tag'];

function toggle(key, value) {
  const off = state[key] === value; // clicking the active chip clears it
  if (EXCLUSIVE.includes(key)) for (const k of EXCLUSIVE) state[k] = null;
  state[key] = off ? null : value;
  reload();
}
const toggleTag = (tag) => toggle('tag', tag);

function paint() {
  for (const b of document.querySelectorAll('#kinds .facet-btn'))
    b.classList.toggle('on', b.dataset.value === state.kind);
  for (const b of document.querySelectorAll('#regions .facet-btn'))
    b.classList.toggle('on', b.dataset.value === state.region);
  for (const b of document.querySelectorAll('#accounts .facet-btn'))
    b.classList.toggle('on', b.dataset.value === state.account);
  for (const b of document.querySelectorAll('#tags .facet-btn'))
    b.classList.toggle('on', b.dataset.value === state.tag);

  // The menu collapses, so the summary has to carry what is currently active.
  const bits = [];
  if (state.kind) bits.push(state.kind);
  if (state.region) bits.push(state.region);
  if (state.account) bits.push('@' + state.account);
  if (state.tag) bits.push('#' + state.tag);
  $('#filter-state').textContent = bits.length ? bits.join(' · ') : 'none';
}

// --- feed ------------------------------------------------------------------

function query(offset) {
  const q = new URLSearchParams({ limit: PAGE, offset });
  if (state.kind) q.set('kind', state.kind);
  if (state.region) q.set('region', state.region);
  if (state.account) q.set('account', state.account);
  if (state.tag) q.set('tags', state.tag);
  return q;
}

async function loadFeed(append = false) {
  // The observer can fire again while a page is still in flight -- fast scroll,
  // or a short page that leaves the sentinel on screen -- which would request
  // the same offset twice and paint duplicates. One guard covers both cases.
  if (state.loading) return;
  if (append && state.done) return;
  state.loading = true;

  if (!append) {
    state.offset = 0;
    state.done = false;
    $('#feed').replaceChildren();
    $('#feed-end').hidden = true;
  }
  let data;
  try {
    data = await (await fetch(`${BASE}/api/feed?${query(state.offset)}`)).json();
  } finally {
    state.loading = false;
  }
  if (!data || data.error) return;
  state.total = data.total;

  const frag = document.createDocumentFragment();
  for (const it of data.items) {
    const fig = el('figure', { className: 'card', tabIndex: 0 });
    fig.dataset.key = it.media_key;
    const img = el('img', {
      src: mediaUrl(it.r2_small),
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
    fig.append(img);
    if (it.kind === 'video') fig.append(el('span', { className: 'badge', textContent: '▶' }));
    // Clicking the feed does both: lays the item on the table and opens its
    // metadata. Placing something you cannot see the details of would mean
    // clicking it twice to learn what you just picked up.
    fig.onclick = () => { addToBoard(it); openItem(it.media_key); };
    fig.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      addToBoard(it);
      openItem(it.media_key);
    };
    frag.append(fig);
  }
  $('#feed').append(frag);

  state.offset += data.items.length;
  state.done = state.offset >= state.total || data.items.length === 0;
  $('#feed-meta').textContent = `${state.total.toLocaleString()} result${state.total === 1 ? '' : 's'}`;
  $('#feed-end').hidden = !state.done || state.total === 0;

  // A viewport taller than one page would otherwise leave the sentinel visible
  // with nothing to trigger it again -- the feed would stop until the user
  // scrolled, which on a short result set never happens.
  if (!state.done && sentinelVisible()) loadFeed(true);
}

// The feed scrolls inside #left on wide screens and with the page on narrow
// ones. Intersecting against the visible slice of #left covers both, where
// comparing to innerHeight alone would call a sentinel "visible" while it sat
// clipped below the column.
const sentinelVisible = () => {
  const r = $('#sentinel').getBoundingClientRect();
  const host = $('#left').getBoundingClientRect();
  const top = Math.max(0, host.top);
  const bottom = Math.min(innerHeight, host.bottom);
  return r.top < bottom && r.bottom > top;
};

function reload() {
  writeUrl();
  paint();
  loadFeed(false);
}

// --- detail ----------------------------------------------------------------

const fmtDate = (unix) =>
  unix ? new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

async function openItem(key) {
  const d = $('#detail');
  d.classList.remove('empty');
  d.replaceChildren(el('p', { className: 'muted', textContent: 'loading…' }));

  const it = await (await fetch(`${BASE}/api/item/${encodeURIComponent(key)}`)).json();
  if (it.error) {
    d.replaceChildren(el('p', { className: 'muted', textContent: it.error }));
    return;
  }

  for (const c of document.querySelectorAll('.card.on')) c.classList.remove('on');
  document.querySelector(`.card[data-key="${CSS.escape(key)}"]`)?.classList.add('on');

  const frag = document.createDocumentFragment();

  // Account sits above the media and doubles as a filter -- seeing something
  // and wanting the rest of that account is the obvious next move, and this
  // saves hunting for the slug in the left column.
  const who = el('button', {
    className: 'byline' + (it.account === state.account ? ' on' : ''),
    textContent: it.handle || '@' + it.account,
    title: `show only ${it.account}`,
    onclick: () => toggle('account', it.account),
  });
  frag.append(who);

  // Video only loads when opened -- a grid of autoloading mp4s would pull
  // hundreds of MB through the proxy.
  if (it.kind === 'video' && it.r2_original) {
    frag.append(
      el('video', {
        src: mediaUrl(it.r2_original),
        poster: it.r2_poster ? mediaUrl(it.r2_poster) : '',
        controls: true,
        preload: 'none',
        className: 'hero',
      }),
    );
  } else {
    frag.append(el('img', { src: mediaUrl(it.r2_medium || it.r2_small), alt: '', className: 'hero' }));
  }

  if (it.caption) frag.append(el('p', { className: 'caption', textContent: it.caption }));

  // Instagram's own alt text. Single-media posts store a string; carousels
  // store an array aligned to the children, so a child has to index into it --
  // child_index is 1-based, the array is not. Video children are null there
  // (Instagram never captions video), which is what ig_caption.py exists to fill.
  const alt = Array.isArray(it.accessibility_caption)
    ? it.accessibility_caption[(it.child_index || 1) - 1]
    : it.accessibility_caption;
  if (typeof alt === 'string' && alt.trim()) {
    frag.append(
      el('section', { className: 'alt' },
        el('h3', { textContent: 'Accessibility caption' }),
        el('p', { textContent: alt }),
      ),
    );
  }

  if (Array.isArray(it.tags) && it.tags.length) {
    const box = el('div', { className: 'tagrow' });
    for (const t of it.tags) {
      box.append(
        el('button', {
          className: 'tag' + (t === state.tag ? ' on' : ''),
          textContent: t,
          onclick: () => toggleTag(t),
        }),
      );
    }
    frag.append(box);
  } else {
    frag.append(el('p', { className: 'muted small', textContent: 'not yet tagged' }));
  }

  const rows = [
    ['Date', fmtDate(it.post_taken_at || it.taken_at)],
    ['Region', it.region],
    ['Country', it.country],
    ['Type', it.kind + (it.child_index ? ` (item ${it.child_index})` : '')],
    ['Dimensions', it.width && it.height ? `${it.width} × ${it.height}` : null],
    ['Likes', it.like_count >= 0 ? it.like_count?.toLocaleString() : null],
    ['Comments', it.comment_count?.toLocaleString()],
    ['Views', it.view_count?.toLocaleString()],
    ['Location', it.location?.name],
    ['Tagged users', Array.isArray(it.usertags) ? it.usertags.join(', ') : null],
    ['Music', it.music?.title ? `${it.music.title}${it.music.artist ? ' — ' + it.music.artist : ''}` : null],
  ].filter(([, v]) => v != null && v !== '');

  const dl = el('dl');
  for (const [k, v] of rows) {
    dl.append(el('dt', { textContent: k }), el('dd', { textContent: String(v) }));
  }
  frag.append(dl);

  if (it.post_url) {
    frag.append(
      el('a', { href: it.post_url, target: '_blank', rel: 'noopener', className: 'src',
                textContent: 'original post ↗' }),
    );
  }
  frag.append(el('div', { className: 'small muted', textContent: it.media_key }));
  d.replaceChildren(frag);
}

// --- board -----------------------------------------------------------------
//
// The shared table. One piece of state: a playhtml page-data channel holding an
// object keyed by media_key, where each value carries both what the item is
// (src, kind, dimensions) and where it sits (x, y).
//
// An object rather than an array because two people adding at once merge
// cleanly by key, where array indices would collide.
//
// Position lived in can-move's per-element data until writes from chips created
// during the session turned out never to reach the document; see the drag
// section below.

let board = null;                    // page-data channel, null until connected
const chipId = (key) => `board-${key}`;

function setBoardStatus(text) { $('#board-status').textContent = text; }

async function initBoard() {
  setBoardStatus('connecting…');
  try {
    await playhtml.init({
      host: PLAY_HOST,
      room: PLAY_ROOM,
      // No `room` key inside cursors on purpose: giving cursors their own room
      // opens a second Y.Doc and a second socket. Omitting it reuses the table's
      // provider, which is the same set of people anyway.
      cursors: { enabled: true },
    });
  } catch (err) {
    setBoardStatus('offline');
    console.error('[khajistan] playhtml init failed', err);
    return;
  }
  board = playhtml.createPageData('table', {});
  board.onUpdate(renderBoard);
  renderBoard(board.getData());

  renderPresence(playhtml.users.getAll());
  playhtml.users.onChange(renderPresence);

  setBoardStatus('live');
}

// One pip per person, in their cursor colour, so the count in the bar and the
// cursors moving over the page are visibly the same set of people.
function renderPresence(users) {
  const box = $('#board-presence');
  box.replaceChildren();
  for (const user of users) {
    const pip = el('span', { className: 'who' });
    pip.style.setProperty('--pip', user.color);
    pip.dataset.me = String(user.isMe);
    // Names come from other visitors, so this is an attribute, never markup.
    pip.title = user.isMe ? 'you' : (user.name || 'someone');
    box.append(pip);
  }
  box.append(el('span', {
    textContent: users.length === 1 ? 'just you' : `${users.length} here`,
  }));
}

// Reconciles the DOM against the channel. Runs on every remote change, so it
// must be cheap and idempotent: touch only what actually differs.
function renderBoard(data) {
  const surface = $('#board-surface');
  const entries = data && typeof data === 'object' ? data : {};
  const want = new Set(Object.keys(entries));

  for (const node of [...surface.querySelectorAll('.chip')]) {
    if (want.has(node.dataset.key)) continue;
    node.remove();
  }

  for (const key of want) {
    const existing = surface.querySelector(`.chip[data-key="${CSS.escape(key)}"]`);
    if (!existing) {
      addChipNode(key, entries[key]);
      continue;
    }
    // Someone else moved it. Skip the chip being dragged right now, or the
    // remote echo of our own throttled writes would fight the pointer.
    if (!existing.classList.contains('dragging')) placeChip(existing, entries[key]);
  }

  const n = want.size;
  $('#board-count').textContent = n === 0
    ? 'empty table'
    : `${n} item${n === 1 ? '' : 's'} on the table`;
  $('#board-empty').hidden = n > 0;
}

function addChipNode(key, entry) {
  const fig = el('figure', { className: 'chip' });
  fig.id = chipId(key);
  fig.dataset.key = key;
  placeChip(fig, entry);

  const img = el('img', {
    src: mediaUrl(entry?.src || ''),
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    draggable: false,   // otherwise the browser's native image drag fights ours
  });
  // Reserve the right box before the image decodes, so chips don't jump.
  if (entry?.w && entry?.h) img.style.aspectRatio = `${entry.w} / ${entry.h}`;
  fig.append(img);

  if (entry?.kind === 'video') fig.append(el('span', { className: 'badge', textContent: '▶' }));

  const drop = el('button', { className: 'drop', textContent: '×', title: 'take off the table' });
  drop.onclick = (e) => { e.stopPropagation(); removeFromBoard(key); };
  fig.append(drop);

  $('#board-surface').append(fig);
  wireChipDrag(fig, key);
  return fig;
}

function placeChip(fig, entry) {
  fig.style.left = `${Number.isFinite(entry?.x) ? entry.x : 0}px`;
  fig.style.top = `${Number.isFinite(entry?.y) ? entry.y : 0}px`;
}

// Dragging is ours rather than can-move's. Position is one more field on the
// board channel, which keeps the whole board in a single shared structure --
// and, unlike per-element capability data, writes from a chip created during
// this session actually reach the document.
//
// Local style updates on every move keep the drag smooth; the shared write is
// throttled and repeated once on release, so other people see it move without
// a write per pixel.
const COMMIT_MS = 120;

function wireChipDrag(fig, key) {
  let startX = 0, startY = 0, originX = 0, originY = 0;
  let dragging = false, lastCommit = 0;

  fig.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.drop')) return;
    const surface = $('#board-surface');
    startX = e.clientX; startY = e.clientY;
    originX = parseFloat(fig.style.left) || 0;
    originY = parseFloat(fig.style.top) || 0;
    dragging = true;
    // Whatever you just touched belongs on top.
    surface.append(fig);
    fig.setPointerCapture(e.pointerId);
    fig.classList.add('dragging');
  });

  fig.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { x, y } = clampToSurface(fig, originX + e.clientX - startX, originY + e.clientY - startY);
    fig.style.left = `${x}px`;
    fig.style.top = `${y}px`;
    const now = Date.now();
    if (now - lastCommit > COMMIT_MS) { lastCommit = now; commitPosition(key, x, y); }
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    fig.classList.remove('dragging');
    if (fig.hasPointerCapture?.(e.pointerId)) fig.releasePointerCapture(e.pointerId);

    // Under the slop threshold this was a click, not a move: show the metadata
    // and leave the position alone.
    if (Math.hypot(e.clientX - startX, e.clientY - startY) <= DRAG_SLOP) {
      fig.style.left = `${originX}px`;
      fig.style.top = `${originY}px`;
      openItem(key);
      return;
    }
    commitPosition(key, parseFloat(fig.style.left) || 0, parseFloat(fig.style.top) || 0);
  };
  fig.addEventListener('pointerup', finish);
  fig.addEventListener('pointercancel', finish);
}

// Keeps a chip inside the surface, so nothing can be shoved under the
// neighbouring panels where it could never be retrieved.
function clampToSurface(fig, x, y) {
  const s = $('#board-surface');
  return {
    x: Math.round(Math.max(0, Math.min(x, s.clientWidth - fig.offsetWidth))),
    y: Math.round(Math.max(0, Math.min(y, s.clientHeight - fig.offsetHeight))),
  };
}

function commitPosition(key, x, y) {
  if (!board) return;
  board.setData((draft) => {
    const entry = draft[key];
    if (!entry) return;      // removed from under us by someone else
    entry.x = x;
    entry.y = y;
  });
}

function addToBoard(it) {
  if (!board) return;                        // not connected yet
  const key = it.media_key;
  if (board.getData()[key]) return;          // already down; leave its position alone

  const spot = freeSpot();
  board.setData((draft) => {
    draft[key] = {
      src: it.r2_small, kind: it.kind, w: it.width, h: it.height,
      x: spot.x, y: spot.y,
    };
  });
  // setData notifies on a microtask; render now so the chip appears on the same
  // click. renderBoard is idempotent, so the later notification is a no-op.
  renderBoard(board.getData());
}

function removeFromBoard(key) {
  if (!board) return;
  board.setData((draft) => { delete draft[key]; });
  renderBoard(board.getData());
}

// A cascade rather than pure random: overlapping is fine and expected on a
// table, but landing two chips exactly on top of each other looks like the
// click failed. Jitter keeps repeat placements from forming a rigid staircase.
function freeSpot() {
  const surface = $('#board-surface');
  const n = surface.querySelectorAll('.chip').length;
  const maxX = Math.max(0, surface.clientWidth - 160);
  const maxY = Math.max(0, surface.clientHeight - 140);
  return {
    x: Math.round(Math.min(maxX, 20 + (n % 8) * 36 + Math.random() * 20)),
    y: Math.round(Math.min(maxY, 20 + (n % 6) * 40 + Math.random() * 20)),
  };
}

// --- wiring ----------------------------------------------------------------

// Infinite scroll. rootMargin pre-loads a screen early so the next page is
// usually already painted by the time the user reaches the bottom.
new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) loadFeed(true);
  },
  { root: null, rootMargin: '600px 0px', threshold: 0 },
).observe($('#sentinel'));

for (const b of document.querySelectorAll('.clear')) {
  b.onclick = () => {
    const k = b.dataset.clear;
    state[k === 'tags' ? 'tag' : k] = null;
    reload();
  };
}
addEventListener('popstate', () => {
  readUrl();
  paint();
  loadFeed(false);
});

readUrl();
writeUrl(true);
await loadFacets();
await loadFeed(false);

// Deliberately not awaited. The archive is the point; the shared table is an
// extra, and a slow or unreachable sync worker must not delay the feed.
initBoard();
