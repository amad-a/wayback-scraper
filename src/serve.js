// Serves the Explorer shell and the archived sites from one origin.
//
// Both halves need this: the shell's iframe points at /sites/..., and
// archive-index.html links to the same root-relative paths. Serving public/
// alone would 404 every archived page; serving the repo root would expose
// node_modules and src.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { ensureUpdatedAt, selectTagged, toCsv } from './tags-csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8080;
// Loopback by default: in production nginx is the only thing that should reach the
// app directly, and binding 0.0.0.0 leaves it one firewall rule away from serving
// unencrypted traffic to the internet. Set HOST=0.0.0.0 to reach it from another
// device -- checking the mobile layout on a phone over the same wifi, say.
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = path.join(ROOT, 'archive.db');

const app = express();

// Opened read-only, and lazily so the server still starts before the first `npm run db`.
// Read-only matters: you will have this file open in a GUI editor while tagging, and the
// server has no business writing to it.
//
// Reopened when the file is replaced. `npm run db` deletes and recreates archive.db, and
// a cached handle would go on serving the deleted inode -- rebuilt data silently not
// showing up, with nothing in the log to explain it. Edits made in place need no reopen;
// SQLite already reads those fresh.
let db = null;
let dbKey = '';

function database() {
  let stat;
  try {
    stat = fs.statSync(DB_PATH);
  } catch {
    return null;
  }

  const key = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  if (db && key !== dbKey) {
    db.close();
    db = null;
  }
  if (!db) {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    dbKey = key;
  }
  return db;
}

// What the shell asks for on every iframe navigation: the real URL and title for the
// page it just loaded, keyed on the path it is already sitting on.
app.get('/api/page', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  // Accepts either '/sites/host/page.html' or the bare local path.
  const localPath = decodeURIComponent(String(req.query.path || '')).replace(/^\/?sites\//, '');
  if (!localPath) return res.status(400).json({ error: 'path required' });

  const row = handle
    .prepare(
      `SELECT local_path, host, display_url, replay_url, captured_at, timestamp,
              display_title, tags, notes, capture_count, frame_parent
       FROM page_view WHERE local_path = ?`,
    )
    .get(localPath);

  if (!row) return res.status(404).json({ error: 'not indexed', local_path: localPath });
  res.json(row);
});

// One page at random, for the toolbar's Random button.
//
// Drawn from index pages only -- 569 of the 11,074 rows. Landing somewhere at random is
// only worth doing if where you land is a place, and most of the corpus is not: nav
// fragments, single images with a caption, pages that are one line of a frameset. An
// index page is a front door, so it establishes what site you just arrived at.
//
// Three things are excluded beyond that:
//
//   framed            a page with a frame_parent is one pane of a frameset, so serving it
//                     alone gives you a bare nav strip or a body with no way out. The
//                     index-page heuristic already caught nearly all of these by accident;
//                     this catches them on purpose, and keeps doing so if the pool ever
//                     widens past index pages.
//   untitled          21 index pages have no <title>, leaving the window chrome blank.
//   directory listings 44 are auto-generated Apache/IIS listings, titled 'host - /path'.
//                      An index of an images folder is not a destination.
//
// The title tests run against display_title rather than title, so a title_override is a
// way to pull a page into the pool -- correct the title and it becomes eligible.
const RANDOM_POOL = `
  local_path LIKE '%/index.%'
  AND frame_parent IS NULL
  AND display_title <> ''
  AND NOT (display_title LIKE '% - /%'
        OR display_title LIKE 'Index of %'
        OR display_title LIKE 'Directory Listing%')
`;

// ORDER BY random() is a full scan, which would be the wrong call on a large table but
// costs nothing at this size and keeps the draw honest -- the OFFSET tricks that avoid
// the scan all skew towards whichever rows happen to sit early in the b-tree.
app.get('/api/random', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  // Excluding the current page, so clicking Random twice in a row always moves.
  const not = decodeURIComponent(String(req.query.not || '')).replace(/^\/?sites\//, '');

  const row = handle
    .prepare(
      `SELECT local_path, display_url, display_title
       FROM page_view WHERE ${RANDOM_POOL} AND local_path <> ? ORDER BY random() LIMIT 1`,
    )
    .get(not);

  if (!row) return res.status(404).json({ error: 'no pages indexed' });
  res.json(row);
});

