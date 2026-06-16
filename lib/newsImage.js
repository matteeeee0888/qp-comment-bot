// lib/newsImage.js — render a broadcast-style "alert" graphic for a news story.
// Pure code (SVG → PNG via @resvg/resvg-js): crisp text, no AI image-gen, no cost.
//   layout "map"  → US map zoomed to the affected states + city dots + corner callouts (weather/regional)
//   layout "card" → big icon + keyword panel + callouts (non-geo: security, car, general prep)
// Shared: red alert header, bottom info bar, product banner.
//
// COMPLIANCE: OUR styling — a "QuietProtector Weather Desk" look. We deliberately do NOT reproduce
// NOAA/NWS/government logos or claim to be an official source (impersonation + Meta policy risk).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const W = 1080, H = 1080;
// map panel geometry (the dark band under the header)
const PX = 40, PY = 176, PW = 1000, PH = 710;

let _map = null;
async function loadMap() {
  if (!_map) _map = JSON.parse(await readFile(path.join(repoRoot, "assets/us-states-paths.json"), "utf8"));
  return _map;
}

const FONT_FILES = [
  "assets/fonts/Anton-Regular.ttf",
  "assets/fonts/BarlowCondensed-Bold.ttf",
  "assets/fonts/BarlowCondensed-SemiBold.ttf",
  "assets/fonts/BarlowCondensed-Medium.ttf",
].map((f) => path.join(repoRoot, f));

const DISPLAY = "Anton, 'Arial Black', Impact, sans-serif";
const COND = "'Barlow Condensed', 'Arial Narrow', sans-serif";

const HAZARD = {
  heat:     { core: "#ff5a1f", watch: "#ffae42", accent: "#ff5a1f", label: "EXTREME HEAT", icon: "sun" },
  storm:    { core: "#e0241a", watch: "#ff8c1a", accent: "#e0241a", label: "SEVERE STORM", icon: "storm" },
  tornado:  { core: "#e0241a", watch: "#ff8c1a", accent: "#e0241a", label: "TORNADO WARNING", icon: "storm" },
  flood:    { core: "#1597b8", watch: "#5fd0e6", accent: "#1597b8", label: "FLOOD WATCH", icon: "storm" },
  cold:     { core: "#2b7bff", watch: "#7fb0ff", accent: "#2b7bff", label: "WINTER STORM", icon: "snow" },
  wind:     { core: "#8a63d2", watch: "#c0a6f0", accent: "#8a63d2", label: "HIGH WIND", icon: "storm" },
  security: { core: "#e0a51a", watch: "#f3cd5e", accent: "#e0a51a", label: "SAFETY ALERT", icon: "lock" },
  car:      { core: "#e0241a", watch: "#ff8c1a", accent: "#e0241a", label: "TRAVEL ALERT", icon: "car" },
  general:  { core: "#e0241a", watch: "#ff8c1a", accent: "#e0241a", label: "PREPAREDNESS ALERT", icon: "shield" },
};

const BRAND = {
  terrashell:  { name: "TerraShell",  accent: "#16a085", tagline: "EMERGENCY THERMAL BIVY · 4 OZ · NO POWER" },
  terrabolt:   { name: "TerraBolt",   accent: "#3b6ea5", tagline: "PORTABLE DOOR LOCK · TRAVEL & HOME · 24H SHIP" },
  terrastryke: { name: "TerraStryke", accent: "#e8821e", tagline: "CAR-ESCAPE TOOL · WINDOW BREAKER + CUTTER" },
  general:     { name: "QuietProtector", accent: "#c0392b", tagline: "BE READY · EVERYDAY EMERGENCY GEAR" },
};

