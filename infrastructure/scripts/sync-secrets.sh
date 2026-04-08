#!/usr/bin/env bash
# Infisical → .env sync script
# Pulls secrets from Infisical and rewrites .env / .env.production
# Restarts containers only if content changed.
# Cron: 0 * * * * /opt/pnptvapp/infrastructure/scripts/sync-secrets.sh >> /opt/pnptvapp/infrastructure/logs/sync-secrets.log 2>&1

set -euo pipefail

APP_DIR="/opt/pnptvapp"
LOG_PREFIX="[$(date -Iseconds)] [sync-secrets]"
INFISICAL_URL="http://127.0.0.1:8200"
CLIENT_ID="36440965-7996-47ce-bdf8-9a64c163d811"
CLIENT_SECRET="c0f7a3fb9ac8360fe3310d4f6f683d57d3ab5d804337aca26347b36227dff5cd"
PROJECT_SLUG="pn-ptv-app-yigo"

# ── helpers ──────────────────────────────────────────────────────────────────

log() { echo "${LOG_PREFIX} $*"; }

die() { log "ERROR: $*"; exit 1; }

# Fetch a fresh machine-identity access token
get_token() {
  curl -sf -X POST "${INFISICAL_URL}/api/v1/auth/universal-auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":\"${CLIENT_ID}\",\"clientSecret\":\"${CLIENT_SECRET}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])"
}

# Fetch all secrets for an environment and write to a temp file in KEY=VALUE format
fetch_env() {
  local env="$1"
  local token="$2"
  curl -sf "${INFISICAL_URL}/api/v3/secrets/raw?workspaceSlug=${PROJECT_SLUG}&environment=${env}" \
    -H "Authorization: Bearer ${token}" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
secrets = d.get('secrets', [])
for s in sorted(secrets, key=lambda x: x['secretKey']):
    key = s['secretKey']
    val = s.get('secretValue', '')
    # Quote values containing spaces, special chars or newlines
    if any(c in val for c in ' \t\n#\"') or not val:
        val = '\"' + val.replace('\"', '\\\\\"') + '\"'
    print(f'{key}={val}')
"
}

# ── main ─────────────────────────────────────────────────────────────────────

log "Starting secret sync from Infisical (${INFISICAL_URL})"

# Check Infisical is reachable
curl -sf "${INFISICAL_URL}/api/status" >/dev/null 2>&1 \
  || die "Infisical is not reachable at ${INFISICAL_URL}"

TOKEN=$(get_token) || die "Failed to authenticate with Infisical"
log "Authenticated as machine identity pnptv-ci"

mkdir -p "${APP_DIR}/infrastructure/logs"

CHANGED=0

# ── prod → .env.production ───────────────────────────────────────────────────
PROD_TMP=$(mktemp)
fetch_env "prod" "${TOKEN}" > "${PROD_TMP}"

PROD_TARGET="${APP_DIR}/.env.production"
if ! diff -q "${PROD_TMP}" <(grep -v '^#' "${PROD_TARGET}" | grep -v '^[[:space:]]*$' | sort 2>/dev/null || true) >/dev/null 2>&1; then
  # Preserve the header comment, then write sorted secrets
  {
    echo "# Auto-synced from Infisical on $(date -Iseconds)"
    cat "${PROD_TMP}"
  } > "${PROD_TARGET}.new"
  mv "${PROD_TARGET}.new" "${PROD_TARGET}"
  log "Updated .env.production ($(wc -l < "${PROD_TMP}") secrets)"
  CHANGED=1
else
  log ".env.production unchanged"
fi
rm -f "${PROD_TMP}"

# ── staging → .env ───────────────────────────────────────────────────────────
STAGING_TMP=$(mktemp)
fetch_env "staging" "${TOKEN}" > "${STAGING_TMP}"

STAGING_TARGET="${APP_DIR}/.env"
if ! diff -q "${STAGING_TMP}" <(grep -v '^#' "${STAGING_TARGET}" | grep -v '^[[:space:]]*$' | sort 2>/dev/null || true) >/dev/null 2>&1; then
  {
    echo "# Auto-synced from Infisical on $(date -Iseconds)"
    cat "${STAGING_TMP}"
  } > "${STAGING_TARGET}.new"
  mv "${STAGING_TARGET}.new" "${STAGING_TARGET}"
  log "Updated .env ($(wc -l < "${STAGING_TMP}") secrets)"
  CHANGED=1
else
  log ".env unchanged"
fi
rm -f "${STAGING_TMP}"

# ── restart containers if anything changed ───────────────────────────────────
if [ "${CHANGED}" -eq 1 ]; then
  log "Secrets changed — restarting app containers"
  cd "${APP_DIR}"
  docker compose up -d pnptv-web pnptv-bot 2>&1 | while IFS= read -r line; do log "  docker: ${line}"; done
  docker exec npm-proxy nginx -s reload 2>&1 | while IFS= read -r line; do log "  nginx: ${line}"; done || true
  log "Containers restarted"
else
  log "No changes — skipping restart"
fi

log "Sync complete"
