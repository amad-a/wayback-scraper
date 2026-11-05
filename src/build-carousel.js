// Build the list a page's image carousel walks through, from a folder of picks.
//
//   node src/build-carousel.js <folder> <out.json>
//   node src/build-carousel.js image-aliases/banners-homepage sites/palestineonline.net/banners.json
//   node src/build-carousel.js image-aliases/computer-picks sites/palestineonline.net/computers.json
//
// The folder is one you filled by hand from image-aliases/ (src/build-image-aliases.js),
// whose entries are named after their path under sites/ ("birzeit.edu ∕ images ∕ x.gif").
// Each one is matched back to its original by that name, or failing that by content, so
// a pick that was copied rather than linked still finds its source. A pick that matches
// nothing under sites/ -- one you cropped, say -- is copied in beside the list, under
// <out dir>/images/, so the page can still show it.
//
// For each image the list names an archived page that shows it -- the best-scoring page
// in archive.db whose markup points at the file -- and that page's original address, so
// the carousel can link back to where the picture was found. Run `npm run db` first if pages are new.
//
// The output is a plain JSON array in folder order (alphabetical, which groups by site);
// the folder itself is gitignored, so the list is what gets committed.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITES = path.join(ROOT, 'sites');
const [folderArg, outArg] = process.argv.slice(2);
if (!folderArg || !outArg) {
  console.error('usage: node src/build-carousel.js <folder> <out.json>');
  process.exit(1);
}
const FOLDER = path.resolve(folderArg);
const OUT = path.resolve(outArg);

const IMAGE = /\.(gif|jpe?g|png|bmp|webp)$/i;
const PAGE = /\.(html?|shtml|asp|php|cfm|stm|cgi|pl)$/i;
const rel = (file) => path.relative(SITES, file).split(path.sep).join('/');
const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

function walk(dir, test, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (entry.isFile() && test(entry.name)) out.push(full);
  }
  return out;
}

// --- which pages show which images -------------------------------------------------------

// Every image a page points at, resolved to paths under sites/ (lowercased, as the
// archive's paths are): `shown` from src, background and CSS url(), `linked` from an
// <a href> -- a thumbnail's full-size picture, or a folder listing's entry.
function imageRefs() {
  const shown = new Map();
  const linked = new Map();
  for (const file of walk(SITES, (name) => PAGE.test(name))) {
    const page = rel(file);
    const text = fs.readFileSync(file, 'latin1');
    const refs = [
      ...[...text.matchAll(/\b(?:src|background|lowsrc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)].map((m) => [m[1], shown]),
      ...[...text.matchAll(/url\(\s*([^)]*?)\s*\)/gi)].map((m) => [m[1], shown]),
      ...[...text.matchAll(/\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)].map((m) => [m[1], linked]),
    ];
    for (const [raw, into] of refs) {
      let ref = raw.trim().replace(/^['"]|['"]$/g, '').replace(/[?#].*$/, '');
      if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
      try {
        ref = decodeURIComponent(ref);
      } catch {
        // left encoded
      }
      let target;
      if (ref.startsWith('/sites/')) target = ref.slice('/sites/'.length);
      else if (ref.startsWith('/')) continue;
      else target = path.posix.normalize(path.posix.join(path.posix.dirname(page), ref));
      if (target.startsWith('..') || !IMAGE.test(target)) continue;
      target = target.toLowerCase();
      if (!into.has(target)) into.set(target, new Set());
      into.get(target).add(page);
    }
  }
  return { shown, linked };
}

// --- main ----------------------------------------------------------------------------------

const picks = fs.readdirSync(FOLDER).filter((name) => IMAGE.test(name)).sort((a, b) => a.localeCompare(b));
console.log(`${picks.length} images in ${path.relative(ROOT, FOLDER)}.`);

// Every copy of each image under sites/, by content. Built only when needed: for a pick
// whose name doesn't lead to its original, or one no page shows under its own path --
// the same picture is often saved twice in one site, and the page shows the other copy.
let byHash = null;
const copiesOf = (file) => {
  if (!byHash) {
    byHash = new Map();
    for (const f of walk(SITES, (name) => IMAGE.test(name)).sort()) {
      const h = md5(f);
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(rel(f));
    }
  }
  return byHash.get(md5(file)) || [];
};

console.log('Finding the pages that show them…');
const { shown, linked } = imageRefs();
const db = new Database(path.join(ROOT, 'archive.db'), { readonly: true });
const pageInfo = db.prepare('SELECT display_url, score FROM pages WHERE local_path = ?');

// The page to credit: one the database knows, best score first, then the shortest path
// (a site's front page over a deep one).
function bestPage(images, refs) {
  return images
    .flatMap((image) => [...(refs.get(image.toLowerCase()) || [])])
    .map((page) => ({ page, info: pageInfo.get(page) }))
    .filter((p) => p.info)
    .sort((a, b) => b.info.score - a.info.score || a.page.length - b.page.length || a.page.localeCompare(b.page))[0];
}

const outDir = path.dirname(OUT);
// Pages added to the list by hand, for images no page is found for (a crop, or one whose
// page points at it by a broken path): kept from the last run.
const byHand = new Map();
try {
  for (const e of JSON.parse(fs.readFileSync(OUT, 'utf-8'))) if (e.page) byHand.set(e.src, e);
} catch {}
const list = [];
for (const name of picks) {
  const file = path.join(FOLDER, name);
  let src = name.replace(/ ∕ /g, '/');
  const original = path.join(SITES, src);
  if (!fs.existsSync(original) || md5(original) !== md5(file)) {
    src = copiesOf(file)[0];
  }
  let copied = false;
  if (!src) {
    // Matches nothing in the archive: kept beside the list instead.
    const dest = path.join(outDir, 'images', path.basename(name.replace(/ ∕ /g, '-')));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    src = rel(dest);
    copied = true;
  }

  // Shown under its own path, else shown as another copy, else at least linked to.
  const found =
    bestPage([src], shown) || bestPage(copiesOf(file), shown) || bestPage([src, ...copiesOf(file)], linked);

  const { width, height, pageHeight } = await sharp(file, { animated: true }).metadata();
  const entry = { src: '/sites/' + src, width, height: pageHeight || height };
  const kept = byHand.get(entry.src);
  if (found) Object.assign(entry, { page: found.page, url: found.info.display_url });
  else if (kept) Object.assign(entry, { page: kept.page, url: kept.url });
  else console.warn(`  no page shows ${src}; add its page and url to the list by hand`);
  if (copied) console.warn(`  ${name} matches nothing in sites/; copied to ${src}`);
  list.push(entry);
}

fs.writeFileSync(OUT, JSON.stringify(list, null, 1) + '\n');
console.log(`Wrote ${list.length} entries to ${path.relative(ROOT, OUT)}.`);
