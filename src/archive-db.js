// Search + tagging store for the downloaded archive.
//
// SQLite with an FTS5 full-text index over page text, plus a tag vocabulary that
// accumulates across runs. Deliberately separate from the scraper: the scraper is a
// no-network file producer, this is the derived, queryable layer built on top of what
// landed on disk. Nothing here fetches; `keyword-extractor.js` owns the one network hop.
//
// Design points that matter:
//   * A page's row is keyed by its destDir-relative path, lowercased -- the exact key
//     the scraper's file Set uses -- so reconciling against the filesystem is a direct
//     comparison, no path munging at read time.
//   * content_hash gates everything expensive. Re-indexing an unchanged page is a hash
//     lookup and nothing more; re-extracting keywords (the paid API call) only happens
//     when the text actually changed. A full re-run over a stable archive is near free.
//   * Tags live in their own tables with a `source` column. Re-indexing a changed page
//     clears only its *llm* associations -- human-authored tags survive content churn.
//   * Consolidation merges aliases by pointing the loser's canonical_id at the winner
//     and repointing page_tags, keeping the alias row so the vocabulary prompt and future
//     lookups still recognize the old name.

import Database from 'better-sqlite3';
import { createHash } from 'crypto';

const KINDS = ['person', 'place', 'topic'];

// Map the extractor's group names to the singular `kind` stored per tag.
const GROUP_KIND = { people: 'person', places: 'place', topics: 'topic' };

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id           INTEGER PRIMARY KEY,
      path         TEXT NOT NULL UNIQUE,   -- destDir-relative posix path, lowercased
      title        TEXT,
      content_hash TEXT NOT NULL,          -- sha256 of title+body; gates re-index/re-extract
      wayback_url  TEXT,
      indexed_at   TEXT NOT NULL,
      extracted_at TEXT                    -- NULL until keyword extraction ran for this hash
    );

    -- Full-text index. Plain (content-stored) FTS5 so snippet()/highlight() work with no
    -- external-content bookkeeping; rowid is pinned to pages.id. remove_diacritics 2
    -- folds accents so a search for "jerusalem" hits "Jérusalem" and Arabic/Hebrew text
    -- matches regardless of vowel points.
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      title, body,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS tags (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,          -- display form, as first seen
      name_key     TEXT NOT NULL,          -- lowercased, for case-insensitive dedupe
      kind         TEXT NOT NULL,          -- person | place | topic
      canonical_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,  -- set when merged as an alias
      source       TEXT NOT NULL DEFAULT 'llm',                     -- llm | human
      UNIQUE(name_key, kind)
    );

    CREATE TABLE IF NOT EXISTS page_tags (
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
      source  TEXT NOT NULL DEFAULT 'llm',
      PRIMARY KEY (page_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_page_tags_tag  ON page_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tags_canonical ON tags(canonical_id);
    CREATE INDEX IF NOT EXISTS idx_pages_extract  ON pages(extracted_at);
  `);
}

function hashText(title, body) {
  return createHash('sha256').update(`${title || ''}\n\n${body || ''}`).digest('hex');
}

// Insert or update a page. Returns { id, changed } -- `changed` is true when the text
// hash differs from what's stored (or the page is new), which is the signal to re-run
// extraction. On a change we null extracted_at and drop the page's llm tags so a stale
// keyword set never lingers; human tags are left intact.
export function upsertPage(db, { path, title, body, waybackUrl }, now) {
  const contentHash = hashText(title, body);
  const existing = db.prepare('SELECT id, content_hash FROM pages WHERE path = ?').get(path);

  if (existing && existing.content_hash === contentHash) {
    return { id: existing.id, changed: false };
  }

  if (existing) {
    db.prepare(
      `UPDATE pages SET title = ?, content_hash = ?, wayback_url = ?, indexed_at = ?, extracted_at = NULL
       WHERE id = ?`
    ).run(title, contentHash, waybackUrl || null, now, existing.id);

    db.prepare('DELETE FROM page_tags WHERE page_id = ? AND source = ?').run(existing.id, 'llm');
    db.prepare('DELETE FROM pages_fts WHERE rowid = ?').run(existing.id);
    db.prepare('INSERT INTO pages_fts(rowid, title, body) VALUES (?, ?, ?)').run(
      existing.id, title || '', body || ''
    );
    return { id: existing.id, changed: true };
  }

  const info = db.prepare(
    `INSERT INTO pages (path, title, content_hash, wayback_url, indexed_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(path, title, contentHash, waybackUrl || null, now);
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO pages_fts(rowid, title, body) VALUES (?, ?, ?)').run(
    id, title || '', body || ''
  );
  return { id, changed: true };
}

// Pages whose current text has never had keywords extracted.
export function pagesNeedingExtraction(db) {
  return db.prepare(
    'SELECT id, path, title FROM pages WHERE extracted_at IS NULL ORDER BY id'
  ).all();
}

export function markExtracted(db, pageId, now) {
  db.prepare('UPDATE pages SET extracted_at = ? WHERE id = ?').run(now, pageId);
}

// Resolve a (name, kind) to a canonical tag id, creating the tag if new. Follows an
// alias's canonical_id so associations always land on the surviving tag.
export function upsertTag(db, name, kind, source = 'llm') {
  const trimmed = (name || '').trim();
  if (!trimmed || !KINDS.includes(kind)) return null;
  const nameKey = trimmed.toLowerCase();

  db.prepare(
    'INSERT OR IGNORE INTO tags (name, name_key, kind, source) VALUES (?, ?, ?, ?)'
  ).run(trimmed, nameKey, kind, source);

  const row = db.prepare(
    'SELECT id, canonical_id FROM tags WHERE name_key = ? AND kind = ?'
  ).get(nameKey, kind);
  return row.canonical_id || row.id;
}

// Replace a page's tags for a given source. Groups is { people, places, topics }.
export function applyTags(db, pageId, groups, source = 'llm') {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM page_tags WHERE page_id = ? AND source = ?').run(pageId, source);
    const link = db.prepare(
      'INSERT OR IGNORE INTO page_tags (page_id, tag_id, source) VALUES (?, ?, ?)'
    );
    for (const [group, kind] of Object.entries(GROUP_KIND)) {
      for (const name of groups[group] || []) {
        const tagId = upsertTag(db, name, kind, source);
        if (tagId) link.run(pageId, tagId, source);
      }
    }
  });
  txn();
}

