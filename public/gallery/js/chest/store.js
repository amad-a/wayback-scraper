// This visitor's chest: the cards they have taken off the pile, kept in their
// browser only. Storage can be unavailable (private windows, blocked site data),
// in which case the chest still works for the session and is simply not kept.
const STORAGE_KEY = 'kjg-chest';

// Items are { id, key, kind, src, w, h, token, takenAt }: `id` is the card's pile
// id (it seeds the border), `key` the media_key used to look up its details, and
// `token` the pile's signature, which the museum requires (older items have none).
export function createChestStore() {
  let items = load();
  const listeners = new Set();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
    for (const fn of listeners) fn(items);
  }

  return {
    items: () => items,
    has: (key) => items.some((item) => item.key === key),
    get: (key) => items.find((item) => item.key === key) ?? null,

    add(card) {
      if (items.some((item) => item.key === card.key)) return;
      const { id, key, kind, src, w, h, token = null } = card;
      items = [{ id, key, kind, src, w, h, token, takenAt: Date.now() }, ...items];
      save();
    },

    remove(key) {
      items = items.filter((item) => item.key !== key);
      save();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === 'string') : [];
  } catch {
    return [];
  }
}
