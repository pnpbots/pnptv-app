#!/bin/bash
# PNPTV Database Backup Script
# Runs daily via cron, keeps 7 days of backups

BACKUP_DIR="/opt/pnptvapp/backups"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

echo "[$(date)] Starting database backups..."

# PostgreSQL backups — use each container's own POSTGRES_USER/POSTGRES_DB env vars
for CONTAINER in pg-authentik pg-directus pg-calcom pg-synapse pg-pnptv pg-btcpay; do

    # Read credentials from the running container's environment
    DB_USER=$(docker exec "$CONTAINER" printenv POSTGRES_USER 2>/dev/null)
    DB_NAME=$(docker exec "$CONTAINER" printenv POSTGRES_DB 2>/dev/null)

    if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
        echo "  SKIPPED: $CONTAINER (container not running or missing env vars)"
        continue
    fi

    OUTFILE="${BACKUP_DIR}/postgres/${CONTAINER}_${DB_NAME}_${DATE}.sql.gz"

    echo "  Backing up $DB_NAME from $CONTAINER (user: $DB_USER)..."
    docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" 2>"${BACKUP_DIR}/postgres/${CONTAINER}_${DATE}.err" | gzip > "$OUTFILE"

    if [ $? -eq 0 ] && [ -s "$OUTFILE" ]; then
        SIZE=$(du -h "$OUTFILE" | cut -f1)
        echo "    OK: $OUTFILE ($SIZE)"
        rm -f "${BACKUP_DIR}/postgres/${CONTAINER}_${DATE}.err"
    else
        echo "    FAILED: $DB_NAME backup — see ${BACKUP_DIR}/postgres/${CONTAINER}_${DATE}.err"
        rm -f "$OUTFILE"
    fi
done
# NOTE: Backups are stored locally at ${BACKUP_DIR}. Configure offsite replication (S3, rsync, etc.) separately.

# MariaDB backup (Ampache)
echo "  Backing up ampache_db from mariadb-ampache..."
OUTFILE="${BACKUP_DIR}/mariadb/ampache_db_${DATE}.sql.gz"
docker exec mariadb-ampache sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" ampache_db' 2>/dev/null | gzip > "$OUTFILE"
if [ $? -eq 0 ] && [ -s "$OUTFILE" ]; then
    SIZE=$(du -h "$OUTFILE" | cut -f1)
    echo "    OK: $OUTFILE ($SIZE)"
else
    echo "    FAILED: ampache_db backup"
    rm -f "$OUTFILE"
fi

# Cleanup old backups
echo "  Cleaning up backups older than ${KEEP_DAYS} days..."
find ${BACKUP_DIR} -name "*.sql.gz" -mtime +${KEEP_DAYS} -delete 2>/dev/null
DELETED=$?
echo "    Cleanup done"

echo "[$(date)] Backup complete."