// Drop pages that are no longer on disk. `liveePaths` is a Set of destDir-relative,
// lowercased paths (the scraper's file-set form). Cascades clean up page_tags and the
// FTS row. Returns the count removed.
export function reconcileDeletions(db, livePaths) {
  const rows = db.prepare('SELECT id, path FROM pages').all();
  const stale = rows.filter((r) => !livePaths.has(r.path));
  const delPage = db.prepare('DELETE FROM pages WHERE id = ?');
  const delFts = db.prepare('DELETE FROM pages_fts WHERE rowid = ?');
  const txn = db.transaction(() => {
    for (const r of stale) {
      delPage.run(r.id);
      delFts.run(r.id);
    }
  });
  txn();
  return stale.length;
}

// The current canonical vocabulary, grouped for the extraction prompt. Aliases are
// excluded so the model is only ever offered surviving names.
export function vocabulary(db) {
  const rows = db.prepare(
    'SELECT name, kind FROM tags WHERE canonical_id IS NULL ORDER BY kind, name COLLATE NOCASE'
  ).all();
  const out = { people: [], places: [], topics: [] };
  const bucket = { person: 'people', place: 'places', topic: 'topics' };
  for (const r of rows) out[bucket[r.kind]]?.push(r.name);
  return out;
}

// Canonical vocabulary with usage counts, for the `tags` listing and consolidation input.
export function vocabularyWithCounts(db, kind) {
  const where = kind ? 'AND t.kind = ?' : '';
  const args = kind ? [kind] : [];
  return db.prepare(
    `SELECT t.id, t.name, t.kind, COUNT(pt.page_id) AS uses
     FROM tags t
     LEFT JOIN page_tags pt ON pt.tag_id = t.id
     WHERE t.canonical_id IS NULL ${where}
     GROUP BY t.id
     ORDER BY t.kind, uses DESC, t.name COLLATE NOCASE`
  ).all(...args);
}

