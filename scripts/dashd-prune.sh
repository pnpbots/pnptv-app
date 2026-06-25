#!/usr/bin/env bash
#
# dashd-prune.sh — one-shot pruning of the Dash blockchain node.
#
# Switches dashd from full-archive mode (~55 GB on disk) to pruned mode
# (prune=10000 → keeps ~10 GB of recent blocks, enough for BTCPay payment
# verification). The pruning happens in-place on container restart; dashd
# is unavailable for ~30–90 minutes while it walks the chain.
#
# Scheduled by systemd-run for 2026-06-26 08:00 UTC.
#
# Failure semantics: pre-flight failures exit immediately and leave dashd
# untouched. After `docker compose stop dashd`, the script logs every
# error and continues to a final status report rather than half-rolling-
# back — there's nothing safe to roll back to once we've appended the
# prune directive and restarted.

set -uo pipefail

LOG=/var/log/dashd-prune-20260626.log
DASH_DIR=/opt/pnptvapp/infrastructure/data/btcpay/dashd
DASH_CONF=$DASH_DIR/dash.conf
COMPOSE_DIR=/opt/pnptvapp
BACKUP_CONF=$DASH_DIR/dash.conf.pre-prune-20260626
POLL_INTERVAL=60         # seconds between dash-cli readiness checks
POLL_MAX_ITERATIONS=120  # 120 × 60s = 120 min ceiling

# ── Logging helper ────────────────────────────────────────────────────
exec > >(tee -a "$LOG") 2>&1
log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }
abort_preflight() { log "PRE-FLIGHT ABORT: $*"; log "dashd untouched. Re-run the script when the condition clears."; exit 2; }

log "============================================================"
log "dashd prune one-shot starting"
log "Host: $(hostname)  Script PID: $$"
log "============================================================"

# ── 1. Pre-flight checks ──────────────────────────────────────────────
log "[1/9] Pre-flight checks"

DASHD_STATUS=$(docker ps --filter name=^dashd$ --format '{{.Status}}' 2>/dev/null || true)
if [[ -z "$DASHD_STATUS" || "$DASHD_STATUS" != Up* ]]; then
  abort_preflight "dashd container status: '$DASHD_STATUS' (expected Up)"
fi
log "  ✓ dashd container: $DASHD_STATUS"

BTCPAY_STATUS=$(docker ps --filter name=^btcpay-server$ --format '{{.Status}}' 2>/dev/null || true)
if [[ -z "$BTCPAY_STATUS" || "$BTCPAY_STATUS" != Up* ]]; then
  abort_preflight "btcpay-server container status: '$BTCPAY_STATUS' (expected Up)"
fi
log "  ✓ btcpay-server container: $BTCPAY_STATUS"

FREE_GB=$(df --output=avail -BG / | tail -1 | tr -d ' G')
if [[ "$FREE_GB" -lt 5 ]]; then
  abort_preflight "only ${FREE_GB} GB free on / (need ≥5 GB)"
fi
log "  ✓ disk free: ${FREE_GB} GB"

PENDING_DASH=$(docker exec pg-pnptv psql -U pnptvbot -d pnptvbot -tAc \
  "SELECT COUNT(*) FROM payments WHERE provider='dash' AND status='pending' AND created_at > NOW() - INTERVAL '15 minutes'" 2>/dev/null || echo "ERR")
if [[ "$PENDING_DASH" == "ERR" ]]; then
  abort_preflight "could not query payments table (DB unreachable?)"
fi
if [[ "$PENDING_DASH" -gt 0 ]]; then
  abort_preflight "$PENDING_DASH Dash payment(s) pending in last 15 min — wait or push window"
fi
log "  ✓ no pending Dash payments in last 15 min"

if grep -qE '^[[:space:]]*prune=' "$DASH_CONF" 2>/dev/null; then
  abort_preflight "dash.conf already contains a prune= line — looks like a previous run; check ${BACKUP_CONF}"
fi
log "  ✓ no existing prune= line in dash.conf"

if [[ -f "$BACKUP_CONF" ]]; then
  abort_preflight "backup file ${BACKUP_CONF} already exists — won't overwrite"
fi
log "  ✓ no prior backup file present"

# ── 2. Baseline ───────────────────────────────────────────────────────
log "[2/9] Recording baseline disk size"
BASELINE_SIZE=$(du -sh "$DASH_DIR" 2>/dev/null | awk '{print $1}')
BASELINE_BYTES=$(du -sb "$DASH_DIR" 2>/dev/null | awk '{print $1}')
log "  baseline: $BASELINE_SIZE ($BASELINE_BYTES bytes)"
echo "$BASELINE_SIZE $BASELINE_BYTES" > /tmp/dashd_prune_baseline.txt

START_TS=$(date -u +%s)

# ── 3. Stop dashd gracefully ──────────────────────────────────────────
log "[3/9] Stopping dashd (graceful shutdown, up to 5 min)"
cd "$COMPOSE_DIR"
STOP_OK=0
if timeout 300 docker compose stop -t 300 dashd 2>&1; then
  STOP_OK=1
  log "  ✓ dashd stopped cleanly"
else
  log "  ✗ docker compose stop dashd failed or timed out"
  log "  Aborting — leaving dashd in whatever state it's in. Investigate manually."
  exit 3
fi

# ── 4. Backup + edit dash.conf ────────────────────────────────────────
log "[4/9] Backing up dash.conf and appending prune=10000"
if ! cp "$DASH_CONF" "$BACKUP_CONF"; then
  log "  ✗ could not write backup file ${BACKUP_CONF} — aborting before edit"
  log "  Restart dashd manually: cd $COMPOSE_DIR && docker compose up -d dashd"
  exit 4
