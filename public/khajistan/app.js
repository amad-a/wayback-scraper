// Khajistan archive browser. Vanilla ES modules, no build step.
//
// State lives in the URL query string, so any view is linkable and the back
// button works without a router.

const BASE = '/khajistan';
const PAGE = 60;

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
    fig.onclick = () => openItem(it.media_key);
    fig.onkeydown = (e) => e.key === 'Enter' && openItem(it.media_key);
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

const sentinelVisible = () => {
  const r = $('#sentinel').getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0;
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
