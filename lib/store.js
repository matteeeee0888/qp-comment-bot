// lib/store.js — JSON post records, one file per record, in state/posts/.
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./note.js";

export function recordId(slot) {
  return `${slot.scheduled_date}__${slugify(slot.page_name)}__${slot.slot_index}`;
}

export async function writeRecord(dir, record) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.id}.json`);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function readRecord(dir, id) {
  return JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8"));
}

export async function listRecords(dir) {
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));
  }
  return out;
}

export async function updateRecord(dir, id, patch) {
  const rec = await readRecord(dir, id);
  const merged = { ...rec, ...patch };
  await writeRecord(dir, merged);
  return merged;
}
