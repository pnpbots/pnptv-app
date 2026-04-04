#!/bin/bash
# PNP Live Smoke Test — runs HTTP checks and reports to QA Touch
# Usage: bash pnp-live-test.sh
# Tests: 27 PNP Live endpoint tests (functional + security/auth guards)

QA_DOMAIN="easybots"
QA_TOKEN="8645eb8b8e532f65025806f315ba604e244d9397e5d27280b94d6a6cc9b9772f"
PROJECT="Gl5X"
TEST_RUN="XGw2M"
BASE="https://app.pnptv.app"

PASS=0
FAIL=0
TOTAL=0
RESULTS="["

add_result() {
  local case_key="$1"
  local status="$2"  # 1=Passed 5=Failed 3=Blocked
  if [ "$TOTAL" -gt 0 ]; then
    RESULTS="${RESULTS},"
  fi
  RESULTS="${RESULTS}{\"case\":\"${case_key}\",\"status\":${status}}"
  TOTAL=$((TOTAL+1))
}

check_http() {
  local url="$1"
  local expected_code="$2"
  local case_key="$3"
  local test_name="$4"
  local check_body="$5"

  local resp body
  resp=$(curl -sL -o /tmp/pnp_live_body.txt -w "%{http_code}" --max-time 15 "$url" 2>/dev/null)

  if [ "$resp" = "$expected_code" ]; then
    if [ -n "$check_body" ]; then
      if grep -q "$check_body" /tmp/pnp_live_body.txt 2>/dev/null; then
        echo "  PASS [$resp] $test_name (body contains '$check_body')"
        add_result "$case_key" 1
        PASS=$((PASS+1))
        return 0
      else
        echo "  FAIL [$resp] $test_name (body missing '$check_body')"
        add_result "$case_key" 5
        FAIL=$((FAIL+1))
        return 1
      fi
    fi
    echo "  PASS [$resp] $test_name"
    add_result "$case_key" 1
    PASS=$((PASS+1))
    return 0
  else
    echo "  FAIL [$resp] $test_name (expected $expected_code)"
    add_result "$case_key" 5
    FAIL=$((FAIL+1))
    return 1
  fi
}

check_json_field() {
  local url="$1"
  local case_key="$2"
  local test_name="$3"
  local field="$4"

  local body
  body=$(curl -sL --max-time 15 "$url" 2>/dev/null)
  local valid
  valid=$(echo "$body" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if '$field' in d:
        print('ok')
    else:
        print('missing')
except:
    print('bad')
" 2>/dev/null)

  if [ "$valid" = "ok" ]; then
    echo "  PASS [200] $test_name (has '$field' field)"
    add_result "$case_key" 1
    PASS=$((PASS+1))
    return 0
  elif [ "$valid" = "missing" ]; then
    echo "  FAIL [200] $test_name (missing '$field' field)"
    add_result "$case_key" 5
    FAIL=$((FAIL+1))
    return 1
  else
    echo "  FAIL [bad-json] $test_name"
    add_result "$case_key" 5
    FAIL=$((FAIL+1))
    return 1
  fi
}

check_auth_guard() {
  local method="$1"
  local url="$2"
  local case_key="$3"
  local test_name="$4"
  local post_data="$5"

  local resp
  if [ "$method" = "GET" ]; then
    resp=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null)
  else
    resp=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 -X POST \
      -H "Content-Type: application/json" -d "${post_data:-{}}" "$url" 2>/dev/null)
  fi

  if [ "$resp" = "401" ] || [ "$resp" = "403" ]; then
    echo "  PASS [$resp] $test_name (correctly blocked)"
    add_result "$case_key" 1
    PASS=$((PASS+1))
    return 0
  else
    echo "  FAIL [$resp] $test_name (expected 401/403, got $resp)"
    add_result "$case_key" 5
    FAIL=$((FAIL+1))
    return 1
  fi
}

echo "========================================"
echo "PNP Live Smoke Test — $(date +%Y-%m-%d\ %H:%M)"
echo "========================================"
echo ""

