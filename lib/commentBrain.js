// lib/commentBrain.js -- single source of truth for comment classification + reply drafting.
// VOICE: replies come from PRIVATE PERSONA pages, not the brand. Every reply must read like a regular
// person typing a quick FB comment under their OWN organic post -- first person ("I", never "we"),
// short, casual, a little imperfect, zero promo tone. The LLM classifies + drafts; deterministic
// post-processing enforces what a model drifts on: first-person voice, opener variety, a `humanize()`
// pass that strips AI tells (em dashes, AI vocabulary, "happy to help" artifacts, tidy structure),
// link-on-buying-intent as a casual "where I got mine" share, locked brand spelling, and safe routing.
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
  ad_meta: "reply",     // complaint about the post itself (too long, wordy) -- light human aside or none
  dismiss: "ignore",    // bad-faith "this is fake/AI/an ad" -- never engage or defend
  risky: "escalate",
};

// Rotating opener styles so many replies in one thread don't all start the same way (the #1 bot tell).
const OPENERS = [
  "just answer, no wind-up",
  "react first in a couple words, then maybe help",
  "lead with your own quick take",
  "a light, offhand hook",
  "echo a word or two of theirs, then go",
  "straight to the useful bit",
  "a quick thanks, then move on",
  "like a fast comment to a friend, mid-thought",
  "short and a little blunt",
  "plain and natural, like you're half-distracted",
];

const SYS = `You are replying to comments under a Facebook/Instagram post that YOU published on your OWN personal page. You are a regular private person -- NOT a brand, NOT a company, NOT "support", NOT an advertiser. You shared this because you personally found it useful and wanted to pass it along, with ZERO promotional intent. Reply the way a normal person replies under their own post.

WRITE LIKE A REAL FACEBOOK COMMENT, NOT AN ESSAY -- this is the whole point:
- SHORT. Often one line. Sometimes just a few words ("Same here, mine lives in my truck."). Vary the length a lot from reply to reply.
- FIRST PERSON, ALWAYS "I / my / me". NEVER "we / our / us / the team / here at...". You are one person.
- Plain everyday words. BAN "AI words": delve, crucial, vital, testament, seamless, elevate, robust, vibrant, foster, leverage, ensure, utilize, navigate, landscape, journey, realm, game-changer, peace of mind (as a slogan).
- NO em dashes (—). Use a comma, a period, or just start a new sentence.
- NO rule-of-three lists. NO "it's not just X, it's Y". NO tidy parallel structure. NO neat sign-off or upbeat closer -- real people just stop.
- NO customer-service / chatbot lines: "happy to help", "hope this helps", "great question", "let me know", "feel free to", "rest assured", "thanks for reaching out".
- Imperfect is human: a sentence fragment, a lowercase start, a trailing "..." now and then are all fine. Don't polish it into marketing copy.
- REACT like a person, don't lecture. A short reaction often beats a full answer. Match their energy: short comment -> short reply, joke -> light reply.
- Emoji only once in a while and naturally (a single 😅 or 🙏), never on every line.
- Speak as someone who just OWNS or TRIED the thing ("the one I got", "mine lives in my car", "got it after a storm last year"), never as a seller.
- It must read like a DIFFERENT real person each time. Never open with "We/I hear you"; never use "resonate".

HARD RULES: US English; make NO claims of any kind (no medical, no efficacy/safety outcomes like "it'll protect you"/"fireproof"/"will save your life"/"guaranteed", no statistics you can't personally vouch for); never argue or get defensive; don't state prices or specs you weren't given; no links EXCEPT the product link in PRODUCT CONTEXT, and ONLY for someone asking where/how to get it; never mention or promise a DM.

Categories:
- "spam": ads, promo links, irrelevant, bot/junk.
- "faq": a real, answerable question (how it generally works, where to learn more, shipping) you can answer from your OWN experience without a claim.
- "positive": compliment, excitement, tagging a friend, gratitude.
- "buying_intent": wants to get one / asks where or how / asks price -- OR is frustrated about price or a form. They just want the link.
- "negative_soft": doubt, skepticism, mild criticism about the THING itself -- NOT a safety/medical/incident matter, NOT about the post's format.
- "ad_meta": the complaint is about the POST ITSELF (too long, too much text, wordy). Don't pitch anything. Either empty, or a light human aside in YOUR voice ("ha, fair, I got a bit carried away 😅").
- "dismiss": bad-faith "this is fake / AI / staged / an ad" accusations, or pure trolling -- leave reply empty, never defend.
- "risky": ANYTHING about medical/health, efficacy or SAFETY ("does it really work", "will it save us", "is it safe"), an injury, a real property/loss incident (fire/flood/break-in/accident), legal threats, a crisis, or press. When torn, choose risky.

For "buying_intent": share where YOU got yours, the way a friend pastes a link ("I got mine here: <link>"). NO guarantee recitation, NO "no hassle / zero risk / backed by" lines, NO "our site". Just a casual pointer + the exact link.

Return ONLY JSON: {"category":"...","reply":"<public reply, or empty string for spam/risky/dismiss>","dm":""}.`;

