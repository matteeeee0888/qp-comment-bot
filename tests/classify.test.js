import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTopic } from "../lib/classify.js";

test("classifies dog campaigns", () => {
  assert.equal(classifyTopic("CCL_DOG || RET"), "dog");
  assert.equal(classifyTopic("TLWF - CBO Test - AT"), "dog");
  assert.equal(classifyTopic("AL.CCLDOG.05.26.KJC.mp4"), "dog");
  assert.equal(classifyTopic("CalmiCollar Fireworks"), "dog");
});

test("classifies cat campaigns and prefers cat over the CCL substring", () => {
  assert.equal(classifyTopic("CCL_CAT || PROSPECTING"), "cat");
  assert.equal(classifyTopic("2026 Cat Launch"), "cat");
});

test("returns null when no topic signal", () => {
  assert.equal(classifyTopic("Holiday Sale"), null);
  assert.equal(classifyTopic(""), null);
  assert.equal(classifyTopic(undefined), null);
});

test("classifies underscore/space-delimited cat names correctly", () => {
  assert.equal(classifyTopic("CAT_LAUNCH_2026"), "cat");
  assert.equal(classifyTopic("BRAND CAT VIDEO"), "cat");
});

test("does NOT classify CATALOG, EDUCATION, VACATION as cat", () => {
  assert.equal(classifyTopic("Spring CATALOG"), null);
});
