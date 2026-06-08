import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { slugify, noteFilename, writeNote, listNotes, updateNote, messageFromBody } from "../lib/note.js";

test("slugify and noteFilename", () => {
  assert.equal(slugify("Diane C. Roberts"), "diane-c-roberts");
  assert.equal(
    noteFilename({ scheduled_date: "2026-06-02", page_name: "Lori Clay", slot_index: 1 }),
    "2026-06-02__lori-clay__1.md"
  );
});

test("writeNote does not overwrite an existing note (non-destructive by default)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ppp-"));
  const slot = {
    page_id: "99", page_name: "Guard Dog", topic: "dog", tier: "MID",
    scheduled_date: "2026-07-01", scheduled_time: "10:00", slot_index: 0,
  };
  const file = await writeNote(dir, slot);
  await updateNote(file, { status: "approved" });

  // calling writeNote again with the same slot must not reset status to "draft"
  const file2 = await writeNote(dir, slot);
  assert.equal(file, file2, "same path returned");

  const notes = await listNotes(dir);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].frontmatter.status, "approved", "approved status must be preserved");
});

test("writeNote with overwrite:true replaces the existing note", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ppp-"));
  const slot = {
    page_id: "99", page_name: "Guard Dog", topic: "dog", tier: "MID",
    scheduled_date: "2026-07-02", scheduled_time: "10:00", slot_index: 0,
  };
  await writeNote(dir, slot);
  await updateNote(path.join(dir, (await listNotes(dir))[0].path.split("/").pop()), { status: "approved" });

  await writeNote(dir, slot, { overwrite: true });

  const notes = await listNotes(dir);
  assert.equal(notes[0].frontmatter.status, "draft", "overwrite resets to draft");
});

test("write, list, and update a note round-trips with schedule fields", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ppp-"));
  const slot = {
    page_id: "1131155456740150", page_name: "Lori Clay", topic: "dog", tier: "HIGH",
    scheduled_date: "2026-06-02", scheduled_time: "14:20", slot_index: 0,
  };
  const file = await writeNote(dir, slot);
  const text = await readFile(file, "utf8");
  assert.match(text, /status: draft/);
  assert.match(text, /scheduled_time:/);

  const notes = await listNotes(dir);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].frontmatter.scheduled_time, "14:20");
  assert.equal(notes[0].frontmatter.tier, "HIGH");

  await updateNote(file, { status: "approved" });
  const after = await listNotes(dir);
  assert.equal(after[0].frontmatter.status, "approved");
});

test("messageFromBody strips Obsidian/markdown image embeds, keeps post text", () => {
  const body = "First line.\n\nSecond line.\n\n![[2026-05-29__susan-miller__0.png]]";
  assert.equal(messageFromBody(body), "First line.\n\nSecond line.");
  const body2 = "Hello world\n![](img/x.png)";
  assert.equal(messageFromBody(body2), "Hello world");
  // an embed in the MIDDLE of a sentence is left alone (only standalone embed lines are stripped)
  assert.equal(messageFromBody("text ![[a.png]] more"), "text ![[a.png]] more");
});

test("unquoted YAML date is normalized to a YYYY-MM-DD string (not a Date)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ppp-"));
  // simulate a note whose scheduled_date was serialized UNQUOTED (YAML parses it as a Date)
  const raw = [
    "---",
    "status: approved",
    "page_id: \"1\"",
    "page_name: Test",
    "scheduled_date: 2026-05-30",
    "scheduled_time: \"09:10\"",
    "---",
    "body text",
  ].join("\n");
  await writeFile(path.join(dir, "2026-05-30__test__0.md"), raw, "utf8");
  const [note] = await listNotes(dir);
  assert.equal(typeof note.frontmatter.scheduled_date, "string");
  assert.equal(note.frontmatter.scheduled_date, "2026-05-30");
});
