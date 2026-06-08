import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMap } from "../lib/pageTopicMap.js";

const tiers = {
  HIGH: { minActiveAds: 50 },
  MID: { minActiveAds: 10 },
  LOW: { minActiveAds: 1 },
};
const pages = {
  "1": { name: "Lori Clay", category: "Animals" },
  "2": { name: "Russel Prewitt", category: "Veterinarian" },
  "3": { name: "Janet Harper", category: "Pet Sitter" },
  "4": { name: "Barbara Brown", category: "Personal blog" },
  "5": { name: "Little Person Trains Dogs", category: "Dog Trainer" },
};

test("topic from ads, active count -> tier, eligibility", () => {
  const adsForTopic = [
    { pageId: "1", campaignName: "CCL_DOG A" },
    { pageId: "3", campaignName: "CCL_CAT A" },
  ];
  const activeCountByPage = { "1": 149, "2": 5, "3": 0, "4": 0, "5": 0 };
  const map = buildMap({
    adsForTopic,
    activeCountByPage,
    pagesById: pages,
    tiers,
    alwaysInclude: { "3": { name: "Janet Harper", tier: "MID" } },
    overrides: {},
  });
  const byId = Object.fromEntries(map.map((m) => [m.page_id, m]));

  assert.equal(byId["1"].topic, "dog");
  assert.equal(byId["1"].tier, "HIGH");
  assert.equal(byId["1"].eligible, true);

  assert.equal(byId["2"].tier, "LOW");
  assert.equal(byId["2"].eligible, true);

  assert.equal(byId["3"].topic, "cat");
  assert.equal(byId["3"].eligible, true);
  assert.equal(byId["3"].tier, "MID");

  assert.equal(byId["4"].eligible, false);
  assert.equal(byId["5"].topic, "dog");
  assert.equal(byId["5"].eligible, false);
});

test("a DORMANT tier (minActiveAds 0) makes 0-ad pages eligible", () => {
  const tiersWithDormant = { ...tiers, DORMANT: { minActiveAds: 0 } };
  const map = buildMap({
    adsForTopic: [],
    activeCountByPage: { "1": 0, "2": 3 },
    pagesById: { "1": { name: "Sleepy Page", category: "Animals" }, "2": { name: "Busy Page", category: "Animals" } },
    tiers: tiersWithDormant,
    alwaysInclude: {},
    overrides: {},
  });
  const byId = Object.fromEntries(map.map((m) => [m.page_id, m]));
  assert.equal(byId["1"].tier, "DORMANT");
  assert.equal(byId["1"].eligible, true);
  // A page with ads still gets its ad-based tier, not DORMANT.
  assert.equal(byId["2"].tier, "LOW");
});

test("alwaysInclude tier wins over DORMANT for a forced 0-ad page", () => {
  const tiersWithDormant = { ...tiers, DORMANT: { minActiveAds: 0 } };
  const map = buildMap({
    adsForTopic: [],
    activeCountByPage: { "3": 0 },
    pagesById: { "3": { name: "Janet Harper", category: "Pet Sitter" } },
    tiers: tiersWithDormant,
    alwaysInclude: { "3": { name: "Janet Harper", tier: "MID" } },
    overrides: {},
  });
  assert.equal(map[0].tier, "MID");
  assert.equal(map[0].eligible, true);
});

test("overrides win for topic", () => {
  const map = buildMap({
    adsForTopic: [],
    activeCountByPage: { "1": 80 },
    pagesById: { "1": { name: "X", category: "Animals" } },
    tiers,
    alwaysInclude: {},
    overrides: { "1": "cat" },
  });
  assert.equal(map[0].topic, "cat");
});
