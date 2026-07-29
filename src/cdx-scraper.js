// Wayback Machine scraper: CDX page list -> browserless parallel download -> local link rewrite.
//
// Fetches the `id_` ("identity") variant of each snapshot, which returns the original
// archived bytes with no Wayback toolbar, no injected scripts and original relative URLs.
// That means no browser is needed, and nothing has to be stripped after the fact.
//
// Assets linked from a page are enqueued during the same pass, at the page's own
// timestamp -- the archive 302s to the nearest snapshot of that asset.
//
// Requires Node >= 18 for global fetch (see .nvmrc).

import fs from 'fs/promises';
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

// Server-side extensions that nonetheless contain HTML once archived. Used both to
// seed the crawl and to decide what the rewrite pass walks -- the two must agree,
// or pages get downloaded with their links left pointing at web.archive.org.
const HTML_EXTENSIONS = /\.(htm|html|shtml|shtm|php|asp|aspx|jsp|cfm|cgi|pl)$/i;

// Assets worth pulling down alongside a page. Deliberately wider than the CDX
// filter, which excludes css/js entirely and so loses page styling.
const ASSET_SELECTORS = [
  ['img', 'src'],
  ['link[rel~="stylesheet"]', 'href'],
  ['script[src]', 'src'],
  ['input[type="image"]', 'src'],
  ['body', 'background'],
  ['td', 'background'],
  ['table', 'background'],
  ['frame', 'src'],
  ['iframe', 'src'],
];

// Elements whose URLs get rewritten to point at the local copy.
const LINK_ATTRS = {
  a: 'href',
  area: 'href',
  link: 'href',
  script: 'src',
  body: 'background',
  td: 'background',
  table: 'background',
  img: 'src',
  frame: 'src',
  iframe: 'src',
};

const NON_NAVIGATIONAL = /^(mailto:|tel:|javascript:|data:|about:|ftp:|news:)/i;

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
    destPath: flags.has('--in-place') ? 'sites' : 'sites-v2',
  };
}

