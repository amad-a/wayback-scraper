// Loads and renders everything the archive holds about one chest item: the media
// row, its post, and the account that posted it. Tables have no foreign keys, so
// the joins happen here (see the archive's docs/digital-borne-archive.md).
// Every value from the database is untrusted text: rendered with textContent,
// and links only when they are https.
import { TABLES, getOne } from '../db.js';
import { mediaUrls } from '../media.js';

const cache = new Map();

export function loadDetails(key) {
  if (!cache.has(key)) {
    const promise = (async () => {
      const media = await getOne(TABLES.media, { media_key: key });
      if (!media) throw new Error('This item is no longer in the archive.');
      const [post, account] = await Promise.all([
        media.shortcode ? getOne(TABLES.posts, { shortcode: media.shortcode }) : null,
        media.account ? getOne(TABLES.accounts, { slug: media.account }) : null,
      ]);
      return { media, post, account };
    })();
    // Failed lookups are retried next time rather than cached.
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return cache.get(key);
}

export function renderDetails({ media, post, account }) {
  const frag = document.createDocumentFragment();
  const urls = mediaUrls(media);

  // --- the media itself
  const figure = el('figure', 'kjg-detail-media');
  if (media.kind === 'video') {
    const video = el('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.poster = urls.poster ?? urls.medium ?? '';
    video.src = urls.original;
    figure.append(video);
  } else {
    const img = el('img');
    img.src = urls.medium ?? urls.original;
    img.alt = firstText(post?.accessibility_caption) ?? '';
    figure.append(img);
  }
  frag.append(figure);

  // --- who posted it
  const byline = el('header', 'kjg-detail-byline');
  const handle = account?.handle ?? (media.account ? `@${media.account}` : 'Unknown account');
  byline.append(link(account?.url, handle, 'kjg-detail-handle'));
  const place = [account?.region, account?.country].filter(Boolean).join(' · ');
  if (place) byline.append(el('span', 'kjg-detail-place', place));
  frag.append(byline);

  if (post?.caption) frag.append(el('p', 'kjg-detail-caption', post.caption));

  // --- facts
  const facts = el('dl', 'kjg-detail-facts');
  const fact = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    facts.append(el('dt', null, label));
    const dd = el('dd');
    dd.append(value instanceof Node ? value : String(value));
    facts.append(dd);
  };
  fact('Posted', formatDate(post?.taken_at ?? media.taken_at));
  fact('Kind', media.kind);
  if (post?.media_count > 1) fact('Item', `${(media.child_index ?? 0) + 1} of ${post.media_count}`);
  fact('Size', media.width && media.height ? `${media.width} × ${media.height}` : null);
  fact('Views', formatCount(post?.view_count));
  fact('Likes', post?.likes_hidden ? 'hidden' : formatCount(post?.like_count));
  fact('Comments', formatCount(post?.comment_count));
  fact('Location', post?.location?.name);
  fact('Music', formatMusic(post?.music));
  if (media.tags?.length) {
    const tags = el('ul', 'kjg-detail-tags');
    for (const tag of media.tags) tags.append(el('li', null, tag));
    fact('Tags', tags);
  }
  if (post?.url) fact('Post', link(post.url, 'Open original post ↗'));
  frag.append(facts);

  return frag;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(url, text, className) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return el('span', className, text);
  const a = el('a', className, text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function firstText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((v) => typeof v === 'string') ?? null;
  return null;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString() : null;
}

function formatMusic(music) {
  if (!music?.title) return null;
  return music.artist ? `${music.title} — ${music.artist}` : music.title;
}