export function factsBlock(key) {
  const s = FACTS.shared;
  const p = FACTS.products[key];
  if (!p) return `PRODUCT CONTEXT: product unknown for this comment. Do NOT state product specifics, prices, or shipping; if asked where to get it, point them to the official site without asserting specifics.`;
  return [
    "PRODUCT CONTEXT (facts you happen to know as an owner; add NO claims beyond them, and don't recite them like an ad):",
    `- What it is: ${p.name} - ${p.what_it_is}`,
    `- Shipping (only if asked): ${p.shipping}`,
    p.fits_note ? `- Compatibility (only if asked): ${p.fits_note}` : "",
    `- If someone wants one, the link to get it: ${p.buy_url}`,
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

// -- deterministic post-processing helpers ------------------------------------
function hash(s) { let h = 5381; const t = String(s); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h; }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Strip the bot-tell openers / "resonate" even if the model slips (belt-and-suspenders to the prompt).
function deBot(reply) {
  let r = String(reply || "");
  r = r.replace(/^\s*(?:we|i)\s+hear\s+(?:you|ya)\b[\s,.:;!-]*/i, "");
  r = r.replace(/^\s*(?:we'?re|i'?m)\s+(?:so\s+)?(?:glad|happy|thrilled)\s+this\s+resonated[^.!?]*[.!?]\s*/i, "");
  r = r.replace(/\bresonated\b/gi, "landed").replace(/\bresonates\b/gi, "lands").replace(/\bresonate\b/gi, "land");
  return r.trim();
}

// Force FIRST PERSON: these replies come from one private person, never a company.
function firstPerson(text) {
  let r = String(text || "");
  r = r.replace(/\bwe're\b/gi, "I'm").replace(/\bwe've\b/gi, "I've").replace(/\bwe'll\b/gi, "I'll").replace(/\bwe'd\b/gi, "I'd");
  r = r.replace(/\bwe are\b/gi, "I am").replace(/\bwe were\b/gi, "I was").replace(/\bwe have\b/gi, "I have").replace(/\bwe do\b/gi, "I do");
  r = r.replace(/\bwe\b/gi, "I");
  r = r.replace(/\bOur\b/g, "My").replace(/\bour\b/g, "my").replace(/\bOurs\b/g, "Mine").replace(/\bours\b/g, "mine").replace(/\bourselves\b/gi, "myself");
  r = r.replace(/\b[Ll]et's\b/g, "you can").replace(/\bus\b/g, "me");
  return r;
}

// Strip the "signs of AI writing" that make a comment read like a bot. Conservative -- only safe,
// high-signal tells (em dashes, curly quotes, AI vocabulary, chatbot/servile artifacts, authority
// tropes). Runs on the prose only; the buy URL is appended AFTER this, so it can't be mangled.
function humanize(text) {
  let r = String(text || "");
  r = r.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");   // curly -> straight quotes
  r = r.replace(/\s*[—–]\s*/g, ", ");                              // em/en dash -> comma
  // chatbot / servile artifacts
  r = r.replace(/\b(i hope this helps|hope this helps|happy to help|glad to help|more than happy to|great question|good question|rest assured|thanks for reaching out|feel free to ask)\b[\s,.!:]*/gi, "");
  r = r.replace(/\blet me know if[^.!?]*[.!?]?/gi, "");
  // persuasive-authority tropes
  r = r.replace(/\b(the real question is|at its core|at the end of the day|truth is,?|that said,?|in reality,?)\s*/gi, "");
  // downgrade common AI vocabulary if it slips through
  const swap = { delve: "look", crucial: "big", vital: "important", seamless: "easy", elevate: "boost", robust: "solid", utilize: "use", "peace of mind": "one less thing to worry about", "game-changer": "really handy" };
  for (const [k, v] of Object.entries(swap)) r = r.replace(new RegExp(`\\b${k.replace(/[-]/g, "\\$&")}\\b`, "gi"), v);
  r = r.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[\s,.;:]+/, "").trim();
  return r;
}

// Lock brand spelling to canonical forms WITHOUT corrupting the buy URL. Split on URLs; fix prose only.
function lockBrandNames(text) {
  return String(text || "")
    .split(/(https?:\/\/\S+)/g)
    .map((seg, i) => (i % 2 === 1 ? seg : seg
      .replace(/\bTerra\s?Str[iy]ke\b/gi, "TerraStrike")
      .replace(/\bTerra\s?Bolt\b/gi, "TerraBolt")
      .replace(/\bTerra\s?Shell\b/gi, "TerraShell")
      .replace(/\bQuiet\s?Protector\b/gi, "QuietProtector")))
    .join("");
}

// Casual "where I got mine" tails -- a person sharing a link, NOT a sales close. No dash, no guarantee.
function buyTail(p, seed) {
  return [
    `I got mine here: ${p.buy_url}`,
    `here's where I grabbed mine: ${p.buy_url}`,
    `this is the one I got: ${p.buy_url}`,
    `mine's from here: ${p.buy_url}`,
  ][seed % 4];
}

// Deterministic hot-lead detector: price / where-to-buy / form frustration = a buyer, not a complaint.
function isBuyingSignal(text) {
  return /\b(how much|what(?:'s| is| are| do).*(cost|price)|the price|priced?|where (?:can|do) i (?:buy|get|order)|how (?:can|do) i (?:buy|order|get)|i (?:want|wanna|need)\s+(?:to\s+(?:buy|order|get)|these|one|it|two)|take my money|shut up and take|fill (?:out )?(?:a |the )?form (?:to|just to) see|link to (?:buy|order)|where to buy)\b/i.test(String(text || ""));
}

export async function classify(text, productKey) {
  const seed = hash(text);
  const opener = OPENERS[seed % OPENERS.length];
  const j = await genJSON(SYS, `${factsBlock(productKey)}\n\nOPENER STYLE for this reply (do not copy verbatim - just the vibe): ${opener}\n\nComment: """${text}"""`);

  let category = j.category;
  let reply = String(j.reply || "");

  // Hot-lead upgrade: a price/where/form question is buying intent even if the model softened it.
  if (isBuyingSignal(text) && ["negative_soft", "faq", "positive"].includes(category)) category = "buying_intent";

  // Safety nets: never let a hard claim through; never let a stray link/price through off buying_intent.
  const claimHit = /(fireproof|will save your life|\bcure\b|100%\s*(safe|protect|guarantee))/i.test(reply);
  const linkPriceHit = /(https?:\/\/|www\.|\$\s?\d)/i.test(reply);
  if (category !== "spam" && (claimHit || (linkPriceHit && category !== "buying_intent"))) category = "risky";

  if (category === "spam" || category === "risky" || category === "dismiss") {
    return { category, action: ROUTE[category] || "escalate", reply: "", dm: "" };
  }

  // Post-process everything we actually post: de-bot -> first person -> strip AI tells -> lock brands.
  reply = cap(lockBrandNames(humanize(firstPerson(deBot(reply)))));

  // Buying intent: make sure the link is there, shared the way a person shares it (no sales lines).
  const p = FACTS.products[productKey];
  if (category === "buying_intent" && p) {
    if (!reply.trim()) reply = cap(buyTail(p, seed));
    else if (!reply.includes(p.buy_url)) reply = `${reply.replace(/\s*$/, "")} ${cap(buyTail(p, seed))}`.trim();
  }

  return { category, action: ROUTE[category] || "reply", reply, dm: "" };
}
