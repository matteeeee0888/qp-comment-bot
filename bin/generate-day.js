#!/usr/bin/env node
// bin/generate-day.js — autonomous daily content generator for QuietProtector pages.
// Text via OpenAI chat API, images via gen-image.sh (gpt-image-1), admitted through the
// fill-record dedup gate. Run by cron, then `node bin/publish.js` to schedule on Facebook.
//
// Usage:
//   node bin/generate-day.js                 # fill one day's worth of the soonest scaffolds
//   node bin/generate-day.js --max 2         # fill at most 2 (testing)
//   node bin/generate-day.js --date 2026-06-08
//   node bin/generate-day.js --dry --max 3   # text-only preview, no images, no fill (cheap)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, loadJson } from "../lib/env.js";
import { listRecords } from "../lib/store.js";
import { scaffoldRecords } from "./plan-buffer.js";
import { fillRecord } from "./fill-record.js";
import { toISODate } from "../lib/schedule.js";
import { genJSON, TEXT_ENGINE } from "../lib/text.js";

const pExecFile = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cfg = await loadConfig();
const storeDir = path.resolve(repoRoot, cfg.store.dir);
const workDir = path.resolve(repoRoot, "state/work");
const dedupFile = path.resolve(repoRoot, "state/dedup.json");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MAX = parseInt(getArg("--max", "0"), 10) || 0;
const ONLY_DATE = getArg("--date", "");
const DRY = argv.includes("--dry");
const MODEL = process.env.GEN_TEXT_MODEL || "gpt-4o-mini";
const AUTO_MEMES = cfg.autoMemes === true; // memes (text-in-image) disabled until local Pillow overlay is added

function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function pickSub(id) { const h = hashStr(id) % 100; return h < 45 ? "tip" : h < 70 ? "story" : "news"; }


const SYS = `You write organic Facebook posts for QuietProtector — a calm, friendly home & family emergency-preparedness community for a US audience. Voice: warm, practical, lightly witty, FIRST-PERSON, human; like a real person sharing, never corporate or salesy, never alarming. HARD RULES: US English; NO fear-mongering or doom; NEVER exploit real tragedies or victims; NO claims of any kind (no medical advice, no product efficacy/safety claims like "fireproof"/"will save your life"/"guaranteed", no unverifiable statistics); TOP-OF-FUNNEL ONLY — never name, sell, price, or link a product, and no "buy/shop/sign up" call-to-action; no politics or religion. End most posts with a light, genuine question that invites comments. Keep it concise and natural. Output ONLY valid minified JSON with exactly the requested keys.`;

const PILLAR = {
  blackout: "power outages (flashlights, lanterns, power banks — NOT candles, which are a fire risk; keeping phones and food going, staying comfortable)",
  storm: "severe-weather readiness (hurricanes, winter storms, floods, heat) — calm prep",
  fire: "home fire safety (smoke alarms, escape plans, kitchen safety)",
  preparedness: "general home & family readiness (go-bags, water, documents, plans)",
};
const NEWS = {
  blackout: [["https://www.ready.gov/power-outages", "Ready.gov"], ["https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/power-outage.html", "the Red Cross"]],
  storm: [["https://www.ready.gov/hurricanes", "Ready.gov"], ["https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/hurricane.html", "the Red Cross"], ["https://www.ready.gov/heat", "Ready.gov"]],
  fire: [["https://www.ready.gov/home-fires", "Ready.gov"]],
  preparedness: [["https://www.ready.gov/kit", "Ready.gov"], ["https://www.ready.gov/plan", "Ready.gov"]],
};

const ANGLES = [
  "the gloriously over-prepared person", "the one friend who always panics", "turning the situation into a cozy event",
  "the phone or tech dying at the worst moment", "the family group chat during it",
  "finally being the prepared one for once", "the comedy of NOT being ready", "a small win that saved the day",
  "the parent-vs-kids dynamic", "the smug 'I told you so' moment", "rediscovering low-tech fun",
];
const angle = () => ANGLES[Math.floor(Math.random() * ANGLES.length)];
const nonce = () => Math.floor(Math.random() * 1e6);
const FUNNY = `It must be genuinely funny or relatable — a specific everyday moment or a playful exaggeration — NOT a slogan, PSA, or generic advice. Avoid clichés; do NOT use the phrase "when the lights go out".`;

