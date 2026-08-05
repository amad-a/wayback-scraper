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
  let text;
  try {
    text = cheerio.load(html)('title').first().text();
  } catch {
    return '';
  }

  // Archived titles are full of hard-wrapped whitespace and non-breaking spaces.
  return (text || '').replace(/[\s ]+/g, ' ').trim();
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
