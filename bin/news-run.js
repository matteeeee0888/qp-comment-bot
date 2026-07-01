#!/usr/bin/env node
// bin/news-run.js — daily ad-newsjacking feed for QuietProtector.
// Free discovery (Google News RSS) → Claude filters/scores/angles → the top stories are written
// to the "News" tab of the SAME Google Sheet the comment archive uses. Cloud-safe: the only
// secrets needed are ANTHROPIC_API_KEY (scoring) and SHEET_WEBHOOK_URL/TOKEN (sheet write).
//
// Usage:
//   node bin/news-run.js                 # full run → writes to the News tab + seeds seen-store
//   node bin/news-run.js --dry           # discover + score + print; NO sheet write, NO seeding
//   node bin/news-run.js --dry --no-llm  # discovery only (no API key needed) — sanity-check feeds
//   node bin/news-run.js --top 8         # how many stories to write (default 8)
//   node bin/news-run.js --max-age 5     # max story age in days (default 3)
//   node bin/news-run.js --geo-top 3     # max AI geopolitical-map images per run (default 3; Gemini→gpt-image-1)
//   node bin/news-run.js --no-geo        # skip the AI geo-map path (weather images only)
import { fetchFeed, fetchRss, titleKey, loadSeen, saveSeen } from "../lib/news.js";
import { scoreCandidates } from "../lib/newsBrain.js";
import { archiveNews } from "../lib/archive.js";
import { TEXT_ENGINE } from "../lib/text.js";
import { buildSpec, buildGeoSpec, frameGeoPrompt } from "../lib/imageBrain.js";
import { specToPNG } from "../lib/newsImage.js";
import { uploadPNG, supabaseReady } from "../lib/supabase.js";
import { generateBackground, generateFullImage, geminiReady } from "../lib/gemini.js";
import { generateImage, openaiImageReady } from "../lib/openaiImage.js";
import { pickStates, buildSpotlightSpec, buyerRank } from "../lib/stateSpotlight.js";
import { readFile, readdir } from "node:fs/promises";

// Load style-reference images for the geo maps from assets/refs/geo/<kind>/ (locator|radius).
// Drop clean reference PNGs there to lock the house look; empty folder => text-only (graceful).
async function loadGeoRefs(kind) {
  const dir = new URL(`../assets/refs/geo/${kind}/`, import.meta.url);
  try {
    const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).slice(0, 3);
    const refs = [];
    for (const f of files) {
      const buf = await readFile(new URL(f, dir));
      const mimeType = /\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg";
      refs.push({ data: buf.toString("base64"), mimeType });
    }
    return refs;
  } catch { return []; }
}

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const NO_LLM = argv.includes("--no-llm");
const NO_IMAGES = argv.includes("--no-images");
const NO_GEMINI = argv.includes("--no-gemini");
const NO_GEO = argv.includes("--no-geo");          // skip the gpt-image-1 geopolitical-map path
const NO_SPOTLIGHT = argv.includes("--no-spotlight");
const SPOTLIGHT = parseInt(getArg("--spotlight", "2"), 10);   // dedicated buyer-state spotlight images/run (0 = off)
const TOP = parseInt(getArg("--top", "8"), 10) || 8;
const GEO_TOP = parseInt(getArg("--geo-top", "3"), 10) || 3; // max AI geo-map images per run
const GEO_RESERVE = parseInt(getArg("--geo-reserve", "2"), 10) || 0; // min geo stories forced into the shortlist (0 = pure ranking)
const MAX_AGE_DAYS = parseInt(getArg("--max-age", "3"), 10) || 3;
const POOL_CAP = 60;           // most candidates sent to the model in one run (cost ceiling)
const PER_SOURCE_CAP = 8;      // max candidates from any single outlet, so no channel floods the pool

