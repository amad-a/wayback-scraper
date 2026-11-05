// Build image-aliases/ -- every image under sites/, sorted into folders of links by
// size, shape, animation, use as a wallpaper tile, and what is in the picture.
//
//   node src/build-image-aliases.js [--out DIR]
//
// Nothing is copied: each entry is a hard link to the original under sites/ -- the same
// file under a second name -- so the tree costs next to nothing and Finder shows each
// one's own thumbnail, which it won't for a symlink. Deleting an entry leaves the
// original alone; editing one edits the original. A file git rewrites (a checkout, a
// rescrape) gets a new inode, and its entry keeps the old picture until the next
// rebuild. Identical files
// (the same bullet saved by twenty sites) are listed once, under the first path in sort
// order. An image can sit in many folders at once.
//
// What is in the picture comes from macOS's Vision framework (scripts/image-vision.swift):
// scene labels, recognised text (Arabic included) and faces. It is slow -- tens of
// minutes for the whole archive -- so its answers are cached by file content in
// <out>/.cache/vision.jsonl, and a rerun only looks at images it has not seen.
//
// The output is generated and gitignored; delete it freely.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawn } from 'child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITES = path.join(ROOT, 'sites');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(argOut !== -1 ? process.argv[argOut + 1] : path.join(ROOT, 'image-aliases'));
const CACHE = path.join(OUT, '.cache');
const VISION_CACHE = path.join(CACHE, 'vision.jsonl');
const VISION_BIN = path.join(CACHE, 'image-vision');
const VISION_SRC = path.join(ROOT, 'scripts', 'image-vision.swift');

const IMAGE = /\.(gif|jpe?g|png|bmp|webp)$/i;
const PAGE = /\.(html?|shtml|asp|php|cfm|stm|css)$/i;

// --- finding the images ----------------------------------------------------------------

function walk(dir, test, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (entry.isFile() && test(entry.name)) out.push(full);
  }
  return out;
}

// The folder a crawl was saved under: the nearest directory above the file with a
// log.json, else the site's own top folder.
function crawlRootOf(rel, roots) {
  let dir = path.posix.dirname(rel);
  while (dir !== '.') {
    if (roots.has(dir)) return dir;
    dir = path.posix.dirname(dir);
  }
  return rel.split('/')[0];
}

// --- wallpaper tiles -------------------------------------------------------------------

