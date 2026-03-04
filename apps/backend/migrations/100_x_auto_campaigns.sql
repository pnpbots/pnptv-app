-- Migration 100: X Auto Campaigns — Autonomous content generation & posting
-- New table for campaign configurations + campaign_id FK on x_post_jobs

CREATE TABLE IF NOT EXISTS x_auto_campaigns (
  campaign_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200) NOT NULL,
  account_id        UUID NOT NULL REFERENCES x_accounts(account_id) ON DELETE CASCADE,

  -- Generation config
  topic             TEXT NOT NULL,
  grok_mode         VARCHAR(30) NOT NULL DEFAULT 'xPost',
  language          VARCHAR(10) NOT NULL DEFAULT 'es',
  custom_prompt     TEXT,

  -- Scheduling config
  interval_minutes  INTEGER NOT NULL DEFAULT 240,
  active_hours_start INTEGER NOT NULL DEFAULT 8,
  active_hours_end   INTEGER NOT NULL DEFAULT 23,

  -- Runtime state
  status            VARCHAR(20) NOT NULL DEFAULT 'paused'
                      CHECK (status IN ('active', 'paused', 'completed')),
  last_generated_at TIMESTAMPTZ,
  next_run_at       TIMESTAMPTZ,
  total_generated   INTEGER NOT NULL DEFAULT 0,
  total_posted      INTEGER NOT NULL DEFAULT 0,
  total_failed      INTEGER NOT NULL DEFAULT 0,
  max_posts         INTEGER,

  -- Audit
  created_by        VARCHAR(255),
  created_by_username VARCHAR(100),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_x_auto_campaigns_status ON x_auto_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_x_auto_campaigns_next_run ON x_auto_campaigns(next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_x_auto_campaigns_account ON x_auto_campaigns(account_id);

ALTER TABLE x_auto_campaigns OWNER TO pnptvbot;

-- Link posts to their originating campaign
ALTER TABLE x_post_jobs ADD COLUMN IF NOT EXISTS campaign_id UUID
  REFERENCES x_auto_campaigns(campaign_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_x_post_jobs_campaign ON x_post_jobs(campaign_id)
  WHERE campaign_id IS NOT NULL;
