# Story Runbook — QuietProtector (ephemeral Facebook Page Stories)

Stories are NOT feed posts:
- They publish **immediately** (no scheduling) and disappear after ~24h.
- Vertical **9:16** full-screen images.
- Same brand voice + HARD RULES as `AUTONOMOUS-RUNBOOK.md` (no fear-mongering, no claims, no products,
  US English, wholesome/calm imagery — never a disaster in progress).

**Scope of this v1:** publish ONE Story to ONE Page, on demand.
Follow-ups (not built yet): autonomous multi-page Story cadence (needs an immediate-publish cron, not the
feed buffer); **Instagram** Stories (needs a linked IG Business account, `instagram_content_publish`, and a
publicly hosted image URL — we'd reuse the US-Project Supabase pipeline for hosting).

## Make + post a Story
1. Pick a page (use the priority pages) and a pillar: `blackout` / `storm` / `fire` / `preparedness`.
2. Generate a vertical 9:16 Story image:
   `bash bin/gen-image.sh --story "<calm, wholesome 9:16 scene matching the pillar>" /tmp/story.png`
3. Validate without publishing (recommended first):
   `node bin/post-story.js --page <PAGE_ID> --image /tmp/story.png --dry-run`
4. Publish it NOW:
   `node bin/post-story.js --page <PAGE_ID> --image /tmp/story.png`
   On success it prints `{ "post_id": ..., "success": true }`.

## Rules
- Stories publish immediately — only run this when you actually want it live (there is no scheduler).
- Wholesome, calm, vertical imagery. No disasters in progress, no claims, no products, no on-image selling.
- `gen-image.sh` MUST be run via Bash (it relies on `</dev/null` stdin for codex).
- Page IDs are in `page-topic-map.json`.
