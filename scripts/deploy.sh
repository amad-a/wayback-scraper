#!/usr/bin/env bash
#
# Deploys whatever is on origin/main to the box this runs on.
#
# Run it on the server, not from your laptop:
#   ssh deploy@167.233.141.19 '~/wayback-scraper/scripts/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

BEFORE=$(git rev-parse HEAD)
# --ff-only so a diverged server fails loudly instead of quietly making a merge commit.
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "already up to date at $(git log --oneline -1)"
fi

# better-sqlite3 is a native module, so a full reinstall is slow. Only pay for it
# when the lockfile actually moved. `npm ci` rather than `npm install`: install
# rewrites package-lock.json, which dirties the tree and blocks the next pull.
if ! git diff --quiet "$BEFORE" "$AFTER" -- package-lock.json; then
  echo "lockfile changed, reinstalling"
  npm ci
fi

pm2 restart wayback --update-env

# A restart can "succeed" into a crash loop, so ask the app itself.
sleep 3
if curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:8080/; then
  echo "deploy OK: $(git log --oneline -1)"
else
  echo "HEALTH CHECK FAILED -- app is not answering on :8080"
  pm2 logs wayback --lines 30 --nostream
  exit 1
fi