// Query pool: covers all QP preparedness themes AND maps onto the 3 ad products.
const QUERIES = [
  // terrashell — cold / exposure / stranded / warmth
  "cold weather safety tips", "winter storm preparedness", "hikers stranded cold rescue", "stay warm during power outage",
  // terrastryke — car escape / floods / driving season
  "flash flood driving safety", "summer road trip safety tips", "vehicle emergency kit", "car safety extreme heat",
  // terrabolt — home / travel security
  "home break-in prevention tips", "hotel room safety travel", "apartment dorm security tips",
  // general QP preparedness
  "emergency preparedness tips", "power outage preparedness", "severe weather preparedness", "family emergency plan",
  // active events (aggressive newsjack — every image is flagged for human review before use)
  "tornado warning today", "severe thunderstorm warning", "flash flood warning", "winter storm warning",
  "heat advisory issued", "evacuation order weather",
  // geopolitical / grid / EMP / supply (kind="geo" — rendered as a neutral region map via gpt-image-1)
  "strait of hormuz tensions", "middle east conflict escalation", "oil shipping lane threat",
  "global conflict escalation news", "power grid attack warning", "EMP threat preparedness",
  "national blackout risk", "cyberattack power grid utilities", "fuel shortage warning US",
  "supply chain disruption crisis", "water supply emergency US", "nuclear threat tensions",
  // newsjack the EXACT channels the (older, TV-news-driven) audience watches all day — via Google
  // News scoped to each outlet, topic-narrowed so we get THEIR framing of OUR themes, not sports/markets.
  "site:cnn.com (iran OR conflict OR war OR blackout OR grid OR storm OR flood OR hurricane OR emergency OR evacuation OR nuclear) when:3d",
  "site:msnbc.com (iran OR conflict OR war OR blackout OR grid OR storm OR emergency OR nuclear) when:3d",
  // Reuters: neutral wire service, strong on geopolitics/energy -> survives the compliance filter well, great for the geo lane.
  "site:reuters.com (iran OR hormuz OR conflict OR war OR sanctions OR oil OR blackout OR grid OR nuclear OR storm OR hurricane OR evacuation) when:3d",
  // Dedicated weather desks — Fox Weather + The Weather Channel. Best signal for the storm/flood/
  // heat lane (terrashell / terrastryke). Scoped via Google News site: (their direct RSS is unreliable).
  "site:foxweather.com (flood OR storm OR thunderstorm OR tornado OR hurricane OR heat OR blizzard OR evacuation OR wildfire OR outage OR warning OR watch) when:3d",
  "site:weather.com (flood OR storm OR thunderstorm OR tornado OR hurricane OR heat OR blizzard OR evacuation OR wildfire OR outage OR warning OR watch) when:3d",
  // CNN International edition (the user's edition.cnn.com) — subdomain not always caught by site:cnn.com.
  "site:edition.cnn.com (iran OR conflict OR war OR blackout OR grid OR storm OR flood OR hurricane OR emergency OR evacuation OR nuclear) when:3d",
];

