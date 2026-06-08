# Setup / migrate to a new Mac

1. `git clone git@github.com:itscutarms/pet-page-posts.git ~/pet-page-posts`
2. Install Node 24 via nvm; install the `claude` and `codex` CLIs.
3. Log in: run `claude` once and `codex` once (interactively) so their auth files exist.
4. Create the two secret files (NOT in the repo):
   - `~/.claude/credentials/meta.env`  → `META_ACCESS_TOKEN=...`
   - `~/.claude/credentials/telegram.env` → `TELEGRAM_BOT_TOKEN=...` and `TELEGRAM_CHAT_ID=...`
5. `cd ~/pet-page-posts && ./install.sh`
6. Verify: `node bin/auth-check.js` → `auth OK`. Trigger one run by hand: `launchd/run-autonomous.sh`.

## How it runs
- The `generate` LaunchAgent fires a few times a day; launchd also runs a missed schedule when the
  Mac next wakes. Each fire runs a cheap no-AI gap-check and only does AI work when the 7-day buffer
  needs refilling.
- Posts are scheduled on Facebook's native scheduler, so they publish at their time even if the Mac
  is later off.
- State + dedup live in `state/` and are pushed to GitHub each run, so a fresh clone already carries
  your posting history and "don't repeat" memory.

## Kill switch
`launchctl unload ~/Library/LaunchAgents/com.pawesome.pageposts.generate.plist` stops all autonomous
generation. Already-scheduled posts still publish from Facebook. Re-enable with `launchctl load ...`.

## Paths the system depends on (from the spike)
- `claude` binary: `~/.local/bin/claude` (the interactive `claude` is a caffeinate-wrapped function).
- `codex` + `node`: `~/.nvm/versions/node/<ver>/bin`. If the Node version changes, update the PATH
  line in `launchd/run-autonomous.sh`.
- Images: codex saves to `~/.codex/generated_images/<session>/ig_*.png`; we locate the file by newest
  mtime (codex stdout does not report the path).
