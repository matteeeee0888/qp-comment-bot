// lib/imageBrain.js — turn a scored news story into a render spec for lib/newsImage.js.
// Claude decides layout (map for US weather/regional stories, card otherwise), the hazard type,
// which states/cities are affected, and writes the broadcast copy (alert label, callouts, banner
// bottom line). The product banner brand is NOT chosen here — it's fixed to the story's scored brand.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genJSON } from "./text.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const HAZARDS = ["heat", "storm", "tornado", "flood", "cold", "wind", "security", "car", "general"];
const USPS = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

let _cities = null;
async function cityList() {
  if (!_cities) {
    const m = JSON.parse(await readFile(path.join(repoRoot, "assets/us-states-paths.json"), "utf8"));
    _cities = Object.keys(m._cities || {});
  }
  return _cities;
}

const SYS = (cities) => `You are an art director for QuietProtector, a US emergency-preparedness brand that runs aggressive direct-response weather/news ads. Turn ONE news story into a JSON spec for a broadcast-style "alert" graphic (think TV weather warning) that newsjacks the story toward the given product.

Decide LAYOUT:
- "map" — the story is tied to US weather or a US region (heat, storms, tornado, flood, cold, wind, evacuations, regional events). Pick the affected US states.
- "card" — no specific US geography (home security, car-escape, generic preparedness, travel). No map.

Rules for fields:
- hazard: one of ${HAZARDS.join(", ")}.
- regionStates: 1-3 USPS codes for the CORE affected area (map only; [] for card).
- watchStates: 0-4 neighboring USPS codes (map only).
- cities: 0-4 names, ONLY from this allowed list (skip any not in it): ${cities.join(", ")}.
- alertLabel: <=4 words, ALL-CAPS-ready headline (e.g. "EXTREME HEAT ADVISORY").
- dateRange: short timeframe ("This week", "Tonight", "Jun 18-24", "Summer 2026") — infer from the story; never invent specific dates you don't have.
- regionLabel: <=7 words sub-headline.
- keyword: <=4 words punchy phrase (used big on card layout).
- callouts: EXACTLY 4 objects {title (<=3 words), body (<=7 words)} — concrete, scannable.
- bottomTitle: <=5 words hook. bottomBody: <=18 words tying the moment to the product's use, calm and benefit-led.
- badge: "50% OFF" (default for ads) or "".
- scenePrompt: a vivid PHOTOREAL background scene for this story (concrete setting / weather / objects, cinematic) to feed an AI image generator — NO text/words/logos and no recognizable faces (<= 35 words).

COMPLIANCE: aggressive urgency is OK, but NEVER name a dead/injured victim or a specific fatal tragedy; no medical claims; no "guaranteed"/"will save your life"; no fake statistics. Frame around readiness.

Output ONLY minified JSON with keys: layout, hazard, regionStates, watchStates, cities, alertLabel, dateRange, regionLabel, keyword, callouts, bottomTitle, bottomBody, badge, scenePrompt.`;

const clampArr = (a, allowed, n) => (Array.isArray(a) ? a.filter((x) => allowed.includes(x)).slice(0, n) : []);

export async function buildSpec(story) {
  const cities = await cityList();
  const user = `STORY headline: "${story.title}"
Outlet: ${story.source || "unknown"}
Product to feature (banner): ${story.brand || "general"}
Chosen ad angle: ${story.angle || ""}
Why now: ${story.why || ""}

Write the JSON spec.`;
  const j = await genJSON(SYS(cities), user, { maxTokens: 1100 });

  const layout = j.layout === "card" ? "card" : j.regionStates?.length ? "map" : "card";
  const spec = {
    layout,
    hazard: HAZARDS.includes(j.hazard) ? j.hazard : "general",
    brand: story.brand || "general",                 // banner brand is fixed to the scored brand
    regionStates: layout === "map" ? clampArr(j.regionStates, USPS, 3) : [],
    watchStates: layout === "map" ? clampArr(j.watchStates, USPS, 4) : [],
    cities: layout === "map" ? clampArr(j.cities, cities, 4).map((name) => ({ name })) : [],
    alertLabel: String(j.alertLabel || "").slice(0, 34),
    dateRange: String(j.dateRange || "").slice(0, 22),
    regionLabel: String(j.regionLabel || "").slice(0, 60),
    keyword: String(j.keyword || "").slice(0, 40),
    callouts: (Array.isArray(j.callouts) ? j.callouts : []).slice(0, 4).map((c) => ({
      title: String(c.title || "").slice(0, 22),
      body: String(c.body || "").slice(0, 52),
    })),
    bottomTitle: String(j.bottomTitle || "").slice(0, 40),
    bottomBody: String(j.bottomBody || "").slice(0, 130),
    badge: typeof j.badge === "string" ? j.badge.slice(0, 12) : "",
    scenePrompt: String(j.scenePrompt || "").slice(0, 240),
  };
  // map layout needs at least one core state; fall back to card if the model gave none
  if (spec.layout === "map" && !spec.regionStates.length) spec.layout = "card";
  return spec;
}
