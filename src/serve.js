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
import mime from 'mime-types';

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
              display_title, tags, notes, capture_count, frame_parent, frame_home, frame_slot
       FROM page_view WHERE local_path = ?`,
    )
    .get(localPath);

  if (!row) return res.status(404).json({ error: 'not indexed', local_path: localPath });
  res.json(row);
});

// --- frames -------------------------------------------------------------------

// Where a page has to be opened so it is never shown bare: the outermost frameset it
// belongs in, then each frame to fill on the way down to it. A page that stands on its
// own comes back as its own top with no steps.
//
// frame_home and frame_slot come from `npm run db` (see frameHomes in build-db.js). A
// database built before those columns existed has neither, and every page stands alone.
function placement(handle, localPath) {
  const steps = [];
  let page = localPath;
  const seen = new Set([page]);
  const home = handle.prepare('SELECT frame_home, frame_slot FROM pages WHERE local_path = ?');
  for (let depth = 0; depth < 4; depth++) {
    let row;
    try {
      row = home.get(page);
    } catch {
      break; // no frame_home column yet
    }
    if (!row?.frame_home || seen.has(row.frame_home)) break;
    steps.unshift({ frame: row.frame_slot, page });
    page = row.frame_home;
    seen.add(page);
  }
  return { top: page, steps };
}

app.get('/api/place', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  const localPath = decodeURIComponent(String(req.query.path || '')).replace(/^\/?sites\//, '');
  if (!localPath) return res.status(400).json({ error: 'path required' });
  res.json(placement(handle, localPath));
});

// Which frame of a frameset each of its pages belongs in, for the shell to send a link
// clicked in one pane to the pane it was written for. Mostly that undoes the scraper
// having stripped <base target> -- a nav frame's links otherwise open inside the nav.
app.get('/api/frameset', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  const localPath = decodeURIComponent(String(req.query.path || '')).replace(/^\/?sites\//, '');
  let rows = [];
  try {
    rows = handle.prepare('SELECT local_path, frame_slot FROM pages WHERE frame_home = ?').all(localPath);
  } catch {
    // no frame_home column yet
  }
  res.json(Object.fromEntries(rows.map((r) => [r.local_path, r.frame_slot])));
});

// The fallback pool for the toolbar's Random button, used only when no page is tagged
// "entry" or "random" (see randomPool below).
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

// The pages tagged "entry" or "random", which is what Random deals from: front doors
// picked by hand. "entry" is the set the address bar's ▼ list shows; "random" adds a
// page to the draw without listing it there. Only if nothing is tagged either way does
// the index-page heuristic above stand in, so the button never comes up empty.
const RANDOM_TAGS = new Set(['entry', 'random']);

function randomPool(handle) {
  const tagged = handle
    .prepare(`SELECT local_path, tags FROM page_view WHERE tags <> ''`)
    .all()
    .filter((r) => splitTags(r.tags).some((t) => RANDOM_TAGS.has(t.toLowerCase())))
    .map((r) => r.local_path);
  if (tagged.length) return tagged;
  return handle
    .prepare(`SELECT local_path FROM page_view WHERE ${RANDOM_POOL}`)
    .all()
    .map((r) => r.local_path);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

app.get('/api/random', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  // Excluding the current page, so clicking Random twice in a row always moves.
  const not = decodeURIComponent(String(req.query.not || '')).replace(/^\/?sites\//, '');
  const pool = randomPool(handle).filter((p) => p !== not);
  if (!pool.length) return res.status(404).json({ error: 'no pages indexed' });

  const pick = pool[Math.floor(Math.random() * pool.length)];
  const row = handle
    .prepare('SELECT local_path, display_url, display_title FROM page_view WHERE local_path = ?')
    .get(pick);
  res.json(row);
});

// The whole pool in random order, dealt one page per click so a session never repeats.
//
// Shuffling once beats drawing one at a time and excluding what has been seen: near the
// end of the pool a fresh draw rarely lands on an unseen page, so every click would fire
// a burst of retries. Dealing from a shuffled deck is one request for the session and
// O(1) per click.
app.get('/api/random/deck', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  const paths = shuffle(randomPool(handle));
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

function cleanTags(input, max = TAGS_MAX) {
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
  return tags.length > max ? null : tags;
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

// --- search -----------------------------------------------------------------

// What the address bar searches as you type: every page's address and title. All ~11k
// rows are read once per database file and kept in memory, so a keystroke is a filter
// over an array rather than a query; reread when `npm run db` replaces the file, the same
// way the read handle is reopened.
const SEARCH_LIMIT = 100;
let searchRows = null;
let searchHandle = null;

// An address as people type it: no scheme, no www, lowercase.
function bareUrl(url) {
  return String(url || '').replace(/^\s*https?:\/\/(www\d?\.)?/i, '').replace(/^www\d?\./i, '').toLowerCase();
}

function searchIndex(handle) {
  if (searchHandle !== handle) {
    // Every page, frames included: the shell opens a frame's page inside its frameset
    // (see /api/place), so finding one by its own title or address is no longer a way to
    // land on a bare nav strip.
    searchRows = handle
      .prepare(`SELECT local_path, crawl_root, display_url, display_title FROM page_view`)
      .all()
      .map((r) => ({
        ...r,
        url: bareUrl(r.display_url),
        // The address of the folder an index page stands for, so typing that folder
        // finds its index first.
        folder: bareUrl(r.display_url).replace(/(^|\/)(index|default)\.[a-z]+$/, '$1'),
        title: (r.display_title || '').toLowerCase(),
      }));
    searchHandle = handle;
  }
  return searchRows;
}

// Every word must appear somewhere in the address or title. Ranked: the page at exactly
// the address typed -- a folder's index page for the folder -- then addresses that start
// with what was typed, then addresses containing it whole, then by how many of the words
// are in the address itself -- so "birzeit news" puts birzeit.edu/bzunews/ above the bare
// home page whose title happens to mention news -- then shorter addresses first. Below an
// exact match the sites then take turns, each one's best page before any one's second,
// across tiers too: otherwise the one site whose address starts with "gaza" fills the
// list before any page that only has gaza further in, and a query matching many sites
// ("geocities") goes to whichever has the shortest addresses.
app.get('/api/search', (req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  const query = bareUrl(String(req.query.q || '')).trim();
  if (!query) return res.json({ query, total: 0, results: [] });
  const words = query.split(/\s+/);

  const scored = [];
  for (const row of searchIndex(handle)) {
    if (!words.every((w) => row.url.includes(w) || row.title.includes(w))) continue;
    const exact = row.url === query || row.folder === query || row.folder === `${query}/`;
    const rank = exact ? -1 : row.url.startsWith(query) ? 0 : row.url.includes(query) ? 1 : 2;
    const inUrl = words.filter((w) => row.url.includes(w)).length;
    scored.push({ rank, inUrl, row });
  }
  const byScore = (a, b) =>
    a.rank - b.rank
    || b.inUrl - a.inUrl
    || a.row.url.length - b.row.url.length
    || a.row.url.localeCompare(b.row.url);
  scored.sort(byScore);
  const perSite = new Map();
  for (const s of scored) {
    if (s.rank < 0) { s.nth = -1; continue; }
    s.nth = perSite.get(s.row.crawl_root) || 0;
    perSite.set(s.row.crawl_root, s.nth + 1);
  }
  scored.sort((a, b) => a.nth - b.nth || byScore(a, b));

  res.json({
    query,
    total: scored.length,
    results: scored.slice(0, SEARCH_LIMIT).map(({ row: { local_path, display_url, display_title } }) => ({
      local_path,
      display_url,
      display_title,
    })),
  });
});

// Every page tagged "entry" -- the front doors you picked -- with the address and
// title the shell's address bar dropdown lists them by, sorted by address so a site's
// pages sit together. Read on each open of the dropdown, so a page tagged a moment ago
// is already in it.
app.get('/api/entries', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });

  const rows = handle
    .prepare(
      `SELECT local_path, display_url, display_title, tags FROM page_view WHERE tags <> ''`,
    )
    .all()
    .filter((r) => splitTags(r.tags).some((t) => t.toLowerCase() === 'entry'))
    // Its other tags, which the ▼ list groups the entries under.
    .map(({ local_path, display_url, display_title, tags }) => ({
      local_path,
      display_url,
      display_title,
      tags: splitTags(tags).filter((t) => t.toLowerCase() !== 'entry'),
    }));

  const key = (r) => r.display_url.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
  rows.sort((a, b) => key(a).localeCompare(key(b)));
  res.json(rows);
});

// The wallpaper tiles the shell cycles through when the background is clicked, in name
// order, ignoring case. Read from the folder on each request, so a tile dropped into
// public/assets/tiles joins the cycle without a restart.
const TILES_DIR = path.join(ROOT, 'public', 'assets', 'tiles');
const TILE_FILE = /\.(gif|jpe?g|png|webp)$/i;

function listTiles() {
  let names;
  try {
    names = fs.readdirSync(TILES_DIR).filter((name) => TILE_FILE.test(name));
  } catch {
    names = [];
  }
  return names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

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

// The order of the address bar's tag groups (see renderEntries in public/app/api.js):
// lowercased tags, first group first. Groups it does not name follow, biggest first.
// Empty on a database built before the table existed.
function tagOrder(handle) {
  try {
    return handle.prepare('SELECT tag FROM tag_order ORDER BY position').all().map((r) => r.tag);
  } catch {
    return [];
  }
}

app.get('/api/tag-order', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  res.json(tagOrder(handle));
});

// Replaces the whole order, for the same reason a page's tags are replaced whole.
app.post('/api/tag-order', adminOnly, express.json({ limit: '16kb' }), (req, res) => {
  // Every tag the archive has could be a group, so not held to one page's limit.
  const order = cleanTags(req.body?.order, 1000);
  if (!order) return res.status(400).json({ error: 'order[] required' });
  const tags = order.map((t) => t.toLowerCase());

  let rw;
  try {
    rw = new Database(DB_PATH, { fileMustExist: true });
  } catch {
    return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  }
  try {
    rw.exec('CREATE TABLE IF NOT EXISTS tag_order (tag TEXT PRIMARY KEY, position INTEGER NOT NULL)');
    const put = rw.prepare('INSERT INTO tag_order (tag, position) VALUES (?, ?)');
    rw.transaction(() => {
      rw.prepare('DELETE FROM tag_order').run();
      tags.forEach((t, i) => put.run(t, i));
    })();
    res.json(tags);
  } finally {
    rw.close();
  }
});

// The order as tag-order.txt, for `npm run tags:pull`.
app.get('/api/tag-order.txt', adminOnly, (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).json({ error: 'no archive.db -- run: npm run db' });
  const tags = tagOrder(handle);
  res.type('text/plain').send(tags.length ? `${tags.join('\n')}\n` : '');
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
//
// Except for the type. What the scraper saved from barghouti.com/folklore/abusami.asp is
// the HTML that page produced, but express types files by extension, so it went out as
// application/octet-stream -- .php as application/x-httpd-php, .pl as application/x-perl
// -- and the browser treated 131 archived pages as downloads, which the frame's sandbox
// then silently refused: they showed up in search and never opened. So a file the
// database lists as a page is served as HTML whatever it is called (two robots.txt and a
// .jpe among them are saved pages too). Other files with a server-side extension -- hit
// counters that are really GIFs, track.dll, a Lycos script saved as .js.php -- are typed
// by their first bytes. Anything else keeps the type its extension gives it.
const SERVER_SIDE = /\.(asp|aspx|php\d?|phtml|cgi|pl|jsp|cfm|dll)$/i;
const SNIFF = [
  [/^GIF8/, 'image/gif'],
  [/^\xff\xd8\xff/, 'image/jpeg'],
  [/^\x89PNG/, 'image/png'],
  [/^\s*(<!--|<!doctype|<html|<head|<body|<title|<table|<script|<meta|<p\b|<br|<center|<font|<frameset)/i, 'text/html; charset=utf-8'],
];
let pagePaths = null;
let pagePathsHandle = null;

function isArchivedPage(localPath) {
  const handle = database();
  if (!handle) return false;
  if (pagePathsHandle !== handle) {
    pagePaths = new Set(handle.prepare('SELECT local_path FROM pages').all().map((r) => r.local_path));
    pagePathsHandle = handle;
  }
  return pagePaths.has(localPath.toLowerCase());
}

// The type an archived file should go out as, or '' to leave it to its extension.
function archivedType(file) {
  const localPath = path.relative(SITES_ROOT, file).split(path.sep).join('/');
  if (/\.s?html?$/i.test(localPath)) return '';
  if (isArchivedPage(localPath)) return 'text/html; charset=utf-8';
  if (!SERVER_SIDE.test(localPath)) return '';
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('latin1');
  } catch {
    return '';
  }
  return SNIFF.find(([re]) => re.test(head))?.[1] || '';
}

function typeArchivedFile(res, file) {
  const type = archivedType(file);
  if (type) res.setHeader('Content-Type', type);
}

// --- keeping the archive inside the frame -------------------------------------

// Everything an archived page could do to get out of the shell's frame, and what stops
// it, is listed where each piece lives. The server's part:
//
//   A /sites page opened on its own -- a middle-click, a search engine, a bookmark --
//   is redirected to the shell with ?p=, so it is never shown bare in a tab. Told apart
//   from the shell's own frame by Sec-Fetch-Dest: 'document' for a tab, 'iframe' or
//   'frame' inside one.
//
//   A navigation to a file a browser cannot show -- 540 links reach .zip, .exe, .doc,
//   RealAudio and the like -- gets a page saying so instead of a download.
//
//   Every archived file goes out with a Content-Security-Policy that keeps it to this
//   site: no frames, form posts, scripts, images or plugins from the live web. 806 pages
//   still ask live hosts for counters and banners, five load live scripts (Angelfire's
//   ad code among them), and 29 frame live sites -- domains that may belong to anyone
//   today. Inline scripts and eval stay allowed: the pages are made of them.
const ARCHIVE_CSP = [
  "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "frame-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
].join('; ');
// The shell's own frame may only ever show this site.
const SHELL_CSP = "frame-src 'self'";

// What a browser shows in a frame rather than handing to a download.
const VIEWABLE = /^(text\/(html|plain)|image\/(gif|jpeg|png|bmp|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)|audio\/(mpeg|wave?|x-wav|ogg)|video\/(mp4|webm|ogg)|application\/pdf)\b/;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function downloadNotice(file, type, size) {
  const name = path.basename(file);
  const kb = size < 1024 ? `${size} bytes` : `${Math.round(size / 1024)} KB`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title></head>
<body style="font: 13px Arial, sans-serif; margin: 32px; color: #000; background: #fff">
<h3 style="font-size: 15px">This file can't be opened here</h3>
<p><b>${escapeHtml(name)}</b> (${escapeHtml(type || 'unknown type')}, ${kb}) was saved with this site,
but it is a download, and the archive doesn't hand out downloads.</p>
<p><a href="javascript:history.back()">Back</a></p>
</body></html>`;
}

