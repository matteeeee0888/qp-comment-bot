#!/bin/bash
# Autonomous pet-page generation wrapper — run by launchd, also runnable by hand.
set -u
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v24.14.1/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="$HOME/pet-page-posts"
LOG="$REPO/state/run.log"
cd "$REPO" || exit 1
mkdir -p "$REPO/state"
echo "=== run $(date) ===" >> "$LOG"

# 1. Cheap, no-AI, no-network gap check. Exit immediately if the queue is full.
GAP="$(node bin/gap-check.js 2>>"$LOG")"
echo "gap-check: $GAP" >> "$LOG"
if [ "$GAP" = "FULL" ]; then
  echo "queue full — nothing to do" >> "$LOG"
  exit 0
fi

# 2. Only now (there is work) verify auth. On failure, Telegram + abort.
if ! node bin/auth-check.js >> "$LOG" 2>&1; then
  node bin/notify.js "⚠️ pet-page-posts: auth-check FAILED, run aborted. Check claude/codex/Meta login." >> "$LOG" 2>&1
  exit 1
fi

# 3. The only AI step. caffeinate holds the Mac awake; call the claude BINARY directly
#    (interactive 'claude' is a caffeinate-wrapped shell function absent under launchd).
caffeinate -i "$HOME/.local/bin/claude" -p "$(cat "$REPO/AUTONOMOUS-RUNBOOK.md")" \
  --dangerously-skip-permissions --output-format text >> "$LOG" 2>&1
RC=$?
echo "claude exit: $RC" >> "$LOG"
if [ "$RC" -ne 0 ]; then
  node bin/notify.js "⚠️ pet-page-posts: generation run exited $RC. Check state/run.log." >> "$LOG" 2>&1
fi
exit 0
