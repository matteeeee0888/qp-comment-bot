#!/usr/bin/env node
// bin/generate-day.js — autonomous daily content generator for QuietProtector pages.
// A per-page WEEKLY MIX so 17 pages never look like one writer (content logic lives in
// lib/postContent.js — this file is the orchestrator over the record store):
//   story  — pure first-person text, no link (the most human)
//   link   — a reputable preparedness link (anti-collision: no two pages share a URL on the same day)
//   photo  — a photoreal "casual smartphone photo" (Gemini, free) uploaded to Supabase, no text/logos
//
// Usage:
//   node bin/generate-day.js                       # fill one day's worth of the soonest scaffolds
//   node bin/generate-day.js --max 2               # fill at most 2 (testing)
//   node bin/generate-day.js --dry --max 8         # preview only, no fill (text is cheap; photo skipped)
//   node bin/generate-day.js --dry --max 2 --type photo   # force photo + actually gen/upload (smoke test)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadJson } from "../lib/env.js";
import { listRecords } from "../lib/store.js";
import { scaffoldRecords } from "./plan-buffer.js";
import { fillRecord } from "./fill-record.js";
import { toISODate } from "../lib/schedule.js";
import { TEXT_ENGINE } from "../lib/text.js";
import { geminiReady } from "../lib/gemini.js";
import { supabaseReady } from "../lib/supabase.js";
import { loadDedup } from "../lib/dedup.js";
import { buildPost } from "../lib/postContent.js";

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
const FORCE_TYPE = getArg("--type", "");     // story | link | photo (testing)
const DRY_SKIP_PHOTO = DRY && FORCE_TYPE !== "photo"; // dry preview stays cheap unless smoke-testing photos

const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
await scaffoldRecords({ cfg, map, storeDir, todayISO: toISODate(new Date()) });

let scaffolds = (await listRecords(storeDir)).filter((r) => r.status === "scaffolded");
if (ONLY_DATE) scaffolds = scaffolds.filter((r) => r.scheduled_date === ONLY_DATE);
scaffolds.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || String(a.page_name).localeCompare(String(b.page_name)));
const cap = MAX > 0 ? MAX : map.filter((m) => m.eligible).length;
scaffolds = scaffolds.slice(0, cap);

const canPhoto = !DRY_SKIP_PHOTO && (await geminiReady()) && (await supabaseReady());
const dedup0 = await loadDedup(dedupFile);
const takenToday = new Set(dedup0.linkDayKeys || []);
const opts = (attempt) => ({ attempt, canPhoto, takenToday, forceType: FORCE_TYPE });

console.log(`generate-day: ${scaffolds.length} scaffold(s) to fill (text=${TEXT_ENGINE}, photo=${canPhoto ? "on" : "off"}${DRY ? ", DRY" : ""}${FORCE_TYPE ? `, force=${FORCE_TYPE}` : ""})`);
let ok = 0;
const issues = [];
const tally = { story: 0, link: 0, photo: 0 };
for (const rec of scaffolds) {
  try {
    let c = await buildPost(rec, opts(0));
    if (DRY) {
      console.log(`\n[${rec.scheduled_date} ${rec.scheduled_time}] ${rec.page_name}  (${c.type} · ${rec.topic})`);
      console.log(JSON.stringify(c.preview, null, 2));
      tally[c.type] = (tally[c.type] || 0) + 1; ok++;
      continue;
    }
    let r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: c.message, imagePath: c.imagePath, imageSource: c.imageSource, link: c.link, postType: c.type, scene: c.scene, sceneHash: c.sceneHash });
    if (!r.ok) { // one retry with a fresh seed (attempt=1)
      c = await buildPost(rec, opts(1));
      r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: c.message, imagePath: c.imagePath, imageSource: c.imageSource, link: c.link, postType: c.type, scene: c.scene, sceneHash: c.sceneHash });
    }
    if (r.ok) {
      ok++; tally[c.type] = (tally[c.type] || 0) + 1;
      if (c.type === "link" && c.url) takenToday.add(`${rec.scheduled_date}|${c.url}`);
      console.log(`OK   ${rec.scheduled_date} ${rec.scheduled_time} ${rec.page_name} [${c.type}]${c.url ? " " + c.url : ""}`);
    } else { issues.push({ id: rec.id, reason: r.reason }); console.log(`SKIP ${rec.page_name}: ${r.reason}`); }
  } catch (e) {
    issues.push({ id: rec.id, error: String(e.message || e) });
    console.log(`ERR  ${rec.page_name}: ${e.message || e}`);
  }
}
console.log(`\ngenerate-day: ${ok}/${scaffolds.length} ready (story ${tally.story} · link ${tally.link} · photo ${tally.photo}).${DRY ? " (dry — nothing filled)" : ""}`);
if (issues.length) console.log("issues:", JSON.stringify(issues, null, 2));
