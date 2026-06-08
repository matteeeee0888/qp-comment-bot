#!/usr/bin/env node
// bin/notify.js "<text>"  — send a plain Telegram message using credentials in telegram.env.
// bin/notify.js --summary  — send this run's full posts (image + full text) from state/last-run.json.
// bin/notify.js --digest   — send a compact one-line-per-post summary from state/last-run.json.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage, sendRunPosts, buildRunSummary } from "../lib/notify.js";

function parseEnv(text, key) {
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

async function loadRun() {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const lastRunPath = path.join(repoRoot, "state", "last-run.json");
  return JSON.parse(await readFile(lastRunPath, "utf8"));
}

const args = process.argv.slice(2);
const envPath = path.join(os.homedir(), ".claude/credentials/telegram.env");
try {
  const env = await readFile(envPath, "utf8");
  const token = parseEnv(env, "TELEGRAM_BOT_TOKEN");
  const chatId = parseEnv(env, "TELEGRAM_CHAT_ID");
  if (!token || !chatId) throw new Error("missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

  if (args.includes("--summary")) {
    // Full posts: header, then each post as image + full caption (text-only fallback if no image).
    let run;
    try {
      run = await loadRun();
    } catch (e) {
      await sendMessage({ token, chatId, text: `📅 Pet posts: run summary unavailable (${e.message}).` });
      console.log("sent");
      process.exit(0);
    }
    await sendRunPosts({ token, chatId, run });
    console.log("sent");
  } else {
    // --digest reads last-run.json for the compact summary; otherwise send the literal text arg.
    let text;
    if (args.includes("--digest")) {
      try {
        text = buildRunSummary(await loadRun());
      } catch (e) {
        text = `📅 Pet posts: run summary unavailable (${e.message}).`;
      }
    } else {
      text = args.join(" ") || "(empty)";
    }
    const r = await sendMessage({ token, chatId, text });
    if (!r.ok) throw new Error(JSON.stringify(r));
    console.log("sent");
  }
} catch (e) {
  console.error(`notify failed: ${e.message}`);
  process.exitCode = 1; // non-fatal to the run; the wrapper logs but continues
}
