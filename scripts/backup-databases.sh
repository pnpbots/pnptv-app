#!/bin/bash
# PNPTV Database Backup Script
# Runs daily via cron, keeps 7 days of backups

BACKUP_DIR="/opt/pnptvapp/backups"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

echo "[$(date)] Starting database backups..."

# PostgreSQL backups (4 databases)
for DB_INFO in \
    "pg-authentik:authentik_user:authentik_db" \
    "pg-directus:directus_user:directus_db" \
    "pg-calcom:calcom_user:calcom_db" \
    "pg-synapse:synapse_user:synapse_db"; do

    CONTAINER=$(echo $DB_INFO | cut -d: -f1)
    USER=$(echo $DB_INFO | cut -d: -f2)
    DB=$(echo $DB_INFO | cut -d: -f3)
    OUTFILE="${BACKUP_DIR}/postgres/${DB}_${DATE}.sql.gz"

    echo "  Backing up $DB from $CONTAINER..."
    docker exec $CONTAINER pg_dump -U $USER $DB 2>/dev/null | gzip > "$OUTFILE"

    if [ $? -eq 0 ] && [ -s "$OUTFILE" ]; then
        SIZE=$(du -h "$OUTFILE" | cut -f1)
        echo "    OK: $OUTFILE ($SIZE)"
    else
        echo "    FAILED: $DB backup"
        rm -f "$OUTFILE"
    fi
done

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
