// lib/newsBrain.js — turn raw headlines into a scored, compliant ad-newsjacking shortlist.
// Free discovery (Google News RSS via lib/news.js) feeds candidate headlines; Claude drops the
// non-compliant ones (tragedy/victims/politics), scores the rest on 5 dimensions, tags the
// best-fit QuietProtector product, and writes ONE compliant ad angle per story. Batched to keep
// API calls (and cost) low — the account is rate-limited to a few requests/minute.
import { genJSON } from "./text.js";

// The three D2C products an ad would newsjack, plus a catch-all. Tag by USE-CASE, not page pillar.
export const BRANDS = {
  terrabolt:   "TerraBolt — portable steel door-brace lock for inward-opening doors (hotels, Airbnbs, apartments, dorms). Triggers: travel/lodging safety, break-in & home-intrusion prevention, apartment/dorm/solo-traveler security.",
  terrastryke: "TerraStryke — keychain car-escape tool (spring striker for tempered side windows + seatbelt cutter). Triggers: vehicle escape, cars in floodwater, being trapped in a car, driving-season & roadside safety.",
  terrashell:  "TerraShell — 4 oz emergency thermal bivy (body-warmth enclosure) with whistle. Triggers: cold/exposure, getting stranded outdoors or in a stalled car, winter storms, hiking/road-trip prep, staying warm in an outage.",
  general:     "General QuietProtector preparedness (no single product fits): broad home/family readiness, power outages, severe weather, emergency kits & plans.",
};

const SYS = `You are a news editor for QuietProtector, a US home & family emergency-preparedness brand that runs Facebook/Instagram direct-response ads. From raw news headlines, pick the ones a preparedness brand can RESPONSIBLY newsjack in an ad, score them, tag the single best-fit product, and write one compliant ad angle.

PRODUCTS you can tag (pick the single best fit, else "general"):
${Object.entries(BRANDS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

DROP a story (keep:false) if it:
- centers on a specific death, injury, named victim, or an ongoing named tragedy/disaster (we NEVER profit from real victims);
- is political/partisan, religious, or crime-gory;
- is an ad, spammy listicle, celebrity/stock-market fluff, or not US-relevant.
KEEP seasonal / trend / awareness / safety-guidance / product-recall / preparedness stories (e.g. "heat wave expected this week", "AAA's summer road-trip safety advice", "storm-season prep checklist", "recall on X").

For each KEPT story, score 1-5 (5 = best):
- t Timeliness — how "right now" / in-season it is
- e Emotional Intensity — the latent, ETHICAL emotional pull of the TOPIC (never the gore of a specific tragedy)
- b Audience Breadth — how many US families it touches
- u Uniqueness — fresh hook vs. generic evergreen
- m Brand Match — how naturally it leads into the tagged product's use-case

Then write:
- angle: ONE punchy ad hook (<= 22 words) newsjacking the topic toward calm readiness. NO fear-mongering, NO claims ("will save your life"/"guaranteed"/medical), NO competitor names, NO exploiting victims.
- why: <= 12 words on why it's worth running now.

Output ONLY minified JSON: {"items":[{"i":<index>,"keep":<bool>,"brand":"<key>","scores":{"t":n,"e":n,"b":n,"u":n,"m":n},"angle":"...","why":"..."}]}. Include EVERY index; for keep:false you may omit scores/angle/why.`;

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// cands: [{title, source, query, link, pubDate}] → kept+scored, sorted best-first.
export async function scoreCandidates(cands, { batch = 10 } = {}) {
  const kept = [];
  for (const group of chunk(cands, batch)) {
    const list = group.map((c, i) => `${i}. [${c.query}] "${c.title}" — ${c.source || "unknown source"}`).join("\n");
    const user = `Score these ${group.length} headlines. Indices are 0-based for THIS batch only.\n\n${list}`;
    let res;
    try { res = await genJSON(SYS, user, { maxTokens: 2200 }); }
    catch (e) { console.log(`  score batch failed: ${e.message || e}`); continue; }
    const items = Array.isArray(res?.items) ? res.items : [];
    for (const it of items) {
      const c = group[it?.i];
      if (!c || !it.keep) continue;
      const s = it.scores || {};
      const total = ["t", "e", "b", "u", "m"].reduce((acc, k) => acc + (Number(s[k]) || 0), 0);
      kept.push({ ...c, brand: BRANDS[it.brand] ? it.brand : "general", scores: s, total, angle: it.angle || "", why: it.why || "" });
    }
  }
  kept.sort((a, b) => b.total - a.total);
  return kept;
}
