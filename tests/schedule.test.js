import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, toISODate } from "../lib/schedule.js";

const opts = {
  tiers: {
    HIGH: { minActiveAds: 50, daysPattern: [2, 1, 2, 2, 1, 2, 1] },
    MID: { minActiveAds: 10, daysPattern: [1, 1, 1, 1, 1, 1, 1] },
    LOW: { minActiveAds: 1, daysPattern: [1, 0, 1, 0, 1, 0, 0] },
  },
  timeWindow: { startHour: 8, endHour: 20 },
};

test("toISODate formats local date", () => {
  assert.equal(toISODate(new Date("2026-06-02T00:00:00")), "2026-06-02");
});

test("HIGH page gets the pattern's weekly total with varied daily counts", () => {
  const pages = [{ page_id: "1", page_name: "Lori Clay", topic: "dog", tier: "HIGH" }];
  const slots = buildSchedule(pages, "2026-06-01", opts);
  assert.equal(slots.length, 11);
  const byDate = {};
  for (const s of slots) byDate[s.scheduled_date] = (byDate[s.scheduled_date] || 0) + 1;
  const counts = Object.values(byDate);
  assert.ok(counts.includes(2));
  assert.ok(counts.includes(1));
});

test("every slot has a time inside the window and times differ within a day", () => {
  const pages = [{ page_id: "1", page_name: "Lori Clay", topic: "dog", tier: "HIGH" }];
  const slots = buildSchedule(pages, "2026-06-01", opts);
  for (const s of slots) {
    const [h] = s.scheduled_time.split(":").map(Number);
    assert.ok(h >= 8 && h < 20, `time ${s.scheduled_time} in window`);
  }
  const day0 = slots.filter((s) => s.scheduled_date === slots[0].scheduled_date);
  if (day0.length === 2) assert.notEqual(day0[0].scheduled_time, day0[1].scheduled_time);
});

test("LOW page posts only ~3 days/week", () => {
  const pages = [{ page_id: "9", page_name: "Margot Malpass", topic: "dog", tier: "LOW" }];
  const slots = buildSchedule(pages, "2026-06-01", opts);
  assert.equal(slots.length, 3);
});

test("'both' topic rotates QP content pillars", () => {
  const pages = [{ page_id: "3", page_name: "Sofia Rossi", topic: "both", tier: "MID" }];
  const slots = buildSchedule(pages, "2026-06-01", opts);
  const topics = new Set(slots.map((s) => s.topic));
  const PILLARS = ["blackout", "storm", "fire", "preparedness"];
  assert.ok(topics.size >= 2, `expected multiple pillars, got ${[...topics]}`);
  for (const t of topics) assert.ok(PILLARS.includes(t), `unexpected pillar ${t}`);
});

test("every slot is tagged meme or fact", () => {
  const pages = [{ page_id: "1", page_name: "Lori Clay", topic: "dog", tier: "HIGH" }];
  const slots = buildSchedule(pages, "2026-06-01", opts);
  assert.ok(slots.every((s) => s.format === "meme" || s.format === "fact"));
});

test("memeShare controls the meme/fact mix (0.7 ≈ 70% memes, evenly spread)", () => {
  // Many pages × a week → a large sample so the ratio is meaningful.
  const pages = Array.from({ length: 20 }, (_, i) => ({
    page_id: String(1000 + i), page_name: `P${i}`, topic: "dog", tier: "HIGH",
  }));
  const slots = buildSchedule(pages, "2026-06-01", { ...opts, memeShare: 0.7 });
  const memes = slots.filter((s) => s.format === "meme").length;
  const ratio = memes / slots.length;
  assert.ok(ratio > 0.6 && ratio < 0.8, `expected ~0.70 memes, got ${ratio.toFixed(2)} (${memes}/${slots.length})`);
});

test("memeShare 0 yields no memes, 1 yields all memes", () => {
  const pages = [{ page_id: "1", page_name: "Lori Clay", topic: "dog", tier: "HIGH" }];
  const none = buildSchedule(pages, "2026-06-01", { ...opts, memeShare: 0 });
  assert.ok(none.every((s) => s.format === "fact"));
  const all = buildSchedule(pages, "2026-06-01", { ...opts, memeShare: 1 });
  assert.ok(all.every((s) => s.format === "meme"));
});
