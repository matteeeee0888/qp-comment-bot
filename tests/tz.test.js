import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUnix } from "../lib/tz.js";

test("interprets wall-clock time in America/New_York (EDT, summer)", () => {
  // 2026-06-02 14:00 EDT (UTC-4) == 18:00 UTC
  const expected = Math.floor(Date.UTC(2026, 5, 2, 18, 0, 0) / 1000);
  assert.equal(zonedToUnix("2026-06-02", "14:00", "America/New_York"), expected);
});

test("handles standard time (EST, winter)", () => {
  // 2026-01-15 09:00 EST (UTC-5) == 14:00 UTC
  const expected = Math.floor(Date.UTC(2026, 0, 15, 14, 0, 0) / 1000);
  assert.equal(zonedToUnix("2026-01-15", "09:00", "America/New_York"), expected);
});
