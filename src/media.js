// Restore the audio and video that archived pages link to, and make it playable.
//
//   node src/media.js [--dry-run] [--max-mb N]
//
// The scraper downloads what a page shows inline -- images, styles, frames, Flash --
// but a recording was usually an ordinary <a href> to a .rm or .ram file, so those
// links were left dead. This fills them in, and is safe to rerun after any crawl:
//
//   1. Find every link to an audio/video file in the saved pages.
//   2. Look the missing ones up in the Wayback index, one prefix query per folder (the
//      index is slow; a folder of 70 recordings is one request instead of 70). Results
//      are cached in storage/, so a rerun does not ask again.
//   3. Download the raw capture (`id_`, not the Wayback player page) to the path the
//      link already points at. The 2000-era crawler kept at most ~1 MB of a large file,
//      so the copy is checked against the original length and marked partial if short.
//   4. Follow .ram/.rpm pointer files -- a line like pnm://host/show.rm naming a stream
//      -- to the recording they name, and fetch that.
//   5. Convert what no browser plays (RealAudio, Windows Media, .au, ...) with ffmpeg:
//      audio to <file>.mp3, video to <file>.mp4. The original stays beside it.
//   6. Point the links at the playable file, clear the dead-link marking, and title a
//      partial recording with how much of it survives.
//
// Pages are edited as bytes (read and written as latin1), touching only the tags whose
// target changed, so their encoding and every other byte stay as the scraper left them.
// What was restored, from which capture, and whether it is partial is written to
// media-manifest.json.

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { toLocalPath } from './page-index.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : fallback;
};
const DRY_RUN = argv.includes('--dry-run');
const MAX_BYTES = Number(flag('--max-mb', 50)) * 1e6;

const SITES = path.join(process.cwd(), 'sites');
const CACHE = path.join(process.cwd(), 'storage', 'media-cdx.json');
const MANIFEST = path.join(process.cwd(), 'media-manifest.json');
const UA = 'palestineonline-archive/1.0 (+https://palestineonline.net)';

const MEDIA_EXT = /\.(rm|ram|ra|rpm|rmm|mp3|wav|au|snd|aif|aiff|mid|midi|wma|wmv|asf|avi|mov|qt|mpg|mpeg|mpe)$/i;
// Text files that name a stream rather than containing one.
const POINTER_EXT = /\.(ram|rpm|rmm)$/i;
// Formats a current browser plays as they are; everything else gets converted. MIDI is
// left alone too: there is no browser decoder to convert for, and it still downloads.
const PLAYABLE_EXT = /\.(mp3|wav|mid|midi)$/i;

// ---------------------------------------------------------------------------
// Finding the links
// ---------------------------------------------------------------------------

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Exact-case existence, the way the Linux server resolves paths. On macOS fs.existsSync
// ignores case and would report a file the server cannot find.
const listings = new Map();
function existsExact(rel) {
  let dir = SITES;
  for (const segment of rel.split('/')) {
    if (!listings.has(dir)) {
      try {
        listings.set(dir, new Set(fs.readdirSync(dir)));
      } catch {
        listings.set(dir, new Set());
      }
    }
    if (!listings.get(dir).has(segment)) return false;
    dir = path.join(dir, segment);
  }
  return true;
}
// Records a file just written, and every directory created on the way to it, in the
// cached listings. Adding only the file was not enough: a parent listed before mkdir
// still lacked the new directory, so everything saved under it read as missing.
function noteWritten(rel) {
  let dir = SITES;
  for (const segment of rel.split('/')) {
    if (listings.has(dir)) listings.get(dir).add(segment);
    dir = path.join(dir, segment);
  }
}

// The crawl a page belongs to: the nearest directory above it holding a log.json.
// Off-site files are stored under that crawl's _external/, as the scraper does.
const crawlRoots = new Map();
function crawlRootOf(pageRel) {
  let dir = path.posix.dirname(pageRel);
  while (dir && dir !== '.') {
    if (!crawlRoots.has(dir)) crawlRoots.set(dir, fs.existsSync(path.join(SITES, dir, 'log.json')));
    if (crawlRoots.get(dir)) return dir;
    dir = path.posix.dirname(dir);
  }
  return pageRel.split('/')[0];
}

