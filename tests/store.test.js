import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordId, writeRecord, readRecord, listRecords, updateRecord } from "../lib/store.js";

function slot() {
  return { page_id: "99", page_name: "Lori Clay", scheduled_date: "2026-06-02", slot_index: 1 };
}

test("recordId is deterministic and slugified", () => {
  assert.equal(recordId(slot()), "2026-06-02__lori-clay__1");
});

test("write/read/list round-trips a record", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "store-"));
  const rec = { id: recordId(slot()), status: "approved", page_id: "99", message: "hi", post_id: "" };
  await writeRecord(dir, rec);
  assert.deepEqual(await readRecord(dir, rec.id), rec);
  const all = await listRecords(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].message, "hi");
});

test("listRecords returns [] for a missing dir", async () => {
  assert.deepEqual(await listRecords(path.join(tmpdir(), "nope-" + process.pid + "-x")), []);
});

test("updateRecord merges a patch and persists it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "store-"));
  const rec = { id: recordId(slot()), status: "approved", post_id: "" };
  await writeRecord(dir, rec);
  const merged = await updateRecord(dir, rec.id, { status: "scheduled", post_id: "99_1" });
  assert.equal(merged.status, "scheduled");
  assert.equal((await readRecord(dir, rec.id)).post_id, "99_1");
});
