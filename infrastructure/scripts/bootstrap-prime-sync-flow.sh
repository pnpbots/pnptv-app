#!/usr/bin/env bash
#
# Idempotent bootstrap for the Directus Flow that auto-syncs prime_videos
# rows to the PNPtv! PRIME channel. Safe to run on a fresh server, and safe
# to re-run on an existing one (it patches the existing flow/operation
# instead of creating duplicates).
#
# What it does:
#   1. Reads DIRECTUS_ADMIN_TOKEN and PRIME_SYNC_SECRET from .env.production
#      (must already be set; PRIME_SYNC_SECRET can be generated with
#       `openssl rand -hex 32` and appended to .env.production).
#   2. Looks up an existing Flow by name; creates one if absent.
#   3. Looks up an existing operation linked to that flow; creates + links
#      one if absent. Always patches the operation's URL + secret header so
#      a rotated secret takes effect immediately.
#
# Usage:
#   bash infrastructure/scripts/bootstrap-prime-sync-flow.sh
#
# Exit codes:
#   0 — flow + operation present and pointing at the configured endpoint
#   non-zero — Directus unreachable, missing env, or API error

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.production"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not found" >&2
  exit 2
fi

# Read only the specific vars we need — sourcing the whole file is unsafe
# because real-world .env values can contain shell metacharacters.
read_env() {
  local key="$1"
  local v
  v="$(grep -m1 "^${key}=" "$ENV_FILE" | cut -d= -f2-)"
  # strip optional surrounding quotes
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

DIRECTUS_ADMIN_TOKEN="$(read_env DIRECTUS_ADMIN_TOKEN)"
PRIME_SYNC_SECRET="$(read_env PRIME_SYNC_SECRET)"
DIRECTUS_PUBLIC_URL="$(read_env DIRECTUS_PUBLIC_URL)"
PRIME_SYNC_ENDPOINT="$(read_env PRIME_SYNC_ENDPOINT)"

: "${DIRECTUS_ADMIN_TOKEN:?DIRECTUS_ADMIN_TOKEN missing in .env.production}"
: "${PRIME_SYNC_SECRET:?PRIME_SYNC_SECRET missing in .env.production — generate with: openssl rand -hex 32}"

DIRECTUS_BASE="${DIRECTUS_PUBLIC_URL:-https://cms.pnptv.app}"
ENDPOINT_URL="${PRIME_SYNC_ENDPOINT:-https://app.pnptv.app/api/webapp/internal/prime-videos/sync}"
FLOW_NAME="Sync prime_videos to PNPtv! PRIME channel"

auth_header="Authorization: Bearer ${DIRECTUS_ADMIN_TOKEN}"

# Make sure Directus is reachable + token is valid.
if ! curl -sk -f -H "$auth_header" "${DIRECTUS_BASE}/users/me" > /dev/null; then
  echo "FATAL: cannot reach ${DIRECTUS_BASE} or DIRECTUS_ADMIN_TOKEN is invalid" >&2
  exit 3
fi

# ── 1. Find or create the Flow ──
flow_id="$(curl -sk -H "$auth_header" "${DIRECTUS_BASE}/flows?fields=id,name&limit=-1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((f['id'] for f in d.get('data',[]) if f.get('name')==\"$FLOW_NAME\"), ''))")"

if [[ -z "$flow_id" ]]; then
  echo "Creating Flow: $FLOW_NAME"
  flow_id="$(curl -sk -X POST -H "$auth_header" -H "Content-Type: application/json" \
    "${DIRECTUS_BASE}/flows" \
    -d "$(cat <<JSON
{
  "name": "${FLOW_NAME}",
  "icon": "sync",
  "color": "#7C3AED",
  "description": "On create/update/delete of prime_videos, POST to bot webhook so the channel feed stays in sync.",
  "status": "active",
  "trigger": "event",
  "accountability": "all",
  "options": {
    "type": "action",
    "scope": ["items.create", "items.update", "items.delete"],
    "collections": ["prime_videos"]
  }
}
JSON
)" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")"
  echo "  flow_id=$flow_id"
else
  echo "Flow already exists: $flow_id"
fi

# ── 2. Find or create the operation linked to the flow ──
# URL-encode [ ] explicitly — curl sends them raw but Directus needs %5B / %5D.
op_id="$(curl -sk -H "$auth_header" "${DIRECTUS_BASE}/operations?filter%5Bflow%5D%5B_eq%5D=${flow_id}&fields=id,key&limit=-1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); ops=d.get('data',[]); print(ops[0]['id'] if ops else '')")"

# The body template tells Directus to send the entire trigger object as JSON.
# Bot side parses event/keys/payload from this single shape.
op_body_template='{{$trigger}}'

op_options="$(python3 -c "
import json
print(json.dumps({
  'method': 'POST',
  'url': '${ENDPOINT_URL}',
  'headers': [
    {'header': 'Content-Type', 'value': 'application/json'},
    {'header': 'x-prime-sync-secret', 'value': '${PRIME_SYNC_SECRET}'},
  ],
  'body': '${op_body_template}',
}))
")"

if [[ -z "$op_id" ]]; then
  echo "Creating operation"
  op_id="$(curl -sk -X POST -H "$auth_header" -H "Content-Type: application/json" \
    "${DIRECTUS_BASE}/operations" \
    -d "$(python3 -c "
import json
print(json.dumps({
  'name': 'POST to bot sync webhook',
  'key': 'webhook',
  'type': 'request',
  'position_x': 19,
  'position_y': 1,
  'flow': '${flow_id}',
  'options': ${op_options},
}))
")" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")"
  echo "  op_id=$op_id"

  # Link the flow's primary operation pointer
  curl -sk -X PATCH -H "$auth_header" -H "Content-Type: application/json" \
    "${DIRECTUS_BASE}/flows/${flow_id}" \
    -d "{\"operation\": \"${op_id}\"}" > /dev/null
  echo "  linked op to flow"
else
  echo "Operation already exists: $op_id (patching options to current secret/endpoint)"
  curl -sk -X PATCH -H "$auth_header" -H "Content-Type: application/json" \
    "${DIRECTUS_BASE}/operations/${op_id}" \
    -d "{\"options\": ${op_options}}" > /dev/null
fi

# ── 3. Verify flow status is active ──
status="$(curl -sk -H "$auth_header" "${DIRECTUS_BASE}/flows/${flow_id}?fields=status" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")"

if [[ "$status" != "active" ]]; then
  echo "Flow status is '$status' — activating"
  curl -sk -X PATCH -H "$auth_header" -H "Content-Type: application/json" \
    "${DIRECTUS_BASE}/flows/${flow_id}" \
    -d '{"status": "active"}' > /dev/null
fi

echo ""
echo "✓ Directus → bot prime_videos sync flow is configured and active."
echo "  Flow id:      $flow_id"
echo "  Operation id: $op_id"
echo "  Endpoint:     $ENDPOINT_URL"
echo "  View in UI:   ${DIRECTUS_BASE}/admin/settings/flows/${flow_id}"