// The whole pool in random order, dealt one page per click so a session never repeats.
//
// Shuffling once beats drawing one at a time and excluding what has been seen. By the
// time 500 of the 569 are used up, a fresh draw lands on an unseen page about one time
// in eight, so every click fires a burst of retries -- and the last page takes 569 of
// them. Dealing from a shuffled deck is one request for the session and O(1) per click.
//
// Whole pool is ~20KB of JSON, which is cheaper than the handful of retries it replaces.
app.get('/api/random/deck', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  const paths = handle
    .prepare(`SELECT local_path FROM page_view WHERE ${RANDOM_POOL} ORDER BY random()`)
    .all()
    .map((r) => r.local_path);

  res.json({ size: paths.length, paths });
});

// --- media ------------------------------------------------------------------

// How long each restored recording is, from media-manifest.json (written by
// `npm run media`), keyed by the URL its links now point at. The main page's player
// passes these to Webamp, which otherwise downloads part of every queued file just to
// measure it -- 51 requests to open the Out Loud archive.
const MEDIA_MANIFEST = path.join(ROOT, 'media-manifest.json');
let mediaDurations = {};
let mediaKey = '';

app.get('/api/media', (_req, res) => {
  let stat;
  try {
    stat = fs.statSync(MEDIA_MANIFEST);
  } catch {
    return res.json({});
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (key !== mediaKey) {
    const manifest = JSON.parse(fs.readFileSync(MEDIA_MANIFEST, 'utf8'));
    mediaDurations = {};
    for (const entry of Object.values(manifest)) {
      if (entry.playable && entry.seconds) {
        mediaDurations[sitesHref(entry.playable)] = entry.seconds;
      }
    }
    mediaKey = key;
  }
  res.json(mediaDurations);
});

// --- tags -------------------------------------------------------------------
//
// Tags are public to read and writable only through the admin port: ADMIN_PORT, bound
// to loopback and never proxied by nginx, so the only way to reach it from outside the
// box is an SSH tunnel (the `palindex` shell alias does this) --
//
//   ssh -N -L 18081:127.0.0.1:8081 deploy@167.233.141.19
//   open http://localhost:18081/archive-index.html
//
// 18081 on your side, not 8081, which is the admin port of a local `npm run serve`. The
// two must not share a port, or a tunnel that failed to bind would leave you tagging the
// local database while believing it was production.
//
// The port the request arrived on is the whole check. Not the remote address, which is
// 127.0.0.1 for nginx's proxied traffic too, and not a header, which a client can set.
// So nothing secret is held in a page, where the archived pages' own scripts -- running
// on this same origin -- could read it.

const ADMIN_PORT = Number(process.env.ADMIN_PORT || 8081);

function isAdmin(req) {
  return req.socket.localPort === ADMIN_PORT;
}

// Writes reject anything but a same-origin JSON request. That shuts out a site you happen
// to visit while the tunnel is open: a cross-origin JSON POST needs a CORS preflight this
// server never answers, and a form post cannot set the content type.
function adminOnly(req, res, next) {
  if (!isAdmin(req)) return res.status(404).json({ error: 'not found' });
  if (req.method !== 'GET') {
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON only' });
    const origin = req.get('origin');
    if (origin && !sameHost(origin, req.get('host'))) {
      return res.status(403).json({ error: 'cross-origin' });
    }
  }
  next();
}

// An Origin of 'null' (sandboxed frames, file://) is not a URL, and is not us either.
function sameHost(origin, host) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Tags are stored comma-separated, so a comma cannot be part of one. Whitespace is
// collapsed, and a tag repeated in different case is kept once, as first spelled.
const TAG_MAX = 60;
const TAGS_MAX = 50;

function cleanTags(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const tags = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return null;
    const tag = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.length > TAGS_MAX ? null : tags;
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// Whether this is the admin port, so a page knows to show the editing controls. Public
// pages get a 404 like any unknown route, and show tags read-only.
app.get('/api/admin', adminOnly, (_req, res) => res.json({ admin: true }));

// Every tagged page, for the index to show and filter on. Small: one row per tagged page.
app.get('/api/tags', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  const rows = handle.prepare("SELECT local_path, tags FROM page_meta WHERE tags <> ''").all();
  res.json(Object.fromEntries(rows.map((r) => [r.local_path, splitTags(r.tags)])));
});

// Replaces one page's whole tag list. Whole-list rather than add/remove calls, so a
// retried request lands in the same state and two tabs cannot interleave half an edit.
//
// A connection of its own, opened per write: the shared handle is read-only, and writes
// are rare enough that holding a second handle open (and reopening it whenever the file
// is rebuilt) is not worth it. updated_at marks the row as edited here, which is what
// stops `npm run db` re-importing an older tags.csv over it -- see importTags.
app.post('/api/tags', adminOnly, express.json({ limit: '16kb' }), (req, res) => {
  const localPath = String(req.body?.path || '');
  const tags = cleanTags(req.body?.tags);
  if (!localPath || !tags) return res.status(400).json({ error: 'path and tags[] required' });

  let rw;
  try {
    rw = new Database(DB_PATH, { fileMustExist: true });
  } catch {
    return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  }

  try {
    ensureUpdatedAt(rw);
    const known = rw.prepare('SELECT 1 FROM pages WHERE local_path = ?').get(localPath);
    if (!known) return res.status(404).json({ error: 'not indexed', local_path: localPath });

    rw.prepare(
      `INSERT INTO page_meta (local_path, tags, updated_at) VALUES (@path, @tags, @now)
       ON CONFLICT(local_path) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at`,
    ).run({ path: localPath, tags: tags.join(', '), now: new Date().toISOString() });

    res.json({ local_path: localPath, tags });
  } finally {
    rw.close();
  }
});

// The hand-edited columns as tags.csv, for `npm run tags:pull` to bring down and commit.
// Admin-only: notes are not meant for the public site.
app.get('/api/tags.csv', adminOnly, (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  res.type('text/csv').send(toCsv(selectTagged(handle)));
});

// The archived pages are 2001-era and full of odd filenames; serve them as-is
// rather than letting express guess at extensions.
app.use('/sites', express.static(path.join(ROOT, 'sites')));

// --- shareable links --------------------------------------------------------
//
// ?p= names a page under sites/, and resolving it here rather than in the browser is
// what makes a shared link open on the right page immediately.
//
// The alternative -- letting the markup's default src load and having the shell swap
// it afterwards -- always shows the wrong page first. The browser starts fetching a
// src the moment it parses the tag, well before any module has run, so the default is
// not a fallback but an unconditional first load. Measured against production that
// left the wrong page on screen for roughly 700ms: ~500ms for the module graph, then
// a further round trip to check the path existed before navigating.
//
// The query is parsed with the same regex the client uses rather than through
// req.query, so both sides agree exactly. express would decode the value a second
// time (corrupting a filename containing a literal %) and would read a '+' as a
// space; these pages are full of odd 2001-era filenames, so neither is hypothetical.
const INDEX_PATH = path.join(ROOT, 'public', 'index.html');
const ARCHIVE_INDEX_PATH = path.join(ROOT, 'archive-index.html');
const SITES_ROOT = path.join(ROOT, 'sites');
const IFRAME_SRC = /(<iframe[^>]*\bid="frame"[^>]*\bsrc=")[^"]*(")/;
// archive-index.html's frame starts with no src at all: an empty src="" would load the
// index inside itself.
const IFRAME_ID = /(<iframe[^>]*\bid="frame")/;

// Reread when the file changes, so editing the shell or rebuilding the index does not
// need a restart.
const templates = new Map();
function template(file) {
  const stat = fs.statSync(file);
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = templates.get(file);
  if (cached?.key === key) return cached.html;
  const html = fs.readFileSync(file, 'utf8');
  templates.set(file, { key, html });
  return html;
}

// The URL for ?p=, or '' if it names nothing servable. Checked against disk here, so
// a link to a page that has since been rebuilt away falls back to the default rather
// than opening a 404 inside the frame.
function sharedSrc(originalUrl) {
  const at = originalUrl.indexOf('?');
  if (at === -1) return '';

  const match = /[?&]p=([^&]*)/.exec(originalUrl.slice(at));
  if (!match) return '';

  let page;
  try {
    page = decodeURIComponent(match[1]);
  } catch {
    return ''; // malformed escape
  }

  // The value becomes a path under sites/, so it must not climb out of it or name an
  // absolute path of its own.
  if (!page || page.startsWith('/') || page.split('/').includes('..')) return '';

  const abs = path.join(SITES_ROOT, page);
  if (!abs.startsWith(SITES_ROOT + path.sep)) return '';

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    // Not under this spelling; a link from before a rename may still find it.
    page = caseInsensitivePath(page);
    if (!page) return '';
    stat = fs.statSync(path.join(SITES_ROOT, page));
  }
  if (!stat.isFile()) return '';

  return sitesHref(page);
}

function sitesHref(page) {
  return '/sites/' + page.split('/').map(encodeURIComponent).join('/');
}

// The on-disk spelling of a path under sites/ that only matches when case is ignored, or
// '' if it matches nothing, or more than one thing, in some directory along the way.
//
// Every saved path is lowercase now, but shared links and bookmarks from before the crawl
// roots were lowercased still carry the old capitals -- geocities.com/SiliconValley and
// friends. Linux matches case exactly, so those would 404 without this. Only reached on a
// miss, so the directory reads cost nothing on the normal path.
function caseInsensitivePath(page) {
  const segments = page.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return '';

  let dir = SITES_ROOT;
  const found = [];
  for (const segment of segments) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return '';
    }
    const name = names.includes(segment)
      ? segment
      : (() => {
          const lower = segment.toLowerCase();
          const matches = names.filter((n) => n.toLowerCase() === lower);
          // Two names differing only in case: no way to know which was meant.
          return matches.length === 1 ? matches[0] : '';
        })();
    if (!name) return '';
    found.push(name);
    dir = path.join(dir, name);
  }
  return found.join('/');
}

