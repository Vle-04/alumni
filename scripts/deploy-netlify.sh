#!/usr/bin/env bash
# Builds on THIS computer and deploys to Netlify (GitHub auto-builds are turned off).
#   npm run deploy:netlify
# - Builds from a clean export of the last commit (git archive), so the local .env, uncommitted
#   changes and local caches can never reach production.
# - Production settings come from the Netlify site's environment variables.
# - Netlify Database only gives the deployed app write access (the CLI gets a read-only user), so
#   migrations are applied by the app itself right after publishing: POST /api/ops/migrate.
set -euo pipefail

SITE="${NETLIFY_SITE_ID:-bcc6c048-a8fe-434e-900a-cc8f5a19b2fd}"
cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes: commit (or stash) them first. Only committed code is deployed." >&2
  exit 1
fi

REV="$(git rev-parse --short HEAD)"
APP_URL="$(netlify env:get APP_URL --context production --site "$SITE" 2>/dev/null | tail -1)"
CRON_SECRET="$(netlify env:get CRON_SECRET --context production --site "$SITE" 2>/dev/null | tail -1)"
case "$APP_URL" in https://*) ;; *) echo "APP_URL isn't set on the Netlify site." >&2; exit 1 ;; esac
[ "${#CRON_SECRET}" -ge 32 ] || { echo "CRON_SECRET isn't set on the Netlify site." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Exporting commit ${REV}..."
git archive HEAD | tar -x -C "$WORK"
cd "$WORK"
npm ci --no-audit --no-fund

netlify deploy --build --prod --context production --site "$SITE" --message "Local deploy of ${REV}"

echo "Applying database migrations through the app..."
RESULT="$(curl -sS --http1.1 -X POST -H "authorization: Bearer ${CRON_SECRET}" -w '\n%{http_code}' "${APP_URL}/api/ops/migrate")"
CODE="$(printf '%s' "$RESULT" | tail -1)"
printf '%s\n' "$RESULT" | sed '$d'
if [ "$CODE" != "200" ]; then
  echo "Migrations FAILED (HTTP $CODE). The new code is live; fix and redeploy." >&2
  exit 1
fi
echo "Done: ${APP_URL}"