app.use('/sites', (req, res, next) => {
  res.setHeader('Content-Security-Policy', ARCHIVE_CSP);
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  let localPath;
  try {
    localPath = decodeURIComponent(req.path).replace(/^\/+/, '');
  } catch {
    return next();
  }
  if (localPath.split('/').includes('..')) return next();
  if (!localPath || req.path.endsWith('/')) localPath = path.posix.join(localPath, 'index.html');
  const file = path.join(SITES_ROOT, localPath);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return next(); // missing, or under other capitals: the redirect handler below decides
  }
  if (!stat.isFile()) return next();

  const type = archivedType(file) || mime.lookup(file) || '';
  const viewable = VIEWABLE.test(type);

  // A search engine fetches /sites pages bare -- it sends no Sec-Fetch-Dest, so the
  // redirect below never reaches it. The canonical link tells it the page's real address
  // is the shell's ?p= link, so that is what it lists, not the page outside the shell.
  if (/^text\/html/.test(type)) res.setHeader('Link', `<${SITE_URL}${shareLink(localPath)}>; rel="canonical"`);

  const dest = req.get('sec-fetch-dest');
  if (dest !== 'document' && dest !== 'iframe' && dest !== 'frame') return next();

  if (dest === 'document' && /^text\/html/.test(type)) {
    return res.redirect(302, shareLink(localPath));
  }
  if (!viewable) {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(downloadNotice(file, type, stat.size));
  }
  next();
});

