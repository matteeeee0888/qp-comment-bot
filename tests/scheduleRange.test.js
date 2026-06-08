import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScheduleForRange } from "../lib/schedule.js";

const opts = {
  tiers: {
    HIGH: { minActiveAds: 50, daysPattern: [2, 1, 2, 2, 1, 2, 1] },
    MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] },
    LOW: { minActiveAds: 1, daysPattern: [1, 0, 1, 0, 1, 0, 0] },
  },
  timeWindow: { startHour: 8, endHour: 20 },
};
const midPage = [{ page_id: "7", page_name: "Janet Harper", topic: "cat", tier: "MID" }];

test("MID page (all-1 pattern) yields exactly one slot per day across the range", () => {
  const slots = buildScheduleForRange(midPage, "2026-06-01", 7, opts);
  assert.equal(slots.length, 7);
  const dates = [...new Set(slots.map((s) => s.scheduled_date))];
  assert.equal(dates.length, 7);
  assert.equal(dates[0], "2026-06-01");
  assert.equal(dates[6], "2026-06-07");
});

test("cadence is weekday-stable: the same date gives the same count from different start dates", () => {
  // 2026-06-03 is a Wednesday. Generate it once starting 06-01 and once starting 06-03.
  const fromMon = buildScheduleForRange(midPage, "2026-06-01", 7, opts).filter((s) => s.scheduled_date === "2026-06-03");
  const fromWed = buildScheduleForRange(midPage, "2026-06-03", 7, opts).filter((s) => s.scheduled_date === "2026-06-03");
  assert.equal(fromMon.length, fromWed.length);
  assert.deepEqual(fromMon.map((s) => s.scheduled_time), fromWed.map((s) => s.scheduled_time));
});

test("every slot's time is inside the configured window", () => {
  const slots = buildScheduleForRange(midPage, "2026-06-01", 7, opts);
  for (const s of slots) {
    const h = Number(s.scheduled_time.slice(0, 2));
    assert.ok(h >= 8 && h < 20, `time ${s.scheduled_time} out of window`);
  }
});
