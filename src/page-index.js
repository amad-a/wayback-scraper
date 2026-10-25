// Reading the archive: what is in /sites, where it came from, and what it is called.
//
// Shared by build-index.js (static HTML tree) and build-db.js (SQLite). Both need the
// same answer to "which local file does this archived URL correspond to", and getting
// two different answers would mean broken links in one of them.
//
// toLocalPath mirrors the scraper's own path logic. It is duplicated from
// cdx-scraper.js rather than imported because that module runs its crawl on import --
// it has no exports and a top-level await on main(). The duplication is guarded by
// checking every path against the disk and reporting the miss count, so if the two ever
// drift the next run says so loudly instead of quietly emitting broken links.

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { inflateSync } from 'zlib';
import * as cheerio from 'cheerio';

export const DEST_PATH = 'sites';
export const destDir = path.join(process.cwd(), DEST_PATH);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function sanitizeSegment(segment) {
  if (segment === '.' || segment === '..') return '';
  return segment.replace(/[:*?"<>|\\]/g, '_');
}

// Every log.json entry is a seeded HTML page, so the document rules always apply:
// an extensionless or trailing-slash URL is a directory index.
export function toLocalPath(originalUrl) {
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

// The page's <title>, or '' if it has none worth showing.
//
// Parsed rather than regexed: 158 titles in the current archive carry HTML entities,
// and cheerio decodes them where a regex capture would print the raw `&amp;`. The whole
// corpus costs a few seconds, which is fine for a generator.
export function titleFromHtml(html) {
  try {
    return titleFrom(cheerio.load(html));
  } catch {
    return '';
  }
}

function titleFrom($) {
  // Archived titles are full of hard-wrapped whitespace and non-breaking spaces.
  return ($('title').first().text() || '').replace(/[\s ]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

// The pages a document pulls into itself: its <frame> and <iframe> targets, as local
// paths.
//
// Resolution is a string slice because the scraper already did the work -- every src it
// rewrote is absolute and already in local-path form (`/sites/host/dir/page.html`), so
// there is no relative path, no <base href>, and no URL joining to get wrong. Lowercased
// to match toLocalPath, which lowercases too; without it the geocities captures miss,
// since their srcs are lowercase and their directories on disk are not.
//
// Parsed rather than regexed for the same reason as titleFromHtml: one tripod page builds
// an <iframe> tag inside a document.write string, and a regex reads that as a real frame.
function framesFrom($) {
  return $('frame[src], iframe[src]')
    .map((_, el) => $(el).attr('src') || '')
    .get()
    .filter((src) => src.startsWith(`/${DEST_PATH}/`))
    .map((src) => src.slice(DEST_PATH.length + 2).split('#')[0].split('?')[0].toLowerCase());
}

// A rewritten `/sites/...` reference as the local path of the page it opens, or '' for
// anything else. Same normalisation as toLocalPath: lowercased, query and fragment
// dropped, and a directory meaning its index.html.
function localTarget(ref) {
  if (!ref.startsWith(`/${DEST_PATH}/`)) return '';
  let target = ref.slice(DEST_PATH.length + 2).split('#')[0].split('?')[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    // Leave malformed escapes as-is, same as toLocalPath.
  }
  target = target.toLowerCase();
  if (!target || target.endsWith('/') || !target.includes('/')) {
    target = path.posix.join(target, 'index.html');
  }
  return target;
}

// The panes a document is made of: each <frame> and <iframe> with the page it starts on
// and the name links use to aim at it. A pane with no name is called by its position,
// '#0', '#1' and so on, in document order -- nothing can target it, but a plain link
// inside it still opens in it.
//
// `size` is how much of its frameset a <frame> gets, for guessing which one is the
// content pane (see frameHomes in build-db.js), measured against a 1000px window: pixels
// as given, percentages of the 1000, and '*' sharing whatever is left -- most of it in
// "120,*,50", a sliver in "93%,*". 0 for an <iframe>, which is never the guess.
function slotsFrom($) {
  return $('frame, iframe')
    .map((i, el) => ({
      child: localTarget($(el).attr('src') || ''),
      name: ($(el).attr('name') || '').trim().toLowerCase() || `#${i}`,
      size: frameSize($, el),
      // Not standard HTML: FrontPage wrote it on each <frame> to mirror the
      // <base target> it put in the page loaded there.
      target: ($(el).attr('target') || '').trim().toLowerCase(),
    }))
    .get();
}

const FRAME_WINDOW = 1000;

function frameSize($, el) {
  const parent = $(el).parent('frameset');
  if (!parent.length) return 0;
  const count = parent.children('frame, frameset').length;
  const spec = (parent.attr('cols') || parent.attr('rows') || '').split(',').map((p) => p.trim());
  const parts = Array.from({ length: count }, (_, i) => spec[i] || '*');

  const fixed = (p) => (p.endsWith('%') ? (FRAME_WINDOW * (Number.parseFloat(p) || 0)) / 100 : Number.parseFloat(p) || 0);
  const weight = (p) => Number.parseFloat(p) || 1;
  const stars = parts.filter((p) => p.endsWith('*'));
  const left = Math.max(0, FRAME_WINDOW - parts.filter((p) => !p.endsWith('*')).reduce((n, p) => n + fixed(p), 0));
  const starWeight = stars.reduce((n, p) => n + weight(p), 0);

  const part = parts[parent.children('frame, frameset').index(el)];
  return part.endsWith('*') ? (left * weight(part)) / starWeight : fixed(part);
}

// Where each link on the page goes and which window it opens in: its own target, else
// the page's <base target>, else the frame it was clicked in ('_self'). `implicit` marks
// a link that named no target at all, which is what frameHomes may have to guess about.
//
// An <a> with nothing inside it is skipped: there is nothing to click. Dreamweaver wrote
// rows of them beside a Flash movie -- "URL's used in the movie" -- so the movie's links
// would be crawled, and they say nothing about where those links open. The movie does;
// see flashLinks. An <area> is always empty and always clickable, so it stays.
function linksFrom($) {
  const base = ($('base[target]').first().attr('target') || '').trim().toLowerCase();
  return $('a[href], area[href]')
    .filter((_, el) => el.tagName === 'area' || $(el).text().trim() !== '' || $(el).children().length > 0)
    .map((_, el) => {
      const own = ($(el).attr('target') || '').trim().toLowerCase();
      return {
        to: localTarget(($(el).attr('href') || '').trim()),
        target: own || base || '_self',
        implicit: !own && !base,
      };
    })
    .get()
    .filter((link) => link.to);
}

// The Flash movies a page embeds, as local paths. The scraper rewrites <embed src> and
// <object data> to /sites/...; a <param name="movie"> it may leave relative, so that is
// resolved against the page's own folder.
function moviesFrom($, localPath) {
  const dir = path.posix.dirname(localPath);
  const refs = [
    ...$('embed[src], object[data]').map((_, el) => $(el).attr('src') || $(el).attr('data')).get(),
    ...$('param')
      .filter((_, el) => /^(movie|src)$/i.test($(el).attr('name') || ''))
      .map((_, el) => $(el).attr('value') || '')
      .get(),
  ];
  const movies = new Set();
  for (const ref of refs.map((r) => (r || '').trim())) {
    if (!/\.swf([?#]|$)/i.test(ref)) continue;
    const local = ref.startsWith('/') ? localTarget(ref) : relativeTarget(dir, ref);
    if (local) movies.add(local);
  }
  return [...movies];
}

// A reference written relative to a page in `dir` -- or absolute, to the live web -- as
// a local path, the way the browser would have resolved it.
//
// Segments go through sanitizeSegment as the crawler's did, so Kirdan's Flash gallery,
// which asks for `mis\w1.htm` in Windows style, finds the mis_w1.htm it was saved as.
function relativeTarget(dir, ref) {
  if (/^https?:\/\//i.test(ref)) return toLocalPath(ref);
  if (/^[a-z]+:/i.test(ref) || ref.startsWith('#')) return '';
  const joined = path.posix.normalize(path.posix.join(dir, ref));
  return localTarget(`/${DEST_PATH}/${joined.split('/').map(sanitizeSegment).join('/')}`);
}

// The links inside a Flash movie, read straight out of its bytecode: each ActionGetURL
// (0x83) carries its URL and target window as two strings. Relative URLs resolve against
// the page that embeds the movie, which is how Flash of this period behaved. getURL2,
// which builds its URL at runtime, cannot be read this way and is not tried.
//
// Bethlehem 2000's header is one of these: its nine buttons all open in "_bottom", the
// content frame, which the empty <a> tags beside it could never have said.
export async function flashLinks(movie, pageDir) {
  let buf;
  try {
    buf = await fs.readFile(path.join(destDir, movie));
  } catch {
    return [];
  }
  const kind = buf.subarray(0, 3).toString('latin1');
  if (kind === 'CWS') {
    try {
      buf = Buffer.concat([buf.subarray(0, 8), inflateSync(buf.subarray(8))]);
    } catch {
      return [];
    }
  } else if (kind !== 'FWS') {
    return [];
  }

  const links = [];
  for (let i = 8; i < buf.length - 4; i++) {
    if (buf[i] !== 0x83) continue;
    const len = buf.readUInt16LE(i + 1);
    if (len < 2 || i + 3 + len > buf.length) continue;
    const body = buf.subarray(i + 3, i + 3 + len);
    const mid = body.indexOf(0);
    if (mid <= 0 || body[len - 1] !== 0) continue;
    const url = body.subarray(0, mid).toString('latin1');
    const target = body.subarray(mid + 1, len - 1).toString('latin1');
    if (/[\x00-\x1f]/.test(url + target)) continue;
    const to = relativeTarget(pageDir, url);
    if (to) links.push({ to, target: target.trim().toLowerCase() || '_self', implicit: false });
  }
  return links;
}

// The scraper strips href and target from every <base> it saves (cdx-scraper.js), leaving
// an empty tag behind. Which of those had a target is lost; that they had a <base> at all
// is not, and it is the hint frameHomes guesses from.
function baseStrippedFrom($) {
  const base = $('base');
  return base.length > 0 && base.toArray().every((el) => Object.keys(el.attribs || {}).length === 0);
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

// Schemes that were never a fetch, so they cannot have failed to survive one. Mirrors
// NON_NAVIGATIONAL in cdx-scraper.js, which decides the same question when it marks a
// link dead.
const NON_NAVIGATIONAL = /^(mailto:|tel:|javascript:|data:|about:|ftp:|news:)/i;

// Every file under /sites, lowercased, for asking whether a rewritten reference actually
// landed. The scraper builds the same set to decide which links to mark dead.
export async function readFileSet() {
  const files = new Set();

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
      else files.add(path.relative(destDir, full).split(path.sep).join('/').toLowerCase());
    }
  }

  await walk(destDir);
  return files;
}

// Whether a reference points at something we actually hold.
//
// Anything still addressed to the live web is a miss by definition: the scraper rewrites
// what it downloaded to `/sites/...` and leaves the rest pointing at hosts that have been
// gone for twenty years. Mirrors localTargetExists in cdx-scraper.js.
export function localResolver(files) {
  return (ref) => {
    if (!ref.startsWith(`/${DEST_PATH}/`)) return false;

    let target = ref.slice(DEST_PATH.length + 2).split('#')[0].split('?')[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      // Leave malformed escapes as-is, same as toLocalPath.
    }

    return files.has(target.toLowerCase());
  };
}

// How much of what a page points at is still here.
//
// Links and images are counted apart because they fail differently: a dead link is a
// path out of the archive that no longer goes anywhere, a broken image is a hole in the
// page itself. Keeping them separate lets the two be weighed against each other later
// without another pass over the corpus.
//
// Counted rather than read off the scraper's own `dead` class, which marks exactly the
// same links: the two agree on 135,805 of 135,839, and every disagreement is inside the
// four pages the scraper never processed, where recounting here is the better answer.
//
// Excluded: bare `#` fragments and the non-navigational schemes, which point nowhere to
// begin with. Not counted: the 31 inline `style="...url()..."` references in the whole
// archive, too few to move any page's score.
function referencesFrom($, resolves) {
  const stats = { linksTotal: 0, linksDead: 0, imagesTotal: 0, imagesBroken: 0 };

  $('a[href], area[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || NON_NAVIGATIONAL.test(href)) return;

    stats.linksTotal++;
    if (!resolves(href)) stats.linksDead++;
  });

  // `background` is the 90s idiom for a tiled backdrop and fails as visibly as an <img>.
  $('img[src], input[type=image][src], [background]').each((_, el) => {
    const $el = $(el);
    const src = ($el.attr('src') || $el.attr('background') || '').trim();
    if (!src || NON_NAVIGATIONAL.test(src)) return;

    stats.imagesTotal++;
    if (!resolves(src)) stats.imagesBroken++;
  });

  return stats;
}

// Everything build-db.js wants from a page, from one parse.
//
// Three separate helpers would each pay their own cheerio.load, and across 11,000 files
// that parse is most of the build -- two passes already cost 13s. titleFromHtml stays
// exported for build-index.js, which wants nothing else.
export function inspectPage(html, resolves, localPath = '') {
  let $;
  try {
    $ = cheerio.load(html);
  } catch {
    return {
      title: '',
      frames: [],
      slots: [],
      links: [],
      movies: [],
      baseStripped: false,
      refs: { linksTotal: 0, linksDead: 0, imagesTotal: 0, imagesBroken: 0 },
    };
  }

  return {
    title: titleFrom($),
    frames: framesFrom($),
    slots: slotsFrom($),
    links: linksFrom($),
    movies: moviesFrom($, localPath),
    baseStripped: baseStrippedFrom($),
    refs: referencesFrom($, resolves),
  };
}

export async function readTitle(localPath) {
  try {
    return titleFromHtml(await fs.readFile(path.join(destDir, localPath), 'utf-8'));
  } catch {
    return '';
  }
}

// The capture a page on disk actually came from.
//
// The scraper stamps every page it rewrites with <body data-wayback-url>, and that is
// the only reliable way to tell which capture produced the file when a log lists the
// same URL more than once. The CDX digest and length cannot answer it: length is the
// compressed WARC record size (2344 bytes against 7465 on disk for one sample) and the
// digest covers the original payload, while the file here has had its links rewritten
// and this very attribute added.
export function stampedTimestamp(html) {
  const match = /data-wayback-url="https:\/\/web\.archive\.org\/web\/(\d+)id_\//.exec(html);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export async function findLogs(dir) {
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
//
// `all` includes pages whose file is missing from disk. Off by default: a log lists what
// the crawl *intended* to fetch, and the ones that 404ed or were never reached are noise
// in a browsing tool.
export async function readCrawl(logPath, { all = false } = {}) {
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
    if (!exists && !all) continue;

    pages.push({
      localPath,
      exists,
      title: exists ? await readTitle(localPath) : '',
      timestamp: entry.timestamp || '',
      originalUrl: entry.originalUrl,
      sourceUrl: entry.sourceUrl,
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
// URLs
// ---------------------------------------------------------------------------

// The address as a person should read it: the `:80` is a leftover of how 90s URLs were
// recorded and carries no meaning. This is what the shell's address bar shows.
export function displayUrl(originalUrl) {
  return originalUrl.replace(/(\/\/[^/]+):80(?=\/|$)/, '$1');
}

// The replay URL for a capture, matching what the shell's Source button opens
// (public/app/api.js waybackSourceUrl). Omits the scraper's `id_` suffix, which asks for
// the raw original bytes -- that strips the archive's toolbar and date banner, which is
// what a scraper wants and a reader does not.
//
// NOTE: build-index.js has its own waybackUrl that keeps the `:80` and always forces an
// http:// scheme. Both resolve on web.archive.org, so this is cosmetic, but the two are
// deliberately left un-merged here rather than silently changing archive-index.html's
// output as a side effect of adding a database.
export function replayUrl(timestamp, originalUrl) {
  if (!timestamp) return '';
  return `https://web.archive.org/web/${timestamp}/${displayUrl(originalUrl)}`;
}
