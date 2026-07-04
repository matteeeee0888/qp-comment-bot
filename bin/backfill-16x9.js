#!/usr/bin/env node
// bin/backfill-16x9.js — one-time backfill: give EVERY existing News-tab image a NATIVE 16:9
// (1920x1080) companion, WITHOUT touching the square. For each `news/<date>/<slug>.png` already in
// Supabase we reconstruct the story from the slug (brand prefix + de-slugged headline), re-run the
// same art-director (buildSpec / buildSpotlightSpec), paint ONE native-16:9 Gemini scene, render the
// wide layout (big state map over the photo when the story is geographic — else photo/card), and
// upload it to `news/<date>/<slug>-16x9.png`. The square (`<slug>.png`) is never overwritten.
//
// Idempotent + resumable: skips any slug whose -16x9 already exists (unless --force). Paced to stay
// under the Gemini free-tier rate limit; a scene that fails/rate-limits is retried, then falls back
// to a code-only wide render (still native 16:9, just no photo) so no row is left without a 16:9.
//
// Usage (cloud, via the backfill-16x9 workflow — needs ANTHROPIC_API_KEY + GEMINI_API_KEY + SUPABASE_*):
//   node bin/backfill-16x9.js                 # all days, skip already-done
//   node bin/backfill-16x9.js --since 2026-06-25
//   node bin/backfill-16x9.js --limit 20 --dry
//   node bin/backfill-16x9.js --force         # regenerate even if the -16x9 exists
import { listFolder, uploadPNG, supabaseReady } from "../lib/supabase.js";
import { buildSpec } from "../lib/imageBrain.js";
import { buildSpotlightSpec } from "../lib/stateSpotlight.js";
import { generateBackground, geminiReady } from "../lib/gemini.js";
import { specToPNG } from "../lib/newsImage.js";

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DRY = argv.includes("--dry");
const FORCE = argv.includes("--force");
const NO_GEMINI = argv.includes("--no-gemini");
const ALLOW_CODEONLY = argv.includes("--allow-codeonly"); // upload even if the photo scene failed (final mop-up pass)
const LIMIT = parseInt(getArg("--limit", "0"), 10) || 0;   // 0 = no cap
const SINCE = getArg("--since", "");                        // YYYY-MM-DD inclusive lower bound
const DELAY_MS = parseInt(getArg("--delay", "1200"), 10);  // pause between images (rate-limit friendly)
const SCENE_RETRIES = 2;

