import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isValidImage } from "../lib/imageCheck.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

test("accepts a PNG above the size floor", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "img-"));
  const f = path.join(dir, "ok.png");
  await writeFile(f, Buffer.concat([PNG, Buffer.alloc(2000)]));
  assert.equal(await isValidImage(f), true);
});

test("accepts a JPEG above the size floor", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "img-"));
  const f = path.join(dir, "ok.jpg");
  await writeFile(f, Buffer.concat([JPEG, Buffer.alloc(2000)]));
  assert.equal(await isValidImage(f), true);
});

test("rejects a missing file", async () => {
  assert.equal(await isValidImage("/no/such/file.png"), false);
});

test("rejects a tiny / empty file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "img-"));
  const f = path.join(dir, "tiny.png");
  await writeFile(f, PNG); // 8 bytes, below floor
  assert.equal(await isValidImage(f), false);
});

test("rejects a non-image (no magic bytes)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "img-"));
  const f = path.join(dir, "fake.png");
  await writeFile(f, Buffer.concat([Buffer.from("NOTANIMAGE"), Buffer.alloc(2000)]));
  assert.equal(await isValidImage(f), false);
});
