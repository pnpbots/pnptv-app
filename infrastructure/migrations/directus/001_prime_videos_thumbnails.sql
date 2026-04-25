-- Directus DB migration 001 (2026-04-25): prime_videos.thumbnails column.
--
-- Adds a JSON column to prime_videos that stores
--   { video_file: <uuid>, frames: [<uuid>, ...] }
-- and registers it in directus_fields so the Directus REST PATCH endpoint
-- accepts the field (otherwise Directus silently drops unknown fields even
-- when the underlying Postgres column exists).
--
-- The bot's generateVideoThumbnails() helper writes here after running
-- ffmpeg over a newly uploaded video_file. The shape lets the sync endpoint
-- compare stored video_file to the current one and skip regeneration when
-- they match (cheap title/description edits stay fast).
--
-- Run against the Directus database (NOT pnptvbot):
--   docker exec -i pg-directus psql -U directus_user -d directus_db < 001_prime_videos_thumbnails.sql
-- Then restart the Directus container so it picks up the new field metadata:
--   docker compose restart directus
--
-- All statements are idempotent.

ALTER TABLE prime_videos
  ADD COLUMN IF NOT EXISTS thumbnails JSON DEFAULT '{}'::json;

-- Register the field in Directus's metadata table so PATCH accepts it.
-- Without this row, Directus knows the column exists in Postgres but
-- treats the field as unmanaged and won't include it in API requests.
-- directus_fields has no unique constraint on (collection, field), so we
-- guard with NOT EXISTS instead of ON CONFLICT.
INSERT INTO directus_fields (collection, field, special, interface, options, hidden, readonly)
SELECT 'prime_videos', 'thumbnails', 'json', 'input-code', '{"language":"json"}', false, false
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields WHERE collection = 'prime_videos' AND field = 'thumbnails'
);
