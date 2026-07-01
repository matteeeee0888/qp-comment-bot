// lib/igDiscover.js — find viral Reels from a list of source IG accounts via IG Business Discovery.
// Business Discovery reads PUBLIC business/creator accounts' recent media (likes/comments + a
// downloadable media_url), queried THROUGH an IG Business account we own (any one works as the
// "query vehicle"; it need not be the account we post to). View counts are NOT available for other
// accounts, so we rank by ENGAGEMENT (likes + comments). Returns top fresh Reels, best-first.
import { loadToken, loadConfig } from "./env.js";

// usernames: ["@survivallife", ...]; queryIgId: an IG Business id the token controls.
export async function discoverReels(usernames, { queryIgId, perAccount = 12, graphVersion } = {}) {
  const cfg = await loadConfig();
  const token = await loadToken(cfg.tokenEnvPath);
  const gv = graphVersion || cfg.graphVersion || "v21.0";
  const qid = queryIgId || cfg.repostQueryIgId;
  if (!qid) throw new Error("discoverReels: no queryIgId (an owned IG Business id to query through)");

  const out = [];
  for (const uRaw of usernames) {
    const u = String(uRaw).replace(/^@/, "").trim();
    if (!u) continue;
    const fields = `business_discovery.username(${u}){followers_count,media.limit(${perAccount}){media_type,media_product_type,like_count,comments_count,media_url,permalink,timestamp,caption}}`;
    const url = `https://graph.facebook.com/${gv}/${qid}?fields=${encodeURIComponent(fields)}&access_token=${token}`;
    let d;
    try { d = await (await fetch(url)).json(); }
    catch (e) { console.log(`  @${u}: fetch error ${e.message || e}`); continue; }
    if (d.error) { console.log(`  @${u}: ${d.error.message}`); continue; }
    const bd = d.business_discovery;
    if (!bd) { console.log(`  @${u}: no business_discovery (private/personal/not found)`); continue; }
    for (const m of (bd.media?.data || [])) {
      if (m.media_product_type !== "REELS" && m.media_type !== "VIDEO") continue; // reels only
      if (!m.media_url) continue;                                                 // need a downloadable video
      out.push({
        source: u, followers: bd.followers_count || 0,
        id: m.id, permalink: m.permalink, videoUrl: m.media_url,
        likes: m.like_count || 0, comments: m.comments_count || 0,
        engagement: (m.like_count || 0) + (m.comments_count || 0),
        caption: (m.caption || ""), timestamp: m.timestamp,
      });
    }
  }
  out.sort((a, b) => b.engagement - a.engagement);
  return out;
}
