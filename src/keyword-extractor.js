// Keyword extraction via Claude Haiku 4.5.
//
// One structured call per page: given the page's text and the vocabulary already in the
// archive, return the people, places, and topics it's about. Passing the existing
// vocabulary is what keeps tags cohesive across a growing archive -- the model reuses an
// established name instead of coining a near-duplicate. Drift that slips through anyway
// is cleaned up by the periodic consolidation pass (see consolidateVocabulary below).
//
// Model choice is deliberate: Haiku is cheap enough to backfill tens of thousands of
// pages for tens of dollars, and content_hash gating means that's a one-time cost.
// The API key comes from ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

// Only offer the model a slice of the vocabulary per group -- the whole point is to keep
// the prompt (and its cost) bounded as the archive grows. The most-used names carry the
// most disambiguation value, so callers pass those first.
const VOCAB_LIMIT = 60;

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    people: { type: 'array', items: { type: 'string' }, description: 'Full names of people the page is about.' },
    places: { type: 'array', items: { type: 'string' }, description: 'Geographic places: cities, countries, regions, landmarks.' },
    topics: { type: 'array', items: { type: 'string' }, description: 'Subjects, themes, events, or concepts the page covers.' },
  },
  required: ['people', 'places', 'topics'],
  additionalProperties: false,
};

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set — required for keyword extraction.');
    }
    client = new Anthropic();
  }
  return client;
}

function vocabBlock(vocabulary) {
  const parts = [];
  for (const [group, names] of Object.entries(vocabulary || {})) {
    if (names && names.length) parts.push(`${group}: ${names.slice(0, VOCAB_LIMIT).join(', ')}`);
  }
  if (!parts.length) return 'The archive has no tags yet.';
  return `Tags already used in this archive — reuse the exact spelling of any that fit:\n${parts.join('\n')}`;
}

// Extract keyword groups for one page. `text` is title + body already pulled from the
// DOM. Truncated to keep a runaway page from blowing the token budget -- the first ~8k
// words carry the subject matter; the tail of a long page rarely adds new named entities.
export async function extractKeywords({ title, text, vocabulary }) {
  const body = (text || '').slice(0, 40_000);
  const prompt =
    `${vocabBlock(vocabulary)}\n\n` +
    `Extract the key people, places, and topics from this archived web page. Prefer ` +
    `proper names as written. Return at most ~8 items per group; omit a group entirely ` +
    `if nothing fits rather than inventing weak matches.\n\n` +
    `TITLE: ${title || '(none)'}\n\nCONTENT:\n${body}`;

  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });

  const parsed = message.parsed_output ?? { people: [], places: [], topics: [] };
  return {
    people: dedupe(parsed.people),
    places: dedupe(parsed.places),
    topics: dedupe(parsed.topics),
  };
}

// Periodic consolidation. Hand the model the current canonical vocabulary for one kind
// and ask which entries are the same real-world entity, returning merge instructions
// (loser -> winner). Operates on the tag list only, not page text, so it's cheap enough
// to run often. Returns [{ from, to }] for the caller to apply via mergeTags.
const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'The duplicate/variant spelling to retire.' },
          to: { type: 'string', description: 'The preferred canonical spelling to keep. Must be another name from the list.' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  required: ['merges'],
  additionalProperties: false,
};

export async function consolidateVocabulary(kind, names) {
  if (!names || names.length < 2) return [];
  const prompt =
    `The list below is the "${kind}" tag vocabulary of a web archive. It has accumulated ` +
    `duplicates: different spellings, transliterations, or aliases of the same real-world ` +
    `entity (e.g. "Jerusalem"/"Al-Quds", "M. Darwish"/"Mahmoud Darwish"). Identify only ` +
    `genuine duplicates and return merges mapping the variant ("from") to the single best ` +
    `canonical spelling ("to"). Both names in each merge must be from the list. Do NOT ` +
    `merge distinct entities that are merely related.\n\n` +
    `${kind}:\n${names.map((n) => `- ${n}`).join('\n')}`;

  const message = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: MERGE_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });

  const known = new Set(names.map((n) => n.toLowerCase()));
  return (message.parsed_output?.merges || []).filter(
    (m) =>
      m.from && m.to &&
      m.from.toLowerCase() !== m.to.toLowerCase() &&
      known.has(m.from.toLowerCase()) &&
      known.has(m.to.toLowerCase())
  );
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr || []) {
    const name = (raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export { MODEL };
