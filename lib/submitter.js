// lib/submitter.js — submit approved store records to Facebook's scheduler.
import { listRecords, updateRecord } from "./store.js";
import { zonedToUnix } from "./tz.js";

const TEN_MIN = 600;

export function selectApproved(records) {
  return records.filter((r) => r.status === "approved" && !r.post_id);
}

export async function submitRecord(record, meta, { storeDir, timezone, nowMs = Date.now() }) {
  const { id, page_id, image_path, image_source, scheduled_date, scheduled_time, message, link } = record;
  let scheduledPublishTime;
  if (scheduled_date && scheduled_time) {
    const unix = zonedToUnix(scheduled_date, scheduled_time, timezone);
    if (unix >= Math.floor(nowMs / 1000) + TEN_MIN) scheduledPublishTime = unix;
  }
  const willSchedule = scheduledPublishTime !== undefined;
  const opts = willSchedule ? { scheduledPublishTime } : {};
  await updateRecord(storeDir, id, { status: "submitting" });
  let result;
  if (image_path && image_source && image_source !== "none") {
    if (/^https?:\/\//.test(image_path)) {
      result = await meta.publishPhotoUrl(page_id, { message, imageUrl: image_path, ...opts });
    } else {
      result = await meta.publishPhotoFile(page_id, { message, imagePath: image_path, ...opts });
    }
  } else {
    result = await meta.publishFeed(page_id, { message, link, ...opts });
  }
  const post_id = result.post_id || result.id;
  await updateRecord(storeDir, id, { status: willSchedule ? "scheduled" : "posted", post_id, error_reason: "" });
  return { post_id, scheduled: willSchedule };
}

export async function runSubmit({ storeDir, meta, timezone, nowMs = Date.now(), logger = console }) {
  const todo = selectApproved(await listRecords(storeDir));
  const results = { scheduled: [], posted: [], errors: [] };
  for (const record of todo) {
    try {
      const r = await submitRecord(record, meta, { storeDir, timezone, nowMs });
      (r.scheduled ? results.scheduled : results.posted).push({ id: record.id, post_id: r.post_id });
      logger.log(`${r.scheduled ? "scheduled" : "posted"} ${record.page_name} -> ${r.post_id}`);
    } catch (e) {
      await updateRecord(storeDir, record.id, { status: "error", error_reason: String(e.message || e) });
      results.errors.push({ id: record.id, error: String(e.message || e) });
      logger.error(`error ${record.page_name}: ${e.message || e}`);
    }
  }
  return results;
}
