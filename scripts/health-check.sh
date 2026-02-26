#!/bin/bash
# PNPTV Health Check - monitors all services
ERRORS=0

check_url() {
    local name=$1
    local url=$2
    local expected=${3:-200}
    CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)
    if [ "$CODE" = "$expected" ]; then
        echo "  OK: $name ($url) -> $CODE"
    else
        echo "  FAIL: $name ($url) -> $CODE (expected $expected)"
        ERRORS=$((ERRORS + 1))
    fi
}

check_container() {
    local name=$1
    STATUS=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null)
    if [ "$STATUS" = "running" ]; then
        echo "  OK: $name -> running"
    else
        echo "  FAIL: $name -> $STATUS"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "[$(date)] PNPTV Health Check"
echo "================================"

echo ""
echo "--- Docker Containers ---"
for c in npm-proxy authentik-server authentik-worker pg-authentik redis-authentik \
         directus pg-directus ampache mariadb-ampache calcom pg-calcom redis-calcom \
         bluesky-pds synapse pg-synapse element-web restreamer pnptv-web; do
    check_container $c
done

echo ""
echo "--- HTTP Endpoints ---"
check_url "Frontend" "https://app.pnptv.app/"
check_url "Auth SSO" "https://auth.pnptv.app/" 302 302
check_url "Directus" "https://cms.pnptv.app/items/performers" 
check_url "Ampache" "https://media.pnptv.app/" 302 302
check_url "Cal.com" "https://booking.pnptv.app/" 307 307
check_url "Bluesky" "https://social.pnptv.app/xrpc/_health"
check_url "Element" "https://chat.pnptv.app/"
check_url "Matrix" "https://matrix.pnptv.app/_matrix/client/versions"
check_url "Restreamer" "https://live.pnptv.app/api"

echo ""
echo "--- API Proxies ---"
check_url "Media API" "https://app.pnptv.app/api/proxy/media/tracks"
check_url "Live API" "https://app.pnptv.app/api/proxy/live/streams"
check_url "Social API" "https://app.pnptv.app/api/proxy/social/feed"

echo ""
echo "--- PM2 Process ---"
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import json,sys; procs=json.load(sys.stdin); print(procs[0]['pm2_env']['status'] if procs else 'unknown')" 2>/dev/null)
if [ "$PM2_STATUS" = "online" ]; then
    echo "  OK: pnptv-bot -> online"
else
    echo "  FAIL: pnptv-bot -> $PM2_STATUS"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "--- Disk Usage ---"
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
echo "  Root: ${DISK_USAGE}% used"
if [ "$DISK_USAGE" -gt 85 ]; then
    echo "  WARNING: Disk usage above 85%!"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "--- Memory ---"
MEM_INFO=$(free -m | awk 'NR==2 {printf "Used: %sMB / %sMB (%.0f%%)\n", $3, $2, $3/$2*100}')
echo "  $MEM_INFO"

echo ""
echo "================================"
if [ $ERRORS -eq 0 ]; then
    echo "ALL CHECKS PASSED"
else
    echo "WARNING: $ERRORS check(s) failed!"
fi
echo "================================"