// Direct publisher front-page RSS — Fox, Al Jazeera, NBC (the MSNBC family). These are the homes
// the audience leaves on all day; their headlines ARE the conversation we newsjack. CNN/MSNBC use
// the site: queries above (their native RSS is deprecated/stale).
const OUTLET_FEEDS = [
  { source: "Fox News",   label: "fox-world",  url: "https://moxie.foxnews.com/google-publisher/world.xml" },
  { source: "Fox News",   label: "fox-us",     url: "https://moxie.foxnews.com/google-publisher/us.xml" },
  { source: "Fox News",   label: "fox-latest", url: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { source: "Al Jazeera", label: "aljazeera",  url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "NBC News",   label: "nbc-world",  url: "https://feeds.nbcnews.com/nbcnews/public/world" },
  { source: "NBC News",   label: "nbc-news",   url: "https://feeds.nbcnews.com/nbcnews/public/news" },
];

function ageDays(pubDate) {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return 0; // unknown date → treat as fresh, let the model judge
  return (Date.now() - t) / 86400000;
}

console.log(`news-run: text=${TEXT_ENGINE} top=${TOP} maxAge=${MAX_AGE_DAYS}d${DRY ? " DRY" : ""}${NO_LLM ? " NO-LLM" : ""}`);

// --probe: write ONE labeled test row to the News tab and report the webhook's BODY.
// Used to verify the Apps Script deploy/URL/token without depending on fresh news.
if (argv.includes("--probe")) {
  const today = new Date().toISOString().slice(0, 10);
  const probe = {
    captured_at: today, brand: "general", headline: "PROBE — deploy check, delete this row",
    source: "diagnostic", url: "", score: "", t: "", e: "", b: "", u: "", m: "",
    angle: "(probe)", why_now: "(probe)", status: "probe",
  };
  const res = await archiveNews([probe]);
  console.log(`PROBE result: ${JSON.stringify(res)}`);
  console.log(res.ok ? "PROBE OK — News tab reachable." : "PROBE FAILED — see body above (stale deploy / wrong URL / bad token).");
  process.exit(res.ok ? 0 : 1);
}

// 1. discover (feeds fetched sequentially — polite, and the feeds are fast enough)
const raw = [];
for (const q of QUERIES) raw.push(...(await fetchFeed(q)));
for (const f of OUTLET_FEEDS) raw.push(...(await fetchRss(f.url, f)));
console.log(`discovered ${raw.length} raw items across ${QUERIES.length} queries + ${OUTLET_FEEDS.length} outlet feeds`);

// 2. keep fresh + unseen, dedup by normalized title
const seen = await loadSeen();
const consideredKeys = new Set();
const fresh = [];
for (const it of raw) {
  if (ageDays(it.pubDate) > MAX_AGE_DAYS) continue;
  const key = titleKey(it.title);
  if (!key || seen.has(key) || consideredKeys.has(key)) continue;
  consideredKeys.add(key);
  fresh.push(it);
}
console.log(`${fresh.length} fresh, unseen candidates (<= ${MAX_AGE_DAYS}d old)`);
if (!fresh.length) { console.log("nothing new today — exiting clean."); process.exit(0); }

// newest first, then build the scored pool with a per-source cap so no single outlet floods it
// (a hot day on one channel could otherwise eat every slot and crowd out diversity).
fresh.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
const pool = [];
const perSourceCount = {};
for (const it of fresh) {
  const src = (it.source || "?").toLowerCase();
  if ((perSourceCount[src] = (perSourceCount[src] || 0) + 1) > PER_SOURCE_CAP) continue;
  pool.push(it);
  if (pool.length >= POOL_CAP) break;
}

if (NO_LLM) {
  console.log(`\n--- ${pool.length} candidates (no scoring) ---`);
  for (const c of pool.slice(0, 25)) console.log(`[${c.query}] ${c.title} — ${c.source} (${c.pubDate})`);
  process.exit(0);
}

// 3. filter + score + angle (Claude)
const scored = await scoreCandidates(pool);
console.log(`${scored.length} passed compliance + scoring`);
// Build the shortlist. Geo stories rarely out-score a flood of active US weather, so reserve a few
// slots for the best compliant geo stories — otherwise the geo-map feature would seldom fire in season.
let top = scored.slice(0, TOP);
if (!NO_GEO && GEO_RESERVE > 0) {
  const geoInTop = top.filter((s) => s.kind === "geo").length;
  if (geoInTop < GEO_RESERVE) {
    const inTop = new Set(top.map((s) => s.link));
    const extraGeo = scored.filter((s) => s.kind === "geo" && !inTop.has(s.link)).slice(0, GEO_RESERVE - geoInTop);
    if (extraGeo.length) {
      const nonGeo = top.filter((s) => s.kind !== "geo");
      const keptNonGeo = nonGeo.slice(0, Math.max(0, nonGeo.length - extraGeo.length)); // drop weakest weather to make room
      top = [...top.filter((s) => s.kind === "geo"), ...keptNonGeo, ...extraGeo].sort((a, b) => b.total - a.total);
    }
  }
}
const geoCount = top.filter((s) => s.kind === "geo").length;
console.log(`(${geoCount} of the top ${top.length} are geo → AI map, capped at ${GEO_TOP}/run; reserve ${GEO_RESERVE})`);
for (const s of top) {
  console.log(`\n[${s.total}/25] ${s.kind.toUpperCase()} ${s.brand}  "${s.title}" (${s.source || "?"})`);
  console.log(`   angle: ${s.angle}`);
  console.log(`   why:   ${s.why}`);
}

if (DRY) { console.log("\n(dry — not writing to the sheet, not seeding the seen-store)"); process.exit(0); }

const todayISO = new Date().toISOString().slice(0, 10);
const spotlightRows = []; // dedicated buyer-state spotlight images (guaranteed buyer-state coverage)

// 3b. broadcast image per story → Supabase (aggressive mode: every image flagged "REVIEW").
// Hybrid: if GEMINI_API_KEY is set, Gemini paints a photoreal background and the code overlays the
// alert chrome on top; if Gemini fails or is absent, it falls back to the code-only render. Never breaks.
if (!NO_IMAGES && (await supabaseReady())) {
  const useGemini = !NO_GEMINI && (await geminiReady());
  // geo backend: prefer Gemini (free tier), fall back to gpt-image-1 if only OpenAI is configured.
  const geoBackend = NO_GEO ? null : (await geminiReady()) ? "gemini" : (await openaiImageReady()) ? "openai" : null;
  // preload geo style references once (locator vs radius); empty => text-only prompt
  const geoRefs = geoBackend === "gemini" ? { locator: await loadGeoRefs("locator"), radius: await loadGeoRefs("radius") } : { locator: [], radius: [] };
  const refsTotal = geoRefs.locator.length + geoRefs.radius.length;
  console.log(`images: on (weather bg=${useGemini ? "Gemini hybrid" : "code-only"}, geo=${geoBackend ? `${geoBackend} (max ${GEO_TOP}/run, ${refsTotal} ref img)` : "off"})`);
  let geoMade = 0;
  for (const s of top) {
    try {
      let png, mode, layoutLabel;
      if (s.kind === "geo") {
        // geopolitical/grid/EMP → full broadcast-map image (capped to bound spend / rate).
        // No US-weather fallback: a US tornado map for a Hormuz story would be wrong, so skip instead.
        if (!geoBackend) { console.log(`IMG geo skip (no image backend) ${s.brand}: ${titleKey(s.title).slice(0, 40)}`); continue; }
        if (geoMade >= GEO_TOP) { console.log(`IMG geo skip (cap ${GEO_TOP}) ${s.brand}: ${titleKey(s.title).slice(0, 40)}`); continue; }
        const gspec = await buildGeoSpec(s);
        const refs = geoRefs[gspec.mapType] || [];
        const geoPrompt = frameGeoPrompt(gspec, { withRefs: refs.length > 0 });
        png = geoBackend === "gemini" ? await generateFullImage(geoPrompt, { refs }) : await generateImage(geoPrompt);
        if (!png) { console.log(`IMG geo gen fail (${geoBackend}) ${s.brand}: ${titleKey(s.title).slice(0, 40)}`); continue; }
        mode = geoBackend === "gemini" ? `gemini-img${refs.length ? `+${refs.length}ref` : ""}` : "gpt-image-1"; layoutLabel = `geo/${gspec.mapType}`; geoMade++;
      } else {
        const spec = await buildSpec(s);
        mode = "code";
        if (useGemini && spec.scenePrompt) {
          const bgPng = await generateBackground(spec.scenePrompt);
          if (bgPng) {
            spec.bgDataUri = `data:image/png;base64,${bgPng.toString("base64")}`;
            spec.layout = "photo";                  // photo-dominant hybrid: the Gemini scene is the hero
            spec.callouts = (spec.callouts || []).slice(0, 3);
            mode = "gemini";
          }
        }
        png = await specToPNG(spec);
        layoutLabel = `${spec.layout}/${spec.hazard}`;
      }
      const slug = `${s.brand}-${titleKey(s.title).replace(/\s+/g, "-").slice(0, 40)}`;
      const upl = await uploadPNG(`news/${todayISO}/${slug}.png`, png);
      if (upl.ok) { s.image_url = upl.url; s.review = "REVIEW"; console.log(`IMG  ${s.brand} ${layoutLabel} bg=${mode} → ${slug}.png`); }
      else { console.log(`IMG upload fail ${s.brand}: ${upl.status || upl.error || upl.reason}`); }
    } catch (e) { console.log(`IMG err ${s.brand}: ${e.message || e}`); }
  }
} else if (!NO_IMAGES) {
  console.log("images skipped — Supabase env not configured");
}

// 3c. STATE SPOTLIGHT — guaranteed daily coverage of top buyer states (weighted rotation), rendered
// like the news images (Gemini photo hybrid, else the state map). Independent of what news surfaced.
if (!NO_SPOTLIGHT && SPOTLIGHT > 0 && !NO_IMAGES && (await supabaseReady())) {
  const useGemini = !NO_GEMINI && (await geminiReady());
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const states = await pickStates(SPOTLIGHT);
  console.log(`state-spotlight: ${states.map((s) => s.code).join(", ")} (${month})`);
  for (const st of states) {
    try {
      const spec = await buildSpotlightSpec(st, { month });
      let mode = "code";
      if (useGemini && spec.scenePrompt) {
        const bgPng = await generateBackground(spec.scenePrompt);
        if (bgPng) { spec.bgDataUri = `data:image/png;base64,${bgPng.toString("base64")}`; spec.layout = "photo"; spec.callouts = spec.callouts.slice(0, 3); mode = "gemini"; }
      }
      const png = await specToPNG(spec);
      const slug = `spotlight-${st.code.toLowerCase()}-${todayISO}`;
      const upl = await uploadPNG(`news/${todayISO}/${slug}.png`, png);
      if (upl.ok) {
        spotlightRows.push({
          captured_at: todayISO, brand: spec.brand, headline: `State Spotlight: ${st.state}`,
          source: "State Spotlight", url: "", score: st.buyers, t: "", e: "", b: "", u: "", m: "",
          angle: spec._angle, why_now: `Buyer state #${buyerRank(st.code)} (${st.buyers})`,
          image_url: upl.url, review: "REVIEW", status: "spotlight",
        });
        console.log(`SPOT ${st.code} ${spec.hazard} bg=${mode} → ${slug}.png`);
      } else { console.log(`SPOT upload fail ${st.code}: ${upl.status || upl.error || upl.reason}`); }
    } catch (e) { console.log(`SPOT err ${st.code}: ${e.message || e}`); }
  }
}

// 4. write the shortlist to the News tab
const rows = top.map((s) => ({
  captured_at: todayISO,
  brand: s.brand,
  headline: s.title,
  source: s.source || "",
  url: s.link,
  score: s.total,
  t: s.scores.t ?? "", e: s.scores.e ?? "", b: s.scores.b ?? "", u: s.scores.u ?? "", m: s.scores.m ?? "",
  angle: s.angle,
  why_now: s.why,
  image_url: s.image_url || "",
  review: s.review || "",
  status: "new",
}));
const res = await archiveNews([...rows, ...spotlightRows]);
console.log(`\nsheet write (${rows.length} news + ${spotlightRows.length} spotlight): ${JSON.stringify(res)}`);

// 5. seed the seen-store with EVERY headline we considered, so tomorrow won't repeat them
for (const k of consideredKeys) seen.add(k);
await saveSeen(seen);
console.log(`seen-store now ${seen.size} keys`);
