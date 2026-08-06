// Build archive.db -- one row per archived page, for the shell to look up and for you
// to tag by hand.
//
//   node src/build-db.js [--db FILE] [--tags FILE]
//
// Two tables, deliberately:
//
//   pages      generated, dropped and rebuilt on every run
//   page_meta  yours -- tags, notes, corrected titles -- never dropped
//
// Splitting them is what makes "rerun the build" safe. If both lived in one table the
// only thing protecting hand-written tags would be getting an UPSERT column list right,
// and getting it wrong once loses work with no warning.
//
// page_meta is pre-populated with an empty row per page, so opening the file in a GUI
// gives you every local_path already listed and you only ever type in the tags cell.

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import {
  destDir,
  displayUrl,
  findLogs,
  inspectPage,
  localResolver,
  readFileSet,
  replayUrl,
  stampedTimestamp,
  toLocalPath,
} from './page-index.js';
import { importTags } from './tags-csv.js';

function parseArgs(argv) {
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : fallback;
  };
  return {
    // Gitignored: everything in `pages` is reproducible from /sites, so committing it
    // would be binary churn for no gain.
    db: flag('--db', 'archive.db'),
    // Committed instead. This is the only data here that cannot be regenerated.
    tags: flag('--tags', 'tags.csv'),
  };
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
DROP VIEW IF EXISTS page_view;
DROP TABLE IF EXISTS pages;

CREATE TABLE pages (
  local_path    TEXT PRIMARY KEY,   -- 'birzeit.edu/aff/words.html'; joins to /sites/<local_path>
  host          TEXT NOT NULL,      -- 'birzeit.edu' -- for filtering a whole site
  crawl_root    TEXT NOT NULL,      -- dir the log.json sits in, e.g. 'birzeit.edu/aff'
  original_url  TEXT NOT NULL,      -- as recorded: 'http://www.birzeit.edu:80/aff/words.html'
  display_url   TEXT NOT NULL,      -- ':80' stripped -- what the address bar shows
  timestamp     TEXT NOT NULL,      -- capture that produced the file on disk
  captured_at   TEXT NOT NULL,      -- same instant as ISO, so you can sort and filter by date
  replay_url    TEXT NOT NULL,      -- what the Source button opens
  title         TEXT NOT NULL,      -- extracted <title>, '' when the page has none
  byte_length   INTEGER,            -- compressed WARC record size, not the on-disk size
  digest        TEXT,
  capture_count INTEGER NOT NULL,   -- distinct timestamps logged for this URL
  -- NULL for a page that stands on its own -- including a frameset, which is a whole
  -- page made of parts. Otherwise the container that frames this one, which is both the
  -- "do not serve this alone" flag and somewhere to send a reader who lands here anyway.
  frame_parent  TEXT,

  -- How much of what this page points at survived the crawl. Counts are the evidence and
  -- score is the reading of it, so a different reading is a rebuild rather than a recount.
  links_total   INTEGER NOT NULL,   -- <a>/<area>, minus '#' fragments and mailto: and friends
  links_dead    INTEGER NOT NULL,   -- of those, targets we do not hold
  images_total  INTEGER NOT NULL,   -- <img>, <input type=image>, and the background attribute
  images_broken INTEGER NOT NULL,
  score         REAL NOT NULL       -- 0..1, see scorePages
);

CREATE INDEX pages_host ON pages(host);
CREATE INDEX pages_captured_at ON pages(captured_at);
CREATE INDEX pages_frame_parent ON pages(frame_parent);
CREATE INDEX pages_score ON pages(score);

-- Not dropped above. Rebuilds only INSERT OR IGNORE into it.
CREATE TABLE IF NOT EXISTS page_meta (
  local_path     TEXT PRIMARY KEY,
  tags           TEXT NOT NULL DEFAULT '',  -- comma-separated, hand-edited
  notes          TEXT NOT NULL DEFAULT '',
  title_override TEXT NOT NULL DEFAULT ''   -- for the mangled titles
);

-- Read through this rather than the pages table: it resolves title_override and
-- carries tags.
CREATE VIEW page_view AS
  SELECT p.*,
         m.tags,
         m.notes,
         COALESCE(NULLIF(m.title_override, ''), p.title) AS display_title
  FROM pages p
  LEFT JOIN page_meta m USING (local_path);