// icons drawn in a 0..100 box; {f}=filled paths, {s}=stroked paths
const ICONS = {
  lock: `<path d="M28 46 V34 a22 22 0 0 1 44 0 V46" fill="none" stroke="COL" stroke-width="9"/><rect x="22" y="46" width="56" height="44" rx="8" fill="COL"/><circle cx="50" cy="64" r="6" fill="#0f1d27"/><rect x="47" y="64" width="6" height="14" fill="#0f1d27"/>`,
  car: `<path d="M14 66 L24 44 H76 L86 66 Z" fill="COL"/><rect x="10" y="62" width="80" height="18" rx="6" fill="COL"/><circle cx="28" cy="82" r="9" fill="#0f1d27"/><circle cx="72" cy="82" r="9" fill="#0f1d27"/><circle cx="28" cy="82" r="4" fill="COL"/><circle cx="72" cy="82" r="4" fill="COL"/>`,
  shield: `<path d="M50 8 L86 22 V50 C86 74 70 88 50 95 C30 88 14 74 14 50 V22 Z" fill="COL"/><path d="M38 50 L47 60 L65 38" fill="none" stroke="#0f1d27" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
  snow: `<g stroke="COL" stroke-width="8" stroke-linecap="round"><line x1="50" y1="12" x2="50" y2="88"/><line x1="18" y1="30" x2="82" y2="70"/><line x1="82" y1="30" x2="18" y2="70"/></g>`,
  sun: `<circle cx="50" cy="50" r="22" fill="COL"/><g stroke="COL" stroke-width="8" stroke-linecap="round"><line x1="50" y1="8" x2="50" y2="22"/><line x1="50" y1="78" x2="50" y2="92"/><line x1="8" y1="50" x2="22" y2="50"/><line x1="78" y1="50" x2="92" y2="50"/><line x1="20" y1="20" x2="30" y2="30"/><line x1="80" y1="20" x2="70" y2="30"/><line x1="20" y1="80" x2="30" y2="70"/><line x1="80" y1="80" x2="70" y2="70"/></g>`,
  storm: `<path d="M30 44 a18 18 0 0 1 4 -35 a20 20 0 0 1 37 8 a15 15 0 0 1 -4 29 Z" fill="COL"/><path d="M52 50 L40 74 H52 L44 92 L70 64 H56 L64 50 Z" fill="#ffd23f"/>`,
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const up = (s) => String(s ?? "").toUpperCase();

function wrap(text, maxChars, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] += "…";
  return lines;
}

function calloutBox(x, y, accent, watch, c) {
  const bw = 360, bh = 92;
  const title = up(c.title || ""), body = wrap(c.body || "", 26, 2);
  return `<g transform="translate(${x},${y})">
    <rect width="${bw}" height="${bh}" rx="8" fill="#0b1620" fill-opacity="0.95" stroke="${accent}" stroke-width="2"/>
    <rect width="6" height="${bh}" rx="3" fill="${accent}"/>
    <text x="20" y="34" font-family="${COND}" font-weight="700" font-size="25" fill="${watch}">${esc(title)}</text>
    ${body.map((l, j) => `<text x="20" y="${60 + j * 24}" font-family="${COND}" font-weight="600" font-size="22" fill="#eaf1f6">${esc(l)}</text>`).join("")}
  </g>`;
}

function mapContent(map, hz, core, watch, cities) {
  // union bbox of highlighted states (fallback: whole US)
  const hi = [...core, ...watch].filter((k) => map[k]?.bbox);
  let minx = 0, miny = 0, maxx = map._w, maxy = map._h;
  if (hi.length) {
    minx = Math.min(...hi.map((k) => map[k].bbox[0])); miny = Math.min(...hi.map((k) => map[k].bbox[1]));
    maxx = Math.max(...hi.map((k) => map[k].bbox[2])); maxy = Math.max(...hi.map((k) => map[k].bbox[3]));
    const px = Math.max((maxx - minx) * 0.22, 40), py = Math.max((maxy - miny) * 0.22, 40);
    minx -= px; miny -= py; maxx += px; maxy += py;
  }
  const bw = maxx - minx, bh = maxy - miny;
  const sc = Math.min(PW / bw, PH / bh);
  const tx = PX + (PW - bw * sc) / 2 - minx * sc, ty = PY + (PH - bh * sc) / 2 - miny * sc;
  const proj = (x, y) => [tx + x * sc, ty + y * sc];

  const zoomed = hi.length > 0;
  let states = "", glow = "";
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith("_")) continue;
    if (zoomed && (k === "AK" || k === "HI")) continue; // hide insets in a continental zoom
    const fill = core.has(k) ? hz.core : watch.has(k) ? hz.watch : "#33485c";
    const op = core.has(k) ? 1 : watch.has(k) ? 0.92 : 0.82;
    states += `<path d="${v.d}" fill="${fill}" fill-opacity="${op}" stroke="#0e1a24" stroke-width="${(0.8 / sc).toFixed(3)}"/>`;
  }
  for (const k of core) if (map[k]) glow += `<path d="${map[k].d}" fill="none" stroke="#ffffff" stroke-width="${(2.6 / sc).toFixed(3)}" stroke-opacity="0.9"/>`;

  let marks = "";
  cities.forEach((c, i) => {
    const p = map._cities[c.name]; if (!p) return;
    const [sx, sy] = proj(p.x, p.y);
    if (sx < PX || sx > PX + PW || sy < PY || sy > PY + PH) return;
    const primary = i === 0, r = primary ? 9 : 6;
    const lx = sx + (c.labelLeft ? -12 : 14), anchor = c.labelLeft ? "end" : "start";
    if (primary) marks += `<circle cx="${sx}" cy="${sy}" r="${r + 6}" fill="none" stroke="#fff" stroke-width="2" stroke-opacity="0.7"/>`;
    marks += `<circle cx="${sx}" cy="${sy}" r="${r}" fill="#fff" stroke="#0e1a24" stroke-width="1.5"/>`;
    marks += `<text x="${lx}" y="${sy + 7}" font-family="${COND}" font-weight="700" font-size="23" fill="#fff" text-anchor="${anchor}" style="paint-order:stroke" stroke="#0b141c" stroke-width="3.5">${esc(c.name)}</text>`;
  });
  return `<g clip-path="url(#mapClip)"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${sc.toFixed(4)})">${states}${glow}</g>${marks}</g>`;
}

