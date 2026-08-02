// Wayback Machine scraper: CDX page list -> browserless parallel download -> local link rewrite.
//
// Fetches the `id_` ("identity") variant of each snapshot, which returns the original
// archived bytes with no Wayback toolbar, no injected scripts and original relative URLs.
// That means no browser is needed, and nothing has to be stripped after the fact.
//
// Assets linked from a page are enqueued during the same pass, at the page's own
// timestamp -- the archive 302s to the nearest snapshot of that asset.
//
// Off-host assets get downloaded too. The toolbar variant rewrites every asset URL to
// point back at the archive, so a third-party image still resolves there; `id_` leaves
// the original absolute URL in place, pointing at a host that has usually been dead for
// two decades. Those land under <site>/_external/<host>/ and are rewritten locally.
// Off-host *links* are still left pointing outward.
//
// Requires Node >= 18 for global fetch (see .nvmrc).

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import fsExists from 'fs.promises.exists';
import PublicGoogleSheetsParser from 'public-google-sheets-parser';

const SPREADSHEET_ID = '1Uz5CdMlhosmaNYMejns1kiPpqs95JwVlHjlz9iDQn0c';

// Measured against web.archive.org: 8 workers sustain ~6.3 req/s with zero failures;
// 12 gets most connections refused outright. The archive refuses TCP rather than
// returning 429, so exceeding this fails hard instead of throttling.
const CONCURRENCY = 8;

// A refusal burst persists well past 30s and 60s of silence; it cleared at ~90s.
// Per-request backoff does not help -- every worker has to stand down together.
const COOLDOWN_MS = 90_000;

const MAX_ATTEMPTS = 4;

// How deep to follow subresources of subresources. Only frames and framed pages can
// recurse at all -- anchors are never followed -- so this just stops a frameset that
// nests or self-references from looping.
const MAX_EXTERNAL_DEPTH = 3;

// Server-side extensions that nonetheless contain HTML once archived. Used both to
// seed the crawl and to decide what the rewrite pass walks -- the two must agree,
// or pages get downloaded with their links left pointing at web.archive.org.
const HTML_EXTENSIONS = /\.(htm|html|shtml|shtm|php|asp|aspx|jsp|cfm|cgi|pl)$/i;

// Image files an <a>/<area> can point straight at. Anchors are otherwise never
// followed -- that is the crawl boundary -- but a link whose target *is* an image is
// a subresource the page needs, not a page to walk into: photo galleries commonly
// link a caption or thumbnail directly to the full-size jpg with no inline <img>.
const IMAGE_EXTENSIONS = /\.(gif|jpe?g|png|bmp|ico|svg|tiff?|webp)(\?|#|$)/i;

// Assets worth pulling down alongside a page. Deliberately wider than the CDX
// filter, which excludes css/js entirely and so loses page styling.
// `document: true` marks a reference to another HTML document rather than a
// subresource, which decides whether an extensionless URL is treated as a directory
// index. Frames are documents but still render inline, so they are fetched off-host
// like any other subresource.
const ASSET_SELECTORS = [
  ['img', 'src'],
  ['link[rel~="stylesheet"]', 'href'],
  ['script[src]', 'src'],
  ['input[type="image"]', 'src'],
  ['body', 'background'],
  ['td', 'background'],
  ['table', 'background'],
  ['frame', 'src', { document: true }],
  ['iframe', 'src', { document: true }],
  // Flash. A 2001 page states its movie three different ways -- <object data>, the
  // nested <embed src> fallback for non-IE browsers, and <param name="movie"> -- and
  // pages routinely use only one of them, so all three have to be collected. The
  // <param> case is not attribute-addressable by selector alone; see enqueueAssets.
  ['object[data]', 'data'],
  ['embed[src]', 'src'],
];

// <param> names that carry the movie URL, lowercased. `src` is the rarer spelling but
// appears in FrontPage-generated markup.
const MOVIE_PARAMS = new Set(['movie', 'src']);

// A <param> element whose value is the SWF URL, for both the crawl and rewrite passes.
function isMovieParam($, el) {
  return MOVIE_PARAMS.has((($(el).attr('name') || '').trim().toLowerCase()));
}

// Elements whose URLs get rewritten to point at the local copy.
//
// `localizeOffHost` decides what happens to a URL on another domain. Subresources are
// repointed at the local `_external` copy -- the third-party hosts serving 2001-era
// banners and hit counters are long gone, so the original URL renders as a broken
// image. Anchors keep pointing outward, since a link is for the reader to follow.
const LINK_ATTRS = {
  a: { attr: 'href', document: true, localizeOffHost: false },
  area: { attr: 'href', document: true, localizeOffHost: false },
  frame: { attr: 'src', document: true, localizeOffHost: true },
  iframe: { attr: 'src', document: true, localizeOffHost: true },
  link: { attr: 'href', localizeOffHost: true },
  script: { attr: 'src', localizeOffHost: true },
  body: { attr: 'background', localizeOffHost: true },
  td: { attr: 'background', localizeOffHost: true },
  table: { attr: 'background', localizeOffHost: true },
  img: { attr: 'src', localizeOffHost: true },
  'input[type="image"]': { attr: 'src', localizeOffHost: true },
  // Ruffle reads the movie URL straight off these attributes, so they have to point at
  // the local copy like any other subresource.
  object: { attr: 'data', localizeOffHost: true },
  embed: { attr: 'src', localizeOffHost: true },
};

// Extensions to try when an archived asset URL carries no extension of its own --
// hit counters and ad beacons are usually a bare path. Used to relink against
// whatever the download pass actually named the file, so this must stay in step with
// the values of EXTENSION_BY_TYPE plus the `.html` case.
const SNIFFED_EXTENSIONS = [
  '.gif',
  '.jpg',
  '.png',
  '.bmp',
  '.ico',
  '.css',
  '.js',
  '.html',
];

// Extension to give an extensionless asset, keyed by the content type it came back as.
const EXTENSION_BY_TYPE = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/x-javascript': '.js',
};

// Where off-host assets are stored, relative to the site's own directory. Kept inside
// the site so a downloaded site stays self-contained.
const EXTERNAL_DIR = '_external';

const NON_NAVIGATIONAL = /^(mailto:|tel:|javascript:|data:|about:|ftp:|news:)/i;