fi
log "  ✓ backup saved: $BACKUP_CONF"

if ! printf '\n# Pruning enabled %s — keeps ~10 GB of recent blocks for BTCPay verification.\nprune=10000\n' "$(date -u +%Y-%m-%d)" >> "$DASH_CONF"; then
  log "  ✗ could not append prune= line to dash.conf"
  log "  Manual recovery: cp $BACKUP_CONF $DASH_CONF; cd $COMPOSE_DIR && docker compose up -d dashd"
  exit 5
fi
log "  ✓ prune=10000 appended"

# ── 5. Restart dashd ──────────────────────────────────────────────────
log "[5/9] Starting dashd (pruning begins on startup)"
if ! docker compose up -d dashd 2>&1; then
  log "  ✗ docker compose up -d dashd failed"
  log "  Manual recovery: cd $COMPOSE_DIR && docker compose up -d dashd"
  exit 6
fi
log "  ✓ dashd container started — pruning in progress"

# ── 6. Poll for RPC readiness ─────────────────────────────────────────
log "[6/9] Polling dash-cli getblockchaininfo every ${POLL_INTERVAL}s (max $((POLL_MAX_ITERATIONS * POLL_INTERVAL / 60)) min)"
RPC_READY=0
PRUNE_INFO=""
for ((i=1; i<=POLL_MAX_ITERATIONS; i++)); do
  ELAPSED_MIN=$(( (i * POLL_INTERVAL) / 60 ))
  if RAW=$(docker exec dashd dash-cli getblockchaininfo 2>/dev/null); then
    if echo "$RAW" | grep -q '"blocks"'; then
      RPC_READY=1
      PRUNE_INFO=$RAW
      log "  ✓ dash-cli responsive after ~${ELAPSED_MIN} min (poll #$i)"
      break
    fi
  fi
  if (( i % 5 == 0 )); then
    log "  … still pruning (~${ELAPSED_MIN} min elapsed, poll #$i)"
  fi
  sleep "$POLL_INTERVAL"
done

if [[ "$RPC_READY" -ne 1 ]]; then
  log "  ✗ dash-cli did not respond within ${POLL_MAX_ITERATIONS} polls"
  log "  dashd may still be pruning — check manually with: docker logs --tail 50 dashd"
  log "  Or: docker exec dashd dash-cli getblockchaininfo"
fi

# ── 7. Verify ─────────────────────────────────────────────────────────
log "[7/9] Verification"
PRUNED_FLAG="unknown"
BLOCKS="?"
if [[ -n "$PRUNE_INFO" ]]; then
  PRUNED_FLAG=$(echo "$PRUNE_INFO" | grep -oE '"pruned"[[:space:]]*:[[:space:]]*(true|false)' | head -1 | grep -oE '(true|false)' || echo "unknown")
  BLOCKS=$(echo "$PRUNE_INFO" | grep -oE '"blocks"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "?")
  log "  pruned: $PRUNED_FLAG"
  log "  blocks: $BLOCKS"
fi

BTCPAY_POST=$(docker ps --filter name=^btcpay-server$ --format '{{.Status}}' 2>/dev/null || echo "MISSING")
log "  btcpay-server post-prune: $BTCPAY_POST"

# Give the filesystem a few seconds to settle, then measure final size.
sleep 5
FINAL_SIZE=$(du -sh "$DASH_DIR" 2>/dev/null | awk '{print $1}')
FINAL_BYTES=$(du -sb "$DASH_DIR" 2>/dev/null | awk '{print $1}')
RECOVERED_BYTES=$(( BASELINE_BYTES - FINAL_BYTES ))
RECOVERED_GB=$(awk "BEGIN {printf \"%.1f\", $RECOVERED_BYTES / 1024 / 1024 / 1024}")
END_TS=$(date -u +%s)
DURATION_MIN=$(( (END_TS - START_TS) / 60 ))

# ── 8. Status summary ─────────────────────────────────────────────────
log "[8/9] Summary"
log "  baseline size:   $BASELINE_SIZE"
log "  final size:      $FINAL_SIZE"
log "  recovered:       ${RECOVERED_GB} GB"
log "  duration:        ${DURATION_MIN} min"
log "  dashd pruned:    $PRUNED_FLAG"
log "  btcpay status:   $BTCPAY_POST"
log "  backup config:   $BACKUP_CONF"

# ── 9. Outcome ────────────────────────────────────────────────────────
log "[9/9] Outcome"
OUTCOME="UNKNOWN"
EXIT_CODE=1
if [[ "$RPC_READY" -eq 1 && "$PRUNED_FLAG" == "true" && "$BTCPAY_POST" == Up* ]]; then
  OUTCOME="SUCCESS"
  EXIT_CODE=0
elif [[ "$RPC_READY" -eq 1 && "$PRUNED_FLAG" == "true" ]]; then
  OUTCOME="DASHD_OK_BTCPAY_DEGRADED"
  EXIT_CODE=10
elif [[ "$RPC_READY" -eq 1 ]]; then
  OUTCOME="DASHD_UP_BUT_NOT_PRUNED"
  EXIT_CODE=11
else
  OUTCOME="DASHD_NOT_RESPONSIVE"
  EXIT_CODE=12
fi
log "  $OUTCOME (exit $EXIT_CODE)"
log "============================================================"
log "done. Full log: $LOG"

exit "$EXIT_CODE"
