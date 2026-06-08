// bin/build-map.js
import { writeFile } from "node:fs/promises";
import { loadToken, loadConfig, loadJson } from "../lib/env.js";
import { fetchAll } from "../lib/graphFetch.js";
import { buildMap } from "../lib/pageTopicMap.js";
import { classifyTopic } from "../lib/classify.js";

const cfg = await loadConfig();
const token = await loadToken(cfg.tokenEnvPath);
const base = `https://graph.facebook.com/${cfg.graphVersion}`;
const enc = encodeURIComponent;

// 1) Pages — filtered to OUR allowlist (config.includePageIds); excludes Andrea's pet network.
const allPages = await fetchAll(`${base}/me/accounts?fields=name,category&limit=200&access_token=${token}`);
const allow = new Set(cfg.includePageIds || []);
const pages = allow.size ? allPages.filter((p) => allow.has(p.id)) : allPages;
const pagesById = Object.fromEntries(pages.map((p) => [p.id, { name: p.name, category: p.category }]));
if (allow.size) {
  const excluded = allPages.filter((p) => !allow.has(p.id)).map((p) => p.name);
  const missing = [...allow].filter((id) => !allPages.some((p) => p.id === id));
  console.log(`Allowlist active: ${pages.length}/${allPages.length} pages kept. Excluded ${excluded.length}: ${excluded.join(", ")}`);
  if (missing.length) console.log(`WARNING: allowlisted IDs not visible to token: ${missing.join(", ")}`);
}

// 2) Ad accounts (optional — needs ads_read; degrade gracefully if the token lacks it)
let accounts = [];
try {
  accounts = await fetchAll(`${base}/me/adaccounts?fields=id&limit=200&access_token=${token}`);
} catch (e) {
  console.error(`adaccounts skip (no ads_read? continuing without ad-based tiers): ${e.message}`);
}

// 3) Per account: topic ads (sample) + ACTIVE ads (full count)
const adsForTopic = [];
const activeCountByPage = {};
const activeFilter = enc(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));

for (const acct of accounts) {
  try {
    const topicRows = await fetchAll(
      `${base}/${acct.id}/ads?fields=campaign{name},creative{effective_object_story_id}&limit=300&access_token=${token}`,
      { maxPages: 3 }
    );
    for (const a of topicRows) {
      const eos = a.creative?.effective_object_story_id || "";
      const pageId = eos.includes("_") ? eos.split("_")[0] : null;
      if (pageId) adsForTopic.push({ pageId, campaignName: a.campaign?.name || "" });
    }
  } catch (e) {
    console.error(`topic skip ${acct.id}: ${e.message}`);
  }
  try {
    const activeRows = await fetchAll(
      `${base}/${acct.id}/ads?fields=creative{effective_object_story_id}&filtering=${activeFilter}&limit=300&access_token=${token}`
    );
    for (const a of activeRows) {
      const eos = a.creative?.effective_object_story_id || "";
      const pageId = eos.includes("_") ? eos.split("_")[0] : null;
      if (pageId) activeCountByPage[pageId] = (activeCountByPage[pageId] || 0) + 1;
    }
  } catch (e) {
    console.error(`active skip ${acct.id}: ${e.message}`);
  }
}

// 4) Build
const overrides = await loadJson(new URL("../overrides.json", import.meta.url));
const map = buildMap({
  adsForTopic,
  activeCountByPage,
  pagesById,
  tiers: cfg.tiers,
  alwaysInclude: cfg.alwaysInclude,
  overrides,
});

await writeFile(new URL("../page-topic-map.json", import.meta.url), JSON.stringify(map, null, 2));
const eligible = map.filter((m) => m.eligible);
console.log(`Wrote page-topic-map.json: ${map.length} pages, ${eligible.length} eligible.`);
console.table(
  map
    .sort((a, b) => b.active_ads - a.active_ads)
    .map((m) => ({ page: m.page_name, topic: m.topic, active: m.active_ads, tier: m.tier, eligible: m.eligible }))
);