// Image-like string literals inside inline scripts. FrontPage hover buttons preload
// their rollover image only in JS -- `MSFPnav1h=MSFPpreload("..._vbtn_a.gif")` -- so
// the swapped-in image never appears in an HTML attribute and is missed otherwise.
// Bounded to quoted strings ending in a known image extension to avoid enqueueing
// arbitrary script tokens.
const SCRIPT_IMAGE_REF = /['"]([^'"]+\.(?:gif|jpe?g|png|bmp|ico))(?:\?[^'"]*)?['"]/gi;

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [webPath, fromBound, toBound] = positional;

  return {
    webPath,
    fromBound,
    // Only fall back to fromBound when no explicit upper bound was given.
    toBound: toBound || fromBound,
    overwrite: flags.has('--overwrite'),
    sheets: flags.has('--sheets'),
    // Skip the download pass and only re-run the local link rewrite. The rewrite now
    // spans every downloaded site, so this relinks the whole corpus against whatever
    // is currently on disk -- the way to pick up cross-site links after the sites they
    // point at have been crawled, with no network traffic.
    rewriteOnly: flags.has('--rewrite-only'),
    destPath: 'sites',
  };
}

const opts = parseArgs(process.argv.slice(2));
const destDir = path.join(process.cwd(), opts.destPath);

// The site's directory under destDir. `toLocalPath` strips `www.` and the port from
// every URL it maps, so the root has to be normalized the same way -- otherwise
// `www.foo.com` is passed on the command line, pages land in `foo.com/`, and the
// rewrite pass walks an empty directory.
const siteDir = normalizeSitePath(opts.webPath || '');

