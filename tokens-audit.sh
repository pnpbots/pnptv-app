#!/bin/bash
# PNPtv Tokens System Audit — HTTP checks + fichas→tokens rename validation
# Reports to QA Touch project Gl5X / test run xmN1m
# Usage: bash tokens-audit.sh

QA_DOMAIN="easybots"
QA_TOKEN="8645eb8b8e532f65025806f315ba604e244d9397e5d27280b94d6a6cc9b9772f"
PROJECT="Gl5X"
TEST_RUN="xmN1m"
BASE="https://pnptv.app"
SRC="/opt/pnptvapp/apps"

PASS=0
FAIL=0
TOTAL=0

# run_key map: case_id → run_key (from GET /api/v1/testRunResults/Gl5X/xmN1m)
declare -A RUN_KEY_MAP
RUN_KEY_MAP["n8Z3nV"]="j1dx4a"
RUN_KEY_MAP["41jZN3"]="5L50E7"
RUN_KEY_MAP["jPDMX9"]="1m50p0"
RUN_KEY_MAP["K4Vq3g"]="kaxV69"
RUN_KEY_MAP["Njmwna"]="0950El"
RUN_KEY_MAP["rGV5l0"]="y5GgKx"
RUN_KEY_MAP["lRvezJ"]="w5n3db"
RUN_KEY_MAP["Eev0P3"]="L4dl0J"
RUN_KEY_MAP["GdZ17z"]="pa79M3"
RUN_KEY_MAP["gQB17X"]="4l50ww"
RUN_KEY_MAP["J8xWXn"]="z5E3Ww"
RUN_KEY_MAP["mBbvmb"]="KPR5WB"
RUN_KEY_MAP["zvbBMp"]="NEV0PE"
RUN_KEY_MAP["3g7arE"]="raqwe6"
RUN_KEY_MAP["XGjaB7"]="laVJGe"
RUN_KEY_MAP["qzxgEP"]="ELMl76"
RUN_KEY_MAP["9eLm8r"]="Gjelmr"
RUN_KEY_MAP["7E3l4L"]="gKbZ6z"
RUN_KEY_MAP["68Lwjw"]="naP6B8"
RUN_KEY_MAP["PgmBGw"]="maJP19"

push_result() {
  local case_key="$1"
  local status="$2"  # 1=Passed 5=Failed 3=Blocked 6=N/A
  local comment="$3"
  local run_key="${RUN_KEY_MAP[$case_key]}"
  local encoded_comment
  encoded_comment=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$comment")
  curl -s -o /dev/null -X PATCH \
    -H "domain: $QA_DOMAIN" \
    -H "api-token: $QA_TOKEN" \
    "https://api.qatouch.com/api/v1/testRunResults/status?status=${status}&project=${PROJECT}&test_run=${TEST_RUN}&run_result=${run_key}&comments=${encoded_comment}"
  TOTAL=$((TOTAL+1))
}

check_auth_guard() {
  local method="$1"
  local url="$2"
  local case_key="$3"
  local name="$4"
  local resp
  if [ "$method" = "GET" ]; then
    resp=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 "$BASE$url" 2>/dev/null)
  else
    resp=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 -X POST \
      -H "Content-Type: application/json" -d '{}' "$BASE$url" 2>/dev/null)
  fi
  if [ "$resp" = "401" ] || [ "$resp" = "403" ]; then
    echo "  PASS [$resp] $name"
    push_result "$case_key" 1 "HTTP $resp — correctly blocked"; PASS=$((PASS+1))
  else
    echo "  FAIL [$resp] $name (expected 401/403)"
    push_result "$case_key" 5 "HTTP $resp — expected 401/403"; FAIL=$((FAIL+1))
  fi
}