function normalizeHost(host) {
  return host.replace(/:\d+$/, '').replace(/^www\d?\./, '').toLowerCase();
}

// Where a URL's file lives under sites/, seen from a page in the given crawl: on the
// crawl's own host it is the plain local path, anywhere else it goes in _external/.
function localFor(url, crawlRoot) {
  const bare = url.replace(/^[a-z]+:\/\//i, '');
  const host = normalizeHost(bare.split('/')[0]);
  const local = toLocalPath('http://' + bare);
  if (host === normalizeHost(crawlRoot.split('/')[0])) return local;
  return path.posix.join(crawlRoot, '_external', local);
}

// The URL a /sites/ link was rewritten from: _external/<host>/... names its host,
// anything else is on the site's own host.
function originalFor(local) {
  const parts = local.split('/');
  const at = parts.indexOf('_external');
  return at === -1 ? local : parts.slice(at + 1).join('/');
}

const TAG = /<(a|area|embed)\b[^>]*>/gi;
const ATTR = /\b(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;

function collect() {
  const targets = new Map(); // local path -> { local, original, refs: [{ page }] }
  for (const file of walk(SITES)) {
    if (!/\.s?html?$/i.test(file)) continue;
    const page = path.relative(SITES, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'latin1');
    for (const [tag] of html.matchAll(TAG)) {
      const attr = ATTR.exec(tag);
      if (!attr) continue;
      const ref = (attr[3] ?? attr[4] ?? attr[5] ?? '').split('#')[0].split('?')[0];
      if (!MEDIA_EXT.test(ref)) continue;

      let local;
      if (ref.startsWith('/sites/')) {
        try {
          local = decodeURIComponent(ref.slice('/sites/'.length));
        } catch {
          continue;
        }
      } else if (/^https?:\/\//i.test(ref)) {
        local = localFor(ref, crawlRootOf(page));
      } else {
        continue;
      }
      if (local.split('/').includes('..')) continue;

      const target = targets.get(local) || { local, original: originalFor(local), refs: [] };
      target.refs.push({ page, ref: attr[3] ?? attr[4] ?? attr[5] });
      targets.set(local, target);
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// The Wayback index
// ---------------------------------------------------------------------------

// How the index identifies a URL, near enough: no scheme, port or www, lowercased.
function indexKey(url) {
  let u = url.replace(/^[a-z]+:\/\//i, '').split('#')[0].split('?')[0];
  u = u.replace(/:\d+(?=\/|$)/, '');
  return u.replace(/^www\d?\./i, '').toLowerCase();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, { attempts = 5, timeoutMs = 180_000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 429/5xx and the archive's "Temporarily Offline" page are worth waiting out.
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      if (i === attempts - 1) throw error;
      await sleep(Math.min(60_000, 5_000 * 2 ** i));
    }
  }
}

// Only media captures are kept. A folder can hold far more than recordings -- and a file
// at a site's top level makes "the folder" the whole site, 173,000 captures for one radio
// station -- which is how an unfiltered cache outgrew what JSON.stringify can write.
function isMediaCapture(c) {
  return MEDIA_EXT.test(String(c.original || '').split('?')[0]);
}

function loadCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    for (const key of Object.keys(cache)) cache[key] = cache[key].filter(isMediaCapture);
    return cache;
  } catch {
    return {};
  }
}

// The cache key and index query for an original URL. Files share a folder query, so a
// directory of 70 recordings is one request; a file at a site's top level is asked for
// by itself instead, since its folder would be the entire site.
function lookupFor(original) {
  const folder = original.slice(0, original.lastIndexOf('/'));
  return folder.includes('/') ? { key: folder, url: folder + '/', matchType: 'prefix' } : { key: original, url: original, matchType: 'exact' };
}

// Every media capture for a lookup, from the cache or one query. The index filters to
// media files itself, so even a large folder comes back small.
async function folderCaptures(lookup, cache) {
  if (cache[lookup.key]) return cache[lookup.key];
  const query = new URLSearchParams({
    url: lookup.url,
    matchType: lookup.matchType,
    output: 'json',
    fl: 'timestamp,original,mimetype,statuscode,length',
    filter: `original:(?i).*\\.(${MEDIA_EXT.source.match(/\((.*)\)/)[1]})$`,
  });
  const res = await fetchRetry(`https://web.archive.org/cdx/search/cdx?${query}`);
  const text = await res.text();
  // Anything but JSON is the outage page served with a 200; not cached, so a rerun retries.
  if (text.trimStart().startsWith('<')) throw new Error('index unavailable');
  const rows = text.trim() ? JSON.parse(text) : [];
  const captures = rows
    .slice(1)
    .map((r) => Object.fromEntries(rows[0].map((k, i) => [k, r[i]])))
    .filter(isMediaCapture);
  cache[lookup.key] = captures;
  return captures;
}

// Several folders at a time, a few requests in flight, the cache saved as it fills.
async function lookUpAll(originals, cache) {
  const lookups = [...new Map(originals.map((o) => lookupFor(o)).map((l) => [l.key, l])).values()].filter(
    (l) => !cache[l.key],
  );
  let next = 0;
  let failed = 0;
  async function worker() {
    while (next < lookups.length) {
      const lookup = lookups[next++];
      try {
        await folderCaptures(lookup, cache);
      } catch {
        failed += 1;
      }
      // Saved even on a dry run: it is only a cache of the index, in gitignored storage/.
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
  }
  if (lookups.length) console.log(`Looking up ${lookups.length} folders and files in the Wayback index...`);
  await Promise.all([worker(), worker(), worker()]);
  if (failed) console.log(`  ${failed} folder lookups failed; rerun to retry them.`);
}

// The capture worth downloading: a 200 that is not an HTML error page, the largest of
// them, since a short copy is the truncated one.
function bestCapture(original, cache) {
  const key = indexKey(original);
  const ok = (cache[lookupFor(original).key] || []).filter(
    (c) =>
      indexKey(c.original) === key &&
      c.statuscode === '200' &&
      /^\d+$/.test(c.length) &&
      !/html/i.test(c.mimetype),
  );
  return ok.sort((a, b) => Number(b.length) - Number(a.length))[0] || null;
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

// The body, or as much of it as arrives. A truncated capture is served with the
// original file's Content-Length -- 22.6 MB announced, 1 MB sent -- so fetch reports the
// early end as a dropped connection. Everything received before it is kept.
async function readBody(res) {
  const chunks = [];
  const reader = res.body.getReader();
  let complete = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } catch {
    complete = false;
  }
  return { body: Buffer.concat(chunks), complete };
}

async function download(target, capture) {
  // The index's record size, not the response's Content-Length, which for a truncated
  // capture is the size of a file the archive does not have.
  if (Number(capture.length) > MAX_BYTES) return { error: `larger than ${MAX_BYTES / 1e6} MB` };

  const url = `https://web.archive.org/web/${capture.timestamp}id_/${capture.original}`;
  let res = await fetchRetry(url, { timeoutMs: 600_000 });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  let { body, complete } = await readBody(res);

  // Cut short: the archive's copy ends there, or the connection dropped. A second try
  // that stops at the same byte is the archive; a longer one was the network.
  if (!complete) {
    res = await fetchRetry(url, { timeoutMs: 600_000 });
    const retry = await readBody(res);
    if (retry.body.length > body.length) ({ body, complete } = retry);
    else if (retry.body.length < body.length) return { error: 'download kept failing' };
  }
  if (!body.length) return { error: 'empty' };

  const head = body.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return { error: 'archived as an HTML page' };

  // The archive passes on the original server's length. Less than that arrived means
  // the crawler stopped early, which is how the 2000-era crawls stored anything big.
  const original = Number(res.headers.get('x-archive-orig-content-length') || 0);
  const partial = original > body.length ? { bytes: body.length, of: original } : null;

  if (!DRY_RUN) {
    const dest = path.join(SITES, target.local);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    noteWritten(target.local);
  }
  return { capture: `${capture.timestamp}/${capture.original}`, bytes: body.length, partial };
}

// The stream a pointer file names, or null. A .ram is a short text file of URLs, one
// per line, most often pnm://host/path.rm for RealServer.
function pointerTarget(local) {
  let text;
  try {
    text = fs.readFileSync(path.join(SITES, local), 'latin1');
  } catch {
    return null;
  }
  if (text.startsWith('.RMF')) return null; // a recording saved under a .ram name
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(pnm|rtsp|https?):\/\/([^\s?#]+)/i.exec(line);
    if (m && MEDIA_EXT.test(m[2]) && !POINTER_EXT.test(m[2])) return m[2];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Converting
// ---------------------------------------------------------------------------

function hasVideo(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return probe.status === 0 && probe.stdout.includes('video');
}

function duration(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const seconds = Number.parseFloat(probe.stdout);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

// <file>.mp3, or <file>.mp4 for video, beside the original. Skipped when already done,
// so reruns cost nothing. A truncated file decodes up to where it stops.
function convert(local) {
  if (PLAYABLE_EXT.test(local)) return { playable: local };
  const src = path.join(SITES, local);
  const video = hasVideo(src);
  const out = `${local}.${video ? 'mp4' : 'mp3'}`;
  const dest = path.join(SITES, out);

  if (!existsExact(out) && !DRY_RUN) {
    const args = video
      ? ['-y', '-v', 'error', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dest]
      : ['-y', '-v', 'error', '-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '5', dest];
    const run = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    // A partial file often ends in an error after decoding everything it holds; keep
    // the output if there is any, since that is the surviving part of the recording.
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      fs.rmSync(dest, { force: true });
      return { error: `ffmpeg: ${(run.stderr || '').trim().split('\n').pop() || 'no output'}` };
    }
    noteWritten(out);
  }
  return { playable: out, seconds: DRY_RUN ? null : duration(dest) };
}

// ---------------------------------------------------------------------------
// Relinking
// ---------------------------------------------------------------------------

function sitesHref(local) {
  return '/sites/' + local.split('/').map(encodeURIComponent).join('/');
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Points one tag at its playable file and clears the scraper's dead-link marking.
function relinkTag(tag, oldRef, newHref, note) {
  let out = tag.replace(ATTR, (match, name, quoted) => {
    const value = quoted.replace(/^["']|["']$/g, '');
    return value === oldRef ? `${name}="${newHref}"` : match;
  });
  out = out
    .replace(/\s+aria-disabled\s*=\s*("true"|'true'|true)/i, '')
    .replace(/\s+class\s*=\s*"([^"]*)"/i, (match, classes) => {
      const kept = classes.split(/\s+/).filter((c) => c && !/^dead(-img(-map)?)?$/.test(c));
      return kept.length ? ` class="${kept.join(' ')}"` : '';
    });
  if (note && !/\btitle\s*=/i.test(out)) out = out.replace(/^(<\w+)/, `$1 title="${note}"`);
  return out;
}

function relinkPages(edits) {
  let pages = 0;
  let links = 0;
  for (const [page, changes] of edits) {
    const file = path.join(SITES, page);
    const html = fs.readFileSync(file, 'latin1');
    const next = html.replace(TAG, (tag) => {
      const attr = ATTR.exec(tag);
      if (!attr) return tag;
      const ref = attr[3] ?? attr[4] ?? attr[5];
      const change = changes.get(ref);
      if (!change) return tag;
      const updated = relinkTag(tag, ref, change.href, change.note);
      if (updated !== tag) links += 1;
      return updated;
    });
    if (next !== html) {
      if (!DRY_RUN) fs.writeFileSync(file, next, 'latin1');
      pages += 1;
    }
  }
  return { pages, links };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(tool, ['-version']).status !== 0) {
      console.error(`${tool} is required (brew install ffmpeg).`);
      process.exit(1);
    }
  }

  const manifest = (() => {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    } catch {
      return {};
    }
  })();
  const cache = loadCache();
  const targets = collect();
  console.log(`${targets.size} linked audio/video files.`);

  // Fetch whatever is missing; then the same again for streams named by pointer files,
  // which only become known once those files are on disk.
  const outcome = new Map();
  async function fetchMissing(list) {
    const missing = list.filter((t) => !existsExact(t.local));
    await lookUpAll(missing.map((t) => t.original), cache);
    let got = 0;
    for (const t of missing) {
      const capture = bestCapture(t.original, cache);
      if (!capture) {
        outcome.set(t.local, { error: 'not archived' });
        continue;
      }
      if (DRY_RUN) {
        got += 1;
        continue;
      }
      const result = await download(t, capture);
      outcome.set(t.local, result);
      if (!result.error) {
        got += 1;
        manifest[t.local] = { ...manifest[t.local], capture: result.capture, bytes: result.bytes, partial: result.partial };
      }
      await sleep(500);
    }
    return { tried: missing.length, got };
  }

  const first = await fetchMissing([...targets.values()]);
  console.log(`${DRY_RUN ? 'Would download' : 'Downloaded'} ${first.got} of ${first.tried} missing files.`);

  const pointed = new Map(); // pointer local -> stream local
  const streams = new Map();
  for (const t of targets.values()) {
    if (!POINTER_EXT.test(t.local) || !existsExact(t.local)) continue;
    const stream = pointerTarget(t.local);
    if (!stream) continue;
    const root = crawlRootOf(t.refs[0].page);
    const local = localFor(stream, root);
    pointed.set(t.local, local);
    if (!targets.has(local)) streams.set(local, { local, original: originalFor(local), refs: [] });
  }
  const second = await fetchMissing([...streams.values()]);
  if (second.tried) console.log(`Pointer files name ${second.tried} more recordings; downloaded ${second.got}.`);

  // Convert everything on disk that a browser cannot play, and work out where each link
  // should now point.
  const playable = new Map();
  const converted = { ok: 0, failed: 0 };
  for (const local of new Set([...targets.keys(), ...streams.keys()])) {
    if (POINTER_EXT.test(local) || !existsExact(local)) continue;
    const result = convert(local);
    playable.set(local, result);
    if (result.error) converted.failed += 1;
    else if (result.playable !== local) {
      converted.ok += 1;
      manifest[local] = { ...manifest[local], playable: result.playable, seconds: result.seconds };
    }
  }
  console.log(`Converted ${converted.ok} to MP3/MP4${converted.failed ? `; ${converted.failed} failed` : ''}.`);

  const edits = new Map();
  for (const t of targets.values()) {
    const source = POINTER_EXT.test(t.local) ? pointed.get(t.local) : t.local;
    const result = source && playable.get(source);
    if (!result || result.error) continue;
    const info = manifest[source] || {};
    const note =
      info.partial && result.seconds
        ? `Partial recording: only the first ${clock(result.seconds)} survives in the archive`
        : info.partial
          ? 'Partial recording: only the start survives in the archive'
          : null;
    for (const { page, ref } of t.refs) {
      if (!edits.has(page)) edits.set(page, new Map());
      edits.get(page).set(ref, { href: sitesHref(result.playable), note });
    }
  }
  const relinked = relinkPages(edits);
  console.log(`Relinked ${relinked.links} links on ${relinked.pages} pages.`);

  const reasons = {};
  for (const r of outcome.values()) if (r.error) reasons[r.error] = (reasons[r.error] || 0) + 1;
  if (Object.keys(reasons).length) console.log('Not restored:', reasons);

  if (!DRY_RUN) {
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
  } else {
    console.log('(dry run: nothing written)');
  }
}

await main();