// Every image some page tiles behind its content: a background attribute (body, table,
// cell), a background in an inline style, or a background rule in a stylesheet.
function backgroundImages() {
  const used = new Set();
  const resolve = (from, ref) => {
    ref = ref.trim().replace(/^['"]|['"]$/g, '').replace(/[?#].*$/, '');
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return; // live web, data:, javascript:
    let rel;
    try {
      ref = decodeURIComponent(ref);
    } catch {
      // left encoded
    }
    if (ref.startsWith('/sites/')) rel = ref.slice('/sites/'.length);
    else if (ref.startsWith('/')) return;
    else rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), ref));
    if (!rel.startsWith('..')) used.add(rel.toLowerCase());
  };
  for (const file of walk(SITES, (name) => PAGE.test(name))) {
    const rel = path.relative(SITES, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'latin1');
    for (const m of text.matchAll(/\bbackground\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) resolve(rel, m[1]);
    for (const m of text.matchAll(/background(?:-image)?\s*:[^;"'}>]*?url\(\s*([^)]*?)\s*\)/gi)) resolve(rel, m[1]);
  }
  return used;
}

// --- what Vision sees ------------------------------------------------------------------

function readVisionCache() {
  const byHash = new Map();
  if (!fs.existsSync(VISION_CACHE)) return byHash;
  for (const line of fs.readFileSync(VISION_CACHE, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      byHash.set(row.hash, row);
    } catch {
      // a line cut short by an interrupted run
    }
  }
  return byHash;
}

// One run of the Swift tool over `batch`, appending each answer to the cache as it
// arrives. Resolves with the files it answered for, even when the tool crashes partway.
function visionBatch(batch, append) {
  const hashOf = new Map(batch.map((img) => [img.file, img.hash]));
  const answered = new Set();
  const child = spawn(VISION_BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.end(batch.map((img) => img.file).join('\n') + '\n');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const row = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      answered.add(row.path);
      row.hash = hashOf.get(row.path);
      delete row.path;
      fs.writeSync(append, JSON.stringify(row) + '\n');
    }
  });
  return new Promise((resolve) => child.on('close', () => resolve(answered)));
}

// Runs the Swift tool over the images not in the cache, in batches so an interrupted
// run keeps what it had. Vision now and then crashes the whole process (it isn't the
// same image twice), so whatever a batch left unanswered is tried again one at a time;
// an image that brings it down on its own is recorded as an error and skipped.
async function runVision(todo) {
  if (!todo.length) return;
  if (!fs.existsSync(VISION_BIN) || fs.statSync(VISION_BIN).mtimeMs < fs.statSync(VISION_SRC).mtimeMs) {
    console.log('Compiling scripts/image-vision.swift…');
    execFileSync('swiftc', ['-O', VISION_SRC, '-o', VISION_BIN], { stdio: 'inherit' });
  }
  console.log(`Vision: ${todo.length} images to look at (cached answers are reused)…`);
  const append = fs.openSync(VISION_CACHE, 'a');
  const BATCH = 500;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const answered = await visionBatch(batch, append);
    for (const img of batch.filter((img) => !answered.has(img.file))) {
      if (!(await visionBatch([img], append)).size) {
        fs.writeSync(append, JSON.stringify({ hash: img.hash, error: 'crashed' }) + '\n');
      }
    }
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  fs.closeSync(append);
}

// --- the folders -----------------------------------------------------------------------

// Vision's labels (its own taxonomy, parents included: "dog" comes with "animal") that
// put an image in a subject folder, and the least confidence that counts.
const SUBJECTS = {
  people: ['people', 'adult', 'child', 'crowd', 'portrait', 'baby', 'teen', 'military'],
  animals: ['animal', 'bird', 'mammal', 'insect', 'reptile', 'fish', 'cat', 'dog', 'horse'],
  buildings: ['building', 'architecture', 'house', 'domicile', 'apartment', 'religious_building', 'mosque', 'church', 'dome', 'castle', 'tower', 'arch', 'ruins', 'cityscape', 'monument', 'bridge', 'street', 'alley'],
  nature: ['sky', 'mountain', 'hill', 'rocks', 'tree', 'palm_tree', 'plant', 'foliage', 'shrub', 'flower', 'land', 'landscape', 'water', 'water_body', 'sea', 'ocean', 'lake', 'beach', 'sunset_sunrise', 'desert', 'forest', 'garden', 'grass', 'cloudy', 'field', 'snow', 'rainbow'],
  flags: ['flag'],
  maps: ['map'],
  art: ['art', 'painting', 'illustrations', 'drawing', 'cartoon', 'sketch', 'mosaic', 'sculpture', 'graffiti', 'poster'],
  documents: ['document', 'screenshot', 'chart', 'diagram', 'handwriting', 'newspaper'],
  food: ['food', 'fruit', 'vegetable', 'bread', 'dessert', 'drink'],
  vehicles: ['vehicle', 'conveyance', 'automobile', 'car', 'truck', 'aircraft', 'boat', 'tank', 'train', 'bus', 'motorcycle'],
  money: ['money', 'currency', 'coin'],
  computers: ['computer', 'computer_monitor', 'computer_keyboard', 'computer_tower', 'laptop', 'circuit_board', 'printer'],
  religion: ['religious_building', 'mosque', 'church', 'cross', 'religious_icon', 'menorah', 'star_of_david'],
};
const SUBJECT_CONFIDENCE = 0.3;

// Words in a file name that say what the picture is, for the many graphics Vision can't
// read: "flag.gif", "palestine_map.jpg", "bg2.gif".
const NAME_WORDS = {
  flags: /flag|alam|علم/i,
  maps: /\bmap|map\b|_map|map_|khareeta|kharita/i,
  buttons: /button|btn|\bbut\d*\b|^but/i,
  bullets: /bullet|\bball|\bdot\d*\b|arrow|\bpoint/i,
  lines: /\bline|\bbar\d*\b|\bhr\d*\b|divider|separator|rule/i,
  logos: /logo/i,
  counters: /counter|count\.|digit/i,
  computers: /comput|laptop|keyboard|monitor|cdrom|modem/i,
};

function sizeFolder(w, h) {
  const side = Math.max(w, h);
  if (side <= 32) return '1 tiny (up to 32px)';
  if (side <= 100) return '2 small (33-100px)';
  if (side <= 300) return '3 medium (101-300px)';
  if (side <= 640) return '4 large (301-640px)';
  return '5 huge (over 640px)';
}

function shapeFolders(w, h) {
  const folders = [];
  if (h <= 12 && w >= 60) folders.push('lines');
  else if (w >= 3 * h && w >= 150) folders.push('banners');
  else if (h >= 3 * w && h >= 150) folders.push('tall strips');
  if (w <= 48 && h <= 48 && Math.abs(w - h) <= 8) folders.push('icons');
  return folders;
}

function foldersFor(img, vision, tiles) {
  const out = new Set();
  const { w, h } = img;
  if (w && h) {
    out.add(path.posix.join('by size', sizeFolder(w, h)));
    for (const f of shapeFolders(w, h)) out.add(f);
  }
  if (img.frames > 1) out.add('animated');
  if (tiles.has(img.rel.toLowerCase())) out.add('tiles (wallpapers)');
  out.add(path.posix.join('by site', img.crawl.replace(/\//g, ' ∕ ')));
  out.add(path.posix.join('by type', img.ext));

  const base = path.posix.basename(img.rel);
  for (const [folder, re] of Object.entries(NAME_WORDS)) if (re.test(base)) out.add(folder);

  if (vision && !vision.error) {
    const labels = vision.labels || {};
    for (const [folder, wanted] of Object.entries(SUBJECTS)) {
      if (wanted.some((label) => (labels[label] || 0) >= SUBJECT_CONFIDENCE)) out.add(folder);
    }
    if (vision.faces > 0) out.add('people');
    const text = (vision.text || []).join(' ');
    if (/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text)) out.add('arabic');
    if ((text.match(/[A-Za-z]/g) || []).length >= 3) out.add('text (latin)');
  }
  if (/[؀-ۿ]/.test(base)) out.add('arabic');
  if (!out.has('animated') && !vision?.labels) out.add('unread by vision');
  return [...out];
}

// One name per image, unique across the archive: its path under sites/ with the
// slashes turned into a look-alike that file names may contain. Past the 255-byte limit
// on a file name, the middle of the path gives way to a short hash that keeps it unique.
function linkName(rel) {
  const name = rel.replace(/\//g, ' ∕ ');
  if (Buffer.byteLength(name) <= 240) return name;
  const parts = name.split(' ∕ ');
  const hash = crypto.createHash('md5').update(rel).digest('hex').slice(0, 8);
  let tail = parts.at(-1);
  if (Buffer.byteLength(tail) > 180) tail = tail.slice(-120);
  return `${parts[0]} ∕ … ${hash} ∕ ${tail}`;
}

// --- main ------------------------------------------------------------------------------

const roots = new Set(
  walk(SITES, (name) => name === 'log.json').map((f) => path.relative(SITES, path.dirname(f)).split(path.sep).join('/')),
);

console.log('Finding images…');
const seen = new Map();
for (const file of walk(SITES, (name) => IMAGE.test(name)).sort()) {
  const hash = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  if (seen.has(hash)) continue;
  const rel = path.relative(SITES, file).split(path.sep).join('/');
  seen.set(hash, { file, rel, hash, crawl: crawlRootOf(rel, roots), ext: path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg') });
}
const images = [...seen.values()];
console.log(`${images.length} distinct images.`);

console.log('Reading sizes…');
for (const img of images) {
  try {
    const meta = await sharp(img.file, { animated: true, limitInputPixels: false }).metadata();
    img.w = meta.width;
    img.h = meta.pageHeight || meta.height;
    img.frames = meta.pages || 1;
  } catch {
    img.frames = 1; // sharp can't read BMPs or broken files; they still get their other folders
  }
}

console.log('Finding wallpaper tiles…');
const tiles = backgroundImages();

fs.mkdirSync(CACHE, { recursive: true });
const cached = readVisionCache();
await runVision(images.filter((img) => !cached.has(img.hash)));
const vision = readVisionCache();

// Only the folders the last run made are cleared, so folders of your own in here
// (picks dragged in from the generated ones) survive a rebuild. A first run under the
// old code left no list; its folders are the ones this run is about to make.
console.log('Linking…');
const MADE = path.join(CACHE, 'folders.json');
const assigned = images.map((img) => foldersFor(img, vision.get(img.hash), tiles));
const making = new Set(assigned.flat().map((folder) => folder.split('/')[0]));
const made = fs.existsSync(MADE) ? JSON.parse(fs.readFileSync(MADE, 'utf8')) : [...making];
for (const folder of new Set([...made, ...making])) {
  fs.rmSync(path.join(OUT, folder), { recursive: true, force: true });
}
fs.writeFileSync(MADE, JSON.stringify([...making].sort()));
const counts = new Map();
for (const [i, img] of images.entries()) {
  for (const folder of assigned[i]) {
    const dir = path.join(OUT, folder);
    if (!counts.has(folder)) fs.mkdirSync(dir, { recursive: true });
    counts.set(folder, (counts.get(folder) || 0) + 1);
    fs.linkSync(img.file, path.join(dir, linkName(img.rel)));
  }
}

for (const [folder, n] of [...counts].filter(([f]) => !f.startsWith('by site/')).sort()) {
  console.log(`${String(n).padStart(6)}  ${folder}`);
}
console.log(`${[...counts.keys()].filter((f) => f.startsWith('by site/')).length} site folders.`);
console.log(`Done: ${OUT}`);
