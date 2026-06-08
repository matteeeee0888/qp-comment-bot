// lib/notify.js — Telegram is the human-readable archive (there is no vault now).

// Telegram rejects photo captions longer than this; longer copy is sent as a follow-up message.
export const TELEGRAM_CAPTION_LIMIT = 1024;

// One-line-per-post digest (kept for callers/tests that want a compact summary).
export function buildRunSummary({ scheduled = [], posted = [], errors = [] }) {
  const lines = [`📅 Pet posts: ${scheduled.length} scheduled, ${posted.length} posted, ${errors.length} error(s).`];
  for (const p of scheduled) {
    const first = String(p.message || "").split("\n")[0];
    lines.push(`• ${p.page_name} — ${p.scheduled_date} ${p.scheduled_time}: ${first}`);
  }
  for (const p of posted) {
    const first = String(p.message || "").split("\n")[0];
    lines.push(`✅ ${p.page_name} — posted now: ${first}`);
  }
  for (const e of errors) lines.push(`⚠️ ${e.id || ""}: ${e.error}`);
  return lines.join("\n");
}

// Compact header: just the counts and any errors (the full posts follow as their own messages).
export function buildRunHeader({ scheduled = [], posted = [], errors = [] }) {
  const lines = [`📅 Pet posts: ${scheduled.length} scheduled, ${posted.length} posted, ${errors.length} error(s).`];
  for (const e of errors) lines.push(`⚠️ ${e.id || ""}: ${e.error}`);
  return lines.join("\n");
}

function postHeadline(p) {
  return `${p.page_name} — ${p.scheduled_date || ""} ${p.scheduled_time || ""}`.trim();
}

// Full caption for a post: a headline line plus the exact Facebook copy.
export function postCaption(p) {
  return `${postHeadline(p)}\n\n${p.message || ""}`.trim();
}

// Send a run as the real posts: a header, then one photo+caption per post (full text as it will
// appear on Facebook). Over-long captions are split — photo with just the headline, then the full
// copy as a follow-up message — so nothing is truncated. Posts without an image fall back to text.
// `send` is injectable for testing.
export async function sendRunPosts({
  token,
  chatId,
  run,
  send = { sendMessage, sendPhoto },
  limit = TELEGRAM_CAPTION_LIMIT,
}) {
  const { scheduled = [], posted = [], errors = [] } = run || {};
  await send.sendMessage({ token, chatId, text: buildRunHeader({ scheduled, posted, errors }) });
  for (const p of [...scheduled, ...posted]) {
    const caption = postCaption(p);
    if (p.image_path) {
      if (caption.length <= limit) {
        await send.sendPhoto({ token, chatId, imagePath: p.image_path, caption });
      } else {
        await send.sendPhoto({ token, chatId, imagePath: p.image_path, caption: postHeadline(p) });
        await send.sendMessage({ token, chatId, text: p.message || "" });
      }
    } else {
      await send.sendMessage({ token, chatId, text: caption });
    }
  }
}

export async function sendMessage({ token, chatId, text, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.json();
}

export async function sendPhoto({ token, chatId, imagePath, caption, fetchImpl = fetch, readFileImpl }) {
  // http(s) image: let Telegram fetch it directly (JSON body) — no local file to read.
  if (/^https?:\/\//.test(imagePath)) {
    const body = { chat_id: chatId, photo: imagePath };
    if (caption) body.caption = caption;
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }
  const { readFile } = readFileImpl ? { readFile: readFileImpl } : await import("node:fs/promises");
  const path = await import("node:path");
  const buf = await readFile(imagePath);
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption);
  form.set("photo", new Blob([buf]), path.basename(imagePath));
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  return res.json();
}
