import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPost, pickLink, intendedType } from "../lib/postContent.js";

const rec = (over = {}) => ({ id: "2026-07-20__jane-doe__0", page_id: "12345", page_name: "Jane Doe", scheduled_date: "2026-07-20", scheduled_time: "10:00", topic: "preparedness", ...over });
// fake deps: gen returns a caption; makeImage returns a fake PNG buffer; upload returns a public URL.
const fakeGen = async (_sys, user) => ({ caption: `CAP<${user.slice(0, 12)}>` });
const okImage = async () => Buffer.from([1, 2, 3]);
const nullImage = async () => null;
const okUpload = async (p) => ({ ok: true, url: `https://cdn/${p}` });
const failUpload = async () => ({ ok: false });

test("story post has no link and no image", async () => {
  const c = await buildPost(rec(), { forceType: "story", deps: { gen: fakeGen } });
  assert.equal(c.type, "story");
  assert.equal(c.link, "");
  assert.equal(c.imageSource, "none");
  assert.match(c.message, /^CAP</);
});

test("link post picks a pool URL and never one already taken today", async () => {
  const taken = new Set();
  // force blackout (2-URL pool) — first call takes one, second must take the other, third degrades to story
  const c1 = await buildPost(rec({ topic: "blackout" }), { forceType: "link", takenToday: taken, deps: { gen: fakeGen } });
  assert.equal(c1.type, "link");
  taken.add(`2026-07-20|${c1.url}`);
  const c2 = await buildPost(rec({ topic: "blackout", page_id: "99999", id: "2026-07-20__p2__0" }), { forceType: "link", takenToday: taken, deps: { gen: fakeGen } });
  assert.equal(c2.type, "link");
  assert.notEqual(c2.url, c1.url, "second page gets a different URL on the same day");
  taken.add(`2026-07-20|${c2.url}`);
  const c3 = await buildPost(rec({ topic: "blackout", page_id: "77777", id: "2026-07-20__p3__0" }), { forceType: "link", takenToday: taken, deps: { gen: fakeGen } });
  assert.equal(c3.type, "story", "pool exhausted for the day -> degrade to story");
});

test("photo post generates an image, uploads it, and carries a scene hash", async () => {
  const c = await buildPost(rec(), { forceType: "photo", canPhoto: true, deps: { gen: fakeGen, makeImage: okImage, upload: okUpload } });
  assert.equal(c.type, "photo");
  assert.equal(c.imageSource, "generated");
  assert.match(c.imagePath, /^https:\/\/cdn\//);
  assert.ok(c.sceneHash && c.sceneHash.length > 0);
  assert.ok(c.scene.includes("("), "scene records the variation");
});

test("photo degrades to link when image generation fails", async () => {
  const c = await buildPost(rec(), { forceType: "photo", canPhoto: true, deps: { gen: fakeGen, makeImage: nullImage, upload: okUpload } });
  assert.equal(c.type, "link");
});

test("photo degrades to link when the upload fails", async () => {
  const c = await buildPost(rec(), { forceType: "photo", canPhoto: true, deps: { gen: fakeGen, makeImage: okImage, upload: failUpload } });
  assert.equal(c.type, "link");
});

test("photo degrades to link when canPhoto is false (no secrets)", async () => {
  const c = await buildPost(rec(), { forceType: "photo", canPhoto: false, deps: { gen: fakeGen } });
  assert.notEqual(c.type, "photo");
});

test("intendedType respects the forced type and is otherwise deterministic", () => {
  assert.equal(intendedType(rec(), "photo"), "photo");
  assert.equal(intendedType(rec()), intendedType(rec()));
});

test("pickLink returns null only when every pool URL is taken that day", () => {
  const r = rec({ topic: "blackout" });
  const taken = new Set(["2026-07-20|https://www.ready.gov/power-outages", "2026-07-20|https://www.redcross.org/get-help/how-to-prepare-for-emergencies/types-of-emergencies/power-outage.html"]);
  assert.equal(pickLink(r, 0, taken), null);
  assert.ok(pickLink(r, 0, new Set()) !== null);
});
