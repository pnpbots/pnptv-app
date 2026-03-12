CREATE TABLE IF NOT EXISTS x_post_analytics (
  analytics_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id         UUID REFERENCES x_post_jobs(post_id) ON DELETE CASCADE,
  campaign_id     UUID REFERENCES x_auto_campaigns(campaign_id) ON DELETE SET NULL,
  impressions     INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  retweets        INTEGER DEFAULT 0,
  replies         INTEGER DEFAULT 0,
  link_clicks     INTEGER DEFAULT 0,
  engagement_score FLOAT GENERATED ALWAYS AS (
    (likes * 1.0) + (retweets * 2.0) + (replies * 1.5) + (link_clicks * 3.0)
  ) STORED,
  fetched_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_x_post_analytics_campaign ON x_post_analytics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_x_post_analytics_score ON x_post_analytics(campaign_id, engagement_score DESC);
