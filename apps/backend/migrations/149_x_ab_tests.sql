CREATE TABLE IF NOT EXISTS x_ab_tests (
  ab_test_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id   UUID REFERENCES x_auto_campaigns(campaign_id) ON DELETE CASCADE,
  variant_a     UUID REFERENCES x_post_jobs(post_id) ON DELETE SET NULL,
  variant_b     UUID REFERENCES x_post_jobs(post_id) ON DELETE SET NULL,
  variant_c     UUID REFERENCES x_post_jobs(post_id) ON DELETE SET NULL,
  winner_post_id UUID REFERENCES x_post_jobs(post_id) ON DELETE SET NULL,
  status        VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_x_ab_tests_campaign ON x_ab_tests(campaign_id);
