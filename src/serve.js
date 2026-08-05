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

app.use(express.static(path.join(ROOT, 'public')));

app.listen(PORT, () => {
  console.log(`  shell   http://localhost:${PORT}/`);
  console.log(`  index   http://localhost:${PORT}/archive-index.html`);
  console.log(`  sites   http://localhost:${PORT}/sites/`);
});
