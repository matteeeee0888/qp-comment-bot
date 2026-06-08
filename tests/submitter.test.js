import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeRecord, readRecord } from "../lib/store.js";
import { selectApproved, runSubmit } from "../lib/submitter.js";

function fakeMeta(result = { id: "PAGE_POST_1" }) {
  const calls = [];
  return {
    calls,
    async publishPhotoFile(pageId, opts) { calls.push({ fn: "photoFile", pageId, opts }); return result; },
    async publishPhotoUrl(pageId, opts) { calls.push({ fn: "photoUrl", pageId, opts }); return result; },
    async publishFeed(pageId, opts) { calls.push({ fn: "feed", pageId, opts }); return result; },
  };
}

test("selectApproved keeps approved records without a post_id", () => {
  const recs = [
    { id: "a", status: "approved", post_id: "" },
    { id: "b", status: "approved", post_id: "X" },
    { id: "c", status: "draft", post_id: "" },
  ];
  assert.deepEqual(selectApproved(recs).map((r) => r.id), ["a"]);
});

test("runSubmit schedules a future photo record and marks it scheduled", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sub-"));
  const img = path.join(dir, "x.png");
  await writeFile(img, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
  const rec = {
    id: "2026-12-31__lori-clay__0", status: "approved", page_id: "99", page_name: "Lori Clay",
    message: "hello world", image_path: img, image_source: "generated",
    scheduled_date: "2026-12-31", scheduled_time: "14:23", post_id: "", error_reason: "",
  };
  await writeRecord(dir, rec);
  const meta = fakeMeta();
  const res = await runSubmit({ storeDir: dir, meta, timezone: "America/New_York", nowMs: Date.parse("2026-12-01T00:00:00Z") });
  assert.equal(res.scheduled.length, 1);
  assert.equal(meta.calls[0].fn, "photoFile");
  assert.ok(meta.calls[0].opts.scheduledPublishTime > 0);
  assert.equal(meta.calls[0].opts.message, "hello world");
  const after = await readRecord(dir, rec.id);
  assert.equal(after.status, "scheduled");
  assert.equal(after.post_id, "PAGE_POST_1");
});

test("runSubmit publishes a past-dated record immediately (no scheduledPublishTime)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sub-"));
  const rec = {
    id: "2020-01-01__past__0", status: "approved", page_id: "55", page_name: "Past",
    message: "old", image_path: "", image_source: "none",
    scheduled_date: "2020-01-01", scheduled_time: "09:00", post_id: "", error_reason: "",
  };
  await writeRecord(dir, rec);
  const meta = fakeMeta();
  const res = await runSubmit({ storeDir: dir, meta, timezone: "America/New_York", nowMs: Date.parse("2026-12-01T00:00:00Z") });
  assert.equal(res.posted.length, 1);
  assert.equal(meta.calls[0].fn, "feed");
  assert.equal(meta.calls[0].opts.scheduledPublishTime, undefined);
  assert.equal((await readRecord(dir, rec.id)).status, "posted");
});

test("runSubmit isolates a failing record as status=error and continues", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sub-"));
  const rec = {
    id: "2026-12-31__bad__0", status: "approved", page_id: "99", page_name: "Bad",
    message: "x", image_path: "", image_source: "none",
    scheduled_date: "2026-12-31", scheduled_time: "14:23", post_id: "", error_reason: "",
  };
  await writeRecord(dir, rec);
  const meta = { async publishFeed() { throw new Error("boom"); } };
  const res = await runSubmit({ storeDir: dir, meta, timezone: "America/New_York", nowMs: Date.parse("2026-12-01T00:00:00Z"), logger: { log() {}, error() {} } });
  assert.equal(res.errors.length, 1);
  assert.equal((await readRecord(dir, rec.id)).status, "error");
  assert.match((await readRecord(dir, rec.id)).error_reason, /boom/);
});
