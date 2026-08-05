// Write the hand-edited columns out of archive.db into tags.csv.
//
//   node src/export-tags.js [--db FILE] [--out FILE]
//
// Run this after tagging. archive.db is gitignored, so until you export, your tags exist
// in exactly one uncommitted binary file. build-db.js reads tags.csv back in on every
// build, so the round trip is: tag in the DB -> export -> commit.

import fs from 'fs/promises';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';

import { selectTagged, toCsv } from './tags-csv.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : fallback;
};

const dbPath = flag('--db', 'archive.db');
const out = flag('--out', 'tags.csv');

if (!existsSync(dbPath)) {
  console.error(`No ${dbPath}. Run: npm run db`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const rows = selectTagged(db);
db.close();

await fs.writeFile(out, toCsv(rows), 'utf8');
console.log(`Wrote ${out}: ${rows.length} tagged ${rows.length === 1 ? 'page' : 'pages'}.`);
