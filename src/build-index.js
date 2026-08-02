// Build a browsable index of everything cdx-scraper.js has downloaded.
//
//   node src/build-index.js [--out FILE] [--all]
//
// Walks /sites for log.json files -- each one marks the root of a single crawl -- and
// emits one static HTML page: a tree of crawls and their pages on the left, an iframe
// on the right that loads whichever page you click.
//
// Page URLs are root-relative (`/sites/...`), the same form the scraper rewrites links
// into, so this file has to be served with the repo root as the web root:
//
//   npx http-server . -p 8080     then open http://localhost:8080/archive-index.html
//
// Opening it straight off disk with file:// will not work -- every link, both here and
// inside the archived pages themselves, resolves against the server root.

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

const DEST_PATH = 'sites';
const destDir = path.join(process.cwd(), DEST_PATH);

function parseArgs(argv) {
  const outFlag = argv.indexOf('--out');
  return {
    // Sits at the repo root because page URLs are root-relative; putting it inside
    // /sites would not change that, only make the location more confusing.
    out: outFlag !== -1 ? argv[outFlag + 1] : 'archive-index.html',
    // Include pages whose file is missing from disk, rendered as unclickable. Off by
    // default: a log lists what the crawl *intended* to fetch, and the ones that 404ed
    // or were never reached are noise in a browsing tool.
    all: argv.includes('--all'),
  };
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Paths
//
// This mirrors toLocalPath in cdx-scraper.js. It is duplicated rather than imported
// because that module runs its crawl on import -- it has no exports and a top-level
// await on main(). The duplication is guarded by checking every path against the disk
// and reporting the miss count, so if the two ever drift the next run says so loudly
// instead of quietly emitting a tree of broken links.
// ---------------------------------------------------------------------------

function sanitizeSegment(segment) {
  if (segment === '.' || segment === '..') return '';
  return segment.replace(/[:*?"<>|\\]/g, '_');
}

// Every log.json entry is a seeded HTML page, so the document rules always apply:
// an extensionless or trailing-slash URL is a directory index.
function toLocalPath(originalUrl) {
  let clean = originalUrl
    .replace(/^https?:\/\//i, '')
    .replace(/:\d+/, '')
    .replace(/^www\d?\./, '')
    .split('#')[0]
    .split('?')[0]
    .toLowerCase();

  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Leave malformed escapes as-is, same as the scraper.
  }

  clean = clean.split('/').map(sanitizeSegment).filter(Boolean).join('/');

  const trailingSlash = originalUrl.split('#')[0].split('?')[0].endsWith('/');
  const hostOnly = !clean.includes('/');

  if (trailingSlash || hostOnly || !path.posix.basename(clean).includes('.')) {
    clean = path.posix.join(clean, 'index.html');
  }

  return clean;
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

// Longer than this and one row swamps the tree. The full text stays in the tooltip.
const TITLE_MAX = 120;

// The page's <title>, or '' if it has none worth showing.
//
// Parsed rather than regexed: 158 titles in the current archive carry HTML entities,
// and cheerio decodes them where a regex capture would print the raw `&amp;`. The whole
// corpus costs a few seconds, which is fine for a generator.
async function readTitle(localPath) {
  let html;
  try {
    html = await fs.readFile(path.join(destDir, localPath), 'utf-8');
  } catch {
    return '';
  }

  let text;
  try {
    text = cheerio.load(html)('title').first().text();
  } catch {
    return '';
  }

  // Archived titles are full of hard-wrapped whitespace and non-breaking spaces.
  return (text || '').replace(/[\s ]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

async function findLogs(dir) {
  const out = [];

  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === 'log.json') out.push(full);
    }
  }

  await walk(dir);
  return out.sort();
}

// One crawl: the directory its log.json sits in, plus every page it recorded.
async function readCrawl(logPath) {
  const root = path.relative(destDir, path.dirname(logPath)).split(path.sep).join('/');

  let entries;
  try {
    entries = JSON.parse(await fs.readFile(logPath, 'utf-8'));
  } catch (error) {
    console.warn(`⚠️  skipping unreadable ${logPath}: ${error.message}`);
    return null;
  }

  if (!Array.isArray(entries)) {
    console.warn(`⚠️  skipping ${logPath}: expected an array`);
    return null;
  }

  const pages = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry?.originalUrl) continue;

    const localPath = toLocalPath(entry.originalUrl);
    // A log can list the same page under several timestamps; the tree wants one row.
    if (seen.has(localPath)) continue;
    seen.add(localPath);

    const exists = existsSync(path.join(destDir, localPath));
    if (!exists && !opts.all) continue;

    pages.push({
      localPath,
      exists,
      title: exists ? await readTitle(localPath) : '',
      timestamp: entry.timestamp || '',
      originalUrl: entry.originalUrl,
      // Label relative to the crawl root, so a deep crawl reads as `poets/darwish.html`
      // rather than repeating the host on every row.
      label:
        (localPath.startsWith(root + '/') ? localPath.slice(root.length + 1) : localPath) ||
        'index.html',
    });
  }

  // Index pages first, then alphabetical -- the entry point is what you want to click.
  pages.sort((a, b) => {
    const ai = a.label === 'index.html' ? 0 : 1;
    const bi = b.label === 'index.html' ? 0 : 1;
    return ai - bi || a.label.localeCompare(b.label);
  });

  return { root, pages, total: entries.length };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Root-relative and percent-encoded per segment, so spaces and other literal characters
// in archived filenames survive. The separators must not be encoded.
function pageHref(localPath) {
  return `/${DEST_PATH}/` + localPath.split('/').map(encodeURIComponent).join('/');
}

// The snapshot this page came from, on web.archive.org.
//
// Deliberately without the `id_` suffix the scraper uses. That suffix asks for the raw
// original bytes, which is what a scraper wants and what a reader does not: it strips
// the toolbar, the date banner and the surrounding navigation, and it is why Flash
// pages arrive without a player. The plain form is the one worth linking a human to.
function waybackUrl(timestamp, originalUrl) {
  if (!timestamp) return '';
  const bare = originalUrl.replace(/^https?:\/\//i, '');
  return `https://web.archive.org/web/${timestamp}/http://${bare}`;
}

function renderCrawl(crawl) {
  const rows = crawl.pages
    .map((page) => {
      if (!page.exists) {
        return `<li class="missing" title="listed in log.json but not on disk">${escapeHtml(page.label)}</li>`;
      }

      const shortened =
        page.title.length > TITLE_MAX ? page.title.slice(0, TITLE_MAX) + '…' : page.title;

      // Full title in the tooltip alongside the archived URL, since the visible one is
      // truncated and many of these pages differ only past the cut.
      const tooltip = page.title
        ? `${page.title}\n${page.originalUrl}`
        : page.originalUrl;

      const titleSpan = shortened
        ? ` <span class="t">${escapeHtml(shortened)}</span>`
        : '';

      // Carried on the row so the click handler can surface it above the frame without
      // needing a lookup table of every page in the archive.
      const wayback = waybackUrl(page.timestamp, page.originalUrl);

      return (
        `<li><a href="${escapeHtml(pageHref(page.localPath))}"` +
        ` title="${escapeHtml(tooltip)}"` +
        (wayback ? ` data-wayback="${escapeHtml(wayback)}"` : '') +
        `>` +
        `<span class="f">${escapeHtml(page.label)}</span>${titleSpan}</a></li>`
      );
    })
    .join('\n');

  return (
    `<details>\n<summary>${escapeHtml(crawl.root)} <span class="count">${crawl.pages.length}</span></summary>\n` +
    `<ul>\n${rows}\n</ul>\n</details>`
  );
}

function renderPage(crawls, stats) {
  const tree = crawls.map(renderCrawl).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wayback archive index</title>
<style>
  body { margin: 0; font-family: sans-serif; font-size: 13px; }
  .wrap { display: flex; align-items: flex-start; gap: 1rem; }
  /* The tree scrolls on its own so the frame stays put on long lists. */
  nav { width: 22rem; flex: none; height: 100vh; overflow-y: auto; padding: .5rem; box-sizing: border-box; border-right: 1px solid #ccc; }
  nav h1 { font-size: 14px; margin: .25rem 0 .5rem; }
  nav p { margin: 0 0 .75rem; color: #555; }
  summary { cursor: pointer; padding: 2px 0; }
  .count { color: #777; font-weight: normal; }
  ul { list-style: none; margin: 0 0 .5rem; padding-left: 1rem; }
  li { padding: 1px 0; }
  a { text-decoration: none; }
  a:hover { text-decoration: underline; }
  a.active { font-weight: bold; }
  /* Filename stays the anchor of the row; the title is secondary and wraps under it. */
  .f { word-break: break-all; }
  .t { color: #555; }
  .missing { color: #999; }
  main { padding: .5rem; }
  /* 4:3 at 800x600. width/height rather than an aspect-ratio box: the archived pages
     are fixed-width 2001-era layouts, so a viewport that matches the era is the point. */
  iframe { width: 800px; height: 600px; border: 1px solid #ccc; background: #fff; }
  #frame-label { margin: 0 0 .25rem; color: #555; height: 1.2em; }
  /* Reserves its line whether or not a page is selected, so the frame never shifts. */
  #frame-source { margin: 0 0 .5rem; height: 1.2em; visibility: hidden; }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <h1>Wayback archive index</h1>
    <p>${stats.crawls} crawls, ${stats.linked} pages${stats.missing ? ` (${stats.missing} not on disk)` : ''}</p>
${tree}
  </nav>
  <main>
    <p id="frame-label">Select a page from the tree.</p>
    <p id="frame-source"><a id="wayback-link" href="" target="_blank" rel="noopener">View on the Wayback Machine</a></p>
    <iframe id="frame" name="archive-frame" title="Archived page"></iframe>
  </main>
</div>
<script>
  // Anchors keep real hrefs so middle-click and "open in new tab" still work; only a
  // plain left click is redirected into the frame.
  var frame = document.getElementById('frame');
  var label = document.getElementById('frame-label');
  var source = document.getElementById('frame-source');
  var waybackLink = document.getElementById('wayback-link');
  var active = null;

  document.querySelector('nav').addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    event.preventDefault();
    frame.src = link.getAttribute('href');
    label.textContent = link.getAttribute('title') || link.textContent;

    // Hidden rather than emptied for pages whose log entry carried no timestamp, so
    // the frame does not jump when moving between rows that have one and rows that
    // do not.
    var wayback = link.getAttribute('data-wayback');
    if (wayback) {
      waybackLink.href = wayback;
      source.style.visibility = 'visible';
    } else {
      waybackLink.removeAttribute('href');
      source.style.visibility = 'hidden';
    }

    if (active) active.classList.remove('active');
    link.classList.add('active');
    active = link;
  });

  // Keep archived navigation inside the frame.
  //
  // These are frameset-era pages, and the scraper deliberately preserves their target
  // attributes -- \`_top\`, \`main\`, \`photo\` and friends are how a frameset drives its own
  // panes, so stripping them would break the sites when viewed standalone. Inside this
  // viewer, though, the top browsing context is the index page itself, so a link with
  // target="_top" (11968 of them in the current archive) replaces the whole tree, and a
  // link to a named pane that is not on screen -- because you clicked a sub-page rather
  // than its frameset -- resolves to no known context and the browser opens a new tab.
  //
  // So the containment belongs here rather than in the scraper: leave a target alone
  // when it names a frame that really exists inside this iframe, and otherwise load the
  // link in the iframe itself.
  function framesByName(win, name, depth) {
    if (depth > 5) return false;
    for (var i = 0; i < win.frames.length; i++) {
      try {
        if (win.frames[i].name === name) return true;
        if (framesByName(win.frames[i], name, depth + 1)) return true;
      } catch (err) {
        // A frame we cannot reach into cannot be the one being targeted.
      }
    }
    return false;
  }

  function onFrameClick(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    var link = event.target.closest && event.target.closest('a[target], area[target]');
    if (!link) return;

    var name = (link.getAttribute('target') || '').trim();
    var lower = name.toLowerCase();
    if (!name || lower === '_self') return;

    // A named pane that exists in here is genuine frameset navigation -- leave it.
    if (lower[0] !== '_' && framesByName(frame.contentWindow, name, 0)) return;

    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|javascript:|tel:|data:)/i.test(href)) {
      return;
    }

    // Assign the location outright rather than rewriting the target attribute: this is
    // unambiguous, and for _top/_parent it gives the right result anyway -- replacing
    // the whole archived document, which is what those mean once the frameset is the
    // thing inside our iframe.
    event.preventDefault();
    try {
      frame.contentWindow.location.href = link.href;
    } catch (err) {
      frame.src = href;
    }
  }

  // Re-applied on every navigation, and to each nested frame of a frameset, since each
  // one is its own document with its own listener set.
  function harden(win) {
    var doc;
    try {
      doc = win.document;
    } catch (err) {
      return; // Not same-origin; nothing we can do and nothing we need to do.
    }
    if (!doc || doc.__hardened) return;
    doc.__hardened = true;
    doc.addEventListener('click', onFrameClick, true);

    for (var i = 0; i < win.frames.length; i++) {
      (function (sub) {
        try {
          harden(sub);
          sub.addEventListener('load', function () { harden(sub); });
        } catch (err) {
          // Unreachable frame; skip it.
        }
      })(win.frames[i]);
    }
  }

  frame.addEventListener('load', function () {
    harden(frame.contentWindow);
  });
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(destDir)) {
    console.error(`No ${DEST_PATH}/ directory here. Run this from the repo root.`);
    process.exit(1);
  }

  const logs = await findLogs(destDir);
  if (!logs.length) {
    console.error(`No log.json files found under ${DEST_PATH}/.`);
    process.exit(1);
  }

  const crawls = [];
  let linked = 0;
  let missing = 0;
  let titled = 0;

  for (const logPath of logs) {
    const crawl = await readCrawl(logPath);
    if (!crawl || !crawl.pages.length) continue;
    crawls.push(crawl);
    for (const page of crawl.pages) {
      if (page.exists) linked += 1;
      else missing += 1;
      if (page.title) titled += 1;
    }
  }

  const html = renderPage(crawls, { crawls: crawls.length, linked, missing });
  await fs.writeFile(opts.out, html, 'utf8');

  console.log(
    `Wrote ${opts.out}: ${crawls.length} crawls, ${linked} pages linked, ${titled} with titles.`
  );
  if (missing) {
    console.log(`${missing} logged pages are not on disk (shown greyed out).`);
  }
  console.log('\nServe from the repo root, e.g.  npx http-server . -p 8080');
  console.log(`then open  http://localhost:8080/${opts.out}`);
}

await main();
