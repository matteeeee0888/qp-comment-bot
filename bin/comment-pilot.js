#!/usr/bin/env node
// bin/comment-pilot.js — PILOT/tester for the comment brain (lib/commentBrain.js). Takes NO action.
//   --samples           run on a built-in realistic sample set
//   --product <key>     product facts for samples (terrabolt | terrastryke | terrashell)
//   --page <pageId>     read REAL comments from a page's recent posts (still no action)
import { loadToken, loadConfig, loadJson } from "../lib/env.js";
import { CommentsClient } from "../lib/metaComments.js";
import { classify, detectProduct } from "../lib/commentBrain.js";

const cfg = await loadConfig();
const argv = process.argv.slice(2);
const SAMPLES = argv.includes("--samples");
const PRODUCT = (() => { const i = argv.indexOf("--product"); return i >= 0 ? argv[i + 1] : ""; })();
const PAGE = (() => { const i = argv.indexOf("--page"); return i >= 0 ? argv[i + 1] : ""; })();

const LABEL = { hide: "HIDE", reply: "REPLY", reply_dm: "REPLY + DM", escalate: "ESCALATE → alert (no auto-reply)" };

const SAMPLE = [
  "How much does this cost?",
  "Where can I buy one??",
  "Is this a scam???",
  "My whole family needs this 🙏 tagging my sister",
  "Does this actually work in a real fire?",
  "Will this protect my kids if the house catches fire?",
  "🔥 get 10k cheap followers + likes here >> www.boost-spam.link",
  "Honestly looks like overpriced junk to me.",
  "Our house flooded last year and nothing like this would've helped.",
  "Can you ship to Canada?",
];

async function realComments() {
  const token = await loadToken(cfg.tokenEnvPath);
  const client = new CommentsClient({ token, graphVersion: cfg.graphVersion });
  const map = await loadJson(new URL("../page-topic-map.json", import.meta.url));
  const pid = PAGE || map.find((m) => m.eligible)?.page_id;
  const posts = await client.recentPosts(pid, 8);
  const out = [];
  for (const post of posts) {
    const ctx = [post.message, post.permalink_url, post.attachments?.data?.[0]?.unshimmed_url].filter(Boolean).join(" ");
    const product = detectProduct(ctx);
    for (const c of await client.comments(post.id, pid)) if (c.message) out.push({ text: c.message, product });
  }
  console.log(`(read ${out.length} real comment(s))`);
  return out;
}

const items = SAMPLES ? SAMPLE.map((t) => ({ text: t, product: PRODUCT })) : await realComments();
console.log(`\n=== COMMENT PILOT — no actions taken, drafts only (${items.length}) ===`);
const tally = {};
for (const it of items) {
  try {
    const b = await classify(it.text, it.product || PRODUCT);
    tally[b.category] = (tally[b.category] || 0) + 1;
    console.log(`\n💬 "${it.text}"`);
    console.log(`   ${b.category}  ⇒  ${LABEL[b.action] || b.action}`);
    if (b.reply) console.log(`   ↳ reply: ${b.reply}`);
    if (b.dm) console.log(`   ↳ DM:    ${b.dm}`);
  } catch (e) { console.log(`\n💬 "${it.text}"\n   ERR ${e.message}`); }
}
console.log(`\nsummary: ${JSON.stringify(tally)}`);
