#!/usr/bin/env bash
# Builds on THIS computer and deploys to Netlify (GitHub auto-builds are turned off).
#   npm run deploy:netlify
# Builds from a clean export of the last commit (git archive), so the local .env, uncommitted
# changes and local caches can never reach production. Production settings come from the
# Netlify site's environment variables; netlify.toml's production command runs migrations first.
set -euo pipefail

SITE="${NETLIFY_SITE_ID:-bcc6c048-a8fe-434e-900a-cc8f5a19b2fd}"
cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes: commit (or stash) them first — only committed code is deployed." >&2
  exit 1
fi

REV="$(git rev-parse --short HEAD)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Exporting commit $REV…"
git archive HEAD | tar -x -C "$WORK"
cd "$WORK"
npm ci --no-audit --no-fund
netlify deploy --build --prod --context production --site "$SITE" --message "Local deploy of $REV"
