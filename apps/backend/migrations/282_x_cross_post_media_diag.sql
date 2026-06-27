-- Migration 282: X cross-post media diagnostics
-- Date: 2026-06-27
-- Purpose: Capture per-share media upload telemetry (preflight + chunked upload
--          + processing) so we can see exactly why "Content not available"
--          renders on X. Backfilling old rows is not needed — these columns are
--          additive and forward-looking.

BEGIN;

ALTER TABLE x_cross_post_log
  ADD COLUMN IF NOT EXISTS media_state          VARCHAR(32),     -- 'skipped' | 'uploaded' | 'failed' | 'succeeded' | 'pending' | 'in_progress'
  ADD COLUMN IF NOT EXISTS media_error          TEXT,
  ADD COLUMN IF NOT EXISTS media_processing_ms  INTEGER,         -- total ms from download → STATUS=succeeded
  ADD COLUMN IF NOT EXISTS media_size_bytes     BIGINT,          -- final uploaded byte size (post-trim if applicable)
  ADD COLUMN IF NOT EXISTS media_duration_sec   NUMERIC(8, 2),   -- final uploaded duration (post-trim if applicable)
  ADD COLUMN IF NOT EXISTS media_was_trimmed    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS media_was_transcoded BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN x_cross_post_log.media_state IS
  'Last observed media upload phase outcome: skipped|uploaded|succeeded|failed|pending|in_progress';

COMMIT;
