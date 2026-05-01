-- ============================================================================
-- Migration 242 — channel_videos
-- ============================================================================
-- Universal channel-video upload pipeline. Until now only admins could upload
-- videos (to the PRIME channel via prime_videos / Directus). This table makes
-- "upload a video to MY channel" available to every creator who owns a
-- creator_channels row, with metadata, tags, AI-attributable fields, and a
-- link back to the social_posts promo row that gets created at publish time.
--
-- Reuse decisions (deliberate):
--   • prime_videos stays as-is for the legacy admin PRIME channel (Directus
--     collection, hardcoded category). Don't touch it.
--   • Promo posts use existing social_posts.media_url / video_thumbnail_url /
--     source_channel — no new social_posts column needed for media. We do add
--     a small `metadata` jsonb so the promo post can carry channel context
--     (channel_id, access_type-at-publish, price, creator handle) that the
--     frontend resolves into the correct CTA per viewer state.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS channel_videos (
    id                bigserial    PRIMARY KEY,
    channel_id        integer      NOT NULL REFERENCES creator_channels(id) ON DELETE CASCADE,
    uploader_id       varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Directus-stored raw video file id (uuid). We don't FK across DB boundaries.
    directus_file_id  uuid         NOT NULL,
    title             varchar(255) NOT NULL,
    description       text,
    tags              text[]       NOT NULL DEFAULT '{}'::text[],
    duration_sec      integer,
    filesize_bytes    bigint,
    -- Static JPG (Directus auto-extracts on upload via the video-thumb extension).
    thumbnail_url     text,
    -- Animated 3s GIF (we generate via ffmpeg in the publish endpoint). Nullable —
    -- when generation fails or is in progress, the promo post falls back to thumbnail_url.
    gif_url           text,
    -- Backref to the promo social_posts row created at publish time.
    promo_post_id     bigint       REFERENCES social_posts(id) ON DELETE SET NULL,
    status            text         NOT NULL DEFAULT 'processing'
                                   CHECK (status IN ('processing','published','draft','failed','removed')),
    -- Track which fields Grok wrote vs. the human edited, for telemetry / audit /
    -- future "AI assist usage" stats. Shape: { title:'ai'|'human', description:'ai'|'human'|'mixed', tags:'ai'|'human' }.
    ai_generated_meta jsonb        NOT NULL DEFAULT '{}'::jsonb,
    -- Soft-delete bookkeeping. Hard-deletion of a video should remove its
    -- promo post too — handled by the DELETE endpoint.
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- Lookups: list videos for a channel (creator dashboard, channel page)
CREATE INDEX IF NOT EXISTS idx_channel_videos_channel
    ON channel_videos (channel_id, created_at DESC)
    WHERE status IN ('published', 'processing', 'draft');

-- Lookups: "my uploads" across all channels for a creator
CREATE INDEX IF NOT EXISTS idx_channel_videos_uploader
    ON channel_videos (uploader_id, created_at DESC);

-- Cleanup cron: find drafts older than 24h, processing rows stuck >1h
CREATE INDEX IF NOT EXISTS idx_channel_videos_status_age
    ON channel_videos (status, created_at)
    WHERE status IN ('processing', 'draft', 'failed');

-- Maintain updated_at on every UPDATE (re-uses the existing trigger function).
DROP TRIGGER IF EXISTS update_channel_videos_updated_at ON channel_videos;
CREATE TRIGGER update_channel_videos_updated_at
    BEFORE UPDATE ON channel_videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── social_posts.metadata ───────────────────────────────────────────────────
-- Lightweight per-post sidecar JSON. We use it (for now) only to embed channel
-- promo context: { kind:'channel_promo', channel_id, channel_slug, channel_name,
-- access_type, price_usd, creator_username }. Existing posts have no metadata
-- and existing code reads no metadata, so the addition is safe.

ALTER TABLE social_posts
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Targeted index for fetching channel-promo posts (used by future channel
-- page "uploaded videos" feed). Uses a partial index keyed by the kind
-- discriminator so it stays small.
CREATE INDEX IF NOT EXISTS idx_social_posts_channel_promo
    ON social_posts ((metadata->>'channel_id'))
    WHERE metadata->>'kind' = 'channel_promo';

COMMIT;
