// Copies of the site's own code with the comments taken out, for production to serve.
//
//   node src/build-shell.js        (npm run build; scripts/deploy.sh runs it)
//
// The shell (public/app, public/styles, public/*.html) and palestineonline.net's own
// pages are written as notes to whoever works on them next, and those notes have no
// business going out to every visitor. Each file is rewritten into dist/ at the same
// path -- dist/public/app/api.js for public/app/api.js -- and serve.js sends the dist/
// copy where there is one, the original otherwise. Without a dist/ (a fresh checkout, or
// after `rm -r dist`) everything is served as written, which is what you want locally.
//
// Only comments go: the code keeps its names, layout and indentation, so an error in the
// browser still points somewhere readable. Left alone:
//   - public/vendor: third-party code, whose licence comments have to stay with it;
//   - the archived sites: their comments are part of what was archived;
//   - the guestbook's <!--begin--> marker, which serve.js writes the entries after.
//
// dist/ is built beside itself and swapped in whole, so a failed build leaves the last
// good one in place.

import fs from 'fs';
import path from 'path';
import { parse } from 'acorn';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const BUILDING = path.join(ROOT, 'dist.building');

// Folders taken whole (their .js, .css and .html, recursively), then single files.
const FOLDERS = ['public/app', 'public/styles', 'sites/palestineonline.net'];
const FILES = ['public/index.html', 'public/play.html', 'sites/damascus-online.com/stonethrowers/game.html'];
const CODE = /\.(js|css|html)$/;

function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (CODE.test(entry.name)) found.push(rel);
    }
  };
  FOLDERS.forEach(walk);
  return [...found, ...FILES.filter((file) => fs.existsSync(path.join(ROOT, file)))];
}

// Comments are cut out of the text by position, so everything else stays byte for byte as
// written. A comment between two tokens leaves a space, or a line break if it spanned
// lines (which is what JavaScript reads it as); a line left with nothing on it goes. A
// cut with `text` is a replacement instead -- an HTML page's inline script, stripped.
const GAP = '\u0001';
const BREAK = '\u0002';
const MARK = /[\u0001\u0002]/;
function cut(text, cuts) {
  let out = '';
  let at = 0;
  for (const { start, end, text: replacement } of cuts.sort((x, y) => x.start - y.start)) {
    const comment = text.slice(start, end);
    out += text.slice(at, start) + (replacement ?? (comment.includes('\n') ? BREAK : GAP));
    at = end;
  }
  out += text.slice(at);
  return out
    .split('\n')
    .filter((line) => !MARK.test(line) || /[^\s\u0001\u0002]/.test(line))
    .map((line) => (MARK.test(line) ? line.replace(/[ \t]*\u0001[ \t]*$/, '').replaceAll(GAP, ' ').replaceAll(BREAK, '\n').trimEnd() : line))
    .join('\n');
}

// As a module first (the shell's files are), then as a classic script.
function stripJs(code) {
  for (const sourceType of ['module', 'script']) {
    const comments = [];
    try {
      parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true, onComment: comments });
      return cut(code, comments);
    } catch {}
  }
  throw new Error('does not parse as JavaScript');
}

// CSS has one kind of comment, and only strings can hide one.
function stripCss(code) {
  const comments = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unclosed comment');
      comments.push({ start: i, end: end + 2 });
      i = end + 1;
    }
  }
  return cut(code, comments);
}

// A script or stylesheet that cannot be parsed goes out as it was rather than failing the
// page: an old page's script may lean on something only a browser forgives.
function tryStrip(strip, code, file) {
  try {
    return strip(code);
  } catch (err) {
    console.warn(`  kept an inline block in ${file} as written: ${err.message.split('\n')[0]}`);
    return code;
  }
}

// HTML comments go by the same cut, and each inline <script> and <style> is stripped as
// JavaScript or CSS. The markup itself is left exactly as written: serve.js edits
// index.html's tags with patterns that expect them as they are.
const RAW = /(<(script|style)\b[^>]*>)([\s\S]*?)<\/\2\s*>/gi;
const NOT_JS = /\btype\s*=\s*["']?(?!text\/javascript|module|application\/javascript)/i;
function stripHtml(html, file) {
  const cuts = [];
  let at = 0;
  const markup = (end) => {
    for (const m of html.slice(at, end).matchAll(/<!--([\s\S]*?)-->/g)) {
      if (m[1] !== 'begin') cuts.push({ start: at + m.index, end: at + m.index + m[0].length });
    }
  };
  for (const m of html.matchAll(RAW)) {
    markup(m.index);
    const [whole, open, tag, body] = m;
    const strip = tag.toLowerCase() === 'style' ? stripCss : NOT_JS.test(open) ? null : stripJs;
    const start = m.index + open.length;
    if (strip) cuts.push({ start, end: start + body.length, text: tryStrip(strip, body, file) });
    at = m.index + whole.length;
  }
  markup(html.length);
  return cut(html, cuts);
}

function build(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (rel.endsWith('.html')) return stripHtml(text, rel);
  return rel.endsWith('.css') ? stripCss(text) : stripJs(text);
}

fs.rmSync(BUILDING, { recursive: true, force: true });
const files = sources();
let before = 0;
let after = 0;
for (const rel of files) {
  const out = build(rel);
  before += fs.statSync(path.join(ROOT, rel)).size;
  after += Buffer.byteLength(out);
  fs.mkdirSync(path.dirname(path.join(BUILDING, rel)), { recursive: true });
  fs.writeFileSync(path.join(BUILDING, rel), out);
}
fs.rmSync(DIST, { recursive: true, force: true });
fs.renameSync(BUILDING, DIST);
console.log(`Built ${files.length} files into dist/: ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB.`);
