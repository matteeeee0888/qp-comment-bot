#!/usr/bin/env node
// bin/repair-dupes.js — one-shot repair after the persist-memory bug:
//  1. SEED the seen-store: mark every comment created before CUTOFF as seen (they were all
//     handled at least once; the bug only lost the memory, not the handling).
//  2. DELETE duplicate page replies: where the page replied 2+ times to the same comment,
//     keep the OLDEST reply and delete the rest.
// Usage: node bin/repair-dupes.js [--dry] [--seed-only]   (--seed-only: fix memory, delete nothing)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { loadToken, loadConfig, loadJson } from "../lib/env.js";
import { CommentsClient } from "../lib/metaComments.js";

const CUTOFF = Date.parse("2026-06-10T10:39:00Z"); // start of the last duplicate run — everything before it was handled
const DRY = process.argv.includes("--dry");
const SEED_ONLY = process.argv.includes("--seed-only");

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cfg = await loadConfig();
const token = await loadToken(cfg.tokenEnvPath);
const client = new CommentsClient({ token, graphVersion: cfg.graphVersion });
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));

const seenFile = path.join(repoRoot, "state/comments-seen.json");
const seen = new Set(JSON.parse(await readFile(seenFile, "utf8")));
const before = seen.size;

// ad/dark-post objects from the committed cache
let adStories = {};
try { adStories = JSON.parse(await readFile(path.join(repoRoot, "state/ad-stories.json"), "utf8")).byPage || {}; } catch {}

const base = `https://graph.facebook.com/${cfg.graphVersion}`;
let dupesDeleted = 0, dupeComments = 0;

for (const pg of map.filter((m) => m.eligible)) {
  const objects = new Set();
  try { for (const p of await client.recentPosts(pg.page_id, 10)) objects.add(p.id); } catch {}
  for (const sid of adStories[String(pg.page_id)] || []) objects.add(sid);

  const pt = await client.pageToken(pg.page_id).catch(() => null);
  if (!pt) continue;

  for (const oid of objects) {
    let comments = [];
    try { comments = await client.comments(oid, pg.page_id); } catch { continue; }
    for (const c of comments) {
      if (c.from && String(c.from.id) === String(pg.page_id)) { seen.add(c.id); continue; }
      // 1) seed memory
      const ts = c.created_time ? Date.parse(c.created_time) : 0;
      if (ts && ts < CUTOFF) seen.add(c.id);
      // 2) find duplicate page replies on this comment
      let replies = [];
      try {
        const d = await (await fetch(`${base}/${c.id}/comments?fields=id,from,created_time&limit=25&access_token=${encodeURIComponent(pt)}`)).json();
        replies = d.data || [];
      } catch { continue; }
      const mine = replies.filter((r) => r.from && String(r.from.id) === String(pg.page_id))
        .sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
      if (mine.length > 1) {
        dupeComments++;
        for (const extra of mine.slice(1)) {
          if (DRY || SEED_ONLY) { console.log(`[${SEED_ONLY ? "SKIP (seed-only)" : "DRY"}] dup reply ${extra.id} on "${String(c.message).slice(0, 40)}" (${pg.page_name})`); dupesDeleted++; continue; }
          try {
            const r = await (await fetch(`${base}/${extra.id}?access_token=${encodeURIComponent(pt)}`, { method: "DELETE" })).json();
            if (r.success !== false) { dupesDeleted++; console.log(`deleted dup reply on "${String(c.message).slice(0, 40)}" (${pg.page_name})`); }
          } catch (e) { console.log(`delete err ${extra.id}: ${e.message}`); }
        }
      }
      // page replies themselves go in seen too (harmless, keeps store tight)
      for (const r of mine) seen.add(r.id);
    }
  }
}

if (!DRY) await writeFile(seenFile, JSON.stringify([...seen].slice(-5000)), "utf8");
console.log(`\nseed: ${before} -> ${seen.size} seen IDs${DRY ? " (DRY, not saved)" : ""}`);
console.log(`dupes: ${dupeComments} comment(s) had multiple page replies; deleted ${dupesDeleted} extra repl${dupesDeleted === 1 ? "y" : "ies"}.`);
