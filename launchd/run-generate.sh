#!/bin/bash
# Daily QuietProtector run: generate the next day's posts (text via OpenAI + images via
# gpt-image-1), then schedule them on Facebook. Run by launchd, also runnable by hand.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# launchd has a minimal PATH — add the usual node locations.
for d in /opt/homebrew/bin /usr/local/bin "$HOME"/.nvm/versions/node/*/bin; do
  [ -x "$d/node" ] && PATH="$d:$PATH"
done
export PATH
LOG="$REPO/state/run.log"
mkdir -p "$REPO/state"
cd "$REPO" || exit 1
echo "=== generate run $(date) ===" >> "$LOG"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found in PATH" >> "$LOG"
  exit 1
fi
# caffeinate keeps the Mac awake for the duration of the run.
caffeinate -i node bin/generate-day.js >> "$LOG" 2>&1
caffeinate -i node bin/publish.js     >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"
