#!/bin/bash
set -e
REPO="$HOME/pet-page-posts"
echo "Installing pet-page-posts autonomous poster..."
cd "$REPO"
npm install
chmod +x launchd/run-autonomous.sh bin/gen-image.sh
# Render the LaunchAgents with the current $HOME and load them.
for job in publish generate; do
  TMPL="launchd/com.pawesome.pageposts.$job.plist.tmpl"
  PLIST="$HOME/Library/LaunchAgents/com.pawesome.pageposts.$job.plist"
  if [ ! -f "$TMPL" ]; then echo "skip $job (no template)"; continue; fi
  sed "s#__HOME__#$HOME#g" "$TMPL" > "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "loaded $job"
done
echo "Done. Verify: node bin/auth-check.js  (and ensure ~/.claude/credentials/{meta,telegram}.env exist)."
