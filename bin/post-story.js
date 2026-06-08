#!/usr/bin/env node
// bin/post-story.js --page <pageId> --image <path> [--dry-run]
// Publishes a single Facebook Page photo Story IMMEDIATELY. Stories cannot be scheduled, so this
// posts now and the Story disappears after ~24h. Use a vertical 9:16 image (gen-image.sh --story).
import { loadToken, loadConfig } from "../lib/env.js";
import { MetaClient } from "../lib/metaClient.js";
import { isValidImage } from "../lib/imageCheck.js";

const a = process.argv.slice(2);
const args = {};
for (let i = 0; i < a.length; i++) {
  if (a[i] === "--dry-run") { args.dryRun = true; continue; }
  if (a[i].startsWith("--")) { args[a[i].slice(2)] = a[i + 1]; i++; }
}

if (!args.page || !args.image) {
  console.error("usage: post-story.js --page <pageId> --image <path> [--dry-run]");
  process.exit(2);
}
if (!(await isValidImage(args.image))) {
  console.error(`invalid or missing image: ${args.image}`);
  process.exit(1);
}
if (args.dryRun) {
  console.log(`[dry-run] would publish a photo Story to page ${args.page} from ${args.image}`);
  process.exit(0);
}

const cfg = await loadConfig();
const token = await loadToken(cfg.tokenEnvPath);
const meta = new MetaClient({ token, graphVersion: cfg.graphVersion });
const res = await meta.publishPhotoStory(args.page, { imagePath: args.image });
console.log(JSON.stringify(res));