const BRANDS = ["terrastryke", "terrashell", "terrabolt", "general"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deslug = (s) => s.replace(/-/g, " ").replace(/\s+/g, " ").trim();

// Reconstruct the story/spec inputs from a base slug like "terrastryke-texas-flooding-continues-as".
function parseSlug(slug) {
  const m = slug.match(/^spotlight-([a-z]{2})-\d{4}-\d{2}-\d{2}$/i);
  if (m) return { kind: "spotlight", code: m[1].toUpperCase() };
  const dash = slug.indexOf("-");
  const first = dash >= 0 ? slug.slice(0, dash) : slug;
  if (BRANDS.includes(first)) return { kind: "news", brand: first, headline: deslug(slug.slice(dash + 1)) };
  return { kind: "news", brand: "general", headline: deslug(slug) };  // no known brand prefix → general
}

async function sceneWithRetry(scenePrompt, useGemini) {
  if (!useGemini || !scenePrompt) return null;
  for (let a = 0; a <= SCENE_RETRIES; a++) {
    const bg = await generateBackground(scenePrompt);
    if (bg) return bg;
    if (a < SCENE_RETRIES) await sleep(4000 * (a + 1));   // backoff on null (timeout / 429)
  }
  return null;
}

// Build the WIDE (16:9) spec from a reconstructed spec: bigger states via the map layout when the
// story is geographic, else photo-hero (with a scene) or the code card. 4 callouts for the corners.
function toWide(spec, bg) {
  const hasStates = (spec.regionStates || []).length > 0;
  const wide = { ...spec, wide: true, callouts: (spec.callouts || []).slice(0, 4) };
  wide.layout = hasStates ? "map" : bg ? "photo" : spec.layout || "card";
  if (bg) wide.bgDataUri = `data:image/png;base64,${bg.toString("base64")}`;
  return wide;
}

console.log(`backfill-16x9: ${DRY ? "DRY " : ""}${FORCE ? "FORCE " : ""}since=${SINCE || "-"} limit=${LIMIT || "∞"} delay=${DELAY_MS}ms`);
if (!(await supabaseReady())) { console.log("Supabase env missing — abort."); process.exit(1); }
const useGemini = !NO_GEMINI && (await geminiReady());
console.log(`gemini scenes: ${useGemini ? "on" : "OFF (code-only wide)"}`);

// 1. enumerate every base image (skip -16x9 companions, the _test folder, and non-png)
const dates = (await listFolder("news/")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (!SINCE || d >= SINCE)).sort();
const work = [];
for (const date of dates) {
  const files = await listFolder(`news/${date}/`);
  const bases = files.filter((f) => f.endsWith(".png") && !f.endsWith("-16x9.png"));
  const have16 = new Set(files.filter((f) => f.endsWith("-16x9.png")));
  for (const f of bases) {
    const slug = f.replace(/\.png$/, "");
    if (!FORCE && have16.has(`${slug}-16x9.png`)) continue;   // resumable: already done
    work.push({ date, slug });
  }
}
const total = LIMIT ? Math.min(LIMIT, work.length) : work.length;
console.log(`${dates.length} day(s), ${work.length} image(s) need a 16:9${LIMIT ? ` (capped at ${LIMIT})` : ""}`);
if (DRY) { for (const w of work.slice(0, total)) console.log(`  would do: ${w.date}/${w.slug}  ${JSON.stringify(parseSlug(w.slug))}`); process.exit(0); }

// 2. regenerate a native 16:9 per image
let done = 0, photo = 0, code = 0, fail = 0, skip = 0;
const month = (date) => MONTHS[parseInt(date.slice(5, 7), 10) - 1] || "";
for (const w of work.slice(0, total)) {
  const info = parseSlug(w.slug);
  try {
    let spec;
    if (info.kind === "spotlight") spec = await buildSpotlightSpec({ state: info.code, code: info.code }, { month: month(w.date) });
    else spec = await buildSpec({ title: info.headline, brand: info.brand, angle: "", why: "" });

    const wantScene = useGemini && Boolean(spec.scenePrompt);
    const bg = await sceneWithRetry(spec.scenePrompt, useGemini);
    if (wantScene && !bg && !ALLOW_CODEONLY) {   // quota/rate exhausted → leave it for a later run (no photo-less upload)
      skip++; console.log(`[skip] ${w.date}/${w.slug} — scene unavailable (retry next run)`); await sleep(DELAY_MS); continue;
    }
    const widePng = await specToPNG(toWide(spec, bg));
    const dest = `news/${w.date}/${w.slug}-16x9.png`;
    const up = await uploadPNG(dest, widePng);
    if (up.ok) { done++; bg ? photo++ : code++; console.log(`[${done}/${total}] ${bg ? "photo" : "code "} ${w.date}/${w.slug}-16x9.png`); }
    else { fail++; console.log(`[FAIL upload] ${w.date}/${w.slug}: ${up.status || up.error || up.reason}`); }
  } catch (e) { fail++; console.log(`[FAIL] ${w.date}/${w.slug}: ${e.message || e}`); }
  await sleep(DELAY_MS);
}
console.log(`\nDONE: ${done} uploaded (${photo} photo, ${code} code-only), ${skip} skipped (scene unavailable — re-run to retry), ${fail} failed. ${work.length - total} not attempted this run.`);
