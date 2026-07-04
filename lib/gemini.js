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
  return `Photorealistic, cinematic, editorial wide establishing shot. ${scene}. 16:9 widescreen landscape composition, full-bleed horizontal framing. Moody, slightly desaturated, dramatic natural light. Absolutely NO text, NO words, NO captions, NO logos, NO watermarks, NO UI. Keep the top ~15% and bottom ~20% darker and uncluttered (negative space for overlays). No identifiable real people or faces.`;
}

// Core call: send a prompt (+ optional reference images) to Gemini's image model, return a PNG
// Buffer or null on ANY failure. refs: [{ data:<base64>, mimeType }] are attached as style guides.
async function geminiImage(promptText, timeoutMs, refs = [], aspectRatio = null) {
  const key = await envVal("GEMINI_API_KEY");
  if (!key) return null;
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const reqParts = [
      ...refs.map((rf) => ({ inlineData: { mimeType: rf.mimeType || "image/png", data: rf.data } })),
      { text: promptText },
    ];
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: reqParts }],
        generationConfig: { responseModalities: ["IMAGE"], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) },
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
export async function generateBackground(scene, { timeoutMs = 45000, aspectRatio = "16:9" } = {}) {
  return geminiImage(framePrompt(scene), timeoutMs, [], aspectRatio);
}

// FULL image from a complete prompt (e.g. the geopolitical-map prompt), sent as-is. Optional refs
// ([{data:<base64>, mimeType}]) are attached as style references to match a house look.
export async function generateFullImage(prompt, { timeoutMs = 60000, refs = [], aspectRatio = null } = {}) {
  return geminiImage(String(prompt || ""), timeoutMs, refs, aspectRatio);
}
