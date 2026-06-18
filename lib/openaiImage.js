// lib/openaiImage.js — generate a FULL broadcast-style geopolitical map graphic via OpenAI gpt-image-1.
// Unlike lib/gemini.js (which paints only a background for the code to overlay), this returns the
// COMPLETE image: a clean TV/news explainer map with the red circle / effect-radius rings and the
// short in-map labels baked in by the model. Returns a PNG Buffer, or null on ANY failure so the
// caller can skip the story without breaking the run.
// Env: OPENAI_API_KEY. Optional OPENAI_IMAGE_MODEL (default gpt-image-1), OPENAI_IMAGE_QUALITY (default "medium").
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

export async function openaiImageReady() {
  return Boolean(await envVal("OPENAI_API_KEY"));
}

// Generate one square PNG from a prompt. timeoutMs is generous — gpt-image-1 can take 30-60s.
export async function generateImage(prompt, { timeoutMs = 90000, size = "1024x1024" } = {}) {
  const key = await envVal("OPENAI_API_KEY");
  if (!key) return null;
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const quality = process.env.OPENAI_IMAGE_QUALITY || "medium";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: prompt.slice(0, 4000), size, quality, n: 1 }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    if (d.error) { console.log(`  openai-image: ${d.error.message}`); return null; }
    const b64 = d?.data?.[0]?.b64_json;
    if (!b64) { console.log("  openai-image: no image in response"); return null; }
    return Buffer.from(b64, "base64");
  } catch (e) {
    console.log(`  openai-image error: ${e.message || e}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}
