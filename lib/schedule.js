// lib/schedule.js
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hashStr(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function rotate(arr, n) {
  const k = ((n % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

// QuietProtector content pillars. A page mapped to "both" rotates through these so each page's feed
// spans every preparedness theme; a per-page offset staggers the starting pillar so all four stay
// balanced even for pages with few weekly slots. A page pinned to a single pillar (via the map) keeps it.
const QP_PILLARS = ["blackout", "storm", "fire", "preparedness"];
function resolveTopic(topic, idx, pageId = "") {
  if (topic === "both") return QP_PILLARS[(idx + hashStr(pageId)) % QP_PILLARS.length];
  // Safety net: any non-QP topic (e.g. a stray "dog"/"cat" from ad classification) must never
  // pass through undefined into the QP content pillars — map it into the normal rotation.
  if (!QP_PILLARS.includes(topic)) return QP_PILLARS[(idx + hashStr(pageId)) % QP_PILLARS.length];
  return topic;
}

// Decide a slot's format so that ~`memeShare` of posts are memes and the rest are photo + fun-fact.
// Uses an integer Bresenham-style spread so the minority format is distributed evenly (not clustered
// at the end), and offsets by a per-page hash so pages don't all start on the same format.
function resolveFormat(idx, pageId, memeShare = 0.5) {
  const factPct = Math.round((1 - memeShare) * 100);
  const i = idx + (hashStr(pageId) % 100);
  const isFact = Math.floor((i * factPct) / 100) !== Math.floor(((i + 1) * factPct) / 100);
  return isFact ? "fact" : "meme";
}

// Spread `count` post times across [startHour,endHour) with a per-page/day jitter.
function assignTimes(count, window, pageId, day) {
  const startMin = window.startHour * 60;
  const span = window.endHour * 60 - startMin;
  const seg = Math.floor(span / count);
  const times = [];
  for (let i = 0; i < count; i++) {
    const base = startMin + i * seg;
    const jitter = seg > 1 ? hashStr(`${pageId}:${day}:${i}`) % seg : 0;
    const t = base + jitter;
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    times.push(`${hh}:${mm}`);
  }
  return times;
}

// pages: [{ page_id, page_name, topic, tier }]; weekStart "YYYY-MM-DD"
export function buildSchedule(pages, weekStart, opts) {
  const { tiers, timeWindow, memeShare } = opts;
  const start = new Date(`${weekStart}T00:00:00`);
  const slots = [];
  for (const page of pages) {
    const tierCfg = tiers[page.tier] || tiers.MID;
    const pattern = rotate(tierCfg.daysPattern, hashStr(page.page_id) % 7);
    let globalSlotIdx = 0;
    for (let day = 0; day < 7; day++) {
      const count = pattern[day];
      if (!count) continue;
      const d = new Date(start);
      d.setDate(start.getDate() + day);
      const dateStr = toISODate(d);
      const times = assignTimes(count, timeWindow, page.page_id, day);
      for (let i = 0; i < count; i++) {
        slots.push({
          page_id: page.page_id,
          page_name: page.page_name,
          topic: resolveTopic(page.topic, globalSlotIdx, page.page_id),
          format: resolveFormat(globalSlotIdx, page.page_id, memeShare),
          tier: page.tier,
          scheduled_date: dateStr,
          scheduled_time: times[i],
          slot_index: i,
        });
        globalSlotIdx++;
      }
    }
  }
  return slots;
}

// Like buildSchedule, but over an arbitrary [startISO .. startISO+days-1] range, with
// the daysPattern indexed by each date's ABSOLUTE weekday (0=Sun..6=Sat) so the cadence
// for a given calendar date is stable no matter which day the run starts on.
export function buildScheduleForRange(pages, startISO, days, opts) {
  const { tiers, timeWindow, memeShare } = opts;
  const start = new Date(`${startISO}T00:00:00`);
  const slots = [];
  for (const page of pages) {
    const tierCfg = tiers[page.tier] || tiers.MID;
    const pattern = rotate(tierCfg.daysPattern, hashStr(page.page_id) % 7);
    let globalSlotIdx = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const weekday = d.getDay(); // 0 Sun .. 6 Sat — absolute, stable across runs
      const count = pattern[weekday];
      if (!count) continue;
      const dateStr = toISODate(d);
      const times = assignTimes(count, timeWindow, page.page_id, weekday);
      for (let j = 0; j < count; j++) {
        slots.push({
          page_id: page.page_id,
          page_name: page.page_name,
          topic: resolveTopic(page.topic, globalSlotIdx, page.page_id),
          format: resolveFormat(globalSlotIdx, page.page_id, memeShare),
          tier: page.tier,
          scheduled_date: dateStr,
          scheduled_time: times[j],
          slot_index: j,
        });
        globalSlotIdx++;
      }
    }
  }
  return slots;
}
