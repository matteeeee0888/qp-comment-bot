# Weekly Generation Runbook

Run once a week in a Claude Code session (needs web search, image generation, and `/codex`).

## 1. Refresh the page map (topic + active ads + tier + eligibility)
```bash
cd ~/pet-page-posts && node bin/build-map.js
```
Review the table. Only `eligible` pages get posts: pages with >=1 active ad, plus the always-include
cat page (Janet Harper). Fix any wrong topic in `overrides.json` and re-run. Adjust tier thresholds
or `daysPattern` in `config.json` to tune volume/cadence.

## 2. Scaffold the week's draft notes
```bash
cd ~/pet-page-posts && node bin/plan-week.js
```
Creates draft notes (variable 1-2/day by tier, staggered times 08:00-20:00) in the drafts folder.
Use ORGANIC, non-rounded `scheduled_time` values (e.g. 08:17, 13:42, 16:53) — never round
times like 09:00 or 14:30. Random odd minutes look human and avoid an obvious automation footprint.
`bin/plan-week.js` already jitters minutes; if you set times manually, keep them odd/non-rounded.

## 3. Research a topic POOL (not one search per post)
- Web-search Reddit / Quora / Google / pet forums for fresh, engaging dog & cat material.
- Target ~40 dog + ~12 cat topics. For each: 2-3 sentence summary, 2-3 facts, `source_url`,
  and `source_image_url` if the source has a usable image.

## 4. Fill each scaffold note (grouped by `topic`)
- Pick a pool topic fitting the page's persona/voice (Russel Prewitt = vet tone, etc.).
- Replace the body with an ORIGINAL elaboration (never copy the source text).
- Set `source_url`.
- Image (`<draftsDir>` = `02 Media Buying/Page Posts`; put images in its `img/` subfolder):
  - If the pool topic has a usable `source_image_url`: download to
    `<draftsDir>/img/<note-basename>.<ext>`; set `image: ./img/<file>`, `image_source: sourced`.
  - Else generate with Codex CLI (it has a gpt-image tool; NO API key needed). IMPORTANT: the
    Codex sandbox CANNOT write into the Obsidian vault ("Operation not permitted"), so let it save
    to its default location and copy the file in afterward. Recipe:
    ```bash
    codex exec --skip-git-repo-check -m gpt-5.5 --config model_reasoning_effort="low" \
      --sandbox danger-full-access --full-auto -C /tmp \
      "Use your image generation tool (gpt-image) to create a photorealistic lifestyle photo, no text/watermark, of <SCENE>. Save it and tell me the absolute path." </dev/null 2>/tmp/img.log
    # Codex saves to ~/.codex/generated_images/<session>/ig_*.png — copy it in:
    cp "$(grep -o '/Users/[^ ]*ig_[^ ]*\.png' /tmp/img.log | tail -1)" \
       "<draftsDir>/img/<note-basename>.png"
    ```
    Then set `image: ./img/<note-basename>.png`, `image_source: generated`.
  - ALSO append the image as an Obsidian embed on the LAST line of the note body:
    `![[<note-basename>.png]]` — this makes the image preview inline in Obsidian. The publisher
    automatically strips standalone embed lines, so the Facebook message stays clean (do not
    worry about it ending up in the post).
    Run image jobs sequentially or verify each by content — parallel logs can mislabel which
    file is which (identify by viewing the image, not by trusting the log path).
  - (Fallback if Codex image gen is unavailable: native `image-generation` skill.)

## 5. Enforce uniqueness (Meta integrity safety)
- No two notes share identical body text.
- No `sourced` image reused across pages.
- Leave every note `status: draft`.

## 6. Hand off
Tell Andrea the week is ready. He reviews in Obsidian and sets `status: approved` (or edits /
`rejected`). The daily launchd submitter pushes approved notes to Facebook's scheduler, which
publishes each at its `scheduled_time` - even if the Mac is off.
