// lib/archive.js — append every comment to a Google Sheet via an Apps Script web app.
// Secrets: SHEET_WEBHOOK_URL (deployed web-app URL), SHEET_WEBHOOK_TOKEN (shared secret).
// Fire-and-forget: archiving never blocks or breaks a comment run.
import { readFile } from "node:fs/promises";
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

let _url, _token, _loaded = false;
async function load() {
  if (_loaded) return;
  _url = await envVal("SHEET_WEBHOOK_URL");
  _token = await envVal("SHEET_WEBHOOK_TOKEN");
  _loaded = true;
}

export async function archiveComment({ comment, page, product, brain, source }) {
  await load();
  if (!_url) return { skipped: true };
  const row = {
    token: _token,
    tab: "Comments",
    captured_at: new Date().toISOString(),
    page_name: page?.page_name || "",
    page_id: page?.page_id || "",
    source: source || "post",
    comment_id: comment?.id || "",
    author: comment?.from?.name || "",
    author_id: comment?.from?.id || "",
    message: comment?.message || "",
    created_time: comment?.created_time || "",
    product: product || "",
    category: brain?.category || "",
    action: brain?.action || "",
    reply: brain?.reply || "",
  };
  try {
    const r = await fetch(_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(row), redirect: "follow" });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Append the daily news shortlist to the "News" tab in ONE request (rows = array of plain objects).
// Same webhook + token as comments; the Apps Script routes by the "tab" field.
export async function archiveNews(rows) {
  await load();
  if (!_url) return { skipped: true };
  if (!Array.isArray(rows) || !rows.length) return { skipped: "no rows" };
  try {
    const r = await fetch(_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: _token, tab: "News", rows }),
      redirect: "follow",
    });
    // Apps Script ALWAYS returns HTTP 200 (even for "forbidden"/"error:"), so trust the BODY:
    // a successful write replies "ok <n>". Anything else means the deploy/token is wrong.
    const body = (await r.text()).slice(0, 300).trim();
    return { ok: r.ok && /^ok/i.test(body), status: r.status, body, count: rows.length };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
