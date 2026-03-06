-- Migration 112: Referral program + ref_code on users

ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code VARCHAR(20) UNIQUE;

-- Generate ref codes for existing users (deterministic from user id)
UPDATE users
SET ref_code = UPPER(SUBSTRING(MD5(id || 'pnptv2026ref'), 1, 8))
WHERE ref_code IS NULL;

CREATE TABLE IF NOT EXISTS referrals (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20)   NOT NULL,
  referrer_id     VARCHAR(255)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id      VARCHAR(255)  REFERENCES users(id) ON DELETE SET NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | completed
  reward_days     INTEGER       NOT NULL DEFAULT 3,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer  ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code      ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_referee   ON referrals(referee_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_code_referee ON referrals(code, referee_id);
