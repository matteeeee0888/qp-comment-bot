// lib/news.js — free news discovery via Google News RSS (no API key required).
// Google News exposes a search RSS endpoint that returns ~100 recent articles per query,
// scoped to US/English. We fetch a handful of preparedness queries, parse the items with a
// light regex (the feed is well-formed and predictable), and dedup against a seen-store so the
// same story is never re-listed on later days. Scoring/angle-writing happens in newsBrain.js.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const SEEN_PATH = path.resolve(repoRoot, "state/news-seen.json");
const UA = "Mozilla/5.0 (compatible; QP-NewsBot/1.0; +https://quietprotector.com)";

function rssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")                 // strip any stray inner tags (e.g. description HTML)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
}

// Google News appends " - <Source>" to titles; drop it when it echoes the <source> tag.
function cleanTitle(title, source) {
  const i = title.lastIndexOf(" - ");
  if (i < 0 || !source) return title;
  const tail = title.slice(i + 3).trim();
  const fw = (x) => x.toLowerCase().split(/\s+/)[0] || "";
  if (fw(tail) && fw(tail) === fw(source)) return title.slice(0, i).trim();
  return title;
}

// Minimal RSS <item> extractor. The feed is single-line minified XML, so [\s\S]*? is required.
export function parseItems(xml) {
  const items = [];
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? decodeEntities(m[1]) : "";
    };
    const source = pick("source");
    const title = cleanTitle(pick("title"), source);
    const link = pick("link");
    const pubDate = pick("pubDate");
    if (title && link) items.push({ title, link, pubDate, source });
  }
  return items;
}

export async function fetchFeed(query, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(rssUrl(query), {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseItems(xml).map((it) => ({ ...it, query }));
  } catch {
    return []; // a single dead feed never sinks the run
  } finally {
    clearTimeout(t);
  }
}

// Stable dedup key: first 12 lowercased alphanumeric words of the headline.
export function titleKey(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");
}

export async function loadSeen() {
  try { return new Set(JSON.parse(await readFile(SEEN_PATH, "utf8"))); }
  catch { return new Set(); }
}

export async function saveSeen(seen, { cap = 4000 } = {}) {
  await mkdir(path.dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify(Array.from(seen).slice(-cap)));
}
