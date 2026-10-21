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
  flashLinks,
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
  -- Where this page was actually seen: the frameset it opened inside, and the frame it
  -- filled. NULL for a page that stands on its own. Wider than frame_parent -- it also
  -- covers pages a frameset's links opened into one of its frames -- see frameHomes.
  frame_home    TEXT,
  frame_slot    TEXT,               -- the frame's name, or '#2' for the third, unnamed

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
CREATE INDEX pages_frame_home ON pages(frame_home);
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
      // An entry may name its own file: pages whose addresses differ only in their query
      // string (thenation.com/doc.mhtml?i=...) would otherwise all map to one.
      const localPath = entry.localPath || toLocalPath(entry.originalUrl);
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
  // local_path -> the panes and links frameHomes walks.
  const navigation = new Map();

  for (const [localPath, { crawlRoot, entries }] of byPath) {
    const file = path.join(destDir, localPath);
    if (!existsSync(file)) {
      // Logged but never written -- a 404 or an abandoned fetch. Not a page.
      missing++;
      continue;
    }

    const html = await fs.readFile(file, 'utf-8').catch(() => '');
    const { title, frames, slots, links, movies, baseStripped, refs } = inspectPage(html, resolves, localPath);
    for (const movie of movies) links.push(...(await flashLinks(movie, path.posix.dirname(localPath))));
    navigation.set(localPath, { slots, links, baseStripped });
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
      frame_home: null,
      frame_slot: null,
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

  const homes = frameHomes(rows.filter((r) => !NO_FRAME_HOMES.has(r.crawl_root)), navigation);
  for (const row of rows) {
    const home = homes.get(row.local_path);
    if (!home) continue;
    row.frame_home = home.frameset;
    row.frame_slot = home.slot;
  }

  return { rows, missing, stampPicked, framed, homed: homes.size };
}

// ---------------------------------------------------------------------------
// Frame homes
// ---------------------------------------------------------------------------

// Which frameset each page belongs inside, and in which frame -- so the shell can show a
// frame's page the way it was seen, inside its frameset, rather than bare.
//
// Worked out by doing what a browser did. A frameset's panes start on their src pages.
// From there, a link opens where its target says: a plain link (or _self, or the frame's
// own name) in the frame it was clicked in; target="main" in the frame called main, in
// this frameset or one it sits inside; _top, _blank and unknown names in a whole window
// of their own. So following each frame's links outwards reaches every page that ever
// opened inside it -- the Addameer press release a menu link loads into "main", and the
// page that one links to plainly, which loads into "main" in turn.
//
// Only within one site -- one crawl root, so on Angelfire or GeoCities one account rather
// than the whole host -- and never a frameset into a frame of its own. Lina Sharabati's
// first Angelfire site links her second plainly from inside its frameset, so in 2000 the
// second really did open in that frame; it is still a site of its own, and an entry.
//
// A page some standalone page also links to normally stays standalone: it was seen on
// its own too, so wrapping it would hide how it was really reached. Deciding that can
// unhome pages that only got their home through it, so it repeats until nothing moves.
// A frame's own src page is always homed -- that is the page the frameset itself loads.
// And only a page a reader could reach counts as standalone evidence: one something
// links to, or the front page of its crawl. Bethlehem 2000's mainintroduction.htm is
// named only by an empty Dreamweaver <a> beside the Flash header, so the crawler found it
// and no visitor ever could; left to count, its plain links unhomed the whole site.
//
// One guess. Menus of the period sent every link to the content frame with a single
// <base target="main">, and the scraper strips <base> of its target -- so a menu frame's
// links read as opening inside the menu, which would put Bethlehem 2000's fifty pages in
// its 146px header. Where a page's <base> was stripped and a link names no target, the
// link is taken to open in the frameset's largest frame instead. A <base> that only ever
// had an href gets the same treatment; a content pane small enough to be a menu would
// have been a broken site, so the guess costs little.
//
// Better than the guess where it exists: FrontPage repeated each page's <base target> as
// a target attribute on the <frame> it loads into, which the scraper left alone. So for a
// FrontPage frameset the stripped target is read back off the frame instead -- which
// matters on palestine-net.com's FBA site, whose 502px menu frame is wider than the
// content frame beside it and would otherwise be guessed as the content.
//
// Only where a <base> was stripped. Guessing for every small frame would fix Bethlehem
// 2000's header, which has no <base> and links nowhere in particular, but would move
// Deir Yassin's sub-menus -- which really do swap in its 160px menu frame -- into the
// content frame, and palestinehistory.com's rotating title banners with them.
//
// A page reachable from several framesets gets the nearest. Ties go to the most likely
// front door: an index page over index-2.html, a shallower path over a deeper one.
const WHOLE_WINDOW = new Set(['_top', '_blank', '_new', '_parent', '_search', '_media']);

