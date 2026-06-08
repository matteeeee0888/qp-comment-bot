// lib/alert.js — risky-comment alerts. Always logs locally; emails via Resend if RESEND_API_KEY is set.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const TO = process.env.ALERT_EMAIL || "support@quietprotector.com";

async function envVal(name) {
  if (process.env[name]) return process.env[name];
  for (const p of [path.join(repoRoot, ".env"), path.resolve(repoRoot, "../.env")]) {
    try { const t = await readFile(p, "utf8"); const m = t.match(new RegExp("^" + name + "=(.+)$", "m")); if (m) return m[1].trim(); } catch {}
  }
  return "";
}

export async function sendAlert({ comment, page, product, category, stamp }) {
  const subject = `[QP comment alert] ${category} on ${page.page_name}`;
  const body =
    `A risky comment needs human review.\n\n` +
    `Page: ${page.page_name} (${page.page_id})\n` +
    `Product: ${product || "(undetected)"}\n` +
    `Category: ${category}\n` +
    `From: ${comment.from?.name || "?"}\n` +
    `Comment: "${comment.message}"\n` +
    `Comment ID: ${comment.id}\n` +
    `Posted: ${comment.created_time || ""}\n`;

  // 1) Always log locally (so nothing is lost even without an email sender configured).
  const logDir = path.join(repoRoot, "state");
  await mkdir(logDir, { recursive: true }).catch(() => {});
  await appendFile(path.join(logDir, "risky-alerts.log"), `\n=== ${stamp || ""} ===\nTo: ${TO}\n${subject}\n${body}\n`).catch(() => {});

  // 2) Email via Resend if configured.
  const resend = await envVal("RESEND_API_KEY");
  if (resend) {
    try {
      const from = (await envVal("ALERT_FROM")) || "alerts@quietprotector.com";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [TO], subject, text: body }),
      });
      if (r.ok) return { sent: "email" };
      return { sent: "log", error: `resend ${r.status}` };
    } catch (e) { return { sent: "log", error: String(e.message || e) }; }
  }
  return { sent: "log" };
}
