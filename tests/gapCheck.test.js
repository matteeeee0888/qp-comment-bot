import { test } from "node:test";
import assert from "node:assert/strict";
import { gapReport } from "../bin/gap-check.js";

const cfg = {
  bufferDays: 7,
  tiers: { MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] } },
  timeWindow: { startHour: 8, endHour: 20 },
};
const map = [
  { page_id: "7", page_name: "Janet Harper", topic: "cat", tier: "MID", eligible: true },
  { page_id: "8", page_name: "Excluded", topic: "dog", tier: "MID", eligible: false },
];

test("gapReport reports a gap when nothing is scheduled", () => {
  const r = gapReport({ cfg, map, records: [], todayISO: "2026-06-01" });
  assert.equal(r.full, false);
  assert.equal(r.missing, 7); // only the eligible page, 1/day x 7 days
});

test("gapReport reports full when covered to the horizon", () => {
  const records = [{ page_id: "7", status: "scheduled", scheduled_date: "2026-06-08" }];
  const r = gapReport({ cfg, map, records, todayISO: "2026-06-01" });
  assert.equal(r.full, true);
  assert.equal(r.missing, 0);
});
