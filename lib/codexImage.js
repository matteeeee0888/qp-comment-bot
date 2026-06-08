// lib/codexImage.js — codex saves images to ~/.codex/generated_images/<session>/ig_*.png
// but its stdout does NOT report the path (confirmed by the launchd spike). So we locate
// the generated file by taking the newest ig_*.png created at/after the moment we invoked it.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

async function* walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function newestImageSince(rootDir, sinceMs) {
  let best = null;
  let bestM = -1;
  for await (const f of walk(rootDir)) {
    const base = path.basename(f);
    if (!base.startsWith("ig_") || !base.endsWith(".png")) continue;
    const m = (await stat(f)).mtimeMs;
    if (m >= sinceMs && m > bestM) {
      bestM = m;
      best = f;
    }
  }
  return best;
}
