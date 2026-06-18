// lib/gemini.js — generate a photoreal BACKGROUND image via the Gemini API (Nano Banana / Flash Image).
// Returns a PNG Buffer, or null on ANY failure (missing key, error, timeout) so the caller can fall
// back to code-only rendering — the hybrid never breaks the pipeline.
// Env: GEMINI_API_KEY (Google AI Studio). Optional GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image).
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

export async function geminiReady() {
  return Boolean(await envVal("GEMINI_API_KEY"));
}

// Wrap the scene with framing rules: photoreal, NO text/logos, square, dark headroom for overlays.
function framePrompt(scene) {
  return `Photorealistic, cinematic, editorial wide shot. ${scene}. Square 1:1 composition. Moody, slightly desaturated, dramatic natural light. Absolutely NO text, NO words, NO captions, NO logos, NO watermarks, NO UI. Keep the top ~15% and bottom ~20% darker and uncluttered (negative space for overlays). No identifiable real people or faces.`;
}

// Core call: send a prompt to Gemini's image model, return a PNG Buffer or null on ANY failure.
async function geminiImage(promptText, timeoutMs) {
  const key = await envVal("GEMINI_API_KEY");
  if (!key) return null;
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: ctrl.signal,
    });
    const d = await r.json();
    if (d.error) { console.log(`  gemini: ${d.error.message}`); return null; }
    const parts = d?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData?.data);
    if (!img) { console.log("  gemini: no image in response"); return null; }
    return Buffer.from(img.inlineData.data, "base64");
  } catch (e) {
    console.log(`  gemini error: ${e.message || e}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Photoreal BACKGROUND for the code-overlay weather hybrid (adds the framing/headroom rules).
export async function generateBackground(scene, { timeoutMs = 45000 } = {}) {
  return geminiImage(framePrompt(scene), timeoutMs);
}

// FULL image from a complete prompt (e.g. the geopolitical-map prompt) — sent as-is, no extra framing.
export async function generateFullImage(prompt, { timeoutMs = 60000 } = {}) {
  return geminiImage(String(prompt || ""), timeoutMs);
}
