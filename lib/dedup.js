// lib/dedup.js — persistent "don't repeat" memory, committed to git so it survives a machine change.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const MAX_TOPICS_PER_PAGE = 20;

export function emptyDedup() {
  return { bodyHashes: [], imageKeys: [], recentTopicsByPage: {} };
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

export function recordUsage(state, { pageId, bodyHash, imageKey, topic }) {
  const next = {
    bodyHashes: [...state.bodyHashes, bodyHash],
    imageKeys: imageKey && imageKey !== "gen" ? [...state.imageKeys, imageKey] : [...state.imageKeys],
    recentTopicsByPage: { ...state.recentTopicsByPage },
  };
  const prev = next.recentTopicsByPage[pageId] || [];
  next.recentTopicsByPage[pageId] = [...prev, topic].slice(-MAX_TOPICS_PER_PAGE);
  return next;
}

export async function loadDedup(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return emptyDedup();
  }
}

export async function saveDedup(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}