// Merge `loser` into `winner`: repoint every association, mark the loser an alias.
// The alias row stays so its name is still recognized later. Both must share a kind.
export function mergeTags(db, loserName, winnerName, kind) {
  const find = db.prepare('SELECT id FROM tags WHERE name_key = ? AND kind = ? AND canonical_id IS NULL');
  const loser = find.get(loserName.trim().toLowerCase(), kind);
  const winner = find.get(winnerName.trim().toLowerCase(), kind);
  if (!loser || !winner || loser.id === winner.id) return false;

  const txn = db.transaction(() => {
    // Move associations, then delete the loser's now-duplicate rows.
    db.prepare(
      'INSERT OR IGNORE INTO page_tags (page_id, tag_id, source) SELECT page_id, ?, source FROM page_tags WHERE tag_id = ?'
    ).run(winner.id, loser.id);
    db.prepare('DELETE FROM page_tags WHERE tag_id = ?').run(loser.id);
    // Anything that previously aliased the loser now aliases the winner.
    db.prepare('UPDATE tags SET canonical_id = ? WHERE canonical_id = ?').run(winner.id, loser.id);
    db.prepare('UPDATE tags SET canonical_id = ? WHERE id = ?').run(winner.id, loser.id);
  });
  txn();
  return true;
}

// Full-text search. Returns page path/title with a body snippet, ranked by FTS relevance.
// Optionally constrained to pages carrying a given tag (resolved through canonical).
export function search(db, query, { tag, kind, limit = 25 } = {}) {
  const match = ftsQuery(query);
  const joins = [];
  const wheres = ['pages_fts MATCH ?'];
  const args = [match];

  if (tag) {
    joins.push('JOIN page_tags pt ON pt.page_id = p.id', 'JOIN tags t ON t.id = pt.tag_id');
    wheres.push('t.name_key = ?');
    args.push(tag.trim().toLowerCase());
    if (kind) {
      wheres.push('t.kind = ?');
      args.push(kind);
    }
  }

  const sql =
    `SELECT p.path, p.title, p.wayback_url,
            snippet(pages_fts, 1, '«', '»', '…', 12) AS snippet
     FROM pages_fts
     JOIN pages p ON p.id = pages_fts.rowid
     ${joins.join(' ')}
     WHERE ${wheres.join(' AND ')}
     ORDER BY rank
     LIMIT ?`;
  args.push(limit);

  try {
    return db.prepare(sql).all(...args);
  } catch {
    // A raw query with stray FTS operators (e.g. a bare quote) throws. Retry treating
    // the whole thing as one quoted phrase.
    args[0] = `"${query.replace(/"/g, '""')}"`;
    return db.prepare(sql).all(...args);
  }
}

// List pages carrying a tag, no text query -- pure tag browse.
export function pagesByTag(db, name, { kind, limit = 100 } = {}) {
  const where = kind ? 'AND t.kind = ?' : '';
  const args = [name.trim().toLowerCase()];
  if (kind) args.push(kind);
  args.push(limit);
  return db.prepare(
    `SELECT p.path, p.title, t.kind
     FROM tags t
     JOIN page_tags pt ON pt.tag_id = t.id
     JOIN pages p ON p.id = pt.page_id
     WHERE t.name_key = ? ${where}
     ORDER BY p.path
     LIMIT ?`
  ).all(...args);
}

// Turn a user query into a valid FTS5 MATCH expression. If it already uses FTS syntax
// (quotes, AND/OR/NOT, *, :) pass it through; otherwise AND the bare terms so multi-word
// queries narrow rather than error on the space.
function ftsQuery(query) {
  const raw = query.trim();
  if (/["*:()]|(\bAND\b|\bOR\b|\bNOT\b)/.test(raw)) return raw;
  const terms = raw.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.join(' AND ') || raw;
}

export { KINDS, GROUP_KIND };
