// lib/supabase.js — upload a PNG buffer to Supabase Storage (REST) and return its public URL.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET. The bucket must be PUBLIC for the
// sheet's =IMAGE() preview to load. Read-from-.env mirrors the rest of the app (works locally + CI).
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

let _cfg, _loaded = false;
async function load() {
  if (_loaded) return _cfg;
  _cfg = {
    url: (await envVal("SUPABASE_URL")).replace(/\/$/, ""),
    key: await envVal("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: await envVal("SUPABASE_BUCKET"),
  };
  _loaded = true;
  return _cfg;
}

export async function supabaseReady() {
  const c = await load();
  return Boolean(c.url && c.key && c.bucket);
}

// objectPath e.g. "news/2026-06-13/terrashell-ab12cd.png"
export async function uploadPNG(objectPath, buffer) {
  const c = await load();
  if (!c.url || !c.key || !c.bucket) return { skipped: true, reason: "supabase env missing" };
  const dest = `${c.url}/storage/v1/object/${c.bucket}/${objectPath}`;
  try {
    const r = await fetch(dest, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.key}`,
        apikey: c.key,
        "content-type": "image/png",
        "x-upsert": "true",
        "cache-control": "86400",
      },
      body: buffer,
    });
    const body = (await r.text()).slice(0, 300);
    if (!r.ok) return { ok: false, status: r.status, body };
    return { ok: true, url: `${c.url}/storage/v1/object/public/${c.bucket}/${objectPath}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
