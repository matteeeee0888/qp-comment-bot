import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { newestImageSince } from "../lib/codexImage.js";

async function makeImg(dir, name, mtimeSec) {
  const sub = path.join(dir, "sess");
  await mkdir(sub, { recursive: true });
  const f = path.join(sub, name);
  await writeFile(f, Buffer.alloc(2000));
  await utimes(f, mtimeSec, mtimeSec);
  return f;
}

test("returns the newest ig_*.png created at/after sinceMs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cx-"));
  await makeImg(dir, "ig_old.png", 1000);
  const newer = await makeImg(dir, "ig_new.png", 2000);
  const got = await newestImageSince(dir, 1500 * 1000);
  assert.equal(got, newer);
});

test("ignores files older than sinceMs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cx-"));
  await makeImg(dir, "ig_old.png", 1000);
  assert.equal(await newestImageSince(dir, 5000 * 1000), null);
});

test("ignores non ig_*.png files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cx-"));
  await makeImg(dir, "other.png", 9000);
  assert.equal(await newestImageSince(dir, 1000), null);
});
