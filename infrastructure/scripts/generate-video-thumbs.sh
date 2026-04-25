#!/usr/bin/env bash
# Generates poster JPEG + animated preview MP4 for every Directus video file
# that doesn't already have one. Idempotent — safe to run repeatedly.
#
# Output:
#   {UPLOADS}/_thumbs/{id}.jpg          ~640px wide poster (frame at ~2s)
#   {UPLOADS}/_thumbs/{id}_preview.mp4  ~480px wide, 4s, muted, fps=15

set -euo pipefail

UPLOADS_DIR="${UPLOADS_DIR:-/opt/pnptvapp/infrastructure/data/directus/uploads}"
THUMBS_DIR="$UPLOADS_DIR/_thumbs"
ENV_FILE="${ENV_FILE:-/opt/pnptvapp/.env}"

mkdir -p "$THUMBS_DIR"

DB_USER="$(grep '^PG_DIRECTUS_USER=' "$ENV_FILE" | cut -d= -f2)"
DB_NAME="$(grep '^PG_DIRECTUS_DB=' "$ENV_FILE" | cut -d= -f2)"

# Pull (id, filename_disk) for every video file
mapfile -t VIDEOS < <(
  docker exec pg-directus psql -U "$DB_USER" -d "$DB_NAME" -At -F '|' \
    -c "SELECT id, filename_disk FROM directus_files WHERE type LIKE 'video/%' ORDER BY uploaded_on DESC;"
)

TOTAL=${#VIDEOS[@]}
DONE=0
SKIP=0
FAIL=0

echo "Found $TOTAL video files. Generating thumbs into $THUMBS_DIR"

for line in "${VIDEOS[@]}"; do
  ID="${line%%|*}"
  DISK="${line#*|}"
  SRC="$UPLOADS_DIR/$DISK"
  POSTER="$THUMBS_DIR/$ID.jpg"
  PREVIEW="$THUMBS_DIR/${ID}_preview.mp4"

  if [[ ! -f "$SRC" ]]; then
    echo "  [skip] $ID  source missing on disk: $DISK"
    SKIP=$((SKIP+1))
    continue
  fi

  if [[ -s "$POSTER" && -s "$PREVIEW" ]]; then
    SKIP=$((SKIP+1))
    continue
  fi

  # Probe duration so we can pick a sensible seek point
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC" 2>/dev/null || echo "0")
  DUR_INT=$(printf "%.0f" "${DUR:-0}")
  if (( DUR_INT < 6 )); then
    POSTER_AT=0
    PREVIEW_AT=0
    PREVIEW_LEN=$(( DUR_INT > 3 ? 3 : (DUR_INT > 1 ? DUR_INT : 1) ))
  else
    POSTER_AT=$(( DUR_INT / 10 + 2 ))
    PREVIEW_AT=$POSTER_AT
    PREVIEW_LEN=4
  fi

  # Some encoders write "reserved" color metadata which ffmpeg's filter chain
  # rejects with "Invalid color space". The h264_metadata bsf rewrites that
  # metadata in-place at the demuxer level. Fall back to it on failure.
  BSF_FIX="h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1"

  if [[ ! -s "$POSTER" ]]; then
    if ! ffmpeg -nostdin -loglevel error -y \
        -ss "$POSTER_AT" -i "$SRC" \
        -frames:v 1 -q:v 4 \
        -vf "scale='min(640,iw)':-2:flags=bicubic,format=yuvj420p" \
        "$POSTER" 2>/dev/null
    then
      ffmpeg -nostdin -loglevel error -y \
        -ss "$POSTER_AT" -bsf:v "$BSF_FIX" -i "$SRC" \
        -frames:v 1 -q:v 4 \
        -vf "scale='min(640,iw)':-2:flags=bicubic,format=yuvj420p" \
        "$POSTER" \
        || { echo "  [fail-poster] $ID"; FAIL=$((FAIL+1)); continue; }
    fi
  fi

  if [[ ! -s "$PREVIEW" ]]; then
    if ! ffmpeg -nostdin -loglevel error -y \
        -ss "$PREVIEW_AT" -i "$SRC" -t "$PREVIEW_LEN" \
        -an -vf "scale='min(480,iw)':-2,fps=15" \
        -c:v libx264 -preset veryfast -crf 32 \
        -movflags +faststart -pix_fmt yuv420p \
        "$PREVIEW" 2>/dev/null
    then
      rm -f "$PREVIEW"
      ffmpeg -nostdin -loglevel error -y \
        -ss "$PREVIEW_AT" -bsf:v "$BSF_FIX" -i "$SRC" -t "$PREVIEW_LEN" \
        -an -vf "scale='min(480,iw)':-2,fps=15" \
        -c:v libx264 -preset veryfast -crf 32 \
        -movflags +faststart -pix_fmt yuv420p \
        "$PREVIEW" \
        || { echo "  [fail-preview] $ID"; rm -f "$PREVIEW"; FAIL=$((FAIL+1)); continue; }
    fi
  fi

  DONE=$((DONE+1))
  if (( DONE % 5 == 0 )); then
    echo "  [progress] $DONE done, $SKIP skipped, $FAIL failed (of $TOTAL)"
  fi
done

echo "Finished: $DONE generated, $SKIP skipped, $FAIL failed (of $TOTAL)."
