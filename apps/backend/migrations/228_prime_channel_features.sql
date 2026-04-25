-- Migration 228: PNPtv! PRIME channel features (2026-04-25).
--
-- Schema additions to support:
--  • Featured-channel pinning at the top of the channel grid
--  • View-count tracking on social posts (with Directus prime_videos sync)
--  • Multi-frame thumbnail URLs mirrored from prime_videos for hover/cycling
--    preview in the channel feed
--
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe.
-- See companion migration in infrastructure/migrations/directus/ for the
-- Directus-side prime_videos.thumbnails column + field meta registration.

-- ─── Featured-channel pinning ───────────────────────────────────────────
-- Read by /api/webapp/channels?view=channels for ORDER BY is_featured DESC,
-- and surfaces in the API response as channel.featured for the hero card.
ALTER TABLE creator_channels
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

-- ─── View tracking on social posts ─────────────────────────────────────
-- /api/webapp/social/posts/:postId/view increments this; mirrored to
-- prime_videos.plays via Directus REST when the post links to a Directus row.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

-- Helps the prime-videos sync webhook + view-tracking endpoint look up posts
-- by their Directus catalog id efficiently. Partial index — only posts
-- linked to a Directus row carry a directus_id.
CREATE INDEX IF NOT EXISTS idx_social_posts_directus_id_view
  ON social_posts (directus_id) WHERE directus_id IS NOT NULL;

-- ─── Multi-frame thumbnails mirror ─────────────────────────────────────
-- Array of pre-extracted JPEG URLs (typically 6 frames per video) generated
-- by the bot's generateVideoThumbnails() helper and rendered by
-- AnimatedVideoThumbnail with a 1.5s opacity crossfade.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS video_thumbnails JSONB DEFAULT '[]'::jsonb;