`;

// '20000917184414' -> '2000-09-17T18:44:14Z'
function toIso(timestamp) {
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp) || [];
  return y ? `${y}-${mo}-${d}T${h}:${mi}:${s}Z` : '';
}

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

async function collectPages() {
  const logs = await findLogs(destDir);
  // Built once for the whole run: every page asks the same question of it, several
  // hundred thousand times over.
  const resolves = localResolver(await readFileSet());
  // local_path -> { crawlRoot, entries: [...] }. A URL can appear in several logs and several
  // times within one, so everything is gathered before a capture is chosen.
  const byPath = new Map();

  for (const logPath of logs) {
    const crawlRoot = path.relative(destDir, path.dirname(logPath)).split(path.sep).join('/');

    let entries;
    try {
      entries = JSON.parse(await fs.readFile(logPath, 'utf-8'));
    } catch (error) {
      console.warn(`⚠️  skipping unreadable ${logPath}: ${error.message}`);
      continue;
    }
    if (!Array.isArray(entries)) {
      console.warn(`⚠️  skipping ${logPath}: expected an array`);
      continue;
    }

    for (const entry of entries) {
      if (!entry?.originalUrl) continue;
      const localPath = toLocalPath(entry.originalUrl);
      if (!byPath.has(localPath)) byPath.set(localPath, { crawlRoot, entries: [] });
      byPath.get(localPath).entries.push(entry);
    }
  }

  const rows = [];
  let missing = 0;
  let stampPicked = 0;
  // child local_path -> the container that frames it. Filled as the loop reads each file
  // and applied afterwards, since a container is as likely to be read after its children
  // as before.
  const framedBy = new Map();

  for (const [localPath, { crawlRoot, entries }] of byPath) {
    const file = path.join(destDir, localPath);
    if (!existsSync(file)) {
      // Logged but never written -- a 404 or an abandoned fetch. Not a page.
      missing++;
      continue;
    }

    const html = await fs.readFile(file, 'utf-8').catch(() => '');
    const { title, frames, refs } = inspectPage(html, resolves);
    const stamp = stampedTimestamp(html);

    // Prefer the capture the file itself claims. Falling back to the first logged entry
    // matters for the handful whose stamp names a timestamp the log never recorded.
    const chosen = entries.find((e) => e.timestamp === stamp) || entries[0];
    if (chosen.timestamp === stamp) stampPicked++;

    const timestamp = stamp || chosen.timestamp || '';

    for (const child of frames) {
      // A page can frame itself: wildlife-pal.org's phpchat.php drives its panes with
      // `phpchat.php?action=...`, and dropping the query to get a local path collapses
      // those onto the file itself. It is the container, so leaving it flagged would both
      // hide a whole page and point a reader at the page they are already on.
      if (child === localPath) continue;

      // 28 children sit inside more than one frameset, and either parent is a truthful
      // answer. Lowest path wins so the choice is stable -- a rebuild that picked a
      // different one each time would churn the column for no reason.
      const previous = framedBy.get(child);
      if (previous === undefined || localPath < previous) framedBy.set(child, localPath);
    }

    rows.push({
      local_path: localPath,
      host: localPath.split('/')[0],
      crawl_root: crawlRoot,
      original_url: chosen.originalUrl,
      display_url: displayUrl(chosen.originalUrl),
      timestamp,
      captured_at: toIso(timestamp),
      replay_url: replayUrl(timestamp, chosen.originalUrl),
      title,
      byte_length: Number(chosen.length) || null,
      digest: chosen.digest || null,
      capture_count: new Set(entries.map((e) => e.timestamp)).size,
      frame_parent: null,
      links_total: refs.linksTotal,
      links_dead: refs.linksDead,
      images_total: refs.imagesTotal,
      images_broken: refs.imagesBroken,
      score: 0,
    });
  }

  // Only pages that made it into `rows` get flagged. A frame src pointing at something
  // never fetched, or fetched but absent from any log, has no row to flag and needs no
  // handling here.
  let framed = 0;
  for (const row of rows) {
    row.frame_parent = framedBy.get(row.local_path) ?? null;
    if (row.frame_parent) framed++;
  }

  return { rows, missing, stampPicked, framed };
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

// How intact a page is, from 0 to 1: the share of its links and images that are still
// here, pulled toward the archive's own average by a few imaginary references.
//
// A plain ratio cannot be compared across pages, which is the one thing a score is for.
// It puts a page holding a single working link at a flat 1.0, above a dense index page
// with 195 of 200 references intact -- and 5,316 pages tie at 1.0, so the top of the
// ranking is mostly pages too small to have had anything to lose. Nudging every page
// toward the mean by PRIOR references costs a dense page almost nothing and holds a
// two-reference page near the middle until it has shown more.
//
// It also answers the 439 pages with no links or images at all, which have no ratio to
// take. They come out at exactly the corpus mean: no evidence, no opinion.
//
// The mean is measured per run rather than hardcoded, so re-crawling a site moves the
// baseline with it.
const PRIOR = 5;

function scorePages(rows) {
  const working = (r) => r.links_total - r.links_dead + (r.images_total - r.images_broken);
  const total = (r) => r.links_total + r.images_total;

  const refs = rows.reduce((n, r) => n + total(r), 0);
  const mean = refs ? rows.reduce((n, r) => n + working(r), 0) / refs : 0;

  for (const row of rows) {
    // Rounded because the extra digits are noise dressed as precision, and a score you
    // may end up reading in a GUI should be legible.
    row.score = Number(((working(row) + PRIOR * mean) / (total(row) + PRIOR)).toFixed(4));
  }

  return mean;
}

// ---------------------------------------------------------------------------
// tags.csv
//
// The DB is disposable; this file is not. Keeping the manual columns in text means they
// survive a deleted archive.db, diff readably in review, and merge like anything else.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(destDir)) {
    console.error('No sites/ directory here. Run this from the repo root.');
    process.exit(1);
  }

  const { rows, missing, stampPicked, framed } = await collectPages();
  if (!rows.length) {
    console.error('No pages found. Has the scraper run?');
    process.exit(1);
  }

  const mean = scorePages(rows);

  const db = new Database(opts.db);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insert = db.prepare(`
    INSERT INTO pages (local_path, host, crawl_root, original_url, display_url, timestamp, captured_at,
                       replay_url, title, byte_length, digest, capture_count, frame_parent,
                       links_total, links_dead, images_total, images_broken, score)
    VALUES (@local_path, @host, @crawl_root, @original_url, @display_url, @timestamp, @captured_at,
            @replay_url, @title, @byte_length, @digest, @capture_count, @frame_parent,
            @links_total, @links_dead, @images_total, @images_broken, @score)
  `);
  db.transaction((rs) => rs.forEach((r) => insert.run(r)))(rows);

  // One meta row per page, so every local_path is already there to type into.
  db.prepare(
    `INSERT OR IGNORE INTO page_meta (local_path) SELECT local_path FROM pages`,
  ).run();

  const imported = await importTags(db, opts.tags);

  // Meta rows whose page has gone: kept, not deleted. A crawl re-run under a slightly
  // different path should not silently bin the tags you wrote.
  const orphanMeta = db
    .prepare('SELECT count(*) n FROM page_meta WHERE local_path NOT IN (SELECT local_path FROM pages)')
    .get().n;

  const tagged = db.prepare("SELECT count(*) n FROM page_meta WHERE tags <> ''").get().n;
  db.close();

  console.log(
    `Wrote ${opts.db}: ${rows.length} pages, ${stampPicked} matched to their on-disk capture` +
      `${missing ? `, ${missing} logged but not on disk` : ''}` +
      `${framed ? `, ${framed} framed by another page` : ''}.`,
  );
  console.log(
    `${(100 * mean).toFixed(1)}% of all links and images survive; ` +
      `${rows.filter((r) => r.links_total + r.images_total === 0).length} pages reference neither.`,
  );
  if (imported) console.log(`Restored ${imported} rows from ${opts.tags} (${tagged} pages tagged).`);
  if (orphanMeta) console.log(`${orphanMeta} meta rows have no matching page -- kept, not deleted.`);
}

await main();
