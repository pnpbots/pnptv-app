#!/bin/bash
# Migration 220 — Account dedup phase 2 cleanup
# Scheduled: 2026-05-22. Self-removes from crontab after running.
set -euo pipefail

LOGFILE="/opt/pnptvapp/logs/migration220_$(date +%Y%m%d_%H%M%S).log"
exec >> "$LOGFILE" 2>&1

echo "=== Migration 220 started at $(date -u) ==="

# Backup
BACKUP="/opt/pnptv_backups/pre_220_$(date +%Y%m%d_%H%M%S).sql"
echo "Taking backup → $BACKUP"
docker exec pg-pnptv pg_dump -U pnptvbot -d pnptvbot \
  -t users -t user_entitlements -t payments -t user_merge_log \
  > "$BACKUP"
echo "Backup done: $(du -sh "$BACKUP" | cut -f1)"

# Run migration
echo "Running migration 220..."
docker exec -i pg-pnptv psql -U pnptvbot -d pnptvbot \
  < /opt/pnptvapp/apps/backend/migrations/220_account_dedup_phase2_cleanup.sql

echo "=== Migration 220 finished at $(date -u) ==="

# Self-remove from crontab
crontab -l | grep -v "run_migration_220" | crontab -
echo "Removed self from crontab."
