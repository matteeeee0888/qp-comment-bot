import { readFile } from "node:fs/promises";
import path from "node:path";

export class MetaClient {
  constructor({ token, graphVersion = "v21.0", fetchImpl = fetch }) {
    this.token = token;
    this.base = `https://graph.facebook.com/${graphVersion}`;
    this.fetch = fetchImpl;
    this._pageTokens = new Map();
  }

  async getPageToken(pageId) {
    if (this._pageTokens.has(pageId)) return this._pageTokens.get(pageId);
    const url = `${this.base}/${pageId}?fields=access_token&access_token=${this.token}`;
    const res = await this.fetch(url);
    const data = await res.json();
    if (!data.access_token) throw new Error(`No page token for ${pageId}: ${data.error?.message || "unknown"}`);
    this._pageTokens.set(pageId, data.access_token);
    return data.access_token;
  }

  _applySchedule(params, scheduledPublishTime) {
    if (scheduledPublishTime) {
      params.set("published", "false");
      params.set("scheduled_publish_time", String(scheduledPublishTime));
    }
  }

  async publishFeed(pageId, { message, link, scheduledPublishTime }) {
    const pageToken = await this.getPageToken(pageId);
    const body = new URLSearchParams({ message, access_token: pageToken });
    if (link) body.set("link", link);
    this._applySchedule(body, scheduledPublishTime);
    const res = await this.fetch(`${this.base}/${pageId}/feed`, { method: "POST", body });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }

  async publishPhotoUrl(pageId, { message, imageUrl, scheduledPublishTime }) {
    const pageToken = await this.getPageToken(pageId);
    const body = new URLSearchParams({ url: imageUrl, caption: message ?? "", access_token: pageToken });
    this._applySchedule(body, scheduledPublishTime);
    const res = await this.fetch(`${this.base}/${pageId}/photos`, { method: "POST", body });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }

  async publishPhotoFile(pageId, { message, imagePath, scheduledPublishTime }) {
    const pageToken = await this.getPageToken(pageId);
    const buf = await readFile(imagePath);
    const form = new FormData();
    form.set("caption", message ?? "");
    form.set("access_token", pageToken);
    form.set("source", new Blob([buf]), path.basename(imagePath));
    if (scheduledPublishTime) {
      form.set("published", "false");
      form.set("scheduled_publish_time", String(scheduledPublishTime));
    }
    const res = await this.fetch(`${this.base}/${pageId}/photos`, { method: "POST", body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }

  // Upload a photo to a Page WITHOUT publishing it to the feed; returns the photo id.
  async uploadUnpublishedPhoto(pageId, imagePath) {
    const pageToken = await this.getPageToken(pageId);
    const buf = await readFile(imagePath);
    const form = new FormData();
    form.set("published", "false");
    form.set("access_token", pageToken);
    form.set("source", new Blob([buf]), path.basename(imagePath));
    const res = await this.fetch(`${this.base}/${pageId}/photos`, { method: "POST", body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  }

  // Facebook Page photo Story (ephemeral ~24h). Stories CANNOT be scheduled — this publishes now.
  async publishPhotoStory(pageId, { imagePath }) {
    const photoId = await this.uploadUnpublishedPhoto(pageId, imagePath);
    const pageToken = await this.getPageToken(pageId);
    const body = new URLSearchParams({ photo_id: String(photoId), access_token: pageToken });
    const res = await this.fetch(`${this.base}/${pageId}/photo_stories`, { method: "POST", body });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }
}