const memeUser = (p) => `Theme: ${p} — ${PILLAR[p]}. Create a wholesome, RELATABLE preparedness meme (classic top/bottom format). ${FUNNY} Creative angle to take: "${angle()}". Variation seed: ${nonce()}. JSON keys: "top" (short ALL-CAPS top line, <=5 words, no double-quote chars), "bottom" (short ALL-CAPS punchline, <=5 words, no double-quote chars), "scene" (a calm, wholesome, photorealistic scene with PEOPLE and/or objects only — NO animals or pets, NO text of any kind — with clear empty margin space at the very top and very bottom for caption bars), "caption" (the Facebook post text: one witty line + a light "tag a friend"/"save this" prompt).`;
const tipUser = (p) => `Theme: ${p} — ${PILLAR[p]}. Write a practical, genuinely useful preparedness TIP (a tight tip or a 3-item mini-checklist). Take a fresh angle: "${angle()}". Variation seed: ${nonce()}. JSON keys: "caption" (the Facebook post, ending with a save/tag question), "scene" (a calm photorealistic home scene matching the tip — NO text).`;
const storyUser = (p) => `Theme: ${p} — ${PILLAR[p]}. Write a short, warm, true-to-life RELATABLE MOMENT (first-person anecdote) landing on a gentle preparedness takeaway. Fresh angle: "${angle()}". Variation seed: ${nonce()}. JSON keys: "caption" (the Facebook post, ending with a light question), "scene" (a cozy photorealistic scene matching the moment — NO text).`;
const newsUser = (p, url, outlet) => `Theme: ${p}. You are sharing this REAL, reputable resource as a link post: ${url} (from ${outlet}). Write calm 2-3 sentence FRAMING copy: why it's useful + a calm takeaway, then a light question. Do NOT copy the article; no tragedy framing; no sales. Variation seed: ${nonce()}. JSON key: "caption".`;

async function genImage({ meme, top, bottom, scene, dest }) {
  const args = meme
    ? ["bin/gen-image.sh", "--meme", "--top", top, "--bottom", bottom, scene, dest]
    : ["bin/gen-image.sh", scene, dest];
  await pExecFile("bash", args, { cwd: repoRoot, timeout: 180000 });
  return dest;
}

async function buildContent(rec) {
  const p = rec.topic;
  const dest = `/tmp/genday-${rec.id}.png`;
  if (rec.format === "meme" && AUTO_MEMES) {
    const j = await genJSON(SYS, memeUser(p));
    if (!DRY) await genImage({ meme: true, top: j.top, bottom: j.bottom, scene: j.scene, dest });
    return { message: j.caption, imagePath: DRY ? "" : dest, imageSource: DRY ? "none" : "generated", link: "", sub: "meme", preview: j };
  }
  const sub = pickSub(rec.id);
  if (sub === "news") {
    const pool = NEWS[p] || NEWS.preparedness;
    const [url, outlet] = pool[hashStr(rec.id) % pool.length];
    const j = await genJSON(SYS, newsUser(p, url, outlet));
    return { message: j.caption, imagePath: "", imageSource: "none", link: url, sub: "news", preview: { ...j, url } };
  }
  const j = await genJSON(SYS, sub === "tip" ? tipUser(p) : storyUser(p));
  if (!DRY) await genImage({ meme: false, scene: j.scene, dest });
  return { message: j.caption, imagePath: DRY ? "" : dest, imageSource: DRY ? "none" : "generated", link: "", sub, preview: j };
}

// --- main ---
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
await scaffoldRecords({ cfg, map, storeDir, todayISO: toISODate(new Date()) });

let scaffolds = (await listRecords(storeDir)).filter((r) => r.status === "scaffolded");
if (ONLY_DATE) scaffolds = scaffolds.filter((r) => r.scheduled_date === ONLY_DATE);
scaffolds.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || String(a.page_name).localeCompare(String(b.page_name)));
const cap = MAX > 0 ? MAX : map.filter((m) => m.eligible).length;
scaffolds = scaffolds.slice(0, cap);

console.log(`generate-day: ${scaffolds.length} scaffold(s) to fill (text=${TEXT_ENGINE}${DRY ? ", DRY" : ""})`);
let ok = 0;
const issues = [];
for (const rec of scaffolds) {
  try {
    let c = await buildContent(rec);
    if (DRY) {
      console.log(`\n[${rec.scheduled_date} ${rec.scheduled_time}] ${rec.page_name}  (${rec.format}/${c.sub} · ${rec.topic})`);
      console.log(JSON.stringify(c.preview, null, 2));
      ok++;
      continue;
    }
    let r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: c.message, imagePath: c.imagePath, imageSource: c.imageSource, link: c.link });
    if (!r.ok) { // one retry with fresh generation (temperature variation)
      c = await buildContent(rec);
      r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: c.message, imagePath: c.imagePath, imageSource: c.imageSource, link: c.link });
    }
    if (r.ok) { ok++; console.log(`OK   ${rec.scheduled_date} ${rec.scheduled_time} ${rec.page_name} [${c.sub}]`); }
    else { issues.push({ id: rec.id, reason: r.reason }); console.log(`SKIP ${rec.page_name}: ${r.reason}`); }
  } catch (e) {
    issues.push({ id: rec.id, error: String(e.message || e) });
    console.log(`ERR  ${rec.page_name}: ${e.message || e}`);
  }
}
console.log(`\ngenerate-day: ${ok}/${scaffolds.length} ready.${DRY ? " (dry — nothing filled)" : ""}`);
if (issues.length) console.log("issues:", JSON.stringify(issues, null, 2));
