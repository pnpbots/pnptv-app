#!/usr/bin/env bash
# =============================================================================
# apply-npm-routing.sh — Apply versioned Nginx routing to NPM proxy
# =============================================================================
# Patches two NPM-generated proxy host configs so that:
#   - Default location / → pnptv-web:80  (React SPA)
#   - /api/, /pnp/, /auth/, etc. → pnptv-bot:3001 (Node.js backend)
#
#   proxy_host/10.conf  →  pnptv.app
#   proxy_host/9.conf   →  app.pnptv.app  (same routing, same upstream)
#
# Also deploys the shared server_proxy.conf (ATProto OAuth routes).
#
# Strategy: FULL REBUILD of the injected region on every run.
#   1. Keep everything in the runtime file from the top through the
#      server-block `error_log ... warn;` directive (NPM-generated header).
#   2. Keep everything from the catch-all `location / {` through EOF
#      (NPM-generated tail, plus any per-vhost catch-all customisations).
#   3. Between those two anchors, DELETE whatever is there (any prior
#      injected region — sentinel-wrapped or legacy unmarked) and RE-INSERT
#      a fresh copy of pnptv-app-proxy.conf wrapped in BEGIN/END sentinels.
#
# This makes the script:
#   - Idempotent (running twice produces byte-identical output)
#   - Auto-updating (new blocks in the source propagate on every run)
#   - Safe (backups before every write, nginx -t before reload, rollback
#     on validation failure)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NPM_DATA="${REPO_ROOT}/infrastructure/data/npm/data/nginx"
NPM_CONFIGS="${REPO_ROOT}/infrastructure/configs/npm"
PROXY_HOST_10="${NPM_DATA}/proxy_host/10.conf"
PROXY_HOST_9="${NPM_DATA}/proxy_host/9.conf"
CUSTOM_CONF="${NPM_DATA}/custom/server_proxy.conf"
BACKEND_LOCATIONS="${NPM_CONFIGS}/pnptv-app-proxy.conf"
ATPROTO_CONF="${NPM_CONFIGS}/server_proxy.conf"
CONTAINER="npm-proxy"

# Sentinel markers wrap the injected region so re-runs can find and replace it.
SENTINEL_BEGIN="# ==== PNPTV-APP-PROXY BEGIN (managed by apply-npm-routing.sh) ===="
SENTINEL_END="# ==== PNPTV-APP-PROXY END (managed by apply-npm-routing.sh) ===="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Preflight checks ---

if [ ! -f "$PROXY_HOST_10" ]; then
    error "proxy_host/10.conf not found at $PROXY_HOST_10"
    error "Is the npm-proxy container running with mounted data?"
    exit 1
fi

if [ ! -f "$PROXY_HOST_9" ]; then
    error "proxy_host/9.conf not found at $PROXY_HOST_9"
    error "Is the npm-proxy container running with mounted data?"
    exit 1
fi

if [ ! -f "$BACKEND_LOCATIONS" ]; then
    error "Source config not found: $BACKEND_LOCATIONS"
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    error "Container '${CONTAINER}' is not running"
    exit 1
fi

# --- Step 1: Deploy shared server_proxy.conf (ATProto routes) ---

info "Deploying shared server_proxy.conf ..."
mkdir -p "$(dirname "$CUSTOM_CONF")"
cp "$ATPROTO_CONF" "$CUSTOM_CONF"

# --- Rebuild helper ---------------------------------------------------------
#
# rebuild_vhost <runtime-file> <label>
#
# Rebuilds the runtime file so that everything between the NPM-generated
# `error_log ... warn;` directive and the catch-all `location / {` block is
# replaced by a fresh, sentinel-wrapped copy of pnptv-app-proxy.conf.
#
# The awk pipeline runs in 3 states:
#   state=0 — inside the NPM header (copy through as-is).
#             On the FIRST `  error_log ... warn;` line, print the line,
#             emit the sentinel-wrapped injected region, then switch to
#             state=1 (skip mode).
#   state=1 — skip every line until we reach `^  location / {` (the
#             single catch-all). Then switch to state=2 and print.
#   state=2 — past the catch-all; copy through as-is.
#
# This handles all three on-disk states cleanly:
#   (a) Pristine NPM-generated file (no prior injection)
#   (b) Legacy unmarked injection (previous versions of this script)
#   (c) Current sentinel-wrapped injection (from this version)
#
# In every case the output is byte-identical for a given source file.
# ---------------------------------------------------------------------------

