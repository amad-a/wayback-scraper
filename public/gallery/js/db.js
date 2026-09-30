// Thin data-access layer over the Supabase client.
// Feature code should import from here rather than calling supabase.from() directly,
// so table names and error handling live in one place.
import { supabase } from './supabase.js';

export const TABLES = Object.freeze({
  // Public projection of dba_accounts (slug, handle, url, platform, region, country).
  // dba_accounts itself holds crawler state and must stay unreadable by anon.
  accounts: 'dba_accounts_public',
  media: 'dba_media',
  posts: 'dba_posts',
  museum: 'gallery_museum',
});

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * @param {string} table
 * @param {object} [opts]
 * @param {string} [opts.select='*']
 * @param {Record<string, unknown>} [opts.match]  equality filters, e.g. { gallery_id: 3 }
 * @param {{ column: string, ascending?: boolean }} [opts.order]
 * @param {number} [opts.limit]
 */
export async function list(table, { select = '*', match, order, limit } = {}) {
  let query = supabase.from(table).select(select);
  if (match) query = query.match(match);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? true });
  if (limit) query = query.limit(limit);
  return unwrap(await query);
}

// Tables don't share a primary key column (dba_media uses media_key, dba_posts uses
// shortcode), so single-row helpers take a match object, e.g. { shortcode: 'DRcYzJmDOGH' }.
export async function getOne(table, match, select = '*') {
  return unwrap(await supabase.from(table).select(select).match(match).maybeSingle());
}

export async function insert(table, rows) {
  return unwrap(await supabase.from(table).insert(rows).select());
}

export async function update(table, match, changes) {
  return unwrap(await supabase.from(table).update(changes).match(match).select());
}

export async function remove(table, match) {
  return unwrap(await supabase.from(table).delete().match(match));
}

// Row count per table; used to verify connectivity and RLS read access.
export async function checkConnection() {
  return Promise.all(
    Object.values(TABLES).map(async (table) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      return { table, ok: !error, count, error: error?.message };
    }),
  );
}
