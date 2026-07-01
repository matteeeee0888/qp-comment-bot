// lib/stateSpotlight.js — daily "state spotlight" images. Picks top buyer states on a weighted
// rotation (Texas/California/Florida... appear more often, but we avoid recent repeats) and builds a
// preparedness broadcast spec DEDICATED to that state + current season, so buyer-heavy states get
// GUARANTEED image coverage even when the day's news doesn't hit them. Rendered by lib/newsImage.js.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genJSON } from "./text.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const BUYER = JSON.parse(await readFile(path.join(repoRoot, "data/buyer-states.json"), "utf8")).states;
const SEEN_PATH = path.resolve(repoRoot, "state/spotlight-seen.json");
const HAZARDS = ["heat", "storm", "tornado", "flood", "cold", "wind", "security", "car", "general"];
const BRAND_KEYS = ["terrastryke", "terrashell", "terrabolt", "general"];

let _cities = null;
async function cityList() {
  if (!_cities) { const m = JSON.parse(await readFile(path.join(repoRoot, "assets/us-states-paths.json"), "utf8")); _cities = Object.keys(m._cities || {}); }
  return _cities;
}
async function loadSeen() { try { return JSON.parse(await readFile(SEEN_PATH, "utf8")); } catch { return []; } }
async function saveSeen(arr) { await mkdir(path.dirname(SEEN_PATH), { recursive: true }); await writeFile(SEEN_PATH, JSON.stringify(arr.slice(-24))); }

export function buyerRank(code) { return BUYER.findIndex((s) => s.code === code) + 1; }

// Weighted-random pick of n distinct buyer states, avoiding the last `avoidRecent` used (rotation).
export async function pickStates(n = 2, { avoidRecent = 12 } = {}) {
  const seen = await loadSeen();
  const recent = new Set(seen.slice(-avoidRecent));
  let arr = BUYER.filter((s) => !recent.has(s.code));
  if (arr.length < n) arr = BUYER.slice();              // cycled through everyone -> reset the pool
  arr = arr.slice();
  const picks = [];
  for (let k = 0; k < n && arr.length; k++) {
    const total = arr.reduce((a, s) => a + s.buyers, 0);
    let r = Math.random() * total, idx = 0;             // Node runtime — Math.random is fine here
    for (; idx < arr.length - 1; idx++) { r -= arr[idx].buyers; if (r <= 0) break; }
    picks.push(arr[idx]);
    arr.splice(idx, 1);
  }
  await saveSeen([...seen, ...picks.map((s) => s.code)]);
  return picks;
}

const SPOT_SYS = (cities) => `You are an art director for QuietProtector, a US emergency-preparedness brand. Create a JSON spec for a broadcast-style "alert" preparedness graphic DEDICATED to ONE US state — a "state spotlight". It is not breaking news, but an evergreen yet TIMELY readiness nudge aimed at that state's residents.

Pick a plausible, seasonally-right preparedness angle for the state + current month (e.g. Texas summer -> extreme heat or flash flooding; Florida -> hurricane season or heat; California -> wildfire or heat; Michigan/Minnesota winter -> winter storm + power outage; Tornado Alley spring -> tornado). Make it feel current for that state, not generic.

Fields:
- hazard: one of ${HAZARDS.join(", ")} (fits the state + season).
- brand: best-fit product key — terrastryke (car-escape / flood-in-car / roadside), terrashell (cold / stranded / outage warmth), terrabolt (home/travel security), or general.
- cities: 1-3 city names IN THAT STATE, ONLY from this allowed list (skip any not in it): ${cities.join(", ")}.
- alertLabel: <=4 words, ALL-CAPS-ready (e.g. "TEXAS HEAT WATCH").
- dateRange: a season/timeframe ("This summer", "Storm season", "This week").
- regionLabel: <=7 words sub-headline that NAMES the state.
- callouts: EXACTLY 4 objects {title (<=3 words), body (<=7 words)} — concrete readiness tips.
- bottomTitle: <=5 words hook. bottomBody: <=18 words tying the moment to the product's use, calm and benefit-led.
- badge: "50% OFF".
- scenePrompt: a vivid PHOTOREAL background scene for this state + hazard (<=35 words), NO text/words/logos and no recognizable faces.

COMPLIANCE: calm readiness, NO fear-mongering, NO claims ("will save your life"/"guaranteed"/medical), NO fake statistics, NO exploiting victims.

Output ONLY minified JSON with keys: hazard, brand, cities, alertLabel, dateRange, regionLabel, callouts, bottomTitle, bottomBody, badge, scenePrompt.`;

// Build a newsImage spec for a state spotlight. layout defaults to "map" (the state itself); the
// caller may switch it to "photo" when a Gemini background is generated.
export async function buildSpotlightSpec(stateObj, { month } = {}) {
  const cities = await cityList();
  const user = `STATE: ${stateObj.state} (${stateObj.code}). Current month: ${month || "unknown"}. Write the state-spotlight spec.`;
  const j = await genJSON(SPOT_SYS(cities), user, { maxTokens: 900 });
  const clampArr = (a, allowed, n) => (Array.isArray(a) ? a.filter((x) => allowed.includes(x)).slice(0, n) : []);
  return {
    layout: "map",
    hazard: HAZARDS.includes(j.hazard) ? j.hazard : "general",
    brand: BRAND_KEYS.includes(j.brand) ? j.brand : "general",
    regionStates: [stateObj.code],
    watchStates: [],
    cities: clampArr(j.cities, cities, 3).map((name) => ({ name })),
    alertLabel: String(j.alertLabel || "").slice(0, 34),
    dateRange: String(j.dateRange || "").slice(0, 22),
    regionLabel: String(j.regionLabel || `${stateObj.state} — stay ready`).slice(0, 60),
    keyword: "",
    callouts: (Array.isArray(j.callouts) ? j.callouts : []).slice(0, 4).map((c) => ({ title: String(c.title || "").slice(0, 22), body: String(c.body || "").slice(0, 52) })),
    bottomTitle: String(j.bottomTitle || "").slice(0, 40),
    bottomBody: String(j.bottomBody || "").slice(0, 130),
    badge: typeof j.badge === "string" ? j.badge.slice(0, 12) : "50% OFF",
    scenePrompt: String(j.scenePrompt || "").slice(0, 240),
    _angle: String(j.bottomTitle || j.regionLabel || "").slice(0, 120),
  };
}
