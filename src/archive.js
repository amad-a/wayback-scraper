// Archive search & tagging CLI. Built on top of what cdx-scraper.js writes to /sites.
//
//   node src/archive.js index [site]        Index page text into SQLite + FTS, then run
//                                            keyword extraction on pages that changed.
//                                            --no-extract skips the paid API step.
//   node src/archive.js search <query>       Full-text search. --tag NAME [--kind K] to
//                                            constrain to a tag; --limit N.
//   node src/archive.js tags [kind]          List the tag vocabulary with usage counts.
//   node src/archive.js tag <path> <kind> <name>   Attach a human tag to one page.
//   node src/archive.js consolidate          Merge duplicate tags via one LLM pass per kind.
//
// The index step is idempotent and self-reconciling: it re-walks /sites each run, so new
// pages get added, deleted pages get pruned, and only pages whose text hash changed get
// re-extracted. Link liveness stays the scraper's job (a filesystem Set); this layer owns
// only derived, queryable state.

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import {
  openDb, upsertPage, applyTags, reconcileDeletions, pagesNeedingExtraction,
  markExtracted, vocabulary, vocabularyWithCounts, mergeTags, search, upsertTag, KINDS,
} from './archive-db.js';
import { extractKeywords, consolidateVocabulary } from './keyword-extractor.js';

const DEST_DIR = path.join(process.cwd(), 'sites');
const DB_PATH = path.join(DEST_DIR, 'archive.db');
const HTML_EXTENSIONS = /\.(htm|html|shtml|shtm|php|asp|aspx|jsp|cfm|cgi|pl)$/i;

// Directories the scraper owns that hold no readable page content.
const SKIP_DIRS = new Set(['_wayback']);

function nowIso() {
  return new Date().toISOString();
}

// Pull the visible text out of a saved page, mirroring how the browser would read it:
// drop script/style, keep the title separately, collapse whitespace. The wayback-url the
// rewrite pass stamped onto <body> is carried through so search results can link back.
function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  const waybackUrl = $('body').attr('data-wayback-url') || null;
  return { title, body, waybackUrl };
}

// destDir-relative posix path, lowercased -- the key shared with the scraper's file Set
// and the pages table.
function toKey(fullPath) {
  return path.relative(DEST_DIR, fullPath).split(path.sep).join('/').toLowerCase();
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
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await collectHtml(path.join(dir, entry.name))));
    } else if (HTML_EXTENSIONS.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function cmdIndex(db, args) {
  const site = args.find((a) => !a.startsWith('--'));
  const doExtract = !args.includes('--no-extract');
  const root = site ? path.join(DEST_DIR, site) : DEST_DIR;

  const files = await collectHtml(root);
  console.log(`Indexing ${files.length} pages from ${path.relative(process.cwd(), root)}/ ...`);

  const now = nowIso();
  const livePaths = new Set();
  let changed = 0;

  for (const full of files) {
    const key = toKey(full);
    livePaths.add(key);
    const html = await fs.readFile(full, 'utf-8');
    const { title, body, waybackUrl } = extractText(html);
    const { changed: didChange } = upsertPage(db, { path: key, title, body, waybackUrl }, now);
    if (didChange) changed += 1;
  }

  // Only reconcile against the full tree; a single-site index must not prune other sites.
  let pruned = 0;
  if (!site) {
    pruned = reconcileDeletions(db, livePaths);
  }

  console.log(`Indexed ${files.length} pages (${changed} new/changed, ${pruned} pruned).`);

  if (!doExtract) {
    console.log('Skipping keyword extraction (--no-extract).');
    return;
  }
  await runExtraction(db);
}

async function runExtraction(db) {
  const pending = pagesNeedingExtraction(db);
  if (!pending.length) {
    console.log('No pages need keyword extraction — all current.');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      `${pending.length} pages need extraction, but ANTHROPIC_API_KEY is not set. ` +
      `Set it and re-run \`index\` (or \`index --no-extract\` to index text only).`
    );
    return;
  }

  console.log(`Extracting keywords for ${pending.length} pages via Haiku...`);
  const now = nowIso();
  let done = 0;

  for (const page of pending) {
    const full = path.join(DEST_DIR, page.path);
    let text = '';
    try {
      text = extractText(await fs.readFile(full, 'utf-8')).body;
    } catch {
      // File vanished between index and extract; skip and let the next run reconcile.
      continue;
    }

    try {
      const groups = await extractKeywords({ title: page.title, text, vocabulary: vocabulary(db) });
      applyTags(db, page.id, groups, 'llm');
      markExtracted(db, page.id, now);
      done += 1;
      if (done % 25 === 0) console.log(`  ...${done}/${pending.length}`);
    } catch (err) {
      // Leave extracted_at NULL so the next run retries this page; don't abort the batch.
      console.error(`  ✗ ${page.path}: ${err.message}`);
    }
  }
  console.log(`Extracted keywords for ${done}/${pending.length} pages.`);
}