rebuild_vhost() {
    local target="$1"
    local label="$2"

    if [ ! -f "$target" ]; then
        error "$label: $target not found"
        return 1
    fi

    # Sanity: the file must contain the two anchors we rely on.
    if ! grep -qE '^  error_log .*warn;' "$target"; then
        error "$label: missing 'error_log ... warn;' anchor — refusing to rewrite"
        return 1
    fi
    if ! grep -qE '^  location / \{' "$target"; then
        error "$label: missing catch-all 'location / {' anchor — refusing to rewrite"
        return 1
    fi

    local backup="${target}.bak.$(date +%s)"
    cp "$target" "$backup"
    info "$label: backup saved to $backup"

    # Normalise the default upstream to pnptv-web:80 (NPM may reset it).
    sed -i 's/set \$server         "[^"]*"/set $server         "pnptv-web"/' "$target"
    sed -i 's/set \$port           [0-9]\+/set $port           80/'         "$target"

    # Any surviving legacy references to the old bridge IP get corrected.
    sed -i 's|http://172.17.0.1:3001|http://pnptv-bot:3001|g' "$target"

    local tmp="${target}.tmp.$$"
    awk -v inject="$BACKEND_LOCATIONS" \
        -v sentinel_begin="$SENTINEL_BEGIN" \
        -v sentinel_end="$SENTINEL_END" '
        BEGIN { state = 0 }

        # State 0: NPM header — copy through until we hit error_log.
        state == 0 {
            print
            if ($0 ~ /^  error_log .*warn;/) {
                print ""
                print "  " sentinel_begin
                while ((getline line < inject) > 0) {
                    if (line == "") print ""
                    else           print "  " line
                }
                close(inject)
                print "  " sentinel_end
                print ""
                state = 1
            }
            next
        }

        # State 1: skip everything (old injected region) until the catch-all.
        state == 1 {
            if ($0 ~ /^  location \/ \{/) {
                print
                state = 2
            }
            next
        }

        # State 2: tail — copy through.
        state == 2 { print }
    ' "$target" > "$tmp"

    # Sanity: the output must still contain the catch-all we preserved.
    if ! grep -qE '^  location / \{' "$tmp"; then
        error "$label: rebuild produced a file missing the catch-all — aborting"
        rm -f "$tmp"
        cp "$backup" "$target"
        return 1
    fi

    mv "$tmp" "$target"
    info "$label: injected region rebuilt from $BACKEND_LOCATIONS"
}

# --- Step 2: Rebuild proxy_host/10.conf (pnptv.app) -------------------------

info "Rebuilding proxy_host/10.conf (pnptv.app) ..."
rebuild_vhost "$PROXY_HOST_10" "10.conf"

# --- Step 3: Rebuild proxy_host/9.conf (app.pnptv.app) ----------------------

info "Rebuilding proxy_host/9.conf (app.pnptv.app) ..."
rebuild_vhost "$PROXY_HOST_9" "9.conf"

# --- Step 4: Validate and reload ---

info "Testing nginx configuration ..."
if docker exec "$CONTAINER" nginx -t 2>&1; then
    info "Config valid — reloading nginx ..."
    docker exec "$CONTAINER" nginx -s reload
    info "Nginx reloaded successfully"
else
    error "Nginx config test FAILED — rolling back"
    LATEST_10=$(ls -t "${PROXY_HOST_10}".bak.* 2>/dev/null | head -1 || true)
    if [ -n "$LATEST_10" ]; then
        cp "$LATEST_10" "$PROXY_HOST_10"
        info "Rolled back 10.conf to $LATEST_10"
    fi
    LATEST_9=$(ls -t "${PROXY_HOST_9}".bak.* 2>/dev/null | head -1 || true)
    if [ -n "$LATEST_9" ]; then
        cp "$LATEST_9" "$PROXY_HOST_9"
        info "Rolled back 9.conf to $LATEST_9"
    fi
    docker exec "$CONTAINER" nginx -s reload 2>/dev/null || true
    exit 1
fi

# --- Step 5: Verify ---

info "Verifying routing ..."
FAILURES=0

# pnptv.app — bare-domain redirect to app.pnptv.app (catch-all is a 301).
SPA_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/subscribe" 2>/dev/null || echo "000")
if [ "$SPA_CODE" = "301" ] || [ "$SPA_CODE" = "302" ]; then
    info "  pnptv.app/subscribe → $SPA_CODE (redirect to app.pnptv.app — expected)"
else
    error "  pnptv.app/subscribe → $SPA_CODE (expected 301/302 redirect)"
    FAILURES=$((FAILURES + 1))
fi

# pnptv.app — API
API_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/api/health" 2>/dev/null || echo "000")
if [ "$API_CODE" = "200" ]; then
    info "  pnptv.app/api/health → $API_CODE (backend)"
else
    error "  pnptv.app/api/health → $API_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# pnptv.app — health
HEALTH_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/health" 2>/dev/null || echo "000")
if [ "$HEALTH_CODE" = "200" ]; then
    info "  pnptv.app/health → $HEALTH_CODE (backend)"
else
    error "  pnptv.app/health → $HEALTH_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# app.pnptv.app — SPA
APP_SPA_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://app.pnptv.app/subscribe" 2>/dev/null || echo "000")
if [ "$APP_SPA_CODE" = "200" ]; then
    info "  app.pnptv.app/subscribe → $APP_SPA_CODE (SPA)"
else
    error "  app.pnptv.app/subscribe → $APP_SPA_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# app.pnptv.app — API
APP_API_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://app.pnptv.app/api/health" 2>/dev/null || echo "000")
if [ "$APP_API_CODE" = "200" ]; then
    info "  app.pnptv.app/api/health → $APP_API_CODE (backend)"
else
    error "  app.pnptv.app/api/health → $APP_API_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# app.pnptv.app — auth (new route, was previously missing)
APP_AUTH_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://app.pnptv.app/auth/telegram" 2>/dev/null || echo "000")
if [ "$APP_AUTH_CODE" != "000" ]; then
    info "  app.pnptv.app/auth/ → $APP_AUTH_CODE (backend reachable)"
else
    error "  app.pnptv.app/auth/ → $APP_AUTH_CODE (no response)"
    FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
    warn "$FAILURES verification(s) failed — check logs"
    exit 1
fi

echo ""
info "All routing applied and verified successfully"
