// lib/slack.js — post a "this comment could inspire an ad" note to the #copywriting Slack channel.
// Uses a Slack INCOMING WEBHOOK (channel is fixed when the webhook is created, so the URL itself
// targets #copywriting). Env: SLACK_COPYWRITING_WEBHOOK_URL (fallback SLACK_WEBHOOK_URL).
// NON-FATAL by design: always logs locally; only also POSTs if a webhook is configured.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

async function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const p of [path.join(repoRoot, ".env"), path.resolve(repoRoot, "../.env")]) {
    try { const t = await readFile(p, "utf8"); const m = t.match(new RegExp("^" + name + "=(.+)$", "m")); if (m) return m[1].trim(); } catch {}
  }
  return "";
}

function clip(s, n) { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// { message, productName, pageName, postUrl, commentId }
export async function sendCopyInspo({ message, productName, pageName, postUrl, commentId }) {
  const product = productName || "QuietProtector";
  const headline = `Check this comment out for "${product}" — it can be an inspo for an Ad`;
  const quoted = clip(message, 1500).split("\n").map((l) => `> ${l}`).join("\n");
  const ctxBits = [pageName ? `*Page:* ${pageName}` : "", postUrl ? `<${postUrl}|View the post>` : ""].filter(Boolean);

  const payload = {
    text: `${headline}\n${quoted}`,            // notification + plain-text fallback
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:speech_balloon: *${headline}*` } },
      { type: "section", text: { type: "mrkdwn", text: clip(quoted, 2900) } },
      ...(ctxBits.length ? [{ type: "context", elements: [{ type: "mrkdwn", text: ctxBits.join("  ·  ") }] }] : []),
    ],
  };

  // 1) Always log locally so nothing is lost even without a webhook configured.
  const logDir = path.join(repoRoot, "state");
  await mkdir(logDir, { recursive: true }).catch(() => {});
  await appendFile(path.join(logDir, "copy-inspo.log"),
    `\n=== ${new Date().toISOString()} · ${product} · comment ${commentId || "?"} ===\n${headline}\n${clip(message, 1500)}\n${postUrl || ""}\n`).catch(() => {});

  // 2) POST to Slack if a webhook is set.
  const url = (await envVal("SLACK_COPYWRITING_WEBHOOK_URL")) || (await envVal("SLACK_WEBHOOK_URL"));
  if (!url) return { sent: "log", reason: "no webhook configured" };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { sent: "slack" };
    return { sent: "log", error: `slack ${r.status}: ${clip(await r.text(), 200)}` };
  } catch (e) { return { sent: "log", error: String(e.message || e) }; }
}
