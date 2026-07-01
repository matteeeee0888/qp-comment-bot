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

const BUYER = JSON.parse(await readFile(path.join(repoRoot, "data/buyer-states.json"), "utf8")).states;
const TOP_BUYER_CODES = BUYER.slice(0, 16).map((s) => s.code).join(", ");

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
- BUYER GEOGRAPHY: our buyers concentrate in these states (USPS, most first): ${TOP_BUYER_CODES}. When a story is nationwide, multi-state, or genuinely ambiguous about where it hits, PREFER these buyer-heavy states for regionStates + cities so the map resonates with our audience. If the story is clearly about a specific other state, use that real state — never fake the geography.
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

// ─────────────────────────────────────────────────────────────────────────────
// GEO path — geopolitical / grid / EMP stories rendered as a clean broadcast-style
// world/region MAP graphic (Strait-of-Hormuz locator or EMP effect-radius rings).
// Unlike the weather path this image is generated whole by an AI image model
// (lib/openaiImage.js), so buildGeoSpec only extracts the map SEMANTICS and
// frameGeoPrompt wraps them in a fixed, controlled style prompt.

const GEO_SYS = `You are an art director for QuietProtector, a US family emergency-preparedness brand. Turn ONE geopolitical / grid / energy / EMP / supply-disruption news story into a JSON spec for a clean, neutral BROADCAST NEWS EXPLAINER MAP graphic (think a TV/newspaper locator map) that a preparedness ad can newsjack.

Pick mapType:
- "locator" — a regional map with a red circle highlighting ONE geographic chokepoint/hotspot and a small label box (e.g. a strait, border region, shipping lane, capital). Use for conflict, tensions, shipping/oil routes, regional escalation.
- "radius" — concentric effect-radius rings centered over an area, like a blast/EMP/outage reach diagram. Use for EMP, nuclear, grid-collapse, blackout, large-scale infrastructure threats.

Rules (keep ALL text SHORT — it will be rendered inside the image):
- region: the geographic area the map should show, plain English (e.g. "the Persian Gulf, southern Iran, Oman and the UAE", "the continental United States").
- hotspot: (locator) what the red circle outlines, e.g. "the Strait of Hormuz". ("" for radius)
- hotspotLabel: (locator) <=4 words for the red label box, e.g. "Strait of Hormuz". ("" for radius)
- countryLabels: 0-5 place names to print faintly on the map in grey caps (e.g. ["IRAN","OMAN","UAE"]).
- rings: (radius) 2-4 short ring labels, e.g. ["Effect radius 480 miles","1,000 miles","Burst altitude 30 miles"]. ([] for locator)
- threatLabel: <=4 words neutral alert tag, e.g. "SHIPPING LANE RISK", "GRID THREAT ZONE". May be "".
- palette: "red" for conflict/locator, "magenta" for blast/EMP radius, "amber" for energy/supply.

COMPLIANCE (hard): neutral and factual — NO taking sides, NO flags, NO partisan/electoral/religious content, NO named victims or casualty counts, NO weapons depiction, NO gore, NO fake statistics, NO news-network or government logos. It is a geography explainer, not propaganda.

Output ONLY minified JSON with keys: mapType, region, hotspot, hotspotLabel, countryLabels, rings, threatLabel, palette.`;

export async function buildGeoSpec(story) {
  const user = `STORY headline: "${story.title}"
Outlet: ${story.source || "unknown"}
Chosen ad angle: ${story.angle || ""}
Why now: ${story.why || ""}

Write the JSON map spec.`;
  const j = await genJSON(GEO_SYS, user, { maxTokens: 700 });

  const mapType = j.mapType === "radius" ? "radius" : "locator";
  const palette = ["red", "magenta", "amber"].includes(j.palette) ? j.palette : "red";
  const arr = (a, n) => (Array.isArray(a) ? a.map((x) => String(x || "").slice(0, 40)).filter(Boolean).slice(0, n) : []);
  return {
    mapType,
    region: String(j.region || "the affected region").slice(0, 160),
    hotspot: mapType === "locator" ? String(j.hotspot || "").slice(0, 80) : "",
    hotspotLabel: mapType === "locator" ? String(j.hotspotLabel || j.hotspot || "").slice(0, 28) : "",
    countryLabels: arr(j.countryLabels, 5),
    rings: mapType === "radius" ? arr(j.rings, 4) : [],
    threatLabel: String(j.threatLabel || "").slice(0, 26),
    palette,
  };
}

const PALETTE_DESC = {
  red: "bright red (#d12b1f)",
  magenta: "magenta-pink (#d6336c)",
  amber: "amber-orange (#e8821e)",
};

// Compose the final image-model prompt from the geo spec. The STYLE is fixed here (not left to the
// LLM) so every geo image matches the same clean broadcast-map reference set (flat BBC/TV-news look).
// Pass { withRefs:true } when reference images are attached to the model call.
export function frameGeoPrompt(spec = {}, { withRefs = false } = {}) {
  const accent = PALETTE_DESC[spec.palette] || PALETTE_DESC.red;
  const base = `A clean, modern broadcast-news explainer LOCATOR MAP, FLAT vector cartography (no terrain, no relief, no shading, no satellite texture). Show ${spec.region}. The focus country filled near-white, neighboring countries flat light grey, water a muted slate grey-blue, hair-thin neutral borders, lots of empty negative space. Minimal and editorial, like a BBC or Reuters explainer map.`;

  let focus;
  if (spec.mapType === "radius") {
    const rings = spec.rings.length ? spec.rings.join("; ") : "Effect radius; Outer reach";
    focus = `Centered over the area, draw concentric translucent ${accent} filled rings (soft fills fading outward) with thin darker-red ring outlines, like an effect-radius / reach diagram. Each ring distance sits in a small BLACK rounded-rectangle pill with white sans-serif text, reading exactly: ${rings}. Faint state/region borders show through. Keep labels short, legible, correctly spelled.`;
  } else {
    const lbl = spec.hotspotLabel || "Hotspot";
    focus = `Draw a clean medium-weight ${accent} circle outline (not filled) around ${spec.hotspot || "the key chokepoint"}. Place a SOLID deep-red RECTANGLE label box with bold white sans-serif text reading exactly "${lbl}", connected to the circle by one thin straight leader line. ${spec.countryLabels.length ? `Print the place names ${spec.countryLabels.join(", ")} on the map in plain dark-grey uppercase.` : ""} Keep all text short, legible, correctly spelled.`;
  }

  const alert = spec.threatLabel ? ` A small neutral tag reading "${spec.threatLabel}" may appear discreetly in a corner.` : "";
  const refLine = withRefs ? " Match the clean, flat editorial cartography and label treatment of the attached reference image(s)." : "";
  const rules = ` Square 1:1 composition. Absolutely NO photographs, NO real people or faces, NO flags, NO weapons, NO brand logos, NO news-network or government logos, NO watermarks, NO paragraphs of text - only the few short map labels described. Neutral and non-partisan.`;

  return `${base} ${focus}${alert}${refLine}${rules}`;
}
