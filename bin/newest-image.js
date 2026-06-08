#!/usr/bin/env node
// bin/newest-image.js [sinceEpochSeconds]
// Prints the absolute path of the newest ig_*.png under ~/.codex/generated_images created
// at/after the given epoch-seconds (default 0 = newest overall). Empty output if none.
// codex saves images here but does not reliably print the path (launchd spike finding).
import os from "node:os";
import path from "node:path";
import { newestImageSince } from "../lib/codexImage.js";

const sinceSec = Number(process.argv[2] || 0);
const genDir = path.join(os.homedir(), ".codex", "generated_images");
const img = await newestImageSince(genDir, sinceSec * 1000);
if (img) console.log(img);
