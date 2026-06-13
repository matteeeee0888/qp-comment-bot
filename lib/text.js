// lib/text.js — pluggable text generation backend.
// Engine auto-detected (override with TEXT_ENGINE=claude|anthropic|openai):
//   ANTHROPIC_API_KEY set → "anthropic" (Claude API, for cloud/CI)
//   OPENAI_API_KEY set    → "openai"
//   otherwise             → "claude" (local Claude CLI, uses your subscription)
// genJSON(system, user) returns the parsed JSON object the model produced.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pExecFile = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

async function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const p of [path.join(repoRoot, ".env"), path.resolve(repoRoot, "../.env")]) {
    try { const t = await readFile(p, "utf8"); const m = t.match(new RegExp("^" + name + "=(.+)$", "m")); if (m) return m[1].trim(); } catch {}
  }
  return "";
}

const ENGINE = (process.env.TEXT_ENGINE || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "claude")).toLowerCase();

function stripFences(s) {
  return String(s).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function claudeJSON(system, user) {
  const prompt = `${system}\n\n${user}\n\nRespond with ONLY the JSON object — no prose, no markdown, no code fences.`;
  const bin = process.env.CLAUDE_BIN || "claude";
  const args = ["-p", prompt, "--output-format", "json"];
  if (process.env.GEN_TEXT_MODEL) args.push("--model", process.env.GEN_TEXT_MODEL);
  const { stdout } = await pExecFile(bin, args, { maxBuffer: 8 << 20, timeout: 120000 });
  let env;
  try { env = JSON.parse(stdout); } catch { return JSON.parse(stripFences(stdout)); }
  if (env.is_error) throw new Error(`claude CLI: ${env.result || "error"} (logged in? run: claude  then /login)`);
  return JSON.parse(stripFences(env.result));
}

async function anthropicJSON(system, user, maxTokens = 1024) {
  const key = await envVal("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.GEN_TEXT_MODEL || "claude-haiku-4-5-20251001";
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: `${user}\n\nRespond with ONLY the JSON object, no prose, no code fences.` }] });
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body,
    });
    if (r.status === 429 && attempt < 4) {
      const wait = (Number(r.headers.get("retry-after")) || 12 * (attempt + 1)) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    const d = await r.json();
    if (d.error) throw new Error(`anthropic: ${d.error.message}`);
    return JSON.parse(stripFences(d.content?.[0]?.text || ""));
  }
  throw new Error("anthropic: rate-limited after retries");
}

async function openaiJSON(system, user, maxTokens = 1024) {
  const key = await envVal("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const model = process.env.GEN_TEXT_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.7, max_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`OpenAI text: ${d.error.message}`);
  return JSON.parse(d.choices[0].message.content);
}

export async function genJSON(system, user, opts = {}) {
  const maxTokens = opts.maxTokens || 1024;
  if (ENGINE === "anthropic") return anthropicJSON(system, user, maxTokens);
  if (ENGINE === "openai") return openaiJSON(system, user, maxTokens);
  return claudeJSON(system, user); // local CLI has no token cap to thread
}

export const TEXT_ENGINE = ENGINE;
