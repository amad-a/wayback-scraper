// /khajistan -- browse the Instagram archive by region, account and tag.
//
// Self-contained: everything it needs is this router plus public/khajistan/.
// Mounted at a prefix in serve.js, so lifting it onto its own domain later means
// moving two folders and pointing a server block at them -- no route rewriting.
import express from 'express';
import { database } from './db.js';

// Media is served straight off the public R2 bucket by the browser -- see
// mediaUrl() in public/khajistan/app.js. This router only answers questions
// about the database, so it needs no R2 credentials and never proxies bytes.

export const router = express.Router();

const noDb = (res) =>
  res.status(503).json({ error: 'khajistan archive db not available' });

// --- helpers ---------------------------------------------------------------

// accounts.region is free text off a spreadsheet -- "Arabia, Levant, Turkey",
// "Sahara, North Africa". Comma-splitting turns those into filterable atoms
// instead of one unusable string per account.
const splitRegions = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// --- facets: everything the three filter columns need, in one request -------

router.get('/api/facets', (_req, res) => {
  const db = database();
  if (!db) return noDb(res);

  const accounts = db
    .prepare(
      `SELECT a.slug, a.region, a.country, COUNT(m.media_key) AS media
         FROM accounts a JOIN media m ON m.account = a.slug
        GROUP BY a.slug ORDER BY media DESC`,
    )
    .all();

  const regions = new Map();
  for (const a of accounts) {
    for (const r of splitRegions(a.region)) {
      regions.set(r, (regions.get(r) || 0) + a.media);
    }
  }

  // Tag counts come from the media rows themselves rather than tags.json, so the
  // list reflects what is actually applied -- a vocabulary entry nothing uses
  // should not appear as a filter that returns nothing.
  const tags = db
    .prepare(
      `SELECT j.value AS tag, COUNT(*) AS n
         FROM media m, json_each(m.tags) j
        WHERE m.tags IS NOT NULL
        GROUP BY j.value ORDER BY n DESC`,
    )
    .all();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS media, SUM(tagged_at IS NOT NULL) AS tagged FROM media`,
    )
    .get();

  // image / video counts, so the fourth axis shows its size like the others.
  const kinds = db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM media
        WHERE r2_small IS NOT NULL GROUP BY kind ORDER BY n DESC`,
    )
    .all();

  res.json({
    regions: [...regions.entries()]
      .map(([region, media]) => ({ region, media }))
      .sort((a, b) => b.media - a.media),
    accounts,
    tags,
    kinds,
    totals,
  });
});

// --- feed ------------------------------------------------------------------

router.get('/api/feed', (req, res) => {
  const db = database();
  if (!db) return noDb(res);

  const { region, account } = req.query;
  const tags = String(req.query.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = ['m.r2_small IS NOT NULL'];
  const params = {};

  // Whitelisted rather than passed through: kind goes straight into a WHERE, and
  // the column only ever holds these two values.
  if (req.query.kind === 'image' || req.query.kind === 'video') {
    where.push('m.kind = @kind');
    params.kind = req.query.kind;
  }
  if (account) {
    where.push('m.account = @account');
    params.account = account;
  }
  if (region) {
    // Substring match against the raw region string: an account tagged
    // "Sahara, North Africa" must surface under either half.
    where.push(`EXISTS (SELECT 1 FROM accounts a2
                         WHERE a2.slug = m.account AND ',' || REPLACE(a2.region, ', ', ',') || ','
                               LIKE '%,' || @region || ',%')`);
    params.region = region;
  }
  // AND across tags: each selected tag narrows the result, which is what the
  // three-axis UI implies. OR would make every extra click widen the feed.
  tags.forEach((t, i) => {
    where.push(`EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = @tag${i})`);
    params[`tag${i}`] = t;
  });

  const sql = `
    SELECT m.media_key, m.account, m.shortcode, m.kind, m.r2_small, m.r2_medium,
           m.width, m.height, m.tags, d.taken_at
      FROM media m
      LEFT JOIN digital_archive d ON d.shortcode = m.shortcode
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(d.taken_at, m.taken_at) DESC, m.media_key
     LIMIT @limit OFFSET @offset`;

  const rows = db.prepare(sql).all({ ...params, limit, offset });
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM media m WHERE ${where.join(' AND ')}`)
    .get(params).n;

  res.json({
    total,
    offset,
    limit,
    items: rows.map((r) => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] })),
  });
});

// --- one item, with everything the detail panel shows ----------------------

router.get('/api/item/:key', (req, res) => {
  const db = database();
  if (!db) return noDb(res);

  const row = db
    .prepare(
      `SELECT m.*, a.region, a.country, a.handle, a.url AS account_url,
              d.caption, d.taken_at AS post_taken_at, d.like_count, d.comment_count,
              d.url AS post_url, d.media_type, d.location, d.usertags, d.coauthors,
              d.accessibility_caption, d.view_count, d.music
         FROM media m
         LEFT JOIN accounts a ON a.slug = m.account
         LEFT JOIN digital_archive d ON d.shortcode = m.shortcode
        WHERE m.media_key = ?`,
    )
    .get(req.params.key);

  if (!row) return res.status(404).json({ error: 'not found' });

  for (const f of ['tags', 'location', 'usertags', 'coauthors', 'accessibility_caption', 'music']) {
    if (row[f]) {
      try {
        row[f] = JSON.parse(row[f]);
      } catch {
        /* stored as plain text; leave it */
      }
    }
  }
  res.json(row);
});

export default router;
