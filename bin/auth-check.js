#!/usr/bin/env node
// bin/auth-check.js — fast pre-run gate. Verifies the Meta token works and the CLIs exist.
// Exits non-zero with a reason on failure so the wrapper can Telegram + abort.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import os from "node:os";

export async function checkMetaToken({ token, graphVersion, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${graphVersion}/me?access_token=${token}`);
    const data = await res.json();
    if (data.error) return { ok: false, reason: data.error.message };
    if (!data.id) return { ok: false, reason: "no id from /me" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadToken, loadConfig } = await import("../lib/env.js");
  const problems = [];
  const home = os.homedir();
  for (const p of [path.join(home, ".local/bin/claude"), path.join(home, ".codex/auth.json")]) {
    try { await access(p); } catch { problems.push(`missing ${p}`); }
  }
  try {
    const cfg = await loadConfig();
    const token = await loadToken(cfg.tokenEnvPath);
    const r = await checkMetaToken({ token, graphVersion: cfg.graphVersion });
    if (!r.ok) problems.push(`Meta token: ${r.reason}`);
  } catch (e) {
    problems.push(`config/token load: ${e.message}`);
  }
  if (problems.length) {
    console.error(problems.join("; "));
    process.exit(1);
  }
  console.log("auth OK");
}