check_http() {
  local url="$1"
  local expected="$2"
  local case_key="$3"
  local name="$4"
  local body_check="$5"
  local resp
  resp=$(curl -sL -o /tmp/tokens_audit_body.txt -w "%{http_code}" --max-time 15 "$BASE$url" 2>/dev/null)
  if [ "$resp" = "$expected" ]; then
    if [ -n "$body_check" ] && ! grep -q "$body_check" /tmp/tokens_audit_body.txt 2>/dev/null; then
      echo "  FAIL [$resp] $name (body missing '$body_check')"
      push_result "$case_key" 5 "HTTP $resp but body missing '$body_check'"; FAIL=$((FAIL+1)); return 1
    fi
    echo "  PASS [$resp] $name"
    push_result "$case_key" 1 "HTTP $resp OK"; PASS=$((PASS+1))
  else
    echo "  FAIL [$resp] $name (expected $expected)"
    push_result "$case_key" 5 "HTTP $resp — expected $expected"; FAIL=$((FAIL+1))
  fi
}

check_no_fichas_in_response() {
  local url="$1"
  local case_key="$2"
  local name="$3"
  local body
  body=$(curl -sL --max-time 15 "$BASE$url" 2>/dev/null)
  if echo "$body" | grep -qi "fichas"; then
    local hits
    hits=$(echo "$body" | grep -oi "fichas" | wc -l | tr -d ' ')
    echo "  FAIL $name (response contains 'fichas' $hits times)"
    push_result "$case_key" 5 "Response contains fichas $hits times"; FAIL=$((FAIL+1))
  else
    echo "  PASS $name (no 'fichas' in response)"
    push_result "$case_key" 1 "No fichas in API response"; PASS=$((PASS+1))
  fi
}

check_no_fichas_in_source() {
  local file="$1"
  local case_key="$2"
  local name="$3"
  local count
  count=$(grep -c "fichas" "$file" 2>/dev/null || echo "0")
  if [ "$count" -gt 0 ]; then
    echo "  FAIL $name ($count fichas reference(s) in $file)"
    grep -n "fichas" "$file" | head -5 | sed 's/^/       /'
    push_result "$case_key" 5 "$count fichas references remain in source"; FAIL=$((FAIL+1))
  else
    echo "  PASS $name (no fichas in source)"
    push_result "$case_key" 1 "No fichas references in source"; PASS=$((PASS+1))
  fi
}

check_no_fichas_in_error_code() {
  local file="$1"
  local case_key="$2"
  local name="$3"
  local count
  count=$(grep -c "INSUFFICIENT_FICHAS" "$file" 2>/dev/null || echo "0")
  if [ "$count" -gt 0 ]; then
    echo "  FAIL $name ($count INSUFFICIENT_FICHAS reference(s))"
    push_result "$case_key" 5 "$count INSUFFICIENT_FICHAS error codes remain"; FAIL=$((FAIL+1))
  else
    echo "  PASS $name (INSUFFICIENT_FICHAS removed)"
    push_result "$case_key" 1 "No INSUFFICIENT_FICHAS error codes found"; PASS=$((PASS+1))
  fi
}

echo "============================================================"
echo "PNPtv Tokens System Audit — $(date +%Y-%m-%d\ %H:%M)"
echo "Test Run: $TEST_RUN | Project: $PROJECT"
echo "============================================================"
echo ""