# ──────────────────────────────────────────
# SECTION 1: Public / Functional Endpoints
# ──────────────────────────────────────────
echo "[Public / Functional Endpoints]"
check_http "$BASE/health" "200" "dyk0N0" "Health endpoint returns 200" "ok"
check_http "$BASE/api/livestream/active" "200" "xmVeEZ" "Active livestream returns 200"
check_http "$BASE/live" "200" "VKLmBQ" "Live SPA page loads" "script"
check_http "$BASE/api/proxy/live/overlay/test-channel" "200" "J8wx3z" "Public overlay endpoint returns 200"
check_json_field "$BASE/api/livestream/active" "PgXm4r" "Active stream has 'success' field" "success"
check_json_field "$BASE/api/proxy/live/overlay/test-channel" "68gLn0" "Overlay has 'success' field" "success"
check_http "$BASE/api/webapp/radio/status" "404" "7EL3Gq" "Radio status returns 404 (deprecated)"

echo ""

# ──────────────────────────────────────────
# SECTION 2: Auth Guards — GET Endpoints
# ──────────────────────────────────────────
echo "[Auth Guards — GET Endpoints]"
check_auth_guard "GET" "$BASE/api/webapp/live/streams" "9eJLNy" "/streams requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/rtmp-key" "qz6xV7" "/rtmp-key requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/schedule" "XGkjez" "/schedule requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/settings" "3gm79X" "/settings requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/stream-history" "zvLbKe" "/stream-history requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/rules-status" "mBzbD7" "/rules-status requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/webrtc/streams" "n80ZvG" "/webrtc/streams requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/webrtc/config" "gQ3BwM" "/webrtc/config requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/my-channel" "Gd5ZP4" "/my-channel requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/stream-profile" "Eemvdb" "/stream-profile requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/webrtc/viewer-token/test" "LDVJgv" "/webrtc/viewer-token requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/webrtc/status/test" "wmLDgp" "/webrtc/status requires auth"
check_auth_guard "GET" "$BASE/api/webapp/live/schedule/notify/999" "yanvrb" "/schedule/notify requires auth"

echo ""

# ──────────────────────────────────────────
# SECTION 3: Auth Guards — POST Endpoints
# ──────────────────────────────────────────
echo "[Auth Guards — POST Endpoints]"
check_auth_guard "POST" "$BASE/api/webapp/live/raid" "lR5v8V" "POST /raid requires auth"
check_auth_guard "POST" "$BASE/api/webapp/live/host" "rG6VPk" "POST /host requires auth"
check_auth_guard "POST" "$BASE/api/webapp/live/webrtc/end" "Njlmrn" "POST /webrtc/end requires auth"
check_auth_guard "POST" "$BASE/api/webapp/live/webrtc/heartbeat" "K4xVmD" "POST /webrtc/heartbeat requires auth"
check_auth_guard "POST" "$BASE/api/webapp/live/acknowledge-rules" "jPlD2V" "POST /acknowledge-rules requires auth"

echo ""

# ──────────────────────────────────────────
# SECTION 4: Admin Auth Guards
# ──────────────────────────────────────────
echo "[Admin Auth Guards]"
check_auth_guard "GET" "$BASE/api/webapp/admin/live/channels" "419jXq" "Admin /live/channels requires admin auth"
check_auth_guard "GET" "$BASE/api/webapp/admin/stream-overlays" "pDKWdw" "Admin /stream-overlays requires admin auth"

# ──────────────────────────────────────────
# PUSH RESULTS TO QA TOUCH
# ──────────────────────────────────────────
RESULTS="${RESULTS}]"

echo ""
echo "========================================"
echo "RESULTS"
echo "========================================"
echo "  PASSED:  $PASS"
echo "  FAILED:  $FAIL"
echo "  TOTAL:   $TOTAL / 27"
echo "========================================"
echo ""

echo "Pushing results to QA Touch..."
ENCODED_RESULTS=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$RESULTS'))")
ENCODED_COMMENT=$(python3 -c "import urllib.parse; print(urllib.parse.quote('PNP Live automated smoke test $(date +%Y-%m-%d\ %H:%M) — $PASS passed, $FAIL failed out of $TOTAL'))")

response=$(curl -sL -X PATCH \
  -H "domain: $QA_DOMAIN" \
  -H "api-token: $QA_TOKEN" \
  "https://api.qatouch.com/api/v1/testRunResults/status/multiple?project=${PROJECT}&test_run=${TEST_RUN}&comments=${ENCODED_COMMENT}&result=${ENCODED_RESULTS}" 2>/dev/null)

success=$(echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('success','false'))" 2>/dev/null)

if [ "$success" = "True" ]; then
  echo "  QA Touch updated successfully!"
else
  echo "  QA Touch update response: $response"
fi

echo ""
echo "Done."
