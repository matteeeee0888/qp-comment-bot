#!/usr/bin/env node
// bin/preview-week.js — READ-ONLY weekly plan preview. Shows what the engine WOULD schedule for the
// eligible pages over the next bufferDays, without writing any records or touching Facebook.
import { loadConfig, loadJson } from "../lib/env.js";
import { buildScheduleForRange, toISODate } from "../lib/schedule.js";

const cfg = await loadConfig();
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
const eligible = map.filter((m) => m.eligible);

const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

const slots = buildScheduleForRange(eligible, toISODate(tomorrow), cfg.bufferDays, {
  tiers: cfg.tiers,
  timeWindow: cfg.timeWindow,
  memeShare: cfg.memeShare ?? 0.5,
});

const byPage = {};
const pillars = {};
const formats = {};
for (const s of slots) {
  byPage[s.page_name] = (byPage[s.page_name] || 0) + 1;
  pillars[s.topic] = (pillars[s.topic] || 0) + 1;
  formats[s.format] = (formats[s.format] || 0) + 1;
}

console.log(`\nWeekly plan preview — ${slots.length} posts across ${eligible.length} pages (next ${cfg.bufferDays} days)\n`);
console.log("Posts per page / week:");
console.table(
  Object.entries(byPage)
    .sort((a, b) => b[1] - a[1])
    .map(([page, posts]) => ({ page, posts }))
);
console.log("Pillar mix:", pillars);
console.log("Format mix (meme = humor, fact = tip/relatable/news):", formats);
console.log("\nFirst 14 slots (sample):");
console.table(
  slots.slice(0, 14).map((s) => ({
    page: s.page_name,
    date: s.scheduled_date,
    time: s.scheduled_time,
    pillar: s.topic,
    format: s.format,
  }))
);
