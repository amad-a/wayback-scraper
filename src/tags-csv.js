// Moving the manual columns between archive.db and tags.csv.
//
// archive.db is gitignored and rebuildable; tags.csv is committed and is not. Everything
// in the pages table comes back from /sites on the next build, so the only data in this
// project that can actually be lost is what you typed by hand -- which is why it lives in
// a text file that diffs and merges, rather than inside a binary blob.
//
// A module of pure functions with no top-level work, so both build-db.js and export-tags.js
// can import it. (cdx-scraper.js is the counter-example: it runs its crawl on import,
// which is why its path logic had to be copied rather than reused.)

import fs from 'fs/promises';
import { existsSync } from 'fs';

export const CSV_COLUMNS = ['local_path', 'tags', 'notes', 'title_override'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Hand-rolled rather than a dependency: the field set is fixed and narrow, but tags and
// notes are free text, so quotes, commas and newlines inside a field all have to survive
// a round trip.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.length && r.some((v) => v !== ''));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function toCsv(rows) {
  return (
    [
      CSV_COLUMNS.join(','),
      ...rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c])).join(',')),
    ].join('\n') + '\n'
  );
}

// Rows carrying something worth keeping. Without the filter the file would be 11k lines
// of bare commas, one per untagged page.
export function selectTagged(db) {
  return db
    .prepare(
      `SELECT local_path, tags, notes, title_override FROM page_meta
       WHERE tags <> '' OR notes <> '' OR title_override <> ''
       ORDER BY local_path`,
    )
    .all();
}

export async function importTags(db, file) {
  if (!existsSync(file)) return 0;

  const records = parseCsv(await fs.readFile(file, 'utf-8')).filter((r) => r.local_path);
  const stmt = db.prepare(
    `INSERT INTO page_meta (local_path, tags, notes, title_override)
     VALUES (@local_path, @tags, @notes, @title_override)
     ON CONFLICT(local_path) DO UPDATE SET
       tags = excluded.tags, notes = excluded.notes, title_override = excluded.title_override`,
  );

  db.transaction((rs) => {
    for (const r of rs) {
      stmt.run({
        local_path: r.local_path,
        tags: r.tags ?? '',
        notes: r.notes ?? '',
        title_override: r.title_override ?? '',
      });
    }
  })(records);

  return records.length;
}
