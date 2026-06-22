// lib/commentBrain.js -- single source of truth for comment classification + reply drafting.
// VOICE: replies come from PRIVATE PERSONA pages, not the brand. Every reply must read like a regular
// person answering under their OWN organic post -- first person ("I", never "we"), zero promotional
// tone, pure sharing/awareness. The LLM classifies + drafts; deterministic post-processing enforces
// what a model drifts on: first-person voice, opener variety, link-on-buying-intent (as a personal
// "where I got mine" share, no sales lines), locked brand spelling, and safe routing.
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
  "answer the question directly, no preamble",
  "open with a short, warm acknowledgement in your own fresh words",
  "lead with the single most useful thing from your own experience",
  "start with a light, friendly hook",
  "briefly mirror their wording, then help",
  "get straight to the helpful part",
  "start with a quick thanks, then the substance",
  "open conversationally, like a quick reply to a friend",
  "lead with reassurance, then specifics",
  "start plainly and naturally, mid-thought",
];

const SYS = `You are replying to comments under a Facebook/Instagram post that YOU published on your OWN personal page. You are a regular private person -- NOT a brand, NOT a company, NOT "support", NOT an advertiser. You shared this because you personally found it useful and wanted to pass it along (pure awareness / divulgazione), with ZERO promotional intent in your tone. Reply the way a normal person replies under their own post.

VOICE -- this is the entire point, get it right:
- FIRST PERSON, ALWAYS. Use "I", "my", "me". NEVER "we", "our", "us", "the team", "the brand", "here at...". You are ONE person, never a company.
- Sound like a real human typing a quick comment from their phone: casual, warm, specific, a little informal. 1-2 short sentences. NOT polished marketing copy.
- Never sound like an ad, a brand rep, or customer service. Ban corporate phrasing: "we're glad", "thanks for reaching out", "our product", "happy to help!", "rest assured", "we stand behind". No sales push, no hype, no closing lines.
- Speak as someone who simply OWNS or TRIED the thing, or just shared the info -- refer to it personally ("the one I got", "I keep one in my car", "I picked one up after a storm last year"), NEVER as someone selling it.
- It must read like a DIFFERENT real person each time -- these are public threads and identical patterns expose it.

OPENER VARIETY: NEVER open with "We hear you"/"I hear you" or any variant; NEVER use "resonate"/"resonated"/"resonates". Vary the first words every time; follow the OPENER STYLE hint.

HARD RULES: US English; make NO claims of any kind (no medical, no efficacy/safety outcomes like "it'll protect you"/"fireproof"/"will save your life"/"guaranteed", no statistics you can't personally vouch for); never argue or get defensive; don't state prices or specs you weren't given; no links EXCEPT the product link in PRODUCT CONTEXT, and ONLY for someone asking where/how to get it; never mention or promise a DM -- every reply is public.

Categories:
- "spam": ads, promo links, irrelevant, bot/junk.
- "faq": a real, answerable question (how it generally works, where to learn more, shipping) you can answer from your OWN experience without a claim.
- "positive": compliment, excitement, tagging a friend, gratitude.
- "buying_intent": wants to get one / asks where or how to get it / asks the price -- OR is frustrated about price or about a form. Treat them as someone who just wants the link.
- "negative_soft": doubt, skepticism, mild criticism about the THING itself -- NOT a safety/medical/incident matter, NOT about the post's format.
- "ad_meta": the complaint is about the POST ITSELF (too long, too much text, tl;dr, wordy). Do NOT pitch anything. Either leave it empty, or a light human aside in YOUR voice ("ha, fair -- I got a bit carried away 😄"). Never turn a length gripe into a product point.
- "dismiss": bad-faith accusations that it's fake / AI / staged / "this is an ad", or pure trolling -- leave the reply empty; never defend, explain, or argue.
- "risky": ANYTHING about medical/health, efficacy or SAFETY ("does it really work", "will it save us", "is it safe"), an injury, a real property/loss incident the commenter mentions (fire/flood/break-in/accident), legal threats, a crisis, or press/journalist. When torn, choose risky.

For "buying_intent": reply like a person sharing where THEY got theirs -- drop the EXACT link from PRODUCT CONTEXT in the way a friend pastes it ("I grabbed mine here: <link>"). NO guarantee recitation, NO "no hassle / zero risk / backed by" sales lines, NO vague "our site". Just a natural, personal pointer + the link.

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
  return cap(r.trim());
}

// Force FIRST PERSON: these replies come from one private person, never a company. Convert any
// brand "we/our/us" the model slips into personal voice. Replies are 1-2 sentences, so this is safe.
function firstPerson(text) {
  let r = String(text || "");
  r = r.replace(/\bwe're\b/gi, "I'm").replace(/\bwe've\b/gi, "I've").replace(/\bwe'll\b/gi, "I'll").replace(/\bwe'd\b/gi, "I'd");
  r = r.replace(/\bwe are\b/gi, "I am").replace(/\bwe were\b/gi, "I was").replace(/\bwe have\b/gi, "I have").replace(/\bwe do\b/gi, "I do");
  r = r.replace(/\bwe\b/gi, "I");
  r = r.replace(/\bOur\b/g, "My").replace(/\bour\b/g, "my").replace(/\bOurs\b/g, "Mine").replace(/\bours\b/g, "mine").replace(/\bourselves\b/gi, "myself");
  r = r.replace(/\b[Ll]et's\b/g, "you can").replace(/\bus\b/g, "me");
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

// Organic "where I got mine" leads/tails -- a person sharing a link, NOT a sales close. No guarantee,
// no "zero risk", no hype. Varied so buying replies don't all end identically.
function buyLead(seed) {
  return ["Oh for sure", "Yeah, pretty easy", "Honestly just grab one", "Sure thing"][seed % 4];
}
function buyTail(p, seed) {
  return [
    `I got mine here: ${p.buy_url}`,
    `here's where I grabbed mine: ${p.buy_url}`,
    `this is the one I got: ${p.buy_url}`,
    `mine came from here: ${p.buy_url}`,
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

  // First-person + de-bot + lock brand spelling on everything we actually post.
  reply = lockBrandNames(firstPerson(deBot(reply)));

  // Buying intent: make sure the link is there, shared the way a person shares it (no sales lines).
  const p = FACTS.products[productKey];
  if (category === "buying_intent" && p) {
    if (!reply.trim()) reply = `${buyLead(seed)} — ${buyTail(p, seed)}`;
    else if (!reply.includes(p.buy_url)) reply = `${reply.replace(/\s*$/, "")} ${cap(buyTail(p, seed))}`.trim();
  }

  return { category, action: ROUTE[category] || "reply", reply, dm: "" };
}