function cmdSearch(db, args) {
  const flags = parseFlags(args);
  const query = flags._.join(' ');
  if (!query) {
    console.error('Usage: node src/archive.js search <query> [--tag NAME] [--kind K] [--limit N]');
    process.exit(1);
  }
  const rows = search(db, query, {
    tag: flags.tag,
    kind: flags.kind,
    limit: flags.limit ? Number(flags.limit) : 25,
  });
  if (!rows.length) {
    console.log('No matches.');
    return;
  }
  for (const r of rows) {
    console.log(`\n${r.title || '(untitled)'}`);
    console.log(`  ${r.path}`);
    if (r.snippet) console.log(`  ${r.snippet.replace(/\s+/g, ' ').trim()}`);
  }
  console.log(`\n${rows.length} result(s).`);
}

function cmdTags(db, args) {
  const kind = args.find((a) => KINDS.includes(a));
  const rows = vocabularyWithCounts(db, kind);
  if (!rows.length) {
    console.log('No tags yet — run `index` first.');
    return;
  }
  let lastKind = null;
  for (const r of rows) {
    if (r.kind !== lastKind) {
      console.log(`\n${r.kind.toUpperCase()}`);
      lastKind = r.kind;
    }
    console.log(`  ${String(r.uses).padStart(4)}  ${r.name}`);
  }
  console.log(`\n${rows.length} tag(s).`);
}

function cmdTag(db, args) {
  const [pagePath, kind, ...nameParts] = args;
  const name = nameParts.join(' ');
  if (!pagePath || !KINDS.includes(kind) || !name) {
    console.error(`Usage: node src/archive.js tag <path> <${KINDS.join('|')}> <name>`);
    process.exit(1);
  }
  const key = pagePath.replace(/^\/?sites\//, '').toLowerCase();
  const page = db.prepare('SELECT id FROM pages WHERE path = ?').get(key);
  if (!page) {
    console.error(`No indexed page at "${key}". Run \`index\` first, or check the path.`);
    process.exit(1);
  }
  // Add a single human tag on top of whatever llm tags exist -- applyTags replaces an
  // entire source, so insert directly to avoid clearing other human tags on this page.
  const tagId = upsertTag(db, name, kind, 'human');
  db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id, source) VALUES (?, ?, ?)')
    .run(page.id, tagId, 'human');
  console.log(`Tagged ${key} → [${kind}] ${name}`);
}

async function cmdConsolidate(db) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — required for consolidation.');
    process.exit(1);
  }
  let total = 0;
  for (const kind of KINDS) {
    const names = vocabularyWithCounts(db, kind).map((r) => r.name);
    if (names.length < 2) continue;
    console.log(`Consolidating ${names.length} ${kind} tags...`);
    const merges = await consolidateVocabulary(kind, names);
    for (const { from, to } of merges) {
      if (mergeTags(db, from, to, kind)) {
        console.log(`  ${from} → ${to}`);
        total += 1;
      }
    }
  }
  console.log(`Merged ${total} duplicate tag(s).`);
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('Usage: node src/archive.js <index|search|tags|tag|consolidate> [args]');
    process.exit(1);
  }

  await fs.mkdir(DEST_DIR, { recursive: true });
  const db = openDb(DB_PATH);
  try {
    switch (command) {
      case 'index':       await cmdIndex(db, args); break;
      case 'search':      cmdSearch(db, args); break;
      case 'tags':        cmdTags(db, args); break;
      case 'tag':         cmdTag(db, args); break;
      case 'consolidate': await cmdConsolidate(db); break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

await main();
