#!/usr/bin/env node
// bin/comment-inspo-backfill.js — ONE-TIME backfill: scan EXISTING comments across the eligible
// pages' recent posts (+ active ad/dark posts) and send every long comment (> min words) to the
// #copywriting Slack channel as ad inspo. Independent of the live responder's seen-store; keeps its
// OWN dedup in state/inspo-seen.json so re-runs never double-post.
//
//   --dry              count + list what WOULD be sent; NO Slack, NO state write (default-safe)
//   --min-words <n>    threshold (default 25)
//   --max-posts <n>    how many recent posts per page to scan (default 50)
//   --max <n>          hard cap on Slack sends this run (safety against flooding)
//   --page <id>        limit to one page
//   --no-ads           skip ad/dark-post comments (organic posts only)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadToken, loadConfig, loadJson } from "../lib/env.js";
import { CommentsClient } from "../lib/metaComments.js";
import { activeAdStoryIds } from "../lib/adPosts.js";
import { detectProduct, productName } from "../lib/commentBrain.js";
import { sendCopyInspo } from "../lib/slack.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const getN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const DRY = has("--dry");
const MIN_WORDS = getN("--min-words", Number(process.env.INSPO_MIN_WORDS || 50));
const MAX_POSTS = getN("--max-posts", 50);
const MAX_SENDS = getN("--max", Infinity);
const TOP = getN("--top", Infinity); // send only the N longest eligible comments (quality proxy)
const NO_ADS = has("--no-ads");
const PAGE = (() => { const i = argv.indexOf("--page"); return i >= 0 ? argv[i + 1] : ""; })();

const cfg = await loadConfig();
const token = await loadToken(cfg.tokenEnvPath);
const client = new CommentsClient({ token, graphVersion: cfg.graphVersion });
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
const exclude = new Set(cfg.commentExcludePageIds || []);
const pages = (PAGE ? map.filter((m) => m.page_id === PAGE) : map.filter((m) => m.eligible)).filter((m) => !exclude.has(m.page_id));

const seenFile = path.join(repoRoot, "state/inspo-seen.json");
const seen = new Set(await loadJson(new URL(`file://${seenFile}`)).catch(() => []));
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adStoriesFor(pageIds) {
  if (NO_ADS) return new Map();
  // reuse the responder's cache if present; otherwise discover (best-effort).
  try {
    const c = JSON.parse(await readFile(path.join(repoRoot, "state/ad-stories.json"), "utf8"));
    const m = new Map();
    for (const [k, v] of Object.entries(c.byPage || {})) m.set(k, new Set(v));
    if (m.size) return m;
  } catch {}
  try { return await activeAdStoryIds({ token, graphVersion: cfg.graphVersion, allowPageIds: pageIds }); }
  catch (e) { console.log(`ad-post discovery skipped: ${e.message}`); return new Map(); }
}

console.log(`inspo-backfill: ${pages.length} page(s) · min ${MIN_WORDS} words · ${MAX_POSTS} posts/page` +
  `${NO_ADS ? " · no-ads" : ""}${DRY ? " · DRY (no Slack, no state)" : ""}${MAX_SENDS !== Infinity ? ` · cap ${MAX_SENDS}` : ""}`);

const ads = await adStoriesFor(pages.map((p) => p.page_id));
let scanned = 0, skippedSeen = 0;
const cands = []; // collect first, then optionally rank by length and cap (--top)

// ---- 1) scan: gather eligible, not-yet-sent candidates ----
for (const pg of pages) {
  const objects = [];
  try {
    for (const post of await client.recentPosts(pg.page_id, MAX_POSTS)) {
      objects.push({ id: post.id, ctx: [post.message, post.permalink_url, post.attachments?.data?.[0]?.unshimmed_url, post.attachments?.data?.[0]?.target?.url].filter(Boolean).join(" "), source: "post" });
    }
  } catch (e) { console.log(`skip ${pg.page_name} posts: ${e.message}`); }
  for (const sid of ads.get(String(pg.page_id)) || []) {
    if (objects.some((o) => o.id === sid)) continue;
    try { objects.push({ id: sid, ctx: await client.postContext(sid, pg.page_id), source: "ad" }); } catch {}
  }

  for (const obj of objects) {
    const product = detectProduct(obj.ctx);
    const oid = String(obj.id);
    const postUrl = oid.includes("_") ? `https://www.facebook.com/${oid.split("_")[0]}/posts/${oid.split("_")[1]}` : "";
    let comments = [];
    try { comments = await client.comments(obj.id, pg.page_id, 100); } catch { continue; }
    for (const c of comments) {
      if (!c.message) continue;
      if (c.from && String(c.from.id) === String(pg.page_id)) continue; // skip the page's own comments
      scanned++;
      const w = words(c.message);
      if (w <= MIN_WORDS) continue;
      if (seen.has(c.id)) { skippedSeen++; continue; }
      cands.push({ id: c.id, message: c.message, product, page: pg.page_name, postUrl, source: obj.source, w });
    }
  }
}

// ---- 2) rank: longest first (a length proxy for "real story" over short complaints) ----
cands.sort((a, b) => b.w - a.w);
let pick = cands;
if (TOP !== Infinity) pick = pick.slice(0, TOP);
else if (MAX_SENDS !== Infinity) pick = pick.slice(0, MAX_SENDS);
console.log(`eligible (>${MIN_WORDS}w, unsent): ${cands.length} · sending ${DRY ? "0 (dry)" : pick.length}`);

// ---- 3) send (rate-limited, dedup persisted incrementally) ----
let sent = 0;
for (const c of pick) {
  const label = `[${c.page}${c.source === "ad" ? " · AD" : ""}] ${c.w}w ${productName(c.product) || "?"}: "${String(c.message).slice(0, 70).replace(/\s+/g, " ")}"`;
  if (DRY) { console.log(`  WOULD SEND ${label}`); continue; }
  const res = await sendCopyInspo({ message: c.message, productName: productName(c.product), pageName: c.page, postUrl: c.postUrl, commentId: c.id });
  seen.add(c.id);
  if (res.sent === "slack") sent++;
  console.log(`  ${res.sent === "slack" ? "SENT" : "LOG"} ${label}`);
  await mkdir(path.dirname(seenFile), { recursive: true }).catch(() => {});
  await writeFile(seenFile, JSON.stringify([...seen].slice(-20000)), "utf8").catch(() => {});
  await sleep(1200); // respect Slack rate limits, don't flood the channel
}

console.log(`\ninspo-backfill done: scanned ${scanned} comment(s), ${cands.length} > ${MIN_WORDS}w unsent` +
  `, ${DRY ? "(dry — nothing sent)" : `sent ${sent}`}${skippedSeen ? `, ${skippedSeen} already-sent` : ""}.`);
