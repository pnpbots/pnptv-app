-- ============================================================
-- Migration 136: Platform-wide ban system + IP access logging
-- ============================================================

-- ── 1. platform_bans ────────────────────────────────────────
-- Stores every identity vector captured at ban time so no
-- banned user can re-enter through any login method.
CREATE TABLE IF NOT EXISTS platform_bans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Core identity (at least one must be populated)
  user_id           VARCHAR(255),          -- internal DB id (PK of users)
  telegram_id       VARCHAR(50),           -- Telegram user ID
  pnptv_id          VARCHAR(36),           -- pnptv_id UUID
  email             VARCHAR(255),          -- email address
  username          VARCHAR(255),          -- @handle at time of ban
  x_id              VARCHAR(50),           -- Twitter/X user ID
  bluesky_did       VARCHAR(255),          -- Bluesky DID
  atproto_did       VARCHAR(255),          -- ATProto DID

  -- IPs recorded at ban time (collected from access log)
  known_ips         TEXT[],                -- array of IPs seen for this user

  -- Ban metadata
  reason            TEXT NOT NULL,
  evidence          JSONB DEFAULT '{}',    -- arbitrary evidence payload
  banned_by         VARCHAR(255),          -- admin user_id or 'system'
  banned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  -- Soft-unban support
  unbanned_at       TIMESTAMPTZ,
  unbanned_by       VARCHAR(255),
  unban_reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_bans_user_id     ON platform_bans(user_id)     WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_telegram_id ON platform_bans(telegram_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_pnptv_id    ON platform_bans(pnptv_id)    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_email       ON platform_bans(email)        WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_x_id        ON platform_bans(x_id)         WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_bluesky_did ON platform_bans(bluesky_did)  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_bans_active      ON platform_bans(is_active);
CREATE INDEX IF NOT EXISTS idx_platform_bans_known_ips   ON platform_bans USING GIN(known_ips);

-- ── 2. user_access_logs ─────────────────────────────────────
-- Tracks every authenticated session with IP + user-agent.
-- Used for security auditing and populating known_ips on ban.
CREATE TABLE IF NOT EXISTS user_access_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     VARCHAR(255) NOT NULL,
  telegram_id VARCHAR(50),
  ip_address  VARCHAR(45)  NOT NULL,
  user_agent  TEXT,
  path        VARCHAR(500),
  method      VARCHAR(10),
  session_id  VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_user_id    ON user_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip         ON user_access_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON user_access_logs(created_at);
-- Auto-prune rows older than 90 days (run via cron or pg_cron)
-- DELETE FROM user_access_logs WHERE created_at < NOW() - INTERVAL '90 days';
