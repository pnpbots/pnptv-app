#!/bin/bash
# PNPTV Database Backup Script
# Runs daily via cron, keeps 7 days of backups
#
# ─── OFFSITE REPLICATION ENV VARS ────────────────────────────────────────────
# BACKUP_OFFSITE_ENABLED   Set to "true" to enable offsite sync (default: false)
# BACKUP_OFFSITE_METHOD    Replication method: "rsync" or "s3" (default: rsync)
#
# rsync mode (BACKUP_OFFSITE_METHOD=rsync):
#   BACKUP_OFFSITE_HOST      Remote hostname or IP (e.g. backup.example.com)
#   BACKUP_OFFSITE_USER      SSH user on remote host (e.g. backupuser)
#   BACKUP_OFFSITE_PATH      Absolute path on remote host (e.g. /mnt/backups/pnptv)
#   BACKUP_OFFSITE_SSH_KEY   Path to SSH private key (e.g. /root/.ssh/backup_ed25519)
#
# s3 mode (BACKUP_OFFSITE_METHOD=s3):
#   BACKUP_S3_BUCKET         S3 bucket name (e.g. my-pnptv-backups)
#   BACKUP_S3_ENDPOINT       S3-compatible endpoint URL; omit for native AWS S3
#                            (e.g. https://s3.us-east-1.amazonaws.com for AWS,
#                             or https://s3.nl-ams.scw.cloud for Scaleway, etc.)
#   AWS_ACCESS_KEY_ID        S3 access key ID
#   AWS_SECRET_ACCESS_KEY    S3 secret access key
# ─────────────────────────────────────────────────────────────────────────────

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

# ─── OFFSITE REPLICATION ──────────────────────────────────────────────────────
# Controlled entirely by env vars. No-op when BACKUP_OFFSITE_ENABLED != "true".
OFFSITE_ENABLED="${BACKUP_OFFSITE_ENABLED:-false}"
OFFSITE_METHOD="${BACKUP_OFFSITE_METHOD:-rsync}"

if [ "$OFFSITE_ENABLED" = "true" ]; then
    echo "[$(date)] Starting offsite replication (method: ${OFFSITE_METHOD})..."

    OFFSITE_OK=false

    if [ "$OFFSITE_METHOD" = "rsync" ]; then
        # ── rsync over SSH ────────────────────────────────────────────────────
        OFFSITE_HOST="${BACKUP_OFFSITE_HOST:-}"
        OFFSITE_USER="${BACKUP_OFFSITE_USER:-}"
        OFFSITE_PATH="${BACKUP_OFFSITE_PATH:-}"
        OFFSITE_SSH_KEY="${BACKUP_OFFSITE_SSH_KEY:-}"

        # Validate required rsync vars
        RSYNC_MISSING=""
        [ -z "$OFFSITE_HOST" ]    && RSYNC_MISSING="${RSYNC_MISSING} BACKUP_OFFSITE_HOST"
        [ -z "$OFFSITE_USER" ]    && RSYNC_MISSING="${RSYNC_MISSING} BACKUP_OFFSITE_USER"
        [ -z "$OFFSITE_PATH" ]    && RSYNC_MISSING="${RSYNC_MISSING} BACKUP_OFFSITE_PATH"
        [ -z "$OFFSITE_SSH_KEY" ] && RSYNC_MISSING="${RSYNC_MISSING} BACKUP_OFFSITE_SSH_KEY"

        if [ -n "$RSYNC_MISSING" ]; then
            echo "  OFFSITE FAILED: rsync mode requires missing env vars:${RSYNC_MISSING}"
        elif [ ! -f "$OFFSITE_SSH_KEY" ]; then
            echo "  OFFSITE FAILED: SSH key not found at ${OFFSITE_SSH_KEY}"
        else
            echo "  rsync → ${OFFSITE_USER}@${OFFSITE_HOST}:${OFFSITE_PATH}"
            rsync \
                --archive \
                --compress \
                --delete \
                --quiet \
                --timeout=120 \
                -e "ssh -i ${OFFSITE_SSH_KEY} -o StrictHostKeyChecking=no -o BatchMode=yes" \
                "${BACKUP_DIR}/" \
                "${OFFSITE_USER}@${OFFSITE_HOST}:${OFFSITE_PATH}/"

            RSYNC_EXIT=$?
            if [ $RSYNC_EXIT -eq 0 ]; then
                echo "  OFFSITE OK: rsync to ${OFFSITE_HOST} completed successfully"
                OFFSITE_OK=true
            else
                echo "  OFFSITE FAILED: rsync exited with code ${RSYNC_EXIT}"
            fi
        fi

    elif [ "$OFFSITE_METHOD" = "s3" ]; then
        # ── aws s3 sync (S3-compatible) ───────────────────────────────────────
        S3_BUCKET="${BACKUP_S3_BUCKET:-}"
        S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"

        # Validate required S3 vars
        S3_MISSING=""
        [ -z "$S3_BUCKET" ]              && S3_MISSING="${S3_MISSING} BACKUP_S3_BUCKET"
        [ -z "$AWS_ACCESS_KEY_ID" ]      && S3_MISSING="${S3_MISSING} AWS_ACCESS_KEY_ID"
        [ -z "$AWS_SECRET_ACCESS_KEY" ]  && S3_MISSING="${S3_MISSING} AWS_SECRET_ACCESS_KEY"

        if [ -n "$S3_MISSING" ]; then
            echo "  OFFSITE FAILED: s3 mode requires missing env vars:${S3_MISSING}"
        elif ! command -v aws >/dev/null 2>&1; then
            echo "  OFFSITE FAILED: 'aws' CLI not found — install with: apt-get install awscli"
        else
            # Build endpoint flag only if a custom endpoint is set (non-AWS S3)
            ENDPOINT_FLAG=""
            if [ -n "$S3_ENDPOINT" ]; then
                ENDPOINT_FLAG="--endpoint-url ${S3_ENDPOINT}"
            fi

            echo "  s3 sync → s3://${S3_BUCKET}/ ${ENDPOINT_FLAG:+(endpoint: ${S3_ENDPOINT})}"
            AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
            AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
            aws s3 sync \
                "${BACKUP_DIR}/" \
                "s3://${S3_BUCKET}/" \
                --delete \
                --no-progress \
                ${ENDPOINT_FLAG}

            S3_EXIT=$?
            if [ $S3_EXIT -eq 0 ]; then
                echo "  OFFSITE OK: s3 sync to s3://${S3_BUCKET}/ completed successfully"
                OFFSITE_OK=true
            else
                echo "  OFFSITE FAILED: aws s3 sync exited with code ${S3_EXIT}"
            fi
        fi

    else
        echo "  OFFSITE FAILED: Unknown BACKUP_OFFSITE_METHOD '${OFFSITE_METHOD}' — expected 'rsync' or 's3'"
    fi

    if [ "$OFFSITE_OK" = "false" ]; then
        echo "  WARNING: Offsite replication did not complete — local backups are intact but no remote copy was made"
    fi

else
    echo "[$(date)] Offsite replication disabled (set BACKUP_OFFSITE_ENABLED=true to enable)"
fi
# ─────────────────────────────────────────────────────────────────────────────

echo "[$(date)] Backup complete."
