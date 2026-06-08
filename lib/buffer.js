// lib/buffer.js — decide which post slots are needed to keep each eligible page's
// Facebook queue filled from tomorrow through (today + bufferDays).
import { toISODate, buildScheduleForRange } from "./schedule.js";

// Statuses that count as "this date is already covered in the queue".
const COVERING = new Set(["approved", "submitting", "scheduled", "posted"]);

export function coveredThrough(records) {
  const byPage = {};
  for (const r of records) {
    if (!COVERING.has(r.status)) continue;
    if (!byPage[r.page_id] || r.scheduled_date > byPage[r.page_id]) {
      byPage[r.page_id] = r.scheduled_date;
    }
  }
  return byPage;
}

export function planBuffer(eligiblePages, records, todayISO, bufferDays, opts) {
  const covered = coveredThrough(records);
  const today = new Date(`${todayISO}T00:00:00`);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowISO = toISODate(tomorrow);
  // Horizon = [tomorrow .. today+bufferDays] inclusive = bufferDays calendar days.
  const horizon = buildScheduleForRange(eligiblePages, tomorrowISO, bufferDays, opts);
  return horizon.filter((slot) => {
    const cov = covered[slot.page_id];
    return !cov || slot.scheduled_date > cov;
  });
}