// A request under /sites that the static handler missed. If the file exists under
// different capitals, redirect to it, so the browser's address and every relative link
// inside the page resolve against the real spelling from then on.
//
// 302 rather than 301: a 301 is cached by the browser indefinitely, and a page that is
// later re-crawled or renamed again should not stay pinned to a stale redirect.
app.use('/sites', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  let page;
  try {
    page = decodeURIComponent(req.path).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return next(); // malformed escape
  }
  if (!page) return next();

  const real = caseInsensitivePath(page);
  if (!real || real === page) return next();

  const query = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  // A directory keeps its trailing slash, so express.static serves its index.html.
  const slash = req.path.endsWith('/') ? '/' : '';
  res.redirect(302, sitesHref(real) + slash + query);
});

// The page with ?p= already in its frame, for either viewer.
function withSharedPage(file, req) {
  const html = template(file);
  const src = sharedSrc(req.originalUrl);
  if (!src) return html;

  if (IFRAME_SRC.test(html)) return html.replace(IFRAME_SRC, `$1${src}$2`);
  if (IFRAME_ID.test(html)) return html.replace(IFRAME_ID, `$1 src="${src}"`);

  // Silence here would look exactly like the bug this replaced.
  console.warn(`[serve] no #frame in ${path.basename(file)}; ?p= ignored`);
  return html;
}

