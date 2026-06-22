#!/usr/bin/env bash
# Daily pg_dump backup for pg-pnptv → stored in Databasus backup volume
# Keeps 7 days of backups. Run via cron: 0 3 * * * /opt/pnptvapp/infrastructure/scripts/backup-pg-pnptv.sh

set -euo pipefail

BACKUP_DIR="/opt/pnptvapp/infrastructure/data/databasus"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/pnptvbot_${TIMESTAMP}.dump"
KEEP_DAYS=7

# Load DB credentials from .env (actual var names used by the app)
PG_PNPTV_USER=$(grep "^POSTGRES_USER=" /opt/pnptvapp/.env | cut -d= -f2)
PG_PNPTV_DB=$(grep "^POSTGRES_DATABASE=" /opt/pnptvapp/.env | cut -d= -f2)
PG_PNPTV_PASS=$(grep "^POSTGRES_PASSWORD=" /opt/pnptvapp/.env | cut -d= -f2)

if [[ -z "${PG_PNPTV_USER}" || -z "${PG_PNPTV_DB}" ]]; then
  echo "[$(date -Iseconds)] ERROR: POSTGRES_USER or POSTGRES_DATABASE not found in .env — aborting"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] Starting backup → ${BACKUP_FILE}"

docker exec -e PGPASSWORD="${PG_PNPTV_PASS}" pg-pnptv pg_dump \
  -U "${PG_PNPTV_USER}" \
  -d "${PG_PNPTV_DB}" \
  --format=custom \
  > "${BACKUP_FILE}"

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${SIZE})"

# Rotate: delete backups older than KEEP_DAYS
find "${BACKUP_DIR}" -name "pnptvbot_*.dump" -mtime "+${KEEP_DAYS}" -delete
echo "[$(date -Iseconds)] Old backups pruned (>${KEEP_DAYS} days)"
