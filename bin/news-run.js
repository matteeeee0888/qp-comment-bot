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
import { fetchFeed, titleKey, loadSeen, saveSeen } from "../lib/news.js";
import { scoreCandidates } from "../lib/newsBrain.js";
import { archiveNews } from "../lib/archive.js";
import { TEXT_ENGINE } from "../lib/text.js";

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const NO_LLM = argv.includes("--no-llm");
const TOP = parseInt(getArg("--top", "8"), 10) || 8;
const MAX_AGE_DAYS = parseInt(getArg("--max-age", "3"), 10) || 3;
const POOL_CAP = 40; // most candidates sent to the model in one run (cost ceiling)

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
];

function ageDays(pubDate) {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return 0; // unknown date → treat as fresh, let the model judge
  return (Date.now() - t) / 86400000;
}

console.log(`news-run: text=${TEXT_ENGINE} top=${TOP} maxAge=${MAX_AGE_DAYS}d${DRY ? " DRY" : ""}${NO_LLM ? " NO-LLM" : ""}`);

// 1. discover (feeds fetched sequentially — polite, and 15 feeds is fast enough)
const raw = [];
for (const q of QUERIES) raw.push(...(await fetchFeed(q)));
console.log(`discovered ${raw.length} raw items across ${QUERIES.length} feeds`);

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

// newest first, then cap the pool we pay to score
fresh.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
const pool = fresh.slice(0, POOL_CAP);

if (NO_LLM) {
  console.log(`\n--- ${pool.length} candidates (no scoring) ---`);
  for (const c of pool.slice(0, 25)) console.log(`[${c.query}] ${c.title} — ${c.source} (${c.pubDate})`);
  process.exit(0);
}

// 3. filter + score + angle (Claude)
const scored = await scoreCandidates(pool);
console.log(`${scored.length} passed compliance + scoring`);
const top = scored.slice(0, TOP);
for (const s of top) {
  console.log(`\n[${s.total}/25] ${s.brand}  "${s.title}" (${s.source || "?"})`);
  console.log(`   angle: ${s.angle}`);
  console.log(`   why:   ${s.why}`);
}

if (DRY) { console.log("\n(dry — not writing to the sheet, not seeding the seen-store)"); process.exit(0); }

// 4. write the shortlist to the News tab
const todayISO = new Date().toISOString().slice(0, 10);
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
  status: "new",
}));
const res = await archiveNews(rows);
console.log(`\nsheet write: ${JSON.stringify(res)}`);

// 5. seed the seen-store with EVERY headline we considered, so tomorrow won't repeat them
for (const k of consideredKeys) seen.add(k);
await saveSeen(seen);
console.log(`seen-store now ${seen.size} keys`);