// Normalize only the host segment; a webPath may carry a path prefix after it.
function normalizeSitePath(webPath) {
  const [host, ...rest] = webPath.replace(/^https?:\/\//i, '').split('/');
  return [normalizeHost(host), ...rest].join('/');
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function normalizeHost(host) {
  return host.replace(/:\d+$/, '').replace(/^www\d?\./, '').toLowerCase();
}

// Map an archived URL onto a local path. Percent-escapes are decoded exactly once
// here so a name never lands on disk in both encoded and decoded form.
//
// `isDocument` gates the directory-index rewrite. An extensionless *page* URL is a
// directory index, but an extensionless *asset* URL is a file -- counter.digits.com
// serves a gif from a bare path, and treating that as a directory both wrote it to
// the wrong name and left the <img> pointing at a folder.
function toLocalPath(originalUrl, { isDocument = true } = {}) {
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
    // Leave malformed escapes as-is rather than dropping the URL.
  }

  // Archived asset paths carry characters that are legal in a URL but not portable
  // in a filename -- digits.com's counter path is a run of `-rz/-d/4/...` segments.
  clean = clean.split('/').map(sanitizeSegment).filter(Boolean).join('/');

  const trailingSlash = originalUrl.split('#')[0].split('?')[0].endsWith('/');

  // A host-only URL (single segment, no slash) is a directory root, not a file.
  // Its basename carries the TLD's dot -- `pal-soft.com` -- so the has-a-dot test
  // below would wrongly read it as a file with an extension and skip the index,
  // leaving links to the bare host pointing at a path that was never saved.
  const hostOnly = !clean.includes('/');

  if (
    isDocument &&
    (trailingSlash || hostOnly || !path.posix.basename(clean).includes('.'))
  ) {
    clean = path.posix.join(clean, 'index.html');
  }

  return clean;
}

// Strip path segments that would escape the output directory or collide with shell
// and filesystem semantics, without collapsing distinct URLs onto one name.
function sanitizeSegment(segment) {
  if (segment === '.' || segment === '..') return '';
  return segment.replace(/[:*?"<>|\\]/g, '_');
}

// Local path for an off-host asset: <site>/_external/<host>/<path>.
function toExternalPath(absoluteUrl, { isDocument = false } = {}) {
  const inner = toLocalPath(absoluteUrl, { isDocument });
  return path.posix.join(siteDir, EXTERNAL_DIR, inner);
}

// Guard against `..` segments in archived URLs escaping the output directory.
function resolveDest(localPath) {
  const full = path.resolve(destDir, localPath);
  if (full !== destDir && !full.startsWith(destDir + path.sep)) return null;
  return full;
}

function waybackUrl(timestamp, originalUrl) {
  const bare = originalUrl.replace(/^https?:\/\//i, '');
  return `https://web.archive.org/web/${timestamp}id_/http://${bare}`;
}

// ---------------------------------------------------------------------------
// Charset handling
// ---------------------------------------------------------------------------

// True when the bytes round-trip as UTF-8. Legacy single-byte pages almost never do,
// which makes this a reliable way to tell "already UTF-8" from "needs a codepage".
function isValidUtf8(buffer) {
  return Buffer.compare(Buffer.from(buffer.toString('utf8'), 'utf8'), buffer) === 0;
}

// `id_` returns raw original bytes and no x-archive-guessed-charset header, so the
// charset has to be worked out locally.
//
// Order matters. The declared charset wins, but many snapshots declare nothing at
// all -- salfeet.org's 2005 index is windows-1256 with no meta tag, and decoding it
// as UTF-8 produced 31 replacement chars and zero readable Arabic. jschardet is not
// a usable fallback here: it reports windows-1252 at 0.95 confidence for that exact
// page, which is just as wrong. So fall back on the UTF-8 validity check instead and
// only then reach for a codepage.
function decodeHtml(buffer, contentTypeHeader, localPath) {
  const head = buffer.slice(0, 4096).toString('latin1');
  const declared =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i)?.[1] ||
    contentTypeHeader?.match(/charset=([\w-]+)/i)?.[1];

  let charset;
  if (declared && iconv.encodingExists(declared)) {
    charset = declared;
  } else if (isValidUtf8(buffer)) {
    charset = 'utf-8';
  } else {
    // Undeclared and not UTF-8: guess from content. Arabic-range bytes in the
    // windows-1256 high range are the case this repo actually hits.
    charset = guessLegacyCharset(buffer);
    console.log(`   ↳ ${localPath}: no charset declared, using ${charset}`);
  }

  let html = iconv.decode(buffer, charset);

  // Content is rewritten to UTF-8 on disk, so stale declarations must go or the
  // browser will re-decode correct bytes with the wrong table.
  html = html
    .replace(/<meta[^>]*http-equiv=["']?Content-Type["']?[^>]*>/gi, '')
    .replace(/<meta[^>]*\bcharset\s*=\s*["']?[\w-]+["']?[^>]*>/gi, '');

  return { html, charset };
}

// Pick a codepage by how much legible non-ASCII text it yields.
//
// Only runs of non-ASCII characters are scored. Scoring Latin letters instead lets
// windows-1252 win on any page whose ASCII English nav text outnumbers its actual
// non-Latin content -- salfeet.org's index is 0.3% high bytes, and that mistake
// silently discarded all five of its Arabic strings.
function guessLegacyCharset(buffer) {
  const scripts = {
    'windows-1256': /[؀-ۿ]{2,}/g, // Arabic
    'windows-1255': /[֐-׿]{2,}/g, // Hebrew
    'windows-1251': /[Ѐ-ӿ]{2,}/g, // Cyrillic
    'windows-1253': /[Ͱ-Ͽ]{2,}/g, // Greek
    // Accented-Latin runs, excluding the ×÷ math symbols that fall in this range
    // and show up in mojibake far more often than in real words.
    'windows-1252': /[À-ÖØ-öø-ÿ]{2,}/g,
  };

  let best = 'windows-1252';
  let bestScore = -1;

  for (const [candidate, script] of Object.entries(scripts)) {
    const decoded = iconv.decode(buffer, candidate);
    const runs = (decoded.match(script) || []).length;
    const bad = (decoded.match(/�/g) || []).length;
    const score = runs - bad * 10;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// CDX
// ---------------------------------------------------------------------------

async function fetchCdxList() {
  const logPath = path.join(destDir, siteDir, 'log.json');

  if ((await fsExists(logPath)) && !opts.overwrite) {
    console.log('Page log found:', logPath);
    return JSON.parse(await fs.readFile(logPath, 'utf-8'));
  }

  const filters = [
    'statuscode:200',
    encodeURIComponent('!original:.*\\?.*'),
    encodeURIComponent('!original:.*_vti_.*'),
  ]
    .map((f) => `&filter=${f}`)
    .join('');

  const requestUrl =
    `https://web.archive.org/cdx/search/cdx?url=${opts.webPath}/*` +
    `&output=json&from=${opts.fromBound}&to=${opts.toBound}${filters}`;

  console.log('REQUEST URL:', requestUrl);

  const response = await fetch(requestUrl);
  if (!response.ok) {
    throw new Error(`CDX request failed: HTTP ${response.status}`);
  }

  const rows = (await response.json()).slice(1);
  console.log(`Page list fetched from CDX API (${rows.length} rows).`);

  const pages = rows.map((row) => ({
    urlKey: row[0],
    timestamp: row[1],
    originalUrl: row[2],
    mimetype: row[3],
    statusCode: row[4],
    digest: row[5],
    length: row[6],
  }));

  // Reverse so that when duplicate urlKeys collapse below, the earliest
  // snapshot of each URL is the one kept.
  pages.reverse();

  const unique = [...new Map(pages.map((p) => [p.urlKey, p])).values()];

  // Seed with pages only; assets are discovered from the pages themselves, which
  // catches css/js the CDX filters above would never return.
  const seeds = unique.filter(
    (p) => p.mimetype === 'text/html' || HTML_EXTENSIONS.test(p.originalUrl)
  );

  await fs.mkdir(path.join(destDir, siteDir), { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(seeds));
  console.log(`Page log written: ${seeds.length} pages to crawl.`);

  return seeds;
}

// ---------------------------------------------------------------------------
// Download queue
// ---------------------------------------------------------------------------

class Queue {
  constructor() {
    this.pending = [];
    this.seen = new Set();
    this.cooldownUntil = 0;
    // Items handed to a worker but not yet finished. A worker that finds the queue
    // empty must not exit while this is non-zero: assets are discovered from pages
    // mid-crawl, so an empty queue usually means "wait", not "done".
    this.inFlight = 0;
    this.stats = { pages: 0, assets: 0, skipped: 0, failed: 0, refusals: 0 };
    // Per-page asset tally, keyed by the referencing page's localPath. Assets are
    // downloaded by a shared worker pool, not synchronously per page, so completion
    // is counted back to the parent here rather than inline in handleItem.
    this.pageProgress = new Map();
  }

  // All of a page's assets are enqueued in one synchronous `enqueueAssets` pass, so
  // `expected` is fully set before any worker picks up a child -- the tally can never
  // report done early.
  recordExpected(parent) {
    if (!parent) return;
    const p = this.pageProgress.get(parent) || { expected: 0, done: 0, failed: 0 };
    p.expected += 1;
    this.pageProgress.set(parent, p);
  }

  // Count one terminal asset outcome against its page; print a summary once the last
  // asset of that page lands. Retries don't call this -- only success, skip, or a
  // give-up counts.
  recordAssetResult(parent, ok) {
    if (!parent) return;
    const p = this.pageProgress.get(parent);
    if (!p) return;
    if (ok) p.done += 1;
    else p.failed += 1;
    if (p.done + p.failed >= p.expected) {
      // "new" because an asset shared across pages is enqueued -- and so tallied --
      // only under the first page that referenced it this run.
      console.log(
        `   ↳ ${parent}: ${p.done}/${p.expected} new assets saved` +
          (p.failed ? `, ${p.failed} failed` : '')
      );
      this.pageProgress.delete(parent);
    }
  }

  // `item.localPath` is resolved here, once, so the download pass and the rewrite pass
  // cannot disagree about where a URL lands -- the two deriving it independently is
  // what left off-host images pointing at dead hosts.
  add(item) {
    const isDocument = item.isDocument !== false;
    const localPath =
      item.localPath ||
      (item.external
        ? toExternalPath(item.originalUrl, { isDocument })
        : toLocalPath(item.originalUrl, { isDocument }));

    const key = `${item.timestamp}|${localPath}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.pending.push({ attempts: 0, depth: 0, isDocument, ...item, localPath });
    return true;
  }

  next() {
    return this.pending.shift();
  }

  // Called when the archive refuses connections: every worker waits out one
  // shared cooldown rather than each backing off independently.
  startCooldown() {
    const now = Date.now();
    if (now < this.cooldownUntil) return;
    this.cooldownUntil = now + COOLDOWN_MS;
    this.stats.refusals += 1;
    console.log(
      `\n⏸️  Connections refused by archive — pausing all workers ${COOLDOWN_MS / 1000}s\n`
    );
  }

  async waitOutCooldown() {
    const remaining = this.cooldownUntil - Date.now();
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining));
    }
  }
}

function isRefusal(error) {
  const code = error?.cause?.code || error?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ETIMEDOUT'
  );
}

// A rate-limit / temporary-unavailable response. Distinct from an outright refusal
// only in that it arrives as an HTTP status rather than a socket error, but it warrants
// the same shared cooldown and retry -- otherwise a 429 burst is silently recorded as
// permanent failure and the asset is never fetched.
class RateLimitError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function isBackoff(error) {
  return isRefusal(error) || error instanceof RateLimitError;
}

// Pull one snapshot and, if it is HTML, enqueue everything it links to.
async function handleItem(item, queue) {
  let localPath = item.localPath;

  if (!resolveDest(localPath)) {
    console.log(`⚠️  refusing to write outside output dir: ${localPath}`);
    queue.stats.failed += 1;
    queue.recordAssetResult(item.parent, false);
    return;
  }

  // Already on disk from an earlier run. For a plain asset that means we are done. For
  // an HTML page it does not: its subresources still have to be re-discovered, or an
  // image that 429'd last run never gets a second chance. So re-scan the saved copy off
  // disk -- no network -- and enqueue anything still missing, rather than skipping it.
  const savedPath = await savedAssetPath(localPath, item);
  if (savedPath) {
    const pageIsHtml = HTML_EXTENSIONS.test(savedPath);
    if (!pageIsHtml) {
      queue.stats.skipped += 1;
      queue.recordAssetResult(item.parent, true);
      return;
    }

    const buffer = await fs.readFile(resolveDest(savedPath));
    const { html } = decodeHtml(buffer, '', savedPath);
    const found =
      item.depth >= MAX_EXTERNAL_DEPTH ? 0 : enqueueAssets(html, item, queue);
    queue.stats.skipped += 1;
    queue.recordAssetResult(item.parent, true);
    if (found) console.log(`♻️  ${savedPath} (cached) +${found} assets rechecked`);
    return;
  }

  const url = waybackUrl(item.timestamp, item.originalUrl);
  const response = await fetch(url, { redirect: 'follow' });

  // 429 (rate limited) and 503 (temporarily unavailable) are transient -- throw so the
  // worker loop applies the shared cooldown and requeues, same as a connection refusal.
  // Draining the body first frees the socket for the connection pool during the wait.
  if (response.status === 429 || response.status === 503) {
    await response.arrayBuffer().catch(() => {});
    throw new RateLimitError(response.status);
  }

  if (!response.ok) {
    console.log(`❌ HTTP ${response.status} ${url}`);
    queue.stats.failed += 1;
    queue.recordAssetResult(item.parent, false);
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const isHtml =
    contentType.includes('text/html') || HTML_EXTENSIONS.test(localPath);

  // Give extensionless assets one based on what came back, so the browser and the
  // static server both see a type they can act on.
  if (!path.posix.basename(localPath).includes('.')) {
    const type = contentType.split(';')[0].trim().toLowerCase();
    const ext = isHtml ? '.html' : EXTENSION_BY_TYPE[type];
    if (ext) localPath += ext;
  }

  const fullPath = resolveDest(localPath);
  if (!fullPath) {
    console.log(`⚠️  refusing to write outside output dir: ${localPath}`);
    queue.stats.failed += 1;
    queue.recordAssetResult(item.parent, false);
    return;
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  if (isHtml) {
    const { html, charset } = decodeHtml(buffer, contentType, localPath);
    await fs.writeFile(fullPath, html, 'utf8');
    queue.stats.pages += 1;

    // Off-host pages get their subresources fetched too, or the rewrite pass points
    // at `_external` copies that were never downloaded. This stays bounded because
    // `enqueueAssets` collects subresources only -- never anchors -- so it cannot walk
    // outward from page to page. Nested frames are the one recursive case, hence the
    // depth cap.
    const found =
      item.depth >= MAX_EXTERNAL_DEPTH ? 0 : enqueueAssets(html, item, queue);
    console.log(
      `📄 ${localPath} (${charset}, ${buffer.length}b)${found ? ` +${found} assets` : ''}`
    );
    // A framed document is both a page and an asset of its frameset -- tally it back.
    queue.recordAssetResult(item.parent, true);
  } else {
    // Everything else -- images, css, js -- is written byte-for-byte.
    await fs.writeFile(fullPath, buffer);
    queue.stats.assets += 1;
    console.log(`${item.external ? '🌐' : '💾'} ${localPath} (${buffer.length}b)`);
    queue.recordAssetResult(item.parent, true);
  }
}

// The local path this URL is already saved under, or null if not on disk. Allows for
// an extension added at download time to an originally extensionless path, and returns
// the real on-disk name so the caller can tell a saved HTML page (re-scan it) from a
// saved asset (skip it).
async function savedAssetPath(localPath) {
  if (await fsExists(resolveDest(localPath))) return localPath;
  if (path.posix.basename(localPath).includes('.')) return null;

  for (const ext of SNIFFED_EXTENSIONS) {
    const candidate = resolveDest(localPath + ext);
    if (candidate && (await fsExists(candidate))) return localPath + ext;
  }

  return null;
}

// Collect asset URLs from a page and queue them at the page's own timestamp.
// The archive redirects to the nearest snapshot, so no per-asset CDX lookup.
function enqueueAssets(html, page, queue) {
  const $ = cheerio.load(html);
  const refs = [];

  for (const [selector, attr, meta = {}] of ASSET_SELECTORS) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) refs.push({ ref: value, isDocument: meta.document === true });
    });
  }

  // Anchors and image maps that point straight at an image file. Not documents, so
  // this can't recurse into other pages -- only the linked image is pulled down, and
  // the rewrite pass then relinks the anchor to the local copy instead of disabling it.
  $('a[href], area[href]').each((_, el) => {
    const value = $(el).attr('href');
    if (value && IMAGE_EXTENSIONS.test(value.split('#')[0])) {
      refs.push({ ref: value, isDocument: false });
    }
  });

  // <param name="movie" value="..."> -- the only place many Flash pages name the SWF.
  // Selected by attribute value rather than by selector, hence the separate pass.
  $('param[value]').each((_, el) => {
    if (!isMovieParam($, el)) return;
    const value = $(el).attr('value');
    if (value) refs.push({ ref: value, isDocument: false });
  });

  // Inline background:url(...) declarations.
  $('[style*="url("]').each((_, el) => {
    const style = $(el).attr('style') || '';
    for (const match of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      refs.push({ ref: match[1], isDocument: false });
    }
  });

  // Image URLs embedded in inline scripts. FrontPage rollover buttons preload their
  // hover image only from JS, so it never surfaces as an attribute. Match quoted
  // string literals ending in an image extension; anything that doesn't resolve to a
  // saved file is harmless -- the archive 302s or 404s and the rewrite pass ignores it.
  $('script:not([src])').each((_, el) => {
    const code = $(el).text() || '';
    for (const match of code.matchAll(SCRIPT_IMAGE_REF)) {
      refs.push({ ref: match[1], isDocument: false });
    }
  });

  let added = 0;
  for (const { ref, isDocument } of refs) {
    const resolved = toAbsolute(ref, page.originalUrl);
    if (!resolved) continue;
    if (
      queue.add({
        timestamp: page.timestamp,
        originalUrl: resolved.url,
        mimetype: '',
        isDocument,
        // An asset of an off-host page is itself off-host relative to the site.
        external: resolved.external || page.external === true,
        depth: (page.depth || 0) + 1,
        // The page this asset was found on, so its download can be tallied back.
        parent: page.localPath,
      })
    ) {
      added += 1;
      // Only count assets we actually enqueue; a deduped one is already accounted
      // for under whichever page first referenced it.
      queue.recordExpected(page.localPath);
    }
  }

  return added;
}

// Resolve a page-relative reference against the page's archived URL. Returns
// `{ url, external }`, or null for references with nothing to fetch.
//
// Off-host assets are no longer dropped -- they are flagged `external` and stored
// under `_external/`. Their absolute URLs point at hosts that mostly stopped
// resolving years ago, so leaving them alone renders as a broken image.
function toAbsolute(ref, pageUrl) {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (NON_NAVIGATIONAL.test(trimmed)) return null;

  // A ref already rewritten by a previous run reads `/<destPath>/<localPath>`. When a
  // saved page is re-scanned on rerun, invert that rewrite to recover the URL it came
  // from, so an asset that never downloaded (e.g. 429'd) can be re-enqueued. The
  // rewrite is deterministic, so this is exact: an `_external/<host>/...` path maps
  // back to that host, everything else to the site's own host. Targets already on disk
  // dedup out in handleItem, so re-enqueuing them costs nothing.
  const linkPrefix = `/${opts.destPath}/`;
  if (trimmed.startsWith(linkPrefix)) {
    let inner = trimmed.slice(linkPrefix.length).split('#')[0].split('?')[0];
    const extPrefix = path.posix.join(siteDir, EXTERNAL_DIR) + '/';
    if (inner.startsWith(extPrefix)) {
      return { url: inner.slice(extPrefix.length), external: true };
    }
    return { url: inner, external: false };
  }

  const base = pageUrl.startsWith('http') ? pageUrl : `http://${pageUrl}`;

  try {
    const resolved = new URL(trimmed, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }

    const external = normalizeHost(resolved.host) !== normalizeHost(new URL(base).host);

    // Query strings are dropped from local paths, so two URLs differing only in
    // their query would overwrite each other -- keep the one the archive returns.
    return { url: resolved.host + resolved.pathname, external };
  } catch {
    return null;
  }
}

async function drain(queue) {
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      await queue.waitOutCooldown();

      const item = queue.next();

      if (!item) {
        // Nothing queued right now. Only stop once no other worker could still
        // enqueue more; otherwise idle briefly and re-check.
        if (queue.inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      queue.inFlight += 1;
      try {
        await handleItem(item, queue);
      } catch (error) {
        if (isBackoff(error)) {
          queue.startCooldown();
          item.attempts += 1;
          if (item.attempts < MAX_ATTEMPTS) {
            queue.pending.push(item);
          } else {
            queue.stats.failed += 1;
            queue.recordAssetResult(item.parent, false);
            console.log(`‼️  giving up after ${MAX_ATTEMPTS}: ${item.originalUrl}`);
          }
        } else {
          queue.stats.failed += 1;
          queue.recordAssetResult(item.parent, false);
          console.error(`‼️  ${item.originalUrl}: ${error.message}`);
        }
      } finally {
        queue.inFlight -= 1;
      }
    }
  });

  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Local link rewrite (no network)
// ---------------------------------------------------------------------------

// Top-level site directories under destDir, lowercased. Lets the rewrite tell a href
// an earlier run produced correctly from one it mangled -- see rewriteAttr. Populated
// by rewriteSavedPages before any rewriting happens.
let siteRoots = new Set();

// Point every in-scope URL at its local copy under /<destPath>/. Non-navigational
// URLs and off-host ones with no local copy are left untouched; fragments preserved.
function rewriteAttr(value, pageLocalPath, { isDocument = true, localizeOffHost = true } = {}) {
  const raw = value.trim();
  if (!raw || NON_NAVIGATIONAL.test(raw)) return null;

  // Same-page fragment: nothing to resolve.
  if (raw.startsWith('#')) return null;

  // Already rewritten by an earlier run. Without this, a root-relative `/sites/...`
  // reads as site-root-relative and gets the prefix a second time, so every re-run
  // pushes the path one level deeper.
  //
  // Unless its first segment names no site we have. An older version of this pass
  // resolved some page-relative refs against the wrong base and wrote
  // `/sites/units/baru/index.htm` for a link that meant `planet.edu/~arij/units/...`.
  // A blanket skip freezes those forever: they resolve to nothing, so the dead-link
  // pass marks them and no later run ever reconsiders them. Re-resolve the remainder as
  // the relative ref it originally was, and keep the result only if it lands on a file
  // that exists -- a miss leaves the href untouched and still marked dead, so the
  // repair can only improve matters.
  const linkPrefix = `/${opts.destPath}/`;
  if (raw.startsWith(linkPrefix)) {
    const rest = raw.slice(linkPrefix.length);
    if (siteRoots.has(rest.split('/')[0].toLowerCase())) return null;
    const repaired = rewriteAttr(rest, pageLocalPath, { isDocument, localizeOffHost });
    if (!repaired || !repaired.startsWith(linkPrefix)) return null;
    const full = resolveDest(repaired.slice(linkPrefix.length).split('#')[0]);
    return full && existsSync(full) ? repaired : null;
  }

  const [pathPart, ...fragmentParts] = raw.split('#');
  const fragment = fragmentParts.length ? `#${fragmentParts.join('#')}` : '';

  if (!pathPart) return null;

  // A page saved under _external is addressed relative to that host, not the site's.
  const external = externalContext(pageLocalPath);
  const pageHost = external ? external.host : pageLocalPath.split('/')[0];
  const pageDirBase = external ? external.inner : pageLocalPath;

  let target;
  if (/^https?:\/\//i.test(pathPart)) {
    let refHost;
    try {
      refHost = normalizeHost(new URL(pathPart).host);
    } catch {
      return null;
    }

    if (refHost === normalizeHost(pageHost)) {
      target = toLocalPath(pathPart, { isDocument });
      if (external) target = path.posix.join(external.site, EXTERNAL_DIR, target);
    } else {
      // Another host. These archives are crawled one site at a time into sibling
      // directories under destDir, so a cross-site reference frequently *does* have a
      // local copy: merip.org's link to birzeit.edu resolves to `sites/birzeit.edu/`.
      // Prefer that over any `_external` copy -- it is the full crawl of that host,
      // with its own links already rewritten, not one orphaned file.
      target = savedLocalPath(toLocalPath(pathPart, { isDocument }), isDocument);

      // No sibling site. For a subresource, fall back to the `_external` copy saved
      // alongside the referencing page -- but only if it is actually on disk, since
      // some are 404 in the archive and pointing at a path that does not exist is
      // strictly worse than leaving the original URL alone. Off-host *links* get no
      // such fallback: a link is for the reader to follow, so with no local copy it
      // stays outward (and the dead-link pass below then marks it).
      if (!target && localizeOffHost) {
        for (const root of externalRoots(pageLocalPath)) {
          target = savedLocalPath(
            path.posix.join(root, EXTERNAL_DIR, toLocalPath(pathPart, { isDocument })),
            isDocument
          );
          if (target) break;
        }
      }

      if (!target) return null;
      return `/${opts.destPath}/${target}${fragment}`;
    }
  } else if (pathPart.startsWith('/')) {
    target = toLocalPath(`${pageHost}${pathPart}`, { isDocument });
    if (external) target = path.posix.join(external.site, EXTERNAL_DIR, target);
  } else {
    const dir = path.posix.dirname(pageDirBase);
    target = toLocalPath(path.posix.join(dir, pathPart), { isDocument });
    if (external) target = path.posix.join(external.site, EXTERNAL_DIR, target);
  }

  // Extensionless assets were saved with a sniffed extension; point at that name.
  target = resolveSavedName(target, isDocument);

  return `/${opts.destPath}/${target}${fragment}`;
}

// If `target` has no extension and the download pass saved it with one, return the
// saved name. Synchronous so it can run inside cheerio's `.each` callbacks.
function resolveSavedName(target, isDocument) {
  if (isDocument || path.posix.basename(target).includes('.')) return target;

  const full = resolveDest(target);
  if (!full || existsSync(full)) return target;

  for (const ext of SNIFFED_EXTENSIONS) {
    const candidate = resolveDest(target + ext);
    if (candidate && existsSync(candidate)) return target + ext;
  }

  return target;
}

// The local path a target is actually saved under, or null if nothing is on disk.
// Extensionless assets were written with a sniffed extension, so the name the rewrite
// derives is not always the name the download pass chose.
function savedLocalPath(target, isDocument) {
  const resolved = resolveSavedName(target, isDocument);
  const full = resolveDest(resolved);
  return full && existsSync(full) ? resolved : null;
}

// Directories that could hold the `_external` store for a page, longest prefix first.
// The download pass writes off-host assets under the crawl's own root -- the host
// directory for a whole-host crawl, but a deeper prefix when a crawl was scoped to a
// subpath. Walking up from the page resolves both without needing to know which crawl
// saved it, which the global `siteDir` no longer tells us now that the rewrite pass
// covers every site rather than just the one just downloaded.
function externalRoots(pageLocalPath) {
  const parts = pageLocalPath.split('/');
  const roots = [];
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    roots.push(parts.slice(0, i).join('/'));
  }
  return roots;
}

// Split a local path inside `_external` into the host it belongs to and the path
// relative to that host, so references from an off-host page resolve against it.
// `site` is the crawl root the store hangs off, so callers can rebuild the prefix.
function externalContext(localPath) {
  const parts = localPath.split('/');
  const marker = parts.indexOf(EXTERNAL_DIR);
  if (marker < 1) return null;

  const inner = parts.slice(marker + 1).join('/');
  const host = inner.split('/')[0];
  if (!host) return null;

  return { host, inner, site: parts.slice(0, marker).join('/') };
}

// True when a loaded page embeds a Flash movie, by any of the three spellings.
function hasFlash($) {
  if ($('object[data$=".swf" i], embed[src$=".swf" i]').length) return true;
  if ($('object[type="application/x-shockwave-flash" i]').length) return true;
  if ($('embed[type="application/x-shockwave-flash" i]').length) return true;

  let found = false;
  $('param[value]').each((_, el) => {
    if (found) return;
    if (isMovieParam($, el) && /\.swf(\?|#|$)/i.test($(el).attr('value') || '')) {
      found = true;
    }
  });

  return found;
}

// Copy Ruffle's selfhosted build into <destDir>/_wayback/ruffle/ so the archive plays
// Flash with no network. Returns false when the package is not installed, in which case
// the injection is skipped entirely rather than pointing pages at a script that 404s.
//
// Ruffle is a webpack bundle: `ruffle.js` is a small loader that resolves its core
// chunks and wasm binaries relative to its own URL, so the whole directory has to travel
// together. Source maps are the one thing worth dropping -- they roughly double the size
// and are of no use in an archive viewer. The licences are copied deliberately; the
// build is MIT/Apache-2.0 and redistributing it means carrying them along.
async function vendorRuffle(waybackDir) {
  const source = path.join(process.cwd(), 'node_modules', '@ruffle-rs', 'ruffle');
  if (!existsSync(source)) return false;

  const target = path.join(waybackDir, 'ruffle');
  await fs.mkdir(target, { recursive: true });

  let copied = 0;
  for (const name of await fs.readdir(source)) {
    if (name.endsWith('.map') || name === 'package.json') continue;

    const from = path.join(source, name);
    const to = path.join(target, name);

    // Ruffle's filenames are content-hashed, so same name means same bytes; only the
    // unhashed ruffle.js needs a size check to catch a version bump.
    const [src, dest] = await Promise.all([
      fs.stat(from),
      fs.stat(to).catch(() => null),
    ]);
    if (dest && dest.size === src.size) continue;

    await fs.copyFile(from, to);
    copied += 1;
  }

  if (copied) console.log(`Vendored Ruffle: ${copied} files into _wayback/ruffle/.`);
  return true;
}

async function rewriteSavedPages(seeds) {
  console.log('\nRewriting links in saved pages...');
  let rewritten = 0;

  // Every site, not just the one just crawled. These archives cross-link heavily --
  // merip.org points at birzeit.edu, which is its own crawl -- and a link only becomes
  // resolvable once its target host has been downloaded. Restricting this pass to the
  // current site meant those links were judged against a half-finished corpus and
  // frozen that way: still pointing at the live web, permanently marked dead, and never
  // revisited no matter what later runs pulled down. Re-walking everything is cheap
  // (no network) and idempotent, so each run brings the whole corpus up to date.
  const htmlFiles = await collectHtml(destDir);
  const byPath = new Map(
    seeds.map((s) => [toLocalPath(s.originalUrl), s])
  );

  siteRoots = new Set(
    (await fs.readdir(destDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name.toLowerCase())
  );

  // Every file currently on disk, keyed the same way a rewritten href is (relative to
  // destDir, posix separators, lowercased). Rebuilt from the filesystem on every run,
  // so it is always current: a page downloaded in a later crawl revives links to it on
  // pages saved earlier, because this pass re-walks and re-marks every page each time.
  const fileSet = await collectFiles(destDir);

  // A link is live only if its resolved local target is a file we actually saved.
  // Outward `http://` links (never localized) and missing internal pages both fail
  // this, so both get disabled -- nothing is left pointing at the live web or archive.
  const linkPrefix = `/${opts.destPath}/`;
  function localTargetExists(href) {
    if (!href.startsWith(linkPrefix)) return false;
    let target = href.slice(linkPrefix.length).split('#')[0].split('?')[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      // Leave malformed escapes as-is, same as toLocalPath.
    }
    return fileSet.has(target.toLowerCase());
  }

  // Shared client assets: one delegated handler blocks every dead link on a page
  // regardless of count, and the CSS gives the not-allowed cursor. Kept directly under
  // destDir rather than per-site, so every downloaded site shares one copy instead of
  // each carrying its own; written once per run so styling can change without
  // re-crawling.
  const waybackDir = path.join(destDir, '_wayback');
  await fs.mkdir(waybackDir, { recursive: true });
  await fs.writeFile(
    path.join(waybackDir, 'dead-links.css'),
    'a.dead,area.dead{cursor:not-allowed}\n' +
      'a.dead:not(.dead-img),area.dead{opacity:.5;text-decoration:line-through}\n' +
      // Image maps stay unclickable via the JS handler below, but the archived
      // link is usually one region of a larger sliced image -- a not-allowed
      // cursor over the whole graphic reads wrong when most of it is still live.
      'a.dead-img-map{cursor:auto}\n'
  );
  await fs.writeFile(
    path.join(waybackDir, 'dead-links.js'),
    "document.addEventListener('click',function(e){" +
      "var el=e.target.closest&&e.target.closest('a.dead,area.dead');" +
      'if(el){e.preventDefault();e.stopPropagation();}' +
      '},true);\n'
  );
  const assetBase = `${linkPrefix}_wayback`;
  const ruffleReady = await vendorRuffle(waybackDir);
  let flashPages = 0;

  for (const fullPath of htmlFiles) {
    const localPath = path.relative(destDir, fullPath);
    const html = await fs.readFile(fullPath, 'utf-8');
    const $ = cheerio.load(html);

    $('html').removeAttr('style');
    $('head base').removeAttr('href').removeAttr('target');

    // Content was decoded from its original codepage and saved as UTF-8, with the
    // stale declaration stripped. Without a fresh one the browser falls back to
    // guessing, which mojibakes non-Latin pages.
    if (!$('meta[charset]').length) {
      const head = $('head');
      if (head.length) head.prepend('<meta charset="utf-8">');
      else $.root().prepend('<meta charset="utf-8">');
    }

    // Neutralize pop-ups and dialogs however they are triggered. Overriding the
    // globals up front covers inline handlers, external scripts, and body onload
    // alike -- more reliable than trying to grep every script for `window.open`.
    // Injected as the first element in <head> so it runs before any page script.
    if (!$('#wayback-guard').length) {
      const guard =
        '<script id="wayback-guard">' +
        'window.open=function(){return null};' +
        'window.alert=function(){};' +
        'window.confirm=function(){return false};' +
        'window.prompt=function(){return null};' +
        '</script>';
      const head = $('head');
      if (head.length) head.prepend(guard);
      else $.root().prepend(guard);
    }

    for (const [selector, spec] of Object.entries(LINK_ATTRS)) {
      $(selector).each((_, el) => {
        const value = $(el).attr(spec.attr);
        if (!value) return;
        // An anchor straight to an image is a subresource we downloaded (see
        // enqueueAssets), including off-host into `_external` -- so localize it and
        // treat it as a file, unlike an anchor to a page which stays a followable link.
        const imageTarget =
          (selector === 'a' || selector === 'area') &&
          IMAGE_EXTENSIONS.test(value.split('#')[0].split('?')[0]);
        const next = rewriteAttr(value, localPath, {
          isDocument: imageTarget ? false : spec.document === true,
          localizeOffHost: imageTarget ? true : spec.localizeOffHost,
        });
        if (next) $(el).attr(spec.attr, next);
      });
    }

    // <param name="movie"> alongside the attribute table above -- same rewrite, but the
    // element is picked by its `name` value rather than by selector.
    $('param[value]').each((_, el) => {
      if (!isMovieParam($, el)) return;
      const next = rewriteAttr($(el).attr('value'), localPath, {
        isDocument: false,
        localizeOffHost: true,
      });
      if (next) $(el).attr('value', next);
    });

    // Disable links whose target is not a file we saved. Cleared first and fully
    // recomputed from the current file set, never accumulated -- so a link marked dead
    // in an earlier run goes live again once a later crawl downloads its target. Runs
    // after the rewrite loop above, so internal hrefs already read `/sites/...`;
    // outward links were left as `http://...` and so fail localTargetExists too.
    $('a.dead, area.dead')
      .removeClass('dead dead-img dead-img-map')
      .removeAttr('aria-disabled');
    $('a[href], area[href]').each((_, el) => {
      const $el = $(el);
      const href = ($el.attr('href') || '').trim();
      if (!href || href.startsWith('#') || NON_NAVIGATIONAL.test(href)) return;
      if (localTargetExists(href)) return;
      $el.addClass('dead').attr('aria-disabled', 'true');
      // Image links get the not-allowed cursor but keep their normal look --
      // fading/striking through a picture reads as broken image, not dead link.
      const isImageLink = $el.is('a') && $el.find('img').length && !$el.text().trim();
      if (isImageLink) {
        $el.addClass('dead-img');
        // A "map" URL is one region of an image map, not a standalone graphic --
        // skip the cursor change too, since the click-block alone is enough there.
        if (href.toLowerCase().includes('map')) $el.addClass('dead-img-map');
      }
    });

    // Inline background:url(...) references -- always subresources.
    $('[style*="url("]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const next = style.replace(
        /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
        (match, ref) => {
          const rewrittenRef = rewriteAttr(ref, localPath, {
            isDocument: false,
            localizeOffHost: true,
          });
          return rewrittenRef ? `url("${rewrittenRef}")` : match;
        }
      );
      if (next !== style) $(el).attr('style', next);
    });

    // Stop links opening a new tab/window. Only `_blank`/`_new` do that -- this is a
    // frameset site, so named targets (`mainframe`, `_top`, ...) are load-in-frame
    // navigation and must be left alone.
    $('[target]').each((_, el) => {
      const target = ($(el).attr('target') || '').trim().toLowerCase();
      if (target === '_blank' || target === '_new') $(el).removeAttr('target');
    });

    // Strip auto-playing background audio. 2001-era pages embed MIDI that a modern
    // browser would try to fetch and play on load; the crawl never downloaded these
    // (no selector matches them), so a local copy would 404 anyway.
    $('bgsound').remove();
    $('embed, object, audio, source').each((_, el) => {
      const $el = $(el);
      const ref = ($el.attr('src') || $el.attr('data') || '').toLowerCase();
      if (/\.(mid|midi|rmi)(\?|#|$)/.test(ref)) $el.remove();
    });

    $('a[href^="mailto:"]').css('pointer-events', 'none');
    $('form').each((_, el) => {
      $(el)
        .removeAttr('action')
        .removeAttr('method')
        .attr('onsubmit', 'return false');
    });

    // Collapse spacing in cells that hold only an image, so sliced-image
    // layouts line up. `<map>` renders no box -- it only defines an image's
    // clickable areas -- so a cell holding an image plus its map is still
    // image-only for this purpose and must not be excluded, or the baseline
    // gap under image-mapped slices survives.
    $('td, th').each((_, el) => {
      const $el = $(el);
      if (
        $el.children('img').length &&
        !$el.text().trim() &&
        $el.children().not('img, map').length === 0
      ) {
        $el.css('font-size', '0');
      }
    });

    const source = byPath.get(localPath);
    if (source) {
      $('body').attr('data-wayback-url', waybackUrl(source.timestamp, source.originalUrl));
    }

    if (!$('#print-size').length) {
      $('head').append(
        '<style id="print-size">@media print { @page { size: 176mm 240mm; } }</style>'
      );
    }

    if (!$('#dead-links-css').length) {
      $('head').append(
        `<link id="dead-links-css" rel="stylesheet" href="${assetBase}/dead-links.css">`
      );
    }
    if (!$('#dead-links-js').length) {
      $('head').append(
        `<script id="dead-links-js" src="${assetBase}/dead-links.js"></script>`
      );
    }

    // Flash. Ruffle's selfhosted build is a polyfill: loading it is the whole
    // integration -- it finds the page's own <object>/<embed> Flash elements and swaps
    // in its player, reading the movie URL off the attributes rewritten above. So
    // nothing about the archived markup changes, which is what keeps this
    // non-invasive; the `id_` snapshots simply never had the player the Wayback
    // toolbar injects for you.
    //
    // Injected only on pages that actually reference a SWF. It pulls a ~14MB wasm core
    // on first use, and only 6 pages in this archive are Flash pages -- putting the tag
    // on all 6000 would make every unrelated page pay for a feature it never uses.
    if (ruffleReady && hasFlash($) && !$('#ruffle-js').length) {
      $('head').append(
        `<script id="ruffle-js" src="${assetBase}/ruffle/ruffle.js"></script>`
      );
      flashPages += 1;
    }

    await fs.writeFile(fullPath, $.html(), 'utf8');
    rewritten += 1;
  }

  console.log(`Rewrote ${rewritten} pages.`);
  if (flashPages) {
    console.log(`Ruffle injected into ${flashPages} Flash pages.`);
  } else if (!ruffleReady) {
    console.log('Ruffle not installed (npm i @ruffle-rs/ruffle); Flash left inert.');
  }
}

// Every file under `dir`, as a Set of destDir-relative posix paths, lowercased -- the
// exact form a rewritten href resolves to, so membership testing is a direct hash hit
// with no per-link stat syscalls. Links can point at non-HTML (pdf, images), so unlike
// collectHtml this keeps every file.
async function collectFiles(dir) {
  const out = new Set();

  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.add(path.relative(destDir, full).split(path.sep).join('/').toLowerCase());
      }
    }
  }

  await walk(dir);
  return out;
}

async function collectHtml(dir) {
  const out = [];
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectHtml(full)));
    } else if (HTML_EXTENSIONS.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function seedsFromSheet() {
  const parser = new PublicGoogleSheetsParser(SPREADSHEET_ID);
  const rows = await parser.parse();

  let seeds = rows
    .filter((row) => row.URL)
    .map((row) => {
      const match = row.URL.match(/^https?:\/\/(.+)$/i);
      if (!match) return null;
      return {
        timestamp: row.Timestamp || '',
        originalUrl: match[1],
        mimetype: 'text/html',
      };
    })
    .filter(Boolean);

  if (opts.webPath) {
    seeds = seeds.filter((s) => s.originalUrl.includes(opts.webPath));
  }

  return seeds;
}

async function main() {
  if (!opts.webPath) {
    console.error(
      'Usage: node src/cdx-scraper.js <webPath> <fromBound> [toBound] [--overwrite] [--sheets] [--rewrite-only]'
    );
    process.exit(1);
  }

  // A rewrite-only run reads the site's existing log.json, so it needs no bounds.
  if (!opts.sheets && !opts.rewriteOnly && !opts.fromBound) {
    console.error(
      'Please provide a Wayback Machine timestamp to search within (1 year, or 2 datetime stamps).'
    );
    process.exit(1);
  }

  const seeds = opts.sheets ? await seedsFromSheet() : await fetchCdxList();

  // Nothing to crawl is fatal for a download run but fine for a rewrite: seeds only
  // supply the data-wayback-url annotation there, and the pass walks the disk anyway.
  if (opts.rewriteOnly) {
    await rewriteSavedPages(seeds);
    return;
  }

  if (!seeds.length) {
    console.error('No pages to crawl.');
    process.exit(1);
  }

  const queue = new Queue();
  for (const seed of seeds) queue.add(seed);

  console.log(
    `\nDownloading with ${CONCURRENCY} workers into ${opts.destPath}/ ...\n`
  );

  const startedAt = Date.now();
  await drain(queue);
  const elapsed = (Date.now() - startedAt) / 1000;

  const { pages, assets, skipped, failed, refusals } = queue.stats;
  const done = pages + assets;

  console.log(
    `\nDownloaded ${done} files (${pages} pages, ${assets} assets) in ${elapsed.toFixed(1)}s` +
      ` — ${(done / elapsed).toFixed(1)} files/s`
  );
  console.log(`Skipped ${skipped} existing, ${failed} failed, ${refusals} cooldowns.`);

  await rewriteSavedPages(seeds);
}

await main();
