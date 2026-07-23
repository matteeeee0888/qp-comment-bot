#!/usr/bin/env node
// bin/fill-record.js — the ONLY path from a scaffolded record to "approved".
// Enforces integrity (non-empty message, no duplicate body, no reused source image,
// valid image file). The AI step calls this; it never edits records directly.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { readRecord, updateRecord } from "../lib/store.js";
import { loadDedup, saveDedup, hashBody, isDuplicateBody, isReusedImage, isLinkTakenOnDate, isSceneRecentlyUsed, recordUsage } from "../lib/dedup.js";
import { isValidImage } from "../lib/imageCheck.js";

export async function fillRecord({ storeDir, workDir, dedupFile, id, message, imagePath, imageSource, sourceUrl, link, postType, scene, sceneHash }) {
  const record = await readRecord(storeDir, id);
  const msg = String(message || "").trim();
  if (!msg) return { ok: false, reason: "empty message" };

  const dedup = await loadDedup(dedupFile);
  const bodyHash = hashBody(msg);
  if (isDuplicateBody(dedup, bodyHash)) return { ok: false, reason: "duplicate body text" };

  const imageKey = imageSource === "sourced" ? String(sourceUrl || "") : "gen";
  if (isReusedImage(dedup, imageKey)) return { ok: false, reason: "reused sourced image" };

  // Anti-collision: no two pages carry the same link on the same day; no repeated photo scene.
  if (link && isLinkTakenOnDate(dedup, record.scheduled_date, link)) return { ok: false, reason: "link already used by another page today" };
  if (sceneHash && isSceneRecentlyUsed(dedup, sceneHash, record.scheduled_date)) return { ok: false, reason: "photo scene used recently" };

  let finalImagePath = "";
  if (imageSource && imageSource !== "none") {
    if (/^https?:\/\//.test(String(imagePath))) {
      // A remote image (e.g. a Supabase URL from a Gemini photo) — the upload already validated the
      // bytes, and the URL must survive a re-run on a fresh CI runner, so keep it as-is (no local copy).
      finalImagePath = imagePath;
    } else {
      if (!(await isValidImage(imagePath))) return { ok: false, reason: "invalid or missing image file" };
      await mkdir(workDir, { recursive: true });
      finalImagePath = path.join(workDir, `${id}${path.extname(imagePath) || ".png"}`);
      await copyFile(imagePath, finalImagePath);
    }
  }

  await updateRecord(storeDir, id, {
    status: "approved",
    message: msg,
    image_path: finalImagePath,
    image_source: finalImagePath ? imageSource : "none",
    source_url: String(sourceUrl || ""),
    link: String(link || ""),
    post_type: postType || record.post_type || "",
    scene: scene || "",
    body_hash: bodyHash,
    image_key: imageKey,
    error_reason: "",
  });
  await saveDedup(dedupFile, recordUsage(dedup, { pageId: record.page_id, bodyHash, imageKey, topic: record.topic, link: String(link || ""), date: record.scheduled_date, sceneHash }));
  return { ok: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import("../lib/env.js");
  const args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) { args[a[i].slice(2)] = a[i + 1]; i++; }
  }
  const cfg = await loadConfig();
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const storeDir = path.resolve(repoRoot, cfg.store.dir);
  const workDir = path.resolve(repoRoot, "state/work");
  const dedupFile = path.resolve(repoRoot, "state/dedup.json");
  const message = args["message-file"] ? await readFile(args["message-file"], "utf8") : args.message;
  const r = await fillRecord({
    storeDir, workDir, dedupFile, id: args.id, message,
    imagePath: args.image, imageSource: args["image-source"] || "generated", sourceUrl: args["source-url"] || "",
    link: args.link || "",
  });
  console.log(JSON.stringify(r));
  if (!r.ok) process.exitCode = 1;
}
