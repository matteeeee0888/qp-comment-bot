import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scaffoldRecords } from "../bin/plan-buffer.js";
import { listRecords, updateRecord } from "../lib/store.js";

const cfg = {
  bufferDays: 7,
  tiers: { MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] } },
  timeWindow: { startHour: 8, endHour: 20 },
};
const map = [{ page_id: "7", page_name: "Janet Harper", topic: "cat", tier: "MID", eligible: true }];

test("scaffoldRecords writes one scaffolded record per missing slot", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "plan-"));
  const n = await scaffoldRecords({ cfg, map, storeDir: dir, todayISO: "2026-06-01" });
  assert.equal(n, 7);
  const recs = await listRecords(dir);
  assert.equal(recs.length, 7);
  assert.equal(recs[0].status, "scaffolded");
  assert.equal(recs[0].message, "");
  assert.equal(recs[0].image_source, "none");
  assert.ok(recs[0].id.includes("janet-harper"));
  assert.ok(recs.every((r) => r.format === "meme" || r.format === "fact"), "every scaffold has a format");
});

test("scaffoldRecords caps new scaffolds at cfg.maxScaffoldsPerRun", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "plan-"));
  const capped = { ...cfg, maxScaffoldsPerRun: 2 };
  const n = await scaffoldRecords({ cfg: capped, map, storeDir: dir, todayISO: "2026-06-01" });
  assert.equal(n, 2, "only 2 created despite a 7-slot gap");
  // a second run fills 2 more (buffer ramps up over runs)
  const n2 = await scaffoldRecords({ cfg: capped, map, storeDir: dir, todayISO: "2026-06-01" });
  assert.equal(n2, 2);
  assert.equal((await listRecords(dir)).length, 4);
});

test("scaffoldRecords fills higher-active-ads pages first when capped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "plan-"));
  const cfg2 = {
    bufferDays: 7,
    maxScaffoldsPerRun: 3,
    tiers: { MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] } },
    timeWindow: { startHour: 8, endHour: 20 },
  };
  // Map order deliberately puts the low-volume page first to prove sorting (not input order) wins.
  const map2 = [
    { page_id: "low", page_name: "Quiet Co", topic: "dog", tier: "MID", eligible: true, active_ads: 5 },
    { page_id: "high", page_name: "Loud Co", topic: "dog", tier: "MID", eligible: true, active_ads: 200 },
  ];
  await scaffoldRecords({ cfg: cfg2, map: map2, storeDir: dir, todayISO: "2026-06-01" });
  const recs = await listRecords(dir);
  assert.equal(recs.length, 3);
  assert.ok(
    recs.every((r) => r.page_id === "high"),
    "the 3 capped scaffolds all go to the higher-volume page"
  );
});

test("scaffoldRecords is idempotent — re-running adds nothing when full", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "plan-"));
  await scaffoldRecords({ cfg, map, storeDir: dir, todayISO: "2026-06-01" });
  // Mark them as scheduled so they count as covering, then re-run:
  const recs = await listRecords(dir);
  for (const r of recs) await updateRecord(dir, r.id, { status: "scheduled" });
  const n2 = await scaffoldRecords({ cfg, map, storeDir: dir, todayISO: "2026-06-01" });
  assert.equal(n2, 0);
});
