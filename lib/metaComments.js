// lib/metaComments.js — Graph API comment operations via page tokens.
export class CommentsClient {
  constructor({ token, graphVersion = "v21.0", fetchImpl = fetch }) {
    this.token = token;
    this.base = `https://graph.facebook.com/${graphVersion}`;
    this.fetch = fetchImpl;
    this._pt = new Map();
  }
  async pageToken(pageId) {
    if (this._pt.has(pageId)) return this._pt.get(pageId);
    const r = await this.fetch(`${this.base}/${pageId}?fields=access_token&access_token=${encodeURIComponent(this.token)}`);
    const d = await r.json();
    if (!d.access_token) throw new Error(`page token ${pageId}: ${d.error?.message || "none"}`);
    this._pt.set(pageId, d.access_token);
    return d.access_token;
  }
  async _get(url) { const r = await this.fetch(url); const d = await r.json(); if (d.error) throw new Error(d.error.message); return d; }
  async _post(url, params) {
    const r = await this.fetch(url, { method: "POST", body: new URLSearchParams(params) });
    const d = await r.json(); if (d.error) throw new Error(d.error.message); return d;
  }
  // Recent published posts (organic + boosted-published). Dark/unpublished ad posts need ads_read (TODO).
  async recentPosts(pageId, limit = 10) {
    const pt = await this.pageToken(pageId);
    const d = await this._get(`${this.base}/${pageId}/posts?fields=id,message,permalink_url,attachments{unshimmed_url,target{url}}&limit=${limit}&access_token=${encodeURIComponent(pt)}`);
    return d.data || [];
  }
  // Fetch a post/ad object's text + destination link (for product detection).
  async postContext(objectId, pageId) {
    const pt = await this.pageToken(pageId);
    const d = await this._get(`${this.base}/${objectId}?fields=message,story,permalink_url,attachments{unshimmed_url,target{url}}&access_token=${encodeURIComponent(pt)}`);
    return [d.message, d.story, d.permalink_url, d.attachments?.data?.[0]?.unshimmed_url, d.attachments?.data?.[0]?.target?.url].filter(Boolean).join(" ");
  }
  async comments(objectId, pageId, limit = 50) {
    const pt = await this.pageToken(pageId);
    const d = await this._get(`${this.base}/${objectId}/comments?fields=id,message,from,created_time&order=reverse_chronological&limit=${limit}&access_token=${encodeURIComponent(pt)}`);
    return d.data || [];
  }
  async reply(commentId, pageId, message) {
    const pt = await this.pageToken(pageId);
    return this._post(`${this.base}/${commentId}/comments`, { message, access_token: pt });
  }
  // Replies (child comments) under a given comment.
  async replies(commentId, pageId, limit = 25) {
    const pt = await this.pageToken(pageId);
    const d = await this._get(`${this.base}/${commentId}/comments?fields=from&limit=${limit}&access_token=${encodeURIComponent(pt)}`);
    return d.data || [];
  }
  // Bulletproof dedup: has THIS page already replied to this comment? (survives a lost seen-store.)
  async alreadyReplied(commentId, pageId) {
    try { return (await this.replies(commentId, pageId)).some((r) => String(r.from?.id) === String(pageId)); }
    catch { return false; }
  }
  async hide(commentId, pageId, hidden = true) {
    const pt = await this.pageToken(pageId);
    return this._post(`${this.base}/${commentId}`, { is_hidden: String(hidden), access_token: pt });
  }
  // FB comment -> private DM. Requires pages_messaging.
  async privateReply(commentId, pageId, message) {
    const pt = await this.pageToken(pageId);
    return this._post(`${this.base}/${commentId}/private_replies`, { message, access_token: pt });
  }
}
