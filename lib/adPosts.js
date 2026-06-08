// lib/adPosts.js — discover the post objects behind ACTIVE ads (including dark/unpublished posts),
// grouped by page. Needs ads_read. Returns Map(pageId -> Set(storyId)).
export async function activeAdStoryIds({ token, graphVersion = "v21.0", allowPageIds, fetchImpl = fetch }) {
  const base = `https://graph.facebook.com/${graphVersion}`;
  const enc = encodeURIComponent;
  const allow = allowPageIds ? new Set(allowPageIds.map(String)) : null;
  const byPage = new Map();

  async function fetchAll(url, maxPages = 20) {
    const out = []; let next = url; let pages = 0;
    while (next && pages < maxPages) {
      const d = await (await fetchImpl(next)).json();
      if (d.error) throw new Error(d.error.message);
      out.push(...(d.data || []));
      next = d.paging?.next || null; pages++;
    }
    return out;
  }

  let accounts = [];
  try { accounts = await fetchAll(`${base}/me/adaccounts?fields=id&limit=200&access_token=${enc(token)}`); } catch {}
  const activeFilter = enc(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));
  for (const acct of accounts) {
    let ads = [];
    try {
      ads = await fetchAll(`${base}/${acct.id}/ads?fields=creative{effective_object_story_id}&filtering=${activeFilter}&limit=300&access_token=${enc(token)}`);
    } catch {}
    for (const a of ads) {
      const eos = a.creative?.effective_object_story_id || "";
      if (!eos.includes("_")) continue;
      const pageId = eos.split("_")[0];
      if (allow && !allow.has(pageId)) continue;
      if (!byPage.has(pageId)) byPage.set(pageId, new Set());
      byPage.get(pageId).add(eos);
    }
  }
  return byPage;
}
