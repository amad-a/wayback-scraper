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

// The archived pages are 2001-era and full of odd filenames; serve them as-is
// rather than letting express guess at extensions.
app.use('/sites', express.static(path.join(ROOT, 'sites')));

// Generated by `npm run index`; handy to have alongside the shell.
app.get('/archive-index.html', (_req, res) =>
  res.sendFile(path.join(ROOT, 'archive-index.html')),
);

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
const SITES_ROOT = path.join(ROOT, 'sites');
const IFRAME_SRC = /(<iframe[^>]*\bid="frame"[^>]*\bsrc=")[^"]*(")/;

// Reread when the file changes, so editing the shell does not need a restart.
let indexHtml = '';
let indexKey = '';
function indexTemplate() {
  const stat = fs.statSync(INDEX_PATH);
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (key !== indexKey) {
    indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
    indexKey = key;
  }
  return indexHtml;
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
    return '';
  }
  if (!stat.isFile()) return '';

  return '/sites/' + page.split('/').map(encodeURIComponent).join('/');
}

// Ahead of the static middleware, which would otherwise serve index.html for '/'
// untouched.
app.get('/', (req, res) => {
  let html = indexTemplate();
  const src = sharedSrc(req.originalUrl);

  if (src) {
    if (IFRAME_SRC.test(html)) {
      html = html.replace(IFRAME_SRC, `$1${src}$2`);
    } else {
      // Silence here would look exactly like the bug this replaced.
      console.warn('[serve] no #frame src in index.html; ?p= ignored');
    }
  }

  res.type('html').send(html);
});

app.use(express.static(path.join(ROOT, 'public')));

app.listen(PORT, HOST, () => {
  console.log(`  shell   http://localhost:${PORT}/`);
  console.log(`  index   http://localhost:${PORT}/archive-index.html`);
  console.log(`  sites   http://localhost:${PORT}/sites/`);
});
