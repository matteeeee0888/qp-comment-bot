import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { hashBody, isDuplicateBody, isReusedImage, recordUsage, loadDedup, saveDedup, emptyDedup, isLinkTakenOnDate, hashScene, isSceneRecentlyUsed } from "../lib/dedup.js";

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
  let s = recordUsage(emptyDedup(), { pageId: "7", bodyHash: "h", imageKey: "gen", topic: "t", date: "2026-07-20" });
  await saveDedup(file, s);
  assert.deepEqual(await loadDedup(file), s);
});

test("link is taken on the same date only (anti-collision)", () => {
  let s = emptyDedup();
  const url = "https://www.ready.gov/plan";
  assert.equal(isLinkTakenOnDate(s, "2026-07-20", url), false);
  s = recordUsage(s, { pageId: "7", bodyHash: hashBody("a"), imageKey: "gen", topic: "preparedness", link: url, date: "2026-07-20" });
  assert.equal(isLinkTakenOnDate(s, "2026-07-20", url), true, "same day -> taken");
  assert.equal(isLinkTakenOnDate(s, "2026-07-21", url), false, "different day -> free");
  assert.equal(isLinkTakenOnDate(s, "2026-07-20", "https://www.ready.gov/kit"), false, "different url -> free");
});

test("scene reuse is blocked within the 45-day window, allowed after", () => {
  let s = emptyDedup();
  const h = hashScene("a lantern on a table, warm lamp light");
  s = recordUsage(s, { pageId: "7", bodyHash: hashBody("b"), imageKey: "gen", topic: "blackout", sceneHash: h, date: "2026-06-01" });
  assert.equal(isSceneRecentlyUsed(s, h, "2026-06-20"), true, "19 days later -> still blocked");
  assert.equal(isSceneRecentlyUsed(s, h, "2026-08-01"), false, "61 days later -> allowed");
  assert.equal(isSceneRecentlyUsed(s, hashScene("something else"), "2026-06-20"), false);
});

test("legacy dedup.json without the new fields still loads and works", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dd-"));
  const file = path.join(dir, "dedup.json");
  await writeFile(file, JSON.stringify({ bodyHashes: ["x"], imageKeys: [], recentTopicsByPage: {} }));
  const s = await loadDedup(file);
  assert.deepEqual(s.linkDayKeys, []);
  assert.deepEqual(s.sceneUses, []);
  assert.equal(isLinkTakenOnDate(s, "2026-07-20", "https://x"), false);
});

test("old-window link keys are pruned, scene keys kept up to 45 days", () => {
  let s = emptyDedup();
  s = recordUsage(s, { pageId: "7", bodyHash: hashBody("old"), imageKey: "gen", topic: "fire", link: "https://old", date: "2026-06-01", sceneHash: hashScene("old scene") });
  // a later usage prunes relative to its own date
  s = recordUsage(s, { pageId: "7", bodyHash: hashBody("new"), imageKey: "gen", topic: "fire", link: "https://new", date: "2026-07-01" });
  assert.ok(!s.linkDayKeys.some((k) => k.includes("https://old")), "link key >14 days old is pruned");
  assert.ok(s.sceneUses.some((u) => u.date === "2026-06-01"), "scene use <45 days old is kept");
});