// Crawls whose pages always open on their own. geocities.com/siliconvalley/lab/1832 is
// an HTML tutorial: its framesets are demos in examples/, and following their links put
// the tutorial's own chapters (htmintro.html, thissite.html) inside them.
const NO_FRAME_HOMES = new Set(['geocities.com/siliconvalley/lab/1832']);

function frameHomes(rows, navigation) {
  const pages = new Set(rows.map((r) => r.local_path));
  const siteOf = new Map(rows.map((r) => [r.local_path, r.crawl_root]));
  const site = (p) => siteOf.get(p);
  const slotsOf = (p) => navigation.get(p)?.slots ?? [];
  const isContainer = (p) => slotsOf(p).length > 0;

  const frontDoor = (p) => [
    /\/(index|default|home)\.[a-z]+$/.test(p) ? 0 : 1,
    p.split('/').length,
    p.length,
    p,
  ];
  const byFrontDoor = (a, b) => {
    const [x, y] = [frontDoor(a), frontDoor(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  };
  const containers = [...pages].filter(isContainer).sort(byFrontDoor);

  // The frameset's biggest <frame>, for the stripped-<base> guess.
  const contentSlot = (frameset) =>
    slotsOf(frameset).reduce((best, s) => (s.size > (best?.size ?? 0) ? s : best), null)?.name;

  // The frame a link aims at, looking outwards through nested framesets.
  function findSlot(frameset, name, homes) {
    for (let at = frameset, depth = 0; at && depth < 4; depth++) {
      if (slotsOf(at).some((s) => s.name === name)) return at;
      at = homes.get(at)?.frameset;
    }
    return null;
  }

  function walk(standalone) {
    const homes = new Map();
    const queue = [];
    const assign = (page, frameset, slot) => {
      homes.set(page, { frameset, slot });
      queue.push(page);
    };

    for (const frameset of containers) {
      for (const { child, name } of slotsOf(frameset)) {
        if (!pages.has(child) || child === frameset || homes.has(child)) continue;
        if (site(child) !== site(frameset)) continue;
        assign(child, frameset, name);
      }
    }

    for (let i = 0; i < queue.length; i++) {
      const from = queue[i];
      const { frameset, slot } = homes.get(from);
      const stripped = navigation.get(from)?.baseStripped;
      const recovered = stripped ? slotsOf(frameset).find((s) => s.name === slot)?.target : '';
      const guessed = stripped && !recovered ? contentSlot(frameset) : null;
      for (const link of navigation.get(from)?.links ?? []) {
        const { to, implicit } = link;
        const target = implicit && recovered ? recovered : link.target;
        if (!pages.has(to) || homes.has(to) || standalone.has(to)) continue;
        if (to === frameset || isContainer(to) || site(to) !== site(frameset)) continue;
        if (WHOLE_WINDOW.has(target)) continue;
        if (implicit && guessed) {
          assign(to, frameset, guessed);
        } else if (target === '_self' || target === slot) {
          assign(to, frameset, slot);
        } else {
          const owner = findSlot(frameset, target, homes);
          if (owner) assign(to, owner, target);
        }
      }
    }
    return homes;
  }

  const srcPages = new Set(
    containers.flatMap((c) => slotsOf(c).map((s) => s.child)).filter((p) => pages.has(p)),
  );

  const reachable = new Set(rows.map((r) => `${r.crawl_root}/index.html`));
  for (const { links } of navigation.values()) for (const { to } of links) reachable.add(to);

  let standalone = new Set();
  for (;;) {
    const homes = walk(standalone);
    const next = new Set(standalone);
    for (const from of pages) {
      if (homes.has(from) || isContainer(from) || !reachable.has(from)) continue;
      for (const { to } of navigation.get(from)?.links ?? []) {
        if (homes.has(to) && !srcPages.has(to)) next.add(to);
      }
    }
    if (next.size === standalone.size) return homes;
    standalone = next;
  }
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

  const { rows, missing, stampPicked, framed, homed } = await collectPages();
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
                       frame_home, frame_slot, links_total, links_dead, images_total, images_broken, score)
    VALUES (@local_path, @host, @crawl_root, @original_url, @display_url, @timestamp, @captured_at,
            @replay_url, @title, @byte_length, @digest, @capture_count, @frame_parent,
            @frame_home, @frame_slot, @links_total, @links_dead, @images_total, @images_broken, @score)
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
      `${framed ? `, ${framed} framed by another page` : ''}` +
      `${homed ? `, ${homed} shown inside a frameset` : ''}.`,
  );
  console.log(
    `${(100 * mean).toFixed(1)}% of all links and images survive; ` +
      `${rows.filter((r) => r.links_total + r.images_total === 0).length} pages reference neither.`,
  );
  if (imported) console.log(`Restored ${imported} rows from ${opts.tags} (${tagged} pages tagged).`);
  if (orphanMeta) console.log(`${orphanMeta} meta rows have no matching page -- kept, not deleted.`);
}

await main();
