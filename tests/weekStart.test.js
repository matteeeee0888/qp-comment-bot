import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWeekStart } from "../lib/weekStart.js";

test("'today' mode returns today", () => {
  assert.equal(resolveWeekStart("today", "2026-06-03"), "2026-06-03");
});

test("'next-monday' returns the upcoming Monday", () => {
  // 2026-06-03 is a Wednesday -> next Monday 2026-06-08
  assert.equal(resolveWeekStart("next-monday", "2026-06-03"), "2026-06-08");
});