// Ahead of the static middleware, which would otherwise serve index.html for '/'
// untouched.
app.get('/', (req, res) => {
  res.type('html').send(withSharedPage(INDEX_PATH, req));
});

// Generated by `npm run index`; handy to have alongside the shell. Takes ?p= the same
// way the shell does.
app.get('/archive-index.html', (req, res) => {
  if (!fs.existsSync(ARCHIVE_INDEX_PATH)) {
    res.status(404).type('text').send('archive-index.html not built yet; run `npm run index`.');
    return;
  }
  res.type('html').send(withSharedPage(ARCHIVE_INDEX_PATH, req));
});

app.use(express.static(path.join(ROOT, 'public')));

app.listen(PORT, HOST, () => {
  console.log(`  shell   http://localhost:${PORT}/`);
  console.log(`  index   http://localhost:${PORT}/archive-index.html`);
  console.log(`  sites   http://localhost:${PORT}/sites/`);
});

// The same app again on the admin port, which is what unlocks tag editing (see isAdmin).
// Always loopback, whatever HOST says: HOST=0.0.0.0 exists to reach the public site from
// a phone, and must never put the admin port on the network with it.
app.listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`  admin   http://localhost:${ADMIN_PORT}/archive-index.html  (tag editing; loopback only)`);
});
