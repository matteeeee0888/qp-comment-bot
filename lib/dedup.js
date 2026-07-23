// lib/dedup.js — persistent "don't repeat" memory, committed to git so it survives a machine change.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_TOPICS_PER_PAGE = 20;
const LINK_DAY_WINDOW = 14;   // keep same-day link keys ~2 weeks (only "today" matters for collisions)
const SCENE_WINDOW = 45;      // don't reuse a photo scene within 45 days

export function emptyDedup() {
  return { bodyHashes: [], imageKeys: [], recentTopicsByPage: {}, linkDayKeys: [], sceneUses: [] };
}

export function hashBody(message) {
  return createHash("sha256").update(String(message).trim()).digest("hex");
}

export function isDuplicateBody(state, hash) {
  return state.bodyHashes.includes(hash);
}

// "gen" is the sentinel for a freshly generated image — generated images are unique by
// construction, so they never count as reused. Only real source URLs are deduped.
export function isReusedImage(state, imageKey) {
  return imageKey !== "gen" && state.imageKeys.includes(imageKey);
}

// --- link anti-collision: no two pages post the same URL on the same calendar day ---
export function linkDayKey(date, url) {
  return `${date}|${url}`;
}
export function isLinkTakenOnDate(state, date, url) {
  if (!url || !date) return false;
  return (state.linkDayKeys || []).includes(linkDayKey(date, url));
}

// --- photo scene reuse: don't repeat the same generated scene within SCENE_WINDOW days ---
export function hashScene(prompt) {
  return createHash("sha256").update(String(prompt).trim()).digest("hex").slice(0, 16);
}
export function isSceneRecentlyUsed(state, sceneHash, dateISO, windowDays = SCENE_WINDOW) {
  if (!sceneHash) return false;
  const cutoff = Date.parse(dateISO + "T00:00:00Z") - windowDays * 86400000;
  return (state.sceneUses || []).some((s) => s.h === sceneHash && Date.parse(s.date + "T00:00:00Z") >= cutoff);
}

// Drop keys older than their window so state/dedup.json stays bounded (bodyHashes intentionally kept).
function prune(state, todayISO) {
  const now = Date.parse(todayISO + "T00:00:00Z");
  if (!Number.isFinite(now)) return state;
  state.linkDayKeys = (state.linkDayKeys || []).filter((k) => {
    const d = Date.parse(String(k).split("|")[0] + "T00:00:00Z");
    return !Number.isFinite(d) || now - d <= LINK_DAY_WINDOW * 86400000;
  });
  state.sceneUses = (state.sceneUses || []).filter((s) => {
    const d = Date.parse(s.date + "T00:00:00Z");
    return !Number.isFinite(d) || now - d <= SCENE_WINDOW * 86400000;
  });
  return state;
}

export function recordUsage(state, { pageId, bodyHash, imageKey, topic, link, date, sceneHash }) {
  const next = {
    bodyHashes: [...state.bodyHashes, bodyHash],
    imageKeys: imageKey && imageKey !== "gen" ? [...state.imageKeys, imageKey] : [...state.imageKeys],
    recentTopicsByPage: { ...state.recentTopicsByPage },
    linkDayKeys: [...(state.linkDayKeys || [])],
    sceneUses: [...(state.sceneUses || [])],
  };
  const prev = next.recentTopicsByPage[pageId] || [];
  next.recentTopicsByPage[pageId] = [...prev, topic].slice(-MAX_TOPICS_PER_PAGE);
  if (link && date) next.linkDayKeys.push(linkDayKey(date, link));
  if (sceneHash && date) next.sceneUses.push({ h: sceneHash, date });
  return date ? prune(next, date) : next;
}

export async function loadDedup(file) {
  try {
    // spread over emptyDedup() so a committed state missing the newer fields still loads cleanly.
    return { ...emptyDedup(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    return emptyDedup();
  }
}

export async function saveDedup(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}
