#!/usr/bin/env node
// bin/plan-week.js
import { loadConfig, loadJson } from "../lib/env.js";
import { buildSchedule, toISODate } from "../lib/schedule.js";
import { resolveWeekStart } from "../lib/weekStart.js";
import { writeNote } from "../lib/note.js";

const cfg = await loadConfig();
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
const eligible = map.filter((m) => m.eligible);
const today = toISODate(new Date());
const weekStart = resolveWeekStart(cfg.weekStartMode || "today", today);

const slots = buildSchedule(eligible, weekStart, { tiers: cfg.tiers, timeWindow: cfg.timeWindow });
let created = 0;
for (const slot of slots) {
  await writeNote(cfg.draftsDir, slot);
  created += 1;
}
const byTier = {};
for (const s of slots) byTier[s.tier] = (byTier[s.tier] || 0) + 1;
console.log(`Week ${weekStart}: scaffolded ${created} draft notes for ${eligible.length} eligible pages.`);
console.log("by tier:", byTier);
console.log("dir:", cfg.draftsDir);