app.use('/sites', express.static(path.join(ROOT, 'sites'), { setHeaders: typeArchivedFile }));

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

// A random page tagged "entry" -- the same set the address bar dropdown lists -- as a
// frame src, or '' if none is tagged or the drawn page is not on disk.
function randomEntrySrc() {
  const handle = database();
  if (!handle) return '';
  const entries = handle
    .prepare(`SELECT local_path, tags FROM page_view WHERE tags <> ''`)
    .all()
    .filter((r) => splitTags(r.tags).some((t) => t.toLowerCase() === 'entry'));
  if (!entries.length) return '';
  const { local_path } = entries[Math.floor(Math.random() * entries.length)];
  return fs.existsSync(path.join(SITES_ROOT, local_path)) ? sitesHref(local_path) : '';
}

// The page with ?p= already in its frame, for either viewer. `fallback` is the frame's
// src when the URL names no page.
//
// A page that belongs inside a frameset is opened as that frameset, with the steps to put
// it in its frame written onto the iframe as data-place -- so the bare frame is never
// what loads, not even for a moment. The shell carries the steps out (see placeFrames).
function withSharedPage(file, req, fallback = '') {
  let html = template(file);
  let src = sharedSrc(req.originalUrl) || fallback;
  if (!src) return html;

  const handle = database();
  if (handle) {
    const { top, steps } = placement(handle, decodeURIComponent(src.replace(/^\/sites\//, '')));
    if (steps.length) {
      src = sitesHref(top);
      const attr = JSON.stringify(steps).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      html = html.replace(IFRAME_ID, `$1 data-place="${attr}"`);
    }
  }

  if (IFRAME_SRC.test(html)) return html.replace(IFRAME_SRC, `$1${src}$2`);
  if (IFRAME_ID.test(html)) return html.replace(IFRAME_ID, `$1 src="${src}"`);

  // Silence here would look exactly like the bug this replaced.
  console.warn(`[serve] no #frame in ${path.basename(file)}; ?p= ignored`);
  return html;
}

// --- search engines ---------------------------------------------------------------

// The public address. The shell's links, the canonical links and the sitemap all name
// pages by it, whichever host a request came in on.
const SITE_URL = (process.env.SITE_URL || 'https://palestineonline.net').replace(/\/$/, '');
const SITE_SUMMARY =
  'From Palestine Online, a curated archive of websites created by Palestinians or about ' +
  'Palestine in the late 90s to early-mid 2000s.';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The shell's own link to a page: /?p=host/path, each segment encoded and the slashes kept.
function shareLink(localPath) {
  return `/?p=${localPath.split('/').map(encodeURIComponent).join('/')}`;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// What a search result and a link preview say about one archived page: its own title, its
// original address and when it was captured, then a line on the archive it belongs to.
function pageMeta(localPath) {
  const handle = database();
  const row = handle
    ?.prepare('SELECT local_path, display_url, display_title, timestamp FROM page_view WHERE local_path = ?')
    .get(localPath.toLowerCase());
  if (!row) return null;
  const [, y, m, d] = /^(\d{4})(\d{2})(\d{2})/.exec(row.timestamp || '') || [];
  const captured = y ? `, captured ${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}` : '';
  const address = row.display_url.replace(/^https?:\/\//, '');
  const name = (row.display_title || '').trim();
  return {
    title: `${name || address} — Palestine Online`,
    description: `${name ? `${name} — ` : ''}${address}${captured}. ${SITE_SUMMARY}`,
    url: `${SITE_URL}${shareLink(row.local_path)}`,
  };
}

// Writes a page's metadata into the shell: <title>, the description, the canonical link
// and the og: tags. Without a page -- the bare address, or a ?p= naming nothing -- the
// archive's own, as written in index.html, stand.
function withPageMeta(html, localPath) {
  const meta = localPath && pageMeta(localPath);
  if (!meta) return html;
  const title = escapeAttr(meta.title);
  const description = escapeAttr(meta.description);
  const url = escapeAttr(meta.url);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
}

// Crawl everything but the API; point crawlers at the sitemap.
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

// Every archived page by its ?p= link, so each can be found under its own name. Framed
// pages are listed too: their link opens them inside their frameset. The panes a frameset
// starts on -- nav strips, title bars -- are left out; their frameset is listed instead.
// Built from the database on request; at ~11k URLs it is well inside one sitemap's limit.
app.get('/sitemap.xml', (_req, res) => {
  const handle = database();
  if (!handle) return res.status(503).type('text/plain').send('no archive.db -- run: npm run db');
  const rows = handle.prepare('SELECT local_path FROM pages WHERE frame_parent IS NULL ORDER BY local_path').all();
  const xmlEscape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urls = [`${SITE_URL}/`, ...rows.map((r) => `${SITE_URL}${shareLink(r.local_path)}`)];
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join('\n') +
      '\n</urlset>\n',
  );
});

// Ahead of the static middleware, which would otherwise serve index.html for '/'
// untouched.
//
// The tile list goes into the page itself, so the inline script at the top of <head> can
// put the wallpaper up before the first paint -- waiting for app/wallpaper.js meant a
// third of a second of the stylesheet's default tile first. '<' is escaped so no file
// name can close the script element early.
const WALLPAPER_TILES = /(<script type="application\/json" id="wallpaper-tiles">)[^<]*(<\/script>)/;

//
// A bare https://palestineonline.net/, with no query at all, opens on a random entry page
// rather than the placeholder home.html. The shell then writes that page into the address
// as ?p=, so a reload or a shared link keeps it. A ?p= naming nothing still gets home.html.
app.get('/', (req, res) => {
  const random = req.originalUrl.includes('?') ? '' : randomEntrySrc();
  const tiles = JSON.stringify(listTiles()).replace(/</g, '\\u003c');
  const shared = sharedSrc(req.originalUrl);
  const html = withPageMeta(
    withSharedPage(INDEX_PATH, req, random).replace(WALLPAPER_TILES, (_, open, close) => open + tiles + close),
    shared ? decodeURIComponent(shared.replace(/^\/sites\//, '')) : '',
  );
  // Never cached: each visit to the bare address is a new draw.
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', SHELL_CSP);
  res.type('html').send(html);
});

// Generated by `npm run index`; handy to have alongside the shell. Takes ?p= the same
// way the shell does.
app.get('/archive-index.html', (req, res) => {
  if (!fs.existsSync(ARCHIVE_INDEX_PATH)) {
    res.status(404).type('text').send('archive-index.html not built yet; run `npm run index`.');
    return;
  }
  res.set('Content-Security-Policy', SHELL_CSP);
  res.type('html').send(withSharedPage(ARCHIVE_INDEX_PATH, req));
});

// Tiles are cached for a day rather than revalidated on every load: the round trip to
// confirm one had not changed kept the wallpaper blank for a moment after the first paint.
// A replaced tile reaches returning visitors within a day; a new one is a new name.
app.use('/assets/tiles', express.static(TILES_DIR, { maxAge: '1d' }));

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