const opts = parseArgs(process.argv.slice(2));
const destDir = path.join(process.cwd(), opts.destPath);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Map an archived URL onto a local path. Percent-escapes are decoded exactly once
// here so a name never lands on disk in both encoded and decoded form.
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
    // Leave malformed escapes as-is rather than dropping the URL.
  }

  if (clean.endsWith('/') || !path.posix.basename(clean).includes('.')) {
    clean = path.posix.join(clean, 'index.html');
  }

  return clean;
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
  const logPath = path.join(destDir, opts.webPath, 'log.json');

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

  await fs.mkdir(path.join(destDir, opts.webPath), { recursive: true });
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
  }

  add(item) {
    const key = `${item.timestamp}|${toLocalPath(item.originalUrl)}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.pending.push({ attempts: 0, ...item });
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

// Pull one snapshot and, if it is HTML, enqueue everything it links to.
async function handleItem(item, queue) {
  const localPath = toLocalPath(item.originalUrl);
  const fullPath = resolveDest(localPath);

  if (!fullPath) {
    console.log(`⚠️  refusing to write outside output dir: ${localPath}`);
    queue.stats.failed += 1;
    return;
  }

  if (await fsExists(fullPath)) {
    queue.stats.skipped += 1;
    return;
  }

  const url = waybackUrl(item.timestamp, item.originalUrl);
  const response = await fetch(url, { redirect: 'follow' });

  if (!response.ok) {
    console.log(`❌ HTTP ${response.status} ${url}`);
    queue.stats.failed += 1;
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const isHtml =
    contentType.includes('text/html') || HTML_EXTENSIONS.test(localPath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  if (isHtml) {
    const { html, charset } = decodeHtml(buffer, contentType, localPath);
    await fs.writeFile(fullPath, html, 'utf8');
    queue.stats.pages += 1;

    const found = enqueueAssets(html, item, queue);
    console.log(
      `📄 ${localPath} (${charset}, ${buffer.length}b)${found ? ` +${found} assets` : ''}`
    );
  } else {
    // Everything else -- images, css, js -- is written byte-for-byte.
    await fs.writeFile(fullPath, buffer);
    queue.stats.assets += 1;
    console.log(`💾 ${localPath} (${buffer.length}b)`);
  }
}

// Collect asset URLs from a page and queue them at the page's own timestamp.
// The archive redirects to the nearest snapshot, so no per-asset CDX lookup.
function enqueueAssets(html, page, queue) {
  const $ = cheerio.load(html);
  const refs = [];

  for (const [selector, attr] of ASSET_SELECTORS) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) refs.push(value);
    });
  }

  // Inline background:url(...) declarations.
  $('[style*="url("]').each((_, el) => {
    const style = $(el).attr('style') || '';
    for (const match of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      refs.push(match[1]);
    }
  });

  let added = 0;
  for (const ref of refs) {
    const absolute = toAbsolute(ref, page.originalUrl);
    if (!absolute) continue;
    if (
      queue.add({
        timestamp: page.timestamp,
        originalUrl: absolute,
        mimetype: '',
      })
    ) {
      added += 1;
    }
  }

  return added;
}

// Resolve a page-relative reference against the page's archived URL. Returns null
// for off-site and non-navigational references, which are left alone.
function toAbsolute(ref, pageUrl) {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (NON_NAVIGATIONAL.test(trimmed)) return null;

  const base = pageUrl.startsWith('http') ? pageUrl : `http://${pageUrl}`;

  try {
    const resolved = new URL(trimmed, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    // Only follow assets on the host being archived.
    const baseHost = new URL(base).hostname.replace(/^www\d?\./, '');
    const refHost = resolved.hostname.replace(/^www\d?\./, '');
    if (refHost !== baseHost) return null;

    return resolved.host + resolved.pathname;
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
        if (isRefusal(error)) {
          queue.startCooldown();
          item.attempts += 1;
          if (item.attempts < MAX_ATTEMPTS) {
            queue.pending.push(item);
          } else {
            queue.stats.failed += 1;
            console.log(`‼️  giving up after ${MAX_ATTEMPTS}: ${item.originalUrl}`);
          }
        } else {
          queue.stats.failed += 1;
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

// Point every in-scope URL at its local copy under /<destPath>/. Off-site and
// non-navigational URLs are left untouched, and fragments are preserved.
function rewriteAttr(value, pageLocalPath) {
  const raw = value.trim();
  if (!raw || NON_NAVIGATIONAL.test(raw)) return null;

  // Same-page fragment: nothing to resolve.
  if (raw.startsWith('#')) return null;

  const [pathPart, ...fragmentParts] = raw.split('#');
  const fragment = fragmentParts.length ? `#${fragmentParts.join('#')}` : '';

  if (!pathPart) return null;

  const pageHost = pageLocalPath.split('/')[0];

  let target;
  if (/^https?:\/\//i.test(pathPart)) {
    // Only same-host URLs have a local copy; leave off-site links pointing out.
    let refHost;
    try {
      refHost = new URL(pathPart).hostname.replace(/^www\d?\./, '');
    } catch {
      return null;
    }
    if (refHost !== pageHost) return null;
    target = toLocalPath(pathPart);
  } else if (pathPart.startsWith('/')) {
    target = toLocalPath(`${pageHost}${pathPart}`);
  } else {
    const dir = path.posix.dirname(pageLocalPath);
    target = toLocalPath(path.posix.join(dir, pathPart));
  }

  return `/${opts.destPath}/${target}${fragment}`;
}

async function rewriteSavedPages(seeds) {
  console.log('\nRewriting links in saved pages...');
  let rewritten = 0;

  // Walk what actually landed on disk rather than the seed list, so assets and
  // pages discovered mid-crawl are covered too.
  const htmlFiles = await collectHtml(path.join(destDir, opts.webPath));
  const byPath = new Map(
    seeds.map((s) => [toLocalPath(s.originalUrl), s])
  );

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

    for (const [element, attr] of Object.entries(LINK_ATTRS)) {
      $(element).each((_, el) => {
        const value = $(el).attr(attr);
        if (!value) return;
        const next = rewriteAttr(value, localPath);
        if (next) $(el).attr(attr, next);
      });
    }

    // Inline background:url(...) references.
    $('[style*="url("]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const next = style.replace(
        /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
        (match, ref) => {
          const rewrittenRef = rewriteAttr(ref, localPath);
          return rewrittenRef ? `url("${rewrittenRef}")` : match;
        }
      );
      if (next !== style) $(el).attr('style', next);
    });

    $('[target="_blank"]').removeAttr('target');
    $('a[href^="mailto:"]').css('pointer-events', 'none');
    $('form').each((_, el) => {
      $(el)
        .removeAttr('action')
        .removeAttr('method')
        .attr('onsubmit', 'return false');
    });

    // Collapse spacing in cells that hold only an image, so sliced-image
    // layouts line up.
    $('td, th').each((_, el) => {
      const $el = $(el);
      if (
        $el.children('img').length &&
        !$el.text().trim() &&
        $el.children().not('img').length === 0
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

    await fs.writeFile(fullPath, $.html(), 'utf8');
    rewritten += 1;
  }

  console.log(`Rewrote ${rewritten} pages.`);
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
      'Usage: node src/cdx-scraper.js <webPath> <fromBound> [toBound] [--overwrite] [--sheets] [--in-place]'
    );
    process.exit(1);
  }

  if (!opts.sheets && !opts.fromBound) {
    console.error(
      'Please provide a Wayback Machine timestamp to search within (1 year, or 2 datetime stamps).'
    );
    process.exit(1);
  }

  const seeds = opts.sheets ? await seedsFromSheet() : await fetchCdxList();

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
