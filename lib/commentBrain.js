// lib/commentBrain.js — single source of truth for comment classification + reply drafting.
// Uses the pluggable text engine (Claude CLI by default). The LLM classifies + drafts; the
// deterministic ROUTE decides the action (safety: risky/spam never auto-reply).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genJSON } from "./text.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const FACTS = JSON.parse(await readFile(path.join(repoRoot, "data/product-facts.json"), "utf8"));

export const ROUTE = {
  spam: "hide",
  faq: "reply",
  positive: "reply",
  negative_soft: "reply",
  buying_intent: "reply",
  risky: "escalate",
};

const SYS = `You are the comment moderator for QuietProtector, a calm home & family emergency-preparedness brand (US audience), handling comments under its Facebook/Instagram posts and ads.
Classify each comment into exactly one category and, when appropriate, draft a public reply in the brand voice: warm, calm, helpful, human, first-person, concise (1-2 sentences).
HARD RULES for any reply you draft: US English; make NO claims of any kind (no medical, no product efficacy or safety outcomes like "it will protect you"/"fireproof"/"guaranteed", no statistics); never argue or get defensive; do NOT state prices, specs, shipping/return policies, or any fact you were not explicitly given — if you don't know, warmly deflect to "the site" WITHOUT asserting specifics; no links EXCEPT the official product buy link from PRODUCT CONTEXT, and only when answering a buying-intent comment. Never offer, mention, or promise a DM or private message — every reply is public, so phrase things to be handled right there in the comment.
You may be given a PRODUCT CONTEXT block with verified facts — use them when relevant (e.g. shipping, guarantee, what the product is), but add NO claims beyond them.
Categories:
- "spam": ads, promo links, irrelevant, bot/junk.
- "faq": a genuine, answerable question (shipping, availability, how it generally works, where to learn more) you can address helpfully WITHOUT any claim.
- "positive": compliment, excitement, tagging a friend, gratitude.
- "buying_intent": wants to buy / asks where or how to get it.
- "negative_soft": complaint, doubt, skepticism, mild criticism — NOT a safety/medical/legal/incident matter.
- "risky": ANYTHING involving medical/health, product EFFICACY or SAFETY outcomes ("does it really work", "will it save us", "is it safe"), an injury, OR any property-damage/loss event the commenter mentions (fire, flood, break-in, accident), legal threats, a crisis, or press/journalist. When torn, choose risky — especially on efficacy/safety questions or anything mentioning a real incident.
For buying_intent, warmly answer and include the product's buy link (from PRODUCT CONTEXT) directly in the public "reply" so they can grab it. Leave "dm" empty.
Return ONLY JSON: {"category":"...","reply":"<public reply, or empty string if spam or risky>","dm":"<short friendly private follow-up for buying_intent or negative_soft, else empty>"}.`;

export function factsBlock(key) {
  const s = FACTS.shared;
  const p = FACTS.products[key];
  if (!p) return `PRODUCT CONTEXT: product unknown for this comment. Do NOT state product specifics, prices, or shipping; if asked, warmly point them to a DM or the site. Guarantee: ${s.guarantee}. Support: ${s.support_email}.`;
  return [
    "PRODUCT CONTEXT (use these verified facts; add NO claims beyond them):",
    `- Product: ${p.name} — ${p.what_it_is}`,
    `- Guarantee: ${s.guarantee}.`,
    `- Shipping: ${p.shipping}`,
    p.fits_note ? `- Compatibility: ${p.fits_note}` : "",
    `- Support email: ${s.support_email}`,
    `- Buy link (share this exact link in your reply when someone asks where or how to buy): ${p.buy_url}`,
    `- Pricing rule: ${s.pricing_handling}`,
  ].filter(Boolean).join("\n");
}

// Infer which product a comment relates to, from the parent post's text/links.
export function detectProduct(contextText) {
  const hay = String(contextText || "").toLowerCase();
  for (const [key, p] of Object.entries(FACTS.products)) {
    if ((p.keywords || []).some((k) => hay.includes(String(k).toLowerCase()))) return key;
  }
  return "";
}

export async function classify(text, productKey) {
  const j = await genJSON(SYS, `${factsBlock(productKey)}\n\nComment: """${text}"""`);
  let category = j.category;
  const reply = String(j.reply || "");
  // Safety net: never let a hard claim through; never let a link/price through EXCEPT the buy link on buying_intent.
  const claimHit = /(fireproof|will save your life|\bcure\b|100%\s*(safe|protect|guarantee))/i.test(reply);
  const linkPriceHit = /(https?:\/\/|www\.|\$\s?\d)/i.test(reply);
  if (category !== "spam" && (claimHit || (linkPriceHit && category !== "buying_intent"))) {
    category = "risky";
  }
  const suppress = category === "spam" || category === "risky";
  return { category, action: ROUTE[category] || "escalate", reply: suppress ? "" : reply, dm: suppress ? "" : String(j.dm || "") };
}
