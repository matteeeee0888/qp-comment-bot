#!/usr/bin/env node
// bin/commit-state.js — best-effort: commit state/ + map and push. NEVER fails the run.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/env.js";

// Honor the kill switch: don't commit/push state unless explicitly enabled in config.
const cfg = await loadConfig().catch(() => ({}));
if (!cfg?.github?.commitState) {
  console.log("state: commit/push disabled (config.github.commitState=false) — skipping");
  process.exit(0);
}

const pExecFile = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const run = (args) => pExecFile("git", ["-C", repoRoot, ...args], { timeout: 60000 });

try {
  await run(["add", "state", "page-topic-map.json"]);
  // Nothing staged? `git diff --cached --quiet` exits 0 when clean -> skip commit.
  try {
    await run(["diff", "--cached", "--quiet"]);
    console.log("state: nothing to commit");
    process.exit(0);
  } catch {
    /* staged changes present — proceed */
  }
  const stamp = process.argv.slice(2).join(" ") || "auto: update posting state";
  await run(["commit", "-m", stamp]);
  await run(["push", "origin", "HEAD"]);
  console.log("state: committed + pushed");
} catch (e) {
  // Best-effort: log only. Posting already succeeded; the wrapper Telegrams a warning.
  console.error(`commit-state warning (non-fatal): ${e.message}`);
  process.exit(3);
}
