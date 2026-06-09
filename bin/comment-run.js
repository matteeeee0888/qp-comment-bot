#!/usr/bin/env node
// bin/comment-run.js — live comment responder (organic posts + ad/dark posts).
// DEFAULT = DRY: reads comments, classifies, and LOGS the intended action (no action taken).
//   --live          actually execute reply / hide and send escalation emails
//   --page <id>     limit to one page
//   --hide-risky    when live, also hide risky comments (recommended until email alerts are wired)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadToken, loadConfig, loadJson } from "../lib/env.js";
import { CommentsClient } from "../lib/metaComments.js";
import { activeAdStoryIds } from "../lib/adPosts.js";
import { classify, detectProduct } from "../lib/commentBrain.js";
import { sendAlert } from "../lib/alert.js";
import { archiveComment } from "../lib/archive.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cfg = await loadConfig();
const argv = process.argv.slice(2);
const LIVE = argv.includes("--live");
const HIDE_RISKY = argv.includes("--hide-risky");
const PAGE = (() => { const i = argv.indexOf("--page"); return i >= 0 ? argv[i + 1] : ""; })();
const POSTS_PER_PAGE = 8;
const MAX_ACTIONS = Number(cfg.commentMaxActionsPerRun || 25);

const token = await loadToken(cfg.tokenEnvPath);
const client = new CommentsClient({ token, graphVersion: cfg.graphVersion });
const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
const exclude = new Set(cfg.commentExcludePageIds || []);

const seenFile = path.join(repoRoot, "state/comments-seen.json");
const seen = new Set(await loadJson(new URL(`file://${seenFile}`)).catch(() => []));

const pages = (PAGE ? map.filter((m) => m.page_id === PAGE) : map.filter((m) => m.eligible)).filter((m) => !exclude.has(m.page_id));
console.log(`comment-run: ${pages.length} page(s) ${LIVE ? "LIVE" : "DRY (no actions)"}${exclude.size ? ` · excluding ${exclude.size}` : ""}`);

// Ad/dark-post discovery is expensive — cache it (refresh ~hourly) so a 10-min cron doesn't hammer the API.
async function loadAdStoriesCached(pageIds) {
  const file = path.join(repoRoot, "state/ad-stories.json");
  const TTL = 45 * 60 * 1000;
  try {
    const c = JSON.parse(await readFile(file, "utf8"));
    if (c.ts && Date.now() - c.ts < TTL) {
      const m = new Map();
      for (const [k, v] of Object.entries(c.byPage || {})) m.set(k, new Set(v));
      return m;
    }
  } catch {}
  let m = new Map();
  try { m = await activeAdStoryIds({ token, graphVersion: cfg.graphVersion, allowPageIds: pageIds }); }
  catch (e) { console.log(`ad-post discovery skipped: ${e.message}`); }
  const byPage = {};
  for (const [k, v] of m) byPage[k] = [...v];
  await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify({ ts: Date.now(), byPage })).catch(() => {});
  return m;
}

const adStories = await loadAdStoriesCached(pages.map((p) => p.page_id));
console.log(`ad/dark-post objects: ${[...adStories.values()].reduce((n, s) => n + s.size, 0)}`);

let handled = 0;
const tally = {};

async function act(b, c, pg, product, source) {
  tally[b.category] = (tally[b.category] || 0) + 1;
  const head = `[${pg.page_name}${source === "ad" ? " · AD" : ""}] ${b.category} — "${String(c.message).slice(0, 60)}"`;
  if (b.action === "escalate") {
    const res = await sendAlert({ comment: c, page: pg, product, category: b.category, stamp: new Date().toISOString() });
    if (LIVE && HIDE_RISKY) { try { await client.hide(c.id, pg.page_id); } catch {} }
    console.log(`${head} → ESCALATE (alert: ${res.sent})${LIVE && HIDE_RISKY ? " + hidden" : ""}`);
    return;
  }
  if (b.action === "hide") {
    if (LIVE) { try { await client.hide(c.id, pg.page_id); } catch (e) { console.log(`  hide err: ${e.message}`); } }
    console.log(`${head} → ${LIVE ? "HIDDEN" : "would hide"}`);
    return;
  }
  if (LIVE && b.reply) { try { await client.reply(c.id, pg.page_id, b.reply); } catch (e) { console.log(`  reply err: ${e.message}`); } }
  console.log(`${head} → ${LIVE ? "REPLIED" : "would reply"}: ${b.reply}`);
}

outer:
for (const pg of pages) {
  const objects = [];
  try {
    for (const post of await client.recentPosts(pg.page_id, POSTS_PER_PAGE)) {
      objects.push({ id: post.id, ctx: [post.message, post.permalink_url, post.attachments?.data?.[0]?.unshimmed_url, post.attachments?.data?.[0]?.target?.url].filter(Boolean).join(" "), source: "post" });
    }
  } catch (e) { console.log(`skip ${pg.page_name} posts: ${e.message}`); }
  for (const sid of adStories.get(String(pg.page_id)) || []) {
    if (objects.some((o) => o.id === sid)) continue;
    try { objects.push({ id: sid, ctx: await client.postContext(sid, pg.page_id), source: "ad" }); } catch {}
  }

  for (const obj of objects) {
    const product = detectProduct(obj.ctx);
    let comments = [];
    try { comments = await client.comments(obj.id, pg.page_id); } catch { continue; }
    for (const c of comments) {
      if (!c.message || seen.has(c.id)) continue;
      if (c.from && String(c.from.id) === String(pg.page_id)) { seen.add(c.id); continue; }
      if (handled >= MAX_ACTIONS) { console.log(`max actions per run (${MAX_ACTIONS}) reached — stopping`); break outer; }
      let b;
      try { b = await classify(c.message, product); } catch (e) { console.log(`  brain err: ${e.message}`); continue; }
      await act(b, c, pg, product, obj.source);
      await archiveComment({ comment: c, page: pg, product, brain: b, source: obj.source }).catch(() => {});
      seen.add(c.id);
      handled++;
    }
  }
}

if (LIVE) {
  await mkdir(path.dirname(seenFile), { recursive: true }).catch(() => {});
  await writeFile(seenFile, JSON.stringify([...seen].slice(-5000)), "utf8");
}
console.log(`\ncomment-run: handled ${handled} new comment(s).${LIVE ? "" : " (DRY — memory not saved)"} ${JSON.stringify(tally)}`);
