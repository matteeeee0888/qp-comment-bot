#!/bin/bash
# Live comment responder run: reads new comments on QP pages (organic + ad/dark posts),
# classifies via Claude, and replies/hides per the safe router. Run by launchd every ~15 min.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for d in /opt/homebrew/bin /usr/local/bin "$HOME"/.nvm/versions/node/*/bin; do
  [ -x "$d/node" ] && PATH="$d:$PATH"
done
export PATH
LOG="$REPO/state/comments.log"
mkdir -p "$REPO/state"
cd "$REPO" || exit 1
echo "=== comments run $(date) ===" >> "$LOG"
if ! command -v node >/dev/null 2>&1; then echo "ERROR: node not found" >> "$LOG"; exit 1; fi
caffeinate -i node bin/comment-run.js --live --hide-risky >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"
