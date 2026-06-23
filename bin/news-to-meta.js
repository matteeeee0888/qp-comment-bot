#!/usr/bin/env node
// bin/news-to-meta.js — after the daily news run, push today's news PNGs into the Meta
// ad-account IMAGE LIBRARY (/adimages) so they're ready to pick when building ads by hand.
// NO campaign / ad set / ad — just the media. Idempotent: Meta dedupes images by content,
// so re-runs return the same hashes and create no duplicates.
//
// Designed to run in the SAME GitHub Actions job as news-run.js, right after the Supabase
// image upload + Google Sheet write. NON-FATAL by design: it logs problems and exits 0 so
// it can never break the news pipeline.
//
// Env (already secrets in this repo): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SUPABASE_BUCKET, META_ACCESS_TOKEN (system-user token, ads_management).
//   META_AD_ACCOUNTS — comma-separated act_... (default = Ecom Dom 6 + Ecom Dom 2).
//
// Usage:
//   node bin/news-to-meta.js                 # today's news/<UTC-date>/ -> both accounts
//   node bin/news-to-meta.js --day 2026-06-23
//   node bin/news-to-meta.js --account act_1717140845821490
//   node bin/news-to-meta.js --dry           # list what WOULD upload, no writes
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const GRAPH = "https://graph.facebook.com/v21.0";
// Business QuietProtector — Ecom Dom 6, Ecom Dom 2
const DEFAULT_ACCOUNTS = ["act_1679520323501043", "act_1717140845821490"];

async function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const p of [path.join(repoRoot, ".env"), path.resolve(repoRoot, "../.env")]) {
    try {
      const t = await readFile(p, "utf8");
      const m = t.match(new RegExp("^" + name + "=(.+)$", "m"));
      if (m) return m[1].trim();
    } catch {}
  }
  return "";
}

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const DAY = getArg("--day", new Date().toISOString().slice(0, 10)); // matches news-run todayISO

async function sbList(cfg, prefix) {
  const r = await fetch(`${cfg.url}/storage/v1/object/list/${cfg.bucket}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } }),
  });
  if (!r.ok) throw new Error(`supabase list ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).filter((e) => e.id).map((e) => e.name);
}

async function sbDownload(cfg, objectPath) {
  const r = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`, {
    headers: { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key },
  });
  if (!r.ok) throw new Error(`supabase get ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function uploadAdImage(token, account, name, buf) {
  const form = new FormData();
  form.set("access_token", token);
  form.set("filename", new Blob([buf]), name); // field "filename"; response keyed by this name
  const r = await fetch(`${GRAPH}/${account}/adimages`, { method: "POST", body: form });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.images[name].hash;
}

async function main() {
  const cfg = {
    url: (await envVal("SUPABASE_URL")).replace(/\/$/, ""),
    key: await envVal("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: await envVal("SUPABASE_BUCKET"),
  };
  const token = await envVal("META_ACCESS_TOKEN");
  const accEnv = await envVal("META_AD_ACCOUNTS");
  const accounts = argv.includes("--account")
    ? [getArg("--account")]
    : (accEnv ? accEnv.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ACCOUNTS);

  if (!cfg.url || !cfg.key || !cfg.bucket) { console.log("news-to-meta: Supabase env missing — skip"); return; }
  if (!token) { console.log("news-to-meta: META_ACCESS_TOKEN missing — skip"); return; }

  const prefix = `news/${DAY}/`;
  let names;
  try { names = await sbList(cfg, prefix); }
  catch (e) { console.log(`news-to-meta: list failed (${e.message}) — skip`); return; }
  const imgs = names.filter((n) => /\.(png|jpe?g)$/i.test(n));
  console.log(`news-to-meta: ${imgs.length} images in ${prefix} -> ${accounts.length} account(s)${DRY ? " DRY" : ""}`);
  if (!imgs.length) return;

  const buffers = {};
  for (const n of imgs) {
    try { buffers[n] = await sbDownload(cfg, prefix + n); }
    catch (e) { console.log(`  download fail ${n}: ${e.message}`); }
  }

  for (const acct of accounts) {
    let ok = 0;
    for (const n of imgs) {
      if (!buffers[n]) continue;
      if (DRY) { console.log(`  [${acct}] would upload ${n}`); ok++; continue; }
      try { const h = await uploadAdImage(token, acct, n, buffers[n]); ok++; console.log(`  [${acct}] ${n} -> ${h}`); }
      catch (e) { console.log(`  [${acct}] FAIL ${n}: ${String(e.message || e).slice(0, 160)}`); }
    }
    console.log(`  [${acct}] ${ok}/${imgs.length} in library`);
  }
}

main().catch((e) => { console.log(`news-to-meta: non-fatal error ${e.message || e}`); });
