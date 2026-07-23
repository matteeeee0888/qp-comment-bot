import { test } from "node:test";
import assert from "node:assert/strict";
import { TYPE_WHEEL, postTypeFor } from "../lib/persona.js";

test("the wheel holds exactly 6 story / 5 link / 3 photo over 14 days", () => {
  const counts = TYPE_WHEEL.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {});
  assert.equal(TYPE_WHEEL.length, 14);
  assert.deepEqual(counts, { story: 6, link: 5, photo: 3 });
});

test("each page cycles through all three types over 14 days in the right proportion", () => {
  const counts = { story: 0, link: 0, photo: 0 };
  const start = Date.parse("2026-07-20T00:00:00Z");
  for (let i = 0; i < 14; i++) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    counts[postTypeFor("1234567890", date)]++;
  }
  assert.deepEqual(counts, { story: 6, link: 5, photo: 3 });
});

test("postTypeFor is deterministic and offset per page", () => {
  assert.equal(postTypeFor("abc", "2026-07-20"), postTypeFor("abc", "2026-07-20"));
  // Across several pages on one date, more than one distinct type should appear (they're spread).
  const types = new Set(["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => postTypeFor(id, "2026-07-20")));
  assert.ok(types.size >= 2, `pages should not all get the same type on a given day, got ${[...types]}`);
});
