// Set, show or clear the title a page is listed under (page_meta.title_override).
//
//   npm run title -- <page> "New title"     set it
//   npm run title -- <page> ""              clear it, back to the page's own <title>
//   npm run title -- <page>                 show both
//   npm run title -- --file titles.tsv      many at once: one "<page><TAB><title>" per line
//
// <page> is however you have it to hand: a local path (birzeit.edu/bzunews/1999/mar/9.html),
// a /sites/ path, a palestineonline.net link (with ?p=), or the page's original URL.
//
// Writes tags.csv, which is where titles live, and the local archive.db, so the address
// bar and window title show the change at once; search keeps its cached list until the
// next `npm run db`. To publish: commit tags.csv, deploy, then run `npm run db` on the
// server -- it takes every title from tags.csv (see importTags).

import fs from 'fs';
import Database from 'better-sqlite3';

import { ensureUpdatedAt, parseCsv, toCsv } from './tags-csv.js';

const CSV = 'tags.csv';
const DB = 'archive.db';

const argv = process.argv.slice(2);
let pairs;
if (argv[0] === '--file') {
  pairs = fs
    .readFileSync(argv[1], 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.split('\t'));
} else if (argv.length) {
  pairs = [argv.length > 1 ? [argv[0], argv[1]] : [argv[0]]];
} else {
  console.error('usage: npm run title -- <page> ["New title"]   |   npm run title -- --file titles.tsv');
  process.exit(1);
}

const db = new Database(DB, { fileMustExist: true });
ensureUpdatedAt(db);

// The page as the archive knows it, from any of the forms above; null when it is not indexed.
function resolve(page) {
  let s = page.trim();
  try {
    const url = new URL(s);
    if (url.searchParams.get('p')) s = url.searchParams.get('p');
  } catch {}
  s = s.replace(/^\/?sites\//, '');
  const byPath = db.prepare('SELECT local_path, title FROM pages WHERE local_path = ?');
  const found = byPath.get(s.replace(/^\//, '').toLowerCase());
  if (found) return found;
  // An original URL: compare without scheme, www., port or a trailing slash.
  const bare = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\d?\./i, '').replace(/:\d+(?=\/|$)/, '').replace(/\/$/, '').toLowerCase();
  const want = bare(s);
  const host = want.split('/')[0];
  return (
    db
      .prepare('SELECT local_path, title, display_url FROM pages WHERE host = ?')
      .all(host)
      .find((r) => bare(r.display_url) === want || bare(r.display_url) === `${want}/index.html`) ?? null
  );
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8')).filter((r) => r.local_path);
const byPath = new Map(rows.map((r) => [r.local_path, r]));
const save = db.prepare(
  `INSERT INTO page_meta (local_path, title_override) VALUES (?, ?)
   ON CONFLICT(local_path) DO UPDATE SET title_override = excluded.title_override`,
);

let changed = 0;
let failed = 0;
for (const [page, title] of pairs) {
  const found = resolve(page);
  if (!found) {
    console.error(`not in the archive: ${page}`);
    failed++;
    continue;
  }
  const row = byPath.get(found.local_path);
  if (title === undefined) {
    console.log(`${found.local_path}\n  page title: ${found.title || '(none)'}\n  listed as:  ${row?.title_override || '(the page title)'}`);
    continue;
  }
  const next = title.trim();
  if (row) row.title_override = next;
  else if (next) {
    const added = { local_path: found.local_path, tags: '', notes: '', title_override: next };
    rows.push(added);
    byPath.set(found.local_path, added);
  }
  save.run(found.local_path, next);
  console.log(`${found.local_path}: ${next ? `"${next}"` : 'back to the page title'}`);
  changed++;
}
db.close();

if (changed) {
  rows.sort((a, b) => (a.local_path < b.local_path ? -1 : a.local_path > b.local_path ? 1 : 0));
  fs.writeFileSync(CSV, toCsv(rows));
  console.log(`Updated ${CSV} and ${DB}: ${changed} ${changed === 1 ? 'title' : 'titles'}.`);
}
if (failed) process.exit(1);
