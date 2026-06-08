import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeRecord, readRecord } from "../lib/store.js";
import { loadDedup } from "../lib/dedup.js";
import { fillRecord } from "../bin/fill-record.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000)]);

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "fr-"));
  const storeDir = path.join(dir, "posts");
  const workDir = path.join(dir, "work");
  const dedupFile = path.join(dir, "dedup.json");
  const rec = {
    id: "2026-06-02__janet-harper__0", status: "scaffolded", page_id: "7", page_name: "Janet Harper",
    topic: "cat", tier: "MID", scheduled_date: "2026-06-02", scheduled_time: "09:17",
    message: "", image_path: "", image_source: "none", source_url: "", post_id: "",
    error_reason: "", body_hash: "", image_key: "",
  };
  await writeRecord(storeDir, rec);
  const img = path.join(dir, "src.png");
  await writeFile(img, PNG);
  return { storeDir, workDir, dedupFile, rec, img };
}

test("admits a clean scaffold to approved, copies image, records dedup", async () => {
  const { storeDir, workDir, dedupFile, rec, img } = await setup();
  const r = await fillRecord({
    storeDir, workDir, dedupFile, id: rec.id,
    message: "Cats sleep 16 hours a day — here's why.", imagePath: img,
    imageSource: "generated", sourceUrl: "https://example.com/x",
  });
  assert.equal(r.ok, true);
  const after = await readRecord(storeDir, rec.id);
  assert.equal(after.status, "approved");
  assert.equal(after.message, "Cats sleep 16 hours a day — here's why.");
  assert.ok(after.image_path.startsWith(workDir));
  assert.equal(after.image_source, "generated");
  const dd = await loadDedup(dedupFile);
  assert.equal(dd.bodyHashes.length, 1);
  assert.equal(dd.recentTopicsByPage["7"][0], "cat");
});

test("rejects an empty message", async () => {
  const { storeDir, workDir, dedupFile, rec, img } = await setup();
  const r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: "   ", imagePath: img, imageSource: "generated", sourceUrl: "" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /message/i);
  assert.equal((await readRecord(storeDir, rec.id)).status, "scaffolded");
});

test("rejects a duplicate body", async () => {
  const { storeDir, workDir, dedupFile, rec, img } = await setup();
  await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: "same text", imagePath: img, imageSource: "generated", sourceUrl: "" });
  const rec2 = { ...rec, id: "2026-06-03__janet-harper__0", scheduled_date: "2026-06-03" };
  await writeRecord(storeDir, rec2);
  const r = await fillRecord({ storeDir, workDir, dedupFile, id: rec2.id, message: "same text", imagePath: img, imageSource: "generated", sourceUrl: "" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /duplicate/i);
});

test("rejects an invalid image", async () => {
  const { storeDir, workDir, dedupFile, rec } = await setup();
  const r = await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: "good text here", imagePath: "/no/such.png", imageSource: "generated", sourceUrl: "" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /image/i);
});

test("rejects a reused sourced image", async () => {
  const { storeDir, workDir, dedupFile, rec, img } = await setup();
  await fillRecord({ storeDir, workDir, dedupFile, id: rec.id, message: "first", imagePath: img, imageSource: "sourced", sourceUrl: "https://src/cat.jpg" });
  const rec2 = { ...rec, id: "2026-06-04__janet-harper__0", scheduled_date: "2026-06-04" };
  await writeRecord(storeDir, rec2);
  const r = await fillRecord({ storeDir, workDir, dedupFile, id: rec2.id, message: "second", imagePath: img, imageSource: "sourced", sourceUrl: "https://src/cat.jpg" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /reused|image/i);
});
