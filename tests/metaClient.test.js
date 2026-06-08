import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MetaClient } from "../lib/metaClient.js";

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return { json: async () => routes[key] };
  };
  fn.calls = calls;
  return fn;
}

test("getPageToken fetches and caches", async () => {
  const fetchImpl = fakeFetch({ "?fields=access_token": { access_token: "PAGE_TOK" } });
  const c = new MetaClient({ token: "SU", fetchImpl });
  assert.equal(await c.getPageToken("123"), "PAGE_TOK");
  assert.equal(await c.getPageToken("123"), "PAGE_TOK");
  assert.equal(fetchImpl.calls.length, 1);
});

test("publishFeed schedules when scheduledPublishTime is given", async () => {
  const fetchImpl = fakeFetch({
    "?fields=access_token": { access_token: "PAGE_TOK" },
    "/feed": { id: "123_999" },
  });
  const c = new MetaClient({ token: "SU", fetchImpl });
  const res = await c.publishFeed("123", { message: "hi", scheduledPublishTime: 1900000000 });
  assert.equal(res.id, "123_999");
  const feed = fetchImpl.calls.find((x) => x.url.includes("/feed"));
  assert.equal(feed.opts.body.get("message"), "hi");
  assert.equal(feed.opts.body.get("published"), "false");
  assert.equal(feed.opts.body.get("scheduled_publish_time"), "1900000000");
});

test("publishFeed publishes immediately when no schedule time", async () => {
  const fetchImpl = fakeFetch({
    "?fields=access_token": { access_token: "PAGE_TOK" },
    "/feed": { id: "123_1" },
  });
  const c = new MetaClient({ token: "SU", fetchImpl });
  await c.publishFeed("123", { message: "now" });
  const feed = fetchImpl.calls.find((x) => x.url.includes("/feed"));
  assert.equal(feed.opts.body.get("published"), null);
});

test("throws on API error", async () => {
  const fetchImpl = fakeFetch({
    "?fields=access_token": { access_token: "T" },
    "/feed": { error: { message: "boom" } },
  });
  const c = new MetaClient({ token: "SU", fetchImpl });
  await assert.rejects(() => c.publishFeed("123", { message: "x" }), /boom/);
});

test("publishPhotoStory uploads an unpublished photo, then posts the story", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "story-"));
  const img = path.join(dir, "s.png");
  await writeFile(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const fetchImpl = fakeFetch({
    "?fields=access_token": { access_token: "PAGE_TOK" },
    "/photos": { id: "PHOTO_42" },
    "/photo_stories": { post_id: "STORY_1", success: true },
  });
  const c = new MetaClient({ token: "SU", fetchImpl });
  const res = await c.publishPhotoStory("123", { imagePath: img });
  assert.equal(res.post_id, "STORY_1");
  const upload = fetchImpl.calls.find((x) => x.url.includes("/photos") && !x.url.includes("photo_stories"));
  assert.ok(upload, "uploaded an unpublished photo first");
  const story = fetchImpl.calls.find((x) => x.url.includes("/photo_stories"));
  assert.equal(story.opts.body.get("photo_id"), "PHOTO_42");
});
