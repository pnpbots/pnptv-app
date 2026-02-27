#!/usr/bin/env bash
# =============================================================================
# apply-npm-routing.sh — Apply versioned Nginx routing to NPM proxy
# =============================================================================
# Patches the NPM-generated proxy_host/10.conf (pnptv.app) so that:
#   - Default location / → pnptv-web:80  (React SPA)
#   - /api/, /pnp/, /auth/, etc. → 172.17.0.1:3001 (Node.js backend)
#
# Also deploys the shared server_proxy.conf (ATProto OAuth routes).
#
# Safe to re-run: backs up existing configs, validates before reloading.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NPM_DATA="${REPO_ROOT}/infrastructure/data/npm/data/nginx"
NPM_CONFIGS="${REPO_ROOT}/infrastructure/configs/npm"
PROXY_HOST_CONF="${NPM_DATA}/proxy_host/10.conf"
CUSTOM_CONF="${NPM_DATA}/custom/server_proxy.conf"
BACKEND_LOCATIONS="${NPM_CONFIGS}/pnptv-app-proxy.conf"
ATPROTO_CONF="${NPM_CONFIGS}/server_proxy.conf"
CONTAINER="npm-proxy"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Preflight checks ---

if [ ! -f "$PROXY_HOST_CONF" ]; then
    error "proxy_host/10.conf not found at $PROXY_HOST_CONF"
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

# --- Step 2: Patch proxy_host/10.conf ---

info "Checking proxy_host/10.conf ..."

# Check if backend locations are already injected
if grep -q "# Backend API routes" "$PROXY_HOST_CONF"; then
    info "Backend location blocks already present — checking upstream ..."

    # Ensure default upstream points to pnptv-web
    if grep -q 'set \$server.*"pnptv-web"' "$PROXY_HOST_CONF"; then
        info "Default upstream already set to pnptv-web:80"
    else
        warn "Default upstream is NOT pnptv-web — patching ..."
        sed -i 's/set \$server.*"[^"]*"/set $server         "pnptv-web"/' "$PROXY_HOST_CONF"
        sed -i 's/set \$port.*[0-9]*/set $port           80/' "$PROXY_HOST_CONF"
        info "Upstream patched to pnptv-web:80"
    fi
else
    info "Injecting backend location blocks ..."

    # Backup
    BACKUP="${PROXY_HOST_CONF}.bak.$(date +%s)"
    cp "$PROXY_HOST_CONF" "$BACKUP"
    info "Backup saved to $BACKUP"

    # Patch upstream to pnptv-web:80
    sed -i 's/set \$server.*"[^"]*"/set $server         "pnptv-web"/' "$PROXY_HOST_CONF"
    sed -i 's/set \$port.*[0-9]*/set $port           80/' "$PROXY_HOST_CONF"

    # Inject backend locations before the first "location / {"
    # We use awk to insert the content right before the catch-all location block
    INJECT_FILE="$BACKEND_LOCATIONS"
    awk -v inject="$INJECT_FILE" '
        /^  location \/ \{/ && !done {
            # Read and print the inject file
            while ((getline line < inject) > 0) print "  " line
            close(inject)
            print ""
            print "  # ============================================="
            print "  # Default: SPA frontend → pnptv-web container"
            print "  # ============================================="
            print ""
            done = 1
        }
        { print }
    ' "$PROXY_HOST_CONF" > "${PROXY_HOST_CONF}.tmp"
    mv "${PROXY_HOST_CONF}.tmp" "$PROXY_HOST_CONF"

    info "Backend location blocks injected"
fi

# --- Step 3: Validate and reload ---

info "Testing nginx configuration ..."
if docker exec "$CONTAINER" nginx -t 2>&1; then
    info "Config valid — reloading nginx ..."
    docker exec "$CONTAINER" nginx -s reload
    info "Nginx reloaded successfully"
else
    error "Nginx config test FAILED — rolling back"
    if [ -f "${PROXY_HOST_CONF}.bak."* ] 2>/dev/null; then
        LATEST_BACKUP=$(ls -t "${PROXY_HOST_CONF}".bak.* 2>/dev/null | head -1)
        if [ -n "$LATEST_BACKUP" ]; then
            cp "$LATEST_BACKUP" "$PROXY_HOST_CONF"
            docker exec "$CONTAINER" nginx -s reload 2>/dev/null || true
            info "Rolled back to $LATEST_BACKUP"
        fi
    fi
    exit 1
fi

# --- Step 4: Verify ---

info "Verifying routing ..."
FAILURES=0

# Check SPA serves HTML
SPA_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/subscribe" 2>/dev/null || echo "000")
if [ "$SPA_CODE" = "200" ]; then
    info "  /subscribe → $SPA_CODE (SPA)"
else
    error "  /subscribe → $SPA_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# Check API returns JSON
API_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/api/health" 2>/dev/null || echo "000")
if [ "$API_CODE" = "200" ]; then
    info "  /api/health → $API_CODE (backend)"
else
    error "  /api/health → $API_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

# Check health endpoint
HEALTH_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://pnptv.app/health" 2>/dev/null || echo "000")
if [ "$HEALTH_CODE" = "200" ]; then
    info "  /health → $HEALTH_CODE (backend)"
else
    error "  /health → $HEALTH_CODE (expected 200)"
    FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
    warn "$FAILURES verification(s) failed — check logs"
    exit 1
fi

echo ""
info "All routing applied and verified successfully"
