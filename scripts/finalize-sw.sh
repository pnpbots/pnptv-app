#!/bin/bash
# Replace the __BUILD_ID__ placeholder in dist/sw.js with the current git
# short SHA so every deploy invalidates the previous Service Worker cache.
# If git is unavailable, fall back to a unix timestamp.
#
# Called automatically by `npm run build` in apps/web/package.json.
# Path argument is the dist/ folder; defaults to ./dist when run from apps/web.

set -euo pipefail

DIST="${1:-dist}"
SW="$DIST/sw.js"

if [ ! -f "$SW" ]; then
  echo "[finalize-sw] $SW not found — vite build did not run?" >&2
  exit 1
fi

if [ -z "${PNPTV_BUILD_ID:-}" ]; then
  PNPTV_BUILD_ID=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
fi

if ! grep -q "__BUILD_ID__" "$SW"; then
  echo "[finalize-sw] no __BUILD_ID__ placeholder in $SW — already finalized?" >&2
  exit 0
fi

sed -i "s/__BUILD_ID__/$PNPTV_BUILD_ID/g" "$SW"
echo "[finalize-sw] sw.js CACHE_NAME → pnptv-$PNPTV_BUILD_ID"