# ── SECTION 1: Wallet Auth Guards ──────────────────────────────
echo "[Wallet Endpoints — Auth Guards]"
check_auth_guard "GET"  "/api/wallet/balance"            "J8xWXn" "GET /wallet/balance requires auth"
check_auth_guard "GET"  "/api/wallet/packages"           "PgmBGw" "GET /wallet/packages requires auth"
check_auth_guard "GET"  "/api/wallet/history"            "68Lwjw" "GET /wallet/history requires auth"
check_auth_guard "POST" "/api/wallet/buy"                "7E3l4L" "POST /wallet/buy requires auth"
check_auth_guard "POST" "/api/wallet/buy-nowpayments"    "qzxgEP" "POST /wallet/buy-nowpayments requires auth"
check_auth_guard "GET"  "/api/token-checkout/test123"    "XGjaB7" "GET /token-checkout/:id requires auth"
check_auth_guard "POST" "/api/wallet/pay-subscription"   "3g7arE" "POST /wallet/pay-subscription requires auth"
check_auth_guard "POST" "/api/wallet/pay-creator-sub"    "zvbBMp" "POST /wallet/pay-creator-sub requires auth"
check_auth_guard "POST" "/api/wallet/pay-call"           "mBbvmb" "POST /wallet/pay-call requires auth"
check_auth_guard "POST" "/api/wallet/buy-btc"            "n8Z3nV" "POST /wallet/buy-btc requires auth"
check_auth_guard "POST" "/api/wallet/link-dpns"          "gQB17X" "POST /wallet/link-dpns requires auth"
check_auth_guard "GET"  "/api/webapp/users/me/tokens"    "GdZ17z" "GET /users/me/tokens requires auth"
echo ""

# ── SECTION 2: Public Endpoints ────────────────────────────────
echo "[Public Endpoints]"
check_http "/api/wallet/presale-status" "200" "9eLm8r" "GET /wallet/presale-status is public"

echo ""

# ── SECTION 3: Payment Endpoints Exist ─────────────────────────
echo "[Payment Endpoints Exist]"
NP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 -X POST \
  -H "Content-Type: application/json" -d '{}' "$BASE/api/wallet/buy-nowpayments" 2>/dev/null)
if [ "$NP_CODE" != "404" ]; then
  echo "  PASS [$NP_CODE] NowPayments buy endpoint exists"
  push_result "jPDMX9" 1 "HTTP $NP_CODE — endpoint exists"; PASS=$((PASS+1))
else
  echo "  FAIL [404] NowPayments buy endpoint missing"
  push_result "jPDMX9" 5 "HTTP 404 — endpoint missing"; FAIL=$((FAIL+1))
fi

BTC_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 -X POST \
  -H "Content-Type: application/json" -d '{}' "$BASE/api/wallet/buy-btc" 2>/dev/null)
if [ "$BTC_CODE" != "404" ]; then
  echo "  PASS [$BTC_CODE] BTCPay buy endpoint exists"
  push_result "41jZN3" 1 "HTTP $BTC_CODE — endpoint exists"; PASS=$((PASS+1))
else
  echo "  FAIL [404] BTCPay buy endpoint missing"
  push_result "41jZN3" 5 "HTTP 404 — endpoint missing"; FAIL=$((FAIL+1))
fi

echo ""

# ── SECTION 4: fichas → tokens Rename Validation ───────────────
echo "[fichas→tokens Rename Validation — Source Code]"
check_no_fichas_in_response \
  "/api/wallet/presale-status" "Eev0P3" "Presale-status API response contains no fichas"

check_no_fichas_in_error_code \
  "$SRC/backend/bot/api/routes.js" "lRvezJ" "INSUFFICIENT_FICHAS removed from routes.js"

check_no_fichas_in_source \
  "$SRC/web/src/components/BuyTokensModal.tsx" "rGV5l0" "BuyTokensModal has no fichas labels"

check_no_fichas_in_source \
  "$SRC/web/src/lib/i18n/live.ts" "Njmwna" "i18n/live.ts has no fichas strings"

check_no_fichas_in_source \
  "$SRC/web/src/lib/i18n/subscribe.ts" "K4Vq3g" "i18n/subscribe.ts has no fichas strings"

echo ""

echo "============================================================"
echo "RESULTS"
echo "============================================================"
echo "  PASSED:  $PASS"
echo "  FAILED:  $FAIL"
echo "  TOTAL:   $TOTAL / 20"
echo "============================================================"
echo ""
echo "Results pushed to QA Touch per-case (run $TEST_RUN)."
echo "View: https://app.qatouch.com"
if [ "$FAIL" = "0" ]; then
  echo "  ALL TESTS PASSED"
fi
echo ""
echo "Done."
