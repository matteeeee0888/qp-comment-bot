import { test } from "node:test";
import assert from "node:assert/strict";
import { coveredThrough, planBuffer } from "../lib/buffer.js";

const opts = {
  tiers: { MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] } },
  timeWindow: { startHour: 8, endHour: 20 },
};
const pages = [{ page_id: "7", page_name: "Janet Harper", topic: "cat", tier: "MID" }];

test("coveredThrough takes the max scheduled_date per page among queue-covering statuses", () => {
  const records = [
    { page_id: "7", status: "scheduled", scheduled_date: "2026-06-03" },
    { page_id: "7", status: "posted", scheduled_date: "2026-06-05" },
    { page_id: "7", status: "error", scheduled_date: "2026-06-09" }, // ignored
    { page_id: "8", status: "approved", scheduled_date: "2026-06-04" },
  ];
  assert.deepEqual(coveredThrough(records), { "7": "2026-06-05", "8": "2026-06-04" });
});

test("planBuffer fills tomorrow..today+bufferDays for an uncovered page", () => {
  // MID = 1/day, bufferDays 7, no existing records -> 7 slots, dates 06-02..06-08
  const slots = planBuffer(pages, [], "2026-06-01", 7, opts);
  const dates = slots.map((s) => s.scheduled_date);
  assert.equal(slots.length, 7);
  assert.equal(dates[0], "2026-06-02");
  assert.equal(dates[6], "2026-06-08");
});

test("planBuffer generates nothing already covered to the horizon", () => {
  const records = [{ page_id: "7", status: "scheduled", scheduled_date: "2026-06-08" }];
  const slots = planBuffer(pages, records, "2026-06-01", 7, opts);
  assert.equal(slots.length, 0);
});

test("planBuffer fills only the uncovered tail", () => {
  const records = [{ page_id: "7", status: "scheduled", scheduled_date: "2026-06-05" }];
  const slots = planBuffer(pages, records, "2026-06-01", 7, opts);
  // covered through 06-05 -> need 06-06, 06-07, 06-08
  assert.deepEqual(slots.map((s) => s.scheduled_date), ["2026-06-06", "2026-06-07", "2026-06-08"]);
});
