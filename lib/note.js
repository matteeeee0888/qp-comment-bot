// lib/note.js
import matter from "gray-matter";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

export function serializeNote(frontmatter, body = "") {
  return matter.stringify(body, frontmatter);
}

export function parseNote(text) {
  const { data, content } = matter(text);
  // YAML auto-parses an unquoted ISO date (scheduled_date: 2026-05-30) into a Date
  // object; normalize it back to a "YYYY-MM-DD" string so downstream code (tz math,
  // filename, comparisons) always gets a string.
  if (data.scheduled_date instanceof Date) {
    data.scheduled_date = data.scheduled_date.toISOString().slice(0, 10);
  }
  return { frontmatter: data, body: content.trim() };
}

// The note body may end with an Obsidian image embed (so the image previews in
// Obsidian). That embed must NOT be sent to Facebook — strip any line that is only
// an Obsidian wikilink embed (![[...]]) or a markdown image (![](...)).
export function messageFromBody(body) {
  return String(body || "")
    .split("\n")
    .filter((line) => !/^\s*!\[\[[^\]]*\]\]\s*$/.test(line) && !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line))
    .join("\n")
    .trim();
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function noteFilename(slot) {
  return `${slot.scheduled_date}__${slugify(slot.page_name)}__${slot.slot_index}.md`;
}

export async function writeNote(dir, slot, { overwrite = false } = {}) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, noteFilename(slot));
  if (!overwrite) {
    try {
      await readFile(file);
      return file; // already exists — do not overwrite
    } catch {
      // file does not exist; fall through to create it
    }
  }
  const fm = {
    status: "draft",
    page_id: slot.page_id,
    page_name: slot.page_name,
    topic: slot.topic,
    tier: slot.tier || "",
    scheduled_date: slot.scheduled_date,
    scheduled_time: slot.scheduled_time || "",
    image: "",
    image_source: "none",
    source_url: "",
    post_id: "",
    error_reason: "",
  };
  await writeFile(file, serializeNote(fm, "<!-- write the post body here -->"), "utf8");
  return file;
}

export async function listNotes(dir) {
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(dir, f);
    const { frontmatter, body } = parseNote(await readFile(p, "utf8"));
    out.push({ path: p, frontmatter, body });
  }
  return out;
}

export async function updateNote(p, patch) {
  const { frontmatter, body } = parseNote(await readFile(p, "utf8"));
  const merged = { ...frontmatter, ...patch };
  await writeFile(p, serializeNote(merged, body), "utf8");
  return merged;
}
