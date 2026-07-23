// lib/persona.js — a deterministic per-page "voice" so 17 pages don't sound like one writer.
// Each facet is picked from a small table by hashing page_id + the facet name, so a page's persona
// is stable forever (same page -> same voice) but differs from page to page. Overrides in
// data/persona-voices.json win (e.g. the community pages that speak as "we").

function hashStr(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
const pick = (arr, pageId, facet) => arr[hashStr(`${pageId}:${facet}`) % arr.length];

const ARCHETYPES = [
  "a busy parent juggling a full house",
  "an easygoing empty-nester who loves small home projects",
  "a practical list-keeper who likes being ready for anything",
  "a laid-back neighbor who learns things the hands-on way",
  "a grandparent who tells little everyday stories",
  "an outdoorsy weekender who's calm under pressure",
];
const TONES = [
  "warm and chatty",
  "dry, understated humor",
  "upbeat and encouraging",
  "reflective and gentle",
];
const EMOJI = [
  "no emoji at all",
  "at most one emoji, mid-post, only if it feels natural",
  "sometimes a single emoji at the very end",
];
const LENGTHS = [
  "very short — 1 to 2 sentences",
  "medium — 2 to 4 sentences",
  "a longer note — 4 to 6 sentences with a natural line break",
];
const QUESTIONS = [
  "always end with a light question that invites comments",
  "usually end with a light thought, only sometimes a question",
  "end by asking others for their own tip or trick",
];

// Returns a stable voice profile for a page. `overrides` is the parsed data/persona-voices.json.
export function personaFor(pageId, pageName = "", overrides = {}) {
  const base = {
    archetype: pick(ARCHETYPES, pageId, "archetype"),
    tone: pick(TONES, pageId, "tone"),
    emoji: pick(EMOJI, pageId, "emoji"),
    length: pick(LENGTHS, pageId, "length"),
    questionStyle: pick(QUESTIONS, pageId, "question"),
    person: "I",
    pageName,
  };
  const o = overrides && overrides[pageId] ? overrides[pageId] : {};
  return { ...base, ...o };
}

// 14-day post-type rotation: 6 story / 5 link / 3 photo, offset per page so the 17 pages spread
// across all three types on any given day. Deterministic (page_id + calendar date) so the 10:00
// and 15:00 re-runs pick the same type. Exported so it can be unit-tested without running the generator.
export const TYPE_WHEEL = ["story", "link", "photo", "story", "link", "story", "link", "photo", "story", "link", "story", "photo", "link", "story"];
export function postTypeFor(pageId, dateISO) {
  const dayIndex = Math.floor(Date.parse(dateISO + "T00:00:00Z") / 86400000);
  return TYPE_WHEEL[(dayIndex + hashStr(pageId)) % TYPE_WHEEL.length];
}

// A one-line persona directive appended to the system prompt.
export function personaDirective(p) {
  const who = p.person === "we"
    ? `You write as ${p.archetype}, in the first-person PLURAL ("we/our").`
    : `You post as "${p.pageName}" — ${p.archetype}, writing in the first person ("I/my").`;
  return `${who} Tone: ${p.tone}. Emoji: ${p.emoji}. Length: ${p.length}. Ending: ${p.questionStyle}. Make this post sound like THIS specific person, not a generic brand.`;
}
