import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashBody, isDuplicateBody, isReusedImage, recordUsage, loadDedup, saveDedup, emptyDedup } from "../lib/dedup.js";

test("hashBody is stable and trims", () => {
  assert.equal(hashBody("  hello\n"), hashBody("hello"));
  assert.notEqual(hashBody("a"), hashBody("b"));
});

test("isDuplicateBody / isReusedImage detect prior usage", () => {
  let s = emptyDedup();
  s = recordUsage(s, { pageId: "7", bodyHash: hashBody("cats nap a lot"), imageKey: "http://x/cat.jpg", topic: "cat naps" });
  assert.equal(isDuplicateBody(s, hashBody("cats nap a lot")), true);
  assert.equal(isDuplicateBody(s, hashBody("new text")), false);
  assert.equal(isReusedImage(s, "http://x/cat.jpg"), true);
  assert.equal(isReusedImage(s, "gen"), false, "generated images use key 'gen' and never count as reused");
});

test("recordUsage keeps only the last 20 topics per page", () => {
  let s = emptyDedup();
  for (let i = 0; i < 25; i++) s = recordUsage(s, { pageId: "7", bodyHash: hashBody("b" + i), imageKey: "gen", topic: "t" + i });
  assert.equal(s.recentTopicsByPage["7"].length, 20);
  assert.equal(s.recentTopicsByPage["7"].at(-1), "t24");
});

test("load/save round-trips and load returns empty for a missing file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dd-"));
  const file = path.join(dir, "dedup.json");
  assert.deepEqual(await loadDedup(file), emptyDedup());
  let s = recordUsage(emptyDedup(), { pageId: "7", bodyHash: "h", imageKey: "gen", topic: "t" });
  await saveDedup(file, s);
  assert.deepEqual(await loadDedup(file), s);
});
