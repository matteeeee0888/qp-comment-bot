// lib/pageTopicMap.js
import { classifyTopic } from "./classify.js";

const CATEGORY_TOPIC = { "Dog Trainer": "dog", "Dog Walker": "dog" };

// Pick the highest tier whose minActiveAds threshold the page meets. Data-driven so new
// tiers (e.g. a DORMANT tier with minActiveAds: 0 for pages with no active ads) just work.
function tierFor(activeAds, tiers) {
  const ranked = Object.entries(tiers)
    .map(([name, cfg]) => ({ name, min: cfg.minActiveAds ?? 0 }))
    .sort((a, b) => b.min - a.min);
  for (const t of ranked) {
    if (activeAds >= t.min) return t.name;
  }
  return null;
}

// adsForTopic: [{ pageId, campaignName }]; activeCountByPage: { pageId: number }
// pagesById: { id: { name, category } }; tiers/alwaysInclude/overrides from config
export function buildMap({ adsForTopic = [], activeCountByPage = {}, pagesById = {}, tiers, alwaysInclude = {}, overrides = {} }) {
  const topicTally = new Map();
  for (const ad of adsForTopic) {
    const t = classifyTopic(ad.campaignName);
    if (!t) continue;
    if (!topicTally.has(ad.pageId)) topicTally.set(ad.pageId, { dog: 0, cat: 0 });
    topicTally.get(ad.pageId)[t] += 1;
  }
  const out = [];
  for (const [id, page] of Object.entries(pagesById)) {
    const counts = topicTally.get(id) || { dog: 0, cat: 0 };
    let topic, source;
    if (counts.dog + counts.cat > 0) {
      topic = counts.cat > counts.dog ? "cat" : "dog";
      source = "ads";
    } else if (CATEGORY_TOPIC[page.category]) {
      topic = CATEGORY_TOPIC[page.category];
      source = "category";
    } else {
      topic = "both";
      source = "default";
    }
    if (overrides[id]) {
      topic = overrides[id];
      source = "override";
    }
    const active = activeCountByPage[id] || 0;
    let tier = tierFor(active, tiers);
    let eligible = tier !== null;
    if (alwaysInclude[id]) {
      eligible = true;
      // An explicit alwaysInclude tier wins (a forced page keeps its configured cadence even
      // now that 0-ad pages would otherwise fall into DORMANT).
      if (alwaysInclude[id].tier) tier = alwaysInclude[id].tier;
      else if (!tier) tier = "MID";
    }
    out.push({ page_id: id, page_name: page.name, topic, active_ads: active, tier: tier || "none", eligible, source });
  }
  return out;
}
