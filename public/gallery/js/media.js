// Resolves R2 object keys stored in dba_media into public URLs.
import { config } from './config.js';

export function r2Url(key) {
  if (!key) return null;
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${config.r2PublicUrl}/${path}`;
}

// { original, poster, medium, small } for a dba_media row; missing variants are null.
export function mediaUrls(row) {
  return {
    original: r2Url(row.r2_original),
    poster: r2Url(row.r2_poster),
    medium: r2Url(row.r2_medium),
    small: r2Url(row.r2_small),
  };
}
