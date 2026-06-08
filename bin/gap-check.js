#!/usr/bin/env node
// bin/gap-check.js — NO AI, NO network. Prints "FULL" if the queue is filled to the
// horizon for every eligible page; otherwise prints the missing-slot count. The Plan 2
// wrapper reads stdout to decide whether to spin up `claude -p`. Pure function
// `gapReport` is unit-tested.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadJson } from "../lib/env.js";
import { listRecords } from "../lib/store.js";
import { planBuffer } from "../lib/buffer.js";
import { toISODate } from "../lib/schedule.js";

export function gapReport({ cfg, map, records, todayISO }) {
  const eligible = map.filter((m) => m.eligible);
  const slots = planBuffer(eligible, records, todayISO, cfg.bufferDays, {
    tiers: cfg.tiers,
    timeWindow: cfg.timeWindow,
  });
  return { full: slots.length === 0, missing: slots.length, slots };
}

// Only run IO when executed directly (so tests can import gapReport cleanly).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = await loadConfig();
  const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const storeDir = path.resolve(repoRoot, cfg.store.dir);
  const records = await listRecords(storeDir);
  const todayISO = toISODate(new Date());
  const r = gapReport({ cfg, map, records, todayISO });
  console.log(r.full ? "FULL" : `GAP missing=${r.missing}`);
}
