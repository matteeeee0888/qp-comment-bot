// lib/weekStart.js
import { toISODate } from "./schedule.js";

export function resolveWeekStart(mode, todayISO) {
  if (mode === "next-monday") {
    const today = new Date(`${todayISO}T00:00:00`);
    const day = today.getDay(); // 0 Sun .. 6 Sat
    const delta = (8 - day) % 7 || 7;
    const d = new Date(today);
    d.setDate(today.getDate() + delta);
    return toISODate(d);
  }
  return todayISO;
}
