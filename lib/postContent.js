// lib/postContent.js — builds ONE post's content (story | link | photo) for a scaffold record.
// Pure of the record store and CLI so it can be unit-tested: external effects (LLM text, image
// generation, image upload) are injected via `deps`, defaulting to the real implementations.
import { loadJson } from "./env.js";
import { personaFor, personaDirective, postTypeFor } from "./persona.js";
import { hashScene } from "./dedup.js";
import { genJSON } from "./text.js";
import { generateFullImage } from "./gemini.js";
import { uploadPNG } from "./supabase.js";

const overrides = await loadJson(new URL("../data/persona-voices.json", import.meta.url)).catch(() => ({}));
const LINKS = await loadJson(new URL("../data/link-pools.json", import.meta.url));
const SCENES = await loadJson(new URL("../data/photo-scenes.json", import.meta.url));

function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
const seed = (rec, facet, attempt = 0) => hashStr(`${rec.page_id}:${rec.scheduled_date}:${facet}:${attempt}`);

const PILLAR = {
  blackout: "power outages (flashlights, lanterns, power banks — NOT candles, which are a fire risk; keeping phones and food going, staying comfortable)",
  storm: "severe-weather readiness (hurricanes, winter storms, floods, heat) — calm prep",
  fire: "home fire safety (smoke alarms, escape plans, kitchen safety)",
  preparedness: "general home & family readiness (go-bags, water, documents, plans)",
};
const pillarDesc = (p) => PILLAR[p] || PILLAR.preparedness;
const poolFor = (p) => LINKS[p] || LINKS.preparedness;
const scenesFor = (p) => SCENES[p] || SCENES.preparedness;

const ANGLES = [
  "the gloriously over-prepared person", "the one friend who always panics", "turning the situation into a cozy event",
  "the phone or tech dying at the worst moment", "the family group chat during it",
  "finally being the prepared one for once", "the comedy of NOT being ready", "a small win that saved the day",
  "the parent-vs-kids dynamic", "the smug 'I told you so' moment", "rediscovering low-tech fun",
];

const SYS_BASE = `You write organic Facebook posts for QuietProtector — a calm, friendly home & family emergency-preparedness community for a US audience. Voice: warm, practical, lightly witty, human; like a real person sharing, never corporate or salesy, never alarming. HARD RULES: US English; NO fear-mongering or doom; NEVER exploit real tragedies or victims; NO claims of any kind (no medical advice, no product efficacy/safety claims like "fireproof"/"will save your life"/"guaranteed", no unverifiable statistics); TOP-OF-FUNNEL ONLY — never name, sell, price, or link a product, and no "buy/shop/sign up" call-to-action; no politics or religion. Keep it concise and natural. Output ONLY valid minified JSON with exactly the requested keys.`;
export const sysFor = (persona) => `${SYS_BASE}\n\n${personaDirective(persona)}`;

const storyUser = (p, a) => `Theme: ${p} — ${pillarDesc(p)}. Write a short, true-to-life RELATABLE MOMENT (a first-person anecdote) that lands softly on a gentle preparedness takeaway. Fresh angle: "${a}". This is a TEXT-ONLY post — there is NO link and NO photo, so make the words carry it. Do NOT paste any URL. JSON key: "caption".`;
const linkUser = (p, url, outlet, a) => `Theme: ${p}. You are sharing this REAL, reputable resource as a link post: ${url} (from ${outlet}). Write calm FRAMING copy in your own voice — why it's useful + a calm takeaway. Angle flavor: "${a}". Do NOT copy the article; no tragedy framing; no sales; do NOT paste any URL in the text (Facebook shows the link preview below). JSON key: "caption".`;
const photoUser = (p, scene, a) => `Theme: ${p} — ${pillarDesc(p)}. You're sharing a simple photo from around your home (it shows: ${scene}). Write a short, warm first-person caption about that little moment or habit — natural, NOT a literal description of the photo, no product, no sales. Angle flavor: "${a}". JSON key: "caption".`;

export const photoPrompt = (scene, variation) =>
  `Candid casual smartphone photo, realistic and slightly imperfect framing, everyday American home life, natural light, amateur snapshot not professional. ${scene}, ${variation}. Absolutely NO text, NO words, NO captions, NO logos, NO watermarks, NO graphics or UI. No identifiable human faces.`;

// Pick a link from the pillar's pool that is NOT already used on rec.scheduled_date. Deterministic
// start index, then walk. Returns the {url,outlet} entry or null if the whole pool is taken.
export function pickLink(rec, attempt, takenToday) {
  const pool = poolFor(rec.topic);
  const start = seed(rec, "link", attempt) % pool.length;
  for (let k = 0; k < pool.length; k++) {
    const cand = pool[(start + k) % pool.length];
    if (!takenToday.has(`${rec.scheduled_date}|${cand.url}`)) return cand;
  }
  return null;
}

// Decide the intended type for this record (before availability/degradation).
export const intendedType = (rec, forceType) => forceType || postTypeFor(rec.page_id, rec.scheduled_date);

// Build the post. deps = { gen, makeImage, upload }. `canPhoto` gates the image path (secrets present).
// Degradation ladder photo -> link -> story so a record is never blocked by a variety feature.
export async function buildPost(rec, { attempt = 0, canPhoto = false, takenToday = new Set(), forceType = "", deps = {} } = {}) {
  const gen = deps.gen || genJSON;
  const makeImage = deps.makeImage || generateFullImage;
  const upload = deps.upload || uploadPNG;

  const persona = personaFor(rec.page_id, rec.page_name, overrides);
  const SYS = sysFor(persona);
  const a = ANGLES[seed(rec, "angle", attempt) % ANGLES.length];
  const p = rec.topic;
  let type = intendedType(rec, forceType);

  if (type === "photo" && canPhoto) {
    const list = scenesFor(p);
    const scene = list[seed(rec, "scene", attempt) % list.length];
    const variation = SCENES._variations[seed(rec, "variation", attempt) % SCENES._variations.length];
    const prompt = photoPrompt(scene, variation);
    const png = await makeImage(prompt, { aspectRatio: "1:1", timeoutMs: 60000 });
    if (png) {
      const up = await upload(`posts/${rec.scheduled_date}/${rec.id}.png`, png);
      if (up && up.ok) {
        const j = await gen(SYS, photoUser(p, scene, a));
        return { type: "photo", message: j.caption, imagePath: up.url, imageSource: "generated", link: "", url: "", scene: `${scene} (${variation})`, sceneHash: hashScene(prompt), preview: { ...j, scene, image: up.url } };
      }
    }
    type = "link"; // photo unavailable -> degrade
  } else if (type === "photo") {
    type = "link";
  }

  if (type === "link") {
    const chosen = pickLink(rec, attempt, takenToday);
    if (chosen) {
      const j = await gen(SYS, linkUser(p, chosen.url, chosen.outlet, a));
      return { type: "link", message: j.caption, imagePath: "", imageSource: "none", link: chosen.url, url: chosen.url, scene: "", sceneHash: "", preview: { ...j, url: chosen.url } };
    }
    type = "story"; // all links taken today -> degrade
  }

  const j = await gen(SYS, storyUser(p, a));
  return { type: "story", message: j.caption, imagePath: "", imageSource: "none", link: "", url: "", scene: "", sceneHash: "", preview: { ...j } };
}
