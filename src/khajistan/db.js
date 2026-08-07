// Read-only handle on the Khajistan archive database.
//
// This is NOT the wayback archive.db at the repo root -- different file, entirely
// different schema (accounts / digital_archive / media vs pages / page_view). The
// filename collision is why this module names the env var KHAJISTAN_DB and never
// touches DB_PATH from serve.js.
//
// The file is *replaced*, not edited: the scraper rsyncs a fresh VACUUM INTO copy
// after every account it finishes. A cached handle would go on serving the deleted
// inode -- newly crawled accounts silently missing, nothing in the log to say why.
// So the handle is keyed on inode+mtime+size and reopened when any of them move.
// Same approach serve.js uses for its own db, for the same reason.
import fs from 'node:fs';
import Database from 'better-sqlite3';

const DB_PATH = process.env.KHAJISTAN_DB || '/var/data/archive.db';

let db = null;
let dbKey = '';

export function database() {
  let stat;
  try {
    stat = fs.statSync(DB_PATH);
  } catch {
    return null; // not deployed yet; callers return 503 rather than throwing
  }

  const key = `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
  if (db && key !== dbKey) {
    db.close();
    db = null;
  }
  if (!db) {
    // readonly so a bug here can never corrupt the archive, and so the app needs
    // no write permission on /var/data.
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    dbKey = key;
  }
  return db;
}

export const dbPath = () => DB_PATH;