function cardContent(hz, keyword) {
  const icon = (ICONS[hz.icon] || ICONS.shield).replace(/COL/g, hz.core);
  const cx = W / 2, iconY = PY + 70, isz = 220;
  const kw = wrap(keyword || hz.label, 18, 2);
  return `<g>
    <g transform="translate(${cx - isz / 2},${iconY}) scale(${isz / 100})">${icon}</g>
    ${kw.map((l, j) => `<text x="${cx}" y="${iconY + isz + 70 + j * 78}" font-family="${DISPLAY}" font-size="72" fill="#fff" text-anchor="middle">${esc(up(l))}</text>`).join("")}
  </g>`;
}

export async function buildSVG(spec = {}) {
  const map = await loadMap();
  const hz = HAZARD[spec.hazard] || HAZARD.general;
  const br = BRAND[spec.brand] || BRAND.general;
  const core = new Set(spec.regionStates || []);
  const watch = new Set(spec.watchStates || []);
  const cities = (spec.cities || []).map((c) => (typeof c === "string" ? { name: c } : c));
  const layout = spec.layout || (core.size ? "map" : "card");
  const bg = spec.bgDataUri || ""; // optional Gemini photoreal background (hybrid mode)
  const alertLabel = up(spec.alertLabel || hz.label);
  const dateRange = up(spec.dateRange || "");
  const subhead = up(spec.regionLabel || spec.subhead || "");

  const content = layout === "map" ? mapContent(map, hz, core, watch, cities) : cardContent(hz, spec.keyword || subhead);

  // callouts: corners for map, 2-col grid for card
  const slots = layout === "map"
    ? [{ x: 60, y: 250 }, { x: 660, y: 250 }, { x: 60, y: 470 }, { x: 660, y: 470 }]
    : [{ x: 90, y: 600 }, { x: 630, y: 600 }, { x: 90, y: 712 }, { x: 630, y: 712 }];
  const callouts = (spec.callouts || []).slice(0, 4).map((c, i) => calloutBox(slots[i].x, slots[i].y, hz.accent, hz.watch, c)).join("");

  const badge = spec.badge ? up(spec.badge) : "";
  const banner = `<g transform="translate(700,904)">
    <rect width="380" height="176" fill="${br.accent}"/>
    <rect width="380" height="176" fill="url(#bannerShade)"/>
    <text x="28" y="58" font-family="${DISPLAY}" font-size="46" fill="#fff">${esc(br.name)}</text>
    <rect x="28" y="74" width="300" height="3" fill="#fff" fill-opacity="0.65"/>
    ${wrap(br.tagline, badge ? 22 : 30, 2).map((l, j) => `<text x="28" y="${104 + j * 26}" font-family="${COND}" font-weight="600" font-size="21" fill="#fff" fill-opacity="0.95">${esc(l)}</text>`).join("")}
    ${badge ? `<g transform="translate(326,104)"><circle r="42" fill="#fff"/><circle r="42" fill="none" stroke="${hz.accent}" stroke-width="3"/><text y="-2" font-family="${DISPLAY}" font-size="25" fill="${hz.accent}" text-anchor="middle">${esc(badge.split(" ")[0])}</text><text y="21" font-family="${COND}" font-weight="700" font-size="17" fill="${hz.accent}" text-anchor="middle">${esc(badge.split(" ").slice(1).join(" ") || "OFF")}</text></g>` : ""}
  </g>`;
  const bottomLines = wrap(spec.bottomBody || "", 46, 2);
  const infoBar = `<g transform="translate(0,904)">
    <rect width="700" height="176" fill="#0b1620"/>
    <rect width="700" height="6" fill="${hz.accent}"/>
    <text x="40" y="58" font-family="${COND}" font-weight="700" font-size="30" fill="${hz.watch}">${esc(up(spec.bottomTitle || "STAY READY"))}</text>
    ${bottomLines.map((l, j) => `<text x="40" y="${98 + j * 34}" font-family="${COND}" font-weight="600" font-size="27" fill="#eaf1f6">${esc(l)}</text>`).join("")}
  </g>`;

  const header = `
    <rect width="${W}" height="96" fill="url(#alertGrad)"/>
    <g transform="translate(34,30)"><path d="M18 2 L36 34 L0 34 Z" fill="#fff"/><rect x="16" y="13" width="4" height="12" fill="${hz.accent}"/><rect x="16" y="28" width="4" height="4" fill="${hz.accent}"/></g>
    <text x="92" y="66" font-family="${DISPLAY}" font-size="48" fill="#fff" letter-spacing="1">${esc(alertLabel)}</text>
    ${dateRange ? `<text x="${W - 34}" y="62" font-family="${COND}" font-weight="700" font-size="30" fill="#fff" text-anchor="end">${esc(dateRange)}</text>` : ""}
    <rect y="96" width="${W}" height="64" fill="#13212c"/>
    <text x="40" y="138" font-family="${COND}" font-weight="700" font-size="34" fill="#fff">${esc(subhead)}</text>
    <text x="${W - 34}" y="136" font-family="${COND}" font-weight="600" font-size="22" fill="#7d93a3" text-anchor="end">QUIETPROTECTOR WEATHER DESK</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="alertGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${hz.accent}"/><stop offset="1" stop-color="#7d0c06"/></linearGradient>
    <linearGradient id="pageGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16242f"/><stop offset="1" stop-color="#0d1820"/></linearGradient>
    <linearGradient id="bannerShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d12" stop-opacity="0.9"/><stop offset="0.14" stop-color="#0a131a" stop-opacity="0.42"/><stop offset="0.52" stop-color="#0a131a" stop-opacity="0.3"/><stop offset="0.8" stop-color="#070d12" stop-opacity="0.58"/><stop offset="1" stop-color="#05090d" stop-opacity="0.92"/></linearGradient>
    <clipPath id="mapClip"><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}"/></clipPath>
  </defs>
  ${bg
    ? `<image href="${bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="url(#photoScrim)"/><rect x="24" y="172" width="${W - 48}" height="722" rx="16" fill="#0a1620" fill-opacity="0.6"/>`
    : `<rect width="${W}" height="${H}" fill="url(#pageGrad)"/><rect y="160" width="${W}" height="744" fill="#0f1d27"/>`}
  ${content}
  ${callouts}
  ${header}
  ${infoBar}
  ${banner}
</svg>`;
}

export async function renderPNG(svg) {
  const r = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Barlow Condensed" },
    fitTo: { mode: "width", value: W },
  });
  return r.render().asPng();
}

export async function specToPNG(spec) {
  return renderPNG(await buildSVG(spec));
}
