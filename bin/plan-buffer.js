#!/usr/bin/env node
// bin/plan-buffer.js — scaffold empty "scaffolded" records for each missing buffer slot.
// The Plan 2 AI step fills message + image and flips status to "approved". The publisher
// only ships "approved", so a scaffold never publishes as an empty post by accident.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadJson } from "../lib/env.js";
import { listRecords, writeRecord, recordId } from "../lib/store.js";
import { planBuffer } from "../lib/buffer.js";
import { toISODate } from "../lib/schedule.js";

export async function scaffoldRecords({ cfg, map, storeDir, todayISO }) {
  // Fill highest-volume pages first: with maxScaffoldsPerRun capping each run, the most
  // active pages (most ads → most reach) should get their buffer before dormant ones.
  // Ties broken by page_id for deterministic ordering.
  const eligible = map
    .filter((m) => m.eligible)
    .sort(
      (a, b) =>
        (b.active_ads || 0) - (a.active_ads || 0) || String(a.page_id).localeCompare(String(b.page_id))
    );
  const existing = await listRecords(storeDir);
  const slots = planBuffer(eligible, existing, todayISO, cfg.bufferDays, {
    tiers: cfg.tiers,
    timeWindow: cfg.timeWindow,
    memeShare: cfg.memeShare ?? 0.5,
  });
  const existingIds = new Set(existing.map((r) => r.id));
  // Cap NEW scaffolds per run so the first run on an empty store doesn't try to generate
  // the whole 7-day buffer at once; the buffer ramps up over several runs instead.
  const max = cfg.maxScaffoldsPerRun || Infinity;
  let created = 0;
  for (const slot of slots) {
    if (created >= max) break;
    const id = recordId(slot);
    if (existingIds.has(id)) continue;
    await writeRecord(storeDir, {
      id,
      status: "scaffolded",
      page_id: slot.page_id,
      page_name: slot.page_name,
      topic: slot.topic,
      format: slot.format || "fact",
      tier: slot.tier,
      scheduled_date: slot.scheduled_date,
      scheduled_time: slot.scheduled_time,
      message: "",
      image_path: "",
      image_source: "none",
      source_url: "",
      link: "",
      post_id: "",
      error_reason: "",
      body_hash: "",
      image_key: "",
    });
    created += 1;
  }
  return created;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = await loadConfig();
  const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const storeDir = path.resolve(repoRoot, cfg.store.dir);
  const todayISO = toISODate(new Date());
  const n = await scaffoldRecords({ cfg, map, storeDir, todayISO });
  console.log(`scaffolded ${n} record(s) into ${cfg.store.dir}`);
}
