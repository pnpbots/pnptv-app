#!/usr/bin/env bash
# ffprobe each video file in directus_files, write duration (ms) into the row.
set -euo pipefail

UPLOADS_DIR="/opt/pnptvapp/infrastructure/data/directus/uploads"
ENV_FILE="/opt/pnptvapp/.env"
DB_USER="$(grep '^PG_DIRECTUS_USER=' "$ENV_FILE" | cut -d= -f2)"
DB_NAME="$(grep '^PG_DIRECTUS_DB=' "$ENV_FILE" | cut -d= -f2)"

mapfile -t ROWS < <(
  docker exec pg-directus psql -U "$DB_USER" -d "$DB_NAME" -At -F '|' \
    -c "SELECT id, filename_disk FROM directus_files WHERE type LIKE 'video/%';"
)

OK=0
MISS=0
PROBE_FAIL=0
for line in "${ROWS[@]}"; do
  ID="${line%%|*}"
  DISK="${line#*|}"
  SRC="$UPLOADS_DIR/$DISK"
  [[ -f "$SRC" ]] || { MISS=$((MISS+1)); continue; }

  DUR_S=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC" 2>/dev/null || echo "")
  if [[ -z "$DUR_S" ]]; then
    PROBE_FAIL=$((PROBE_FAIL+1))
    continue
  fi
  DUR_MS=$(awk "BEGIN{printf \"%d\", $DUR_S * 1000}")
  docker exec pg-directus psql -U "$DB_USER" -d "$DB_NAME" -q \
    -c "UPDATE directus_files SET duration = $DUR_MS WHERE id = '$ID';" >/dev/null
  OK=$((OK+1))
done

echo "filled=$OK missing=$MISS probe_fail=$PROBE_FAIL"
