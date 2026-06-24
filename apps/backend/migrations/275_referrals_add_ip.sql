-- Migration 275: add referee_ip to referrals for IP-based duplicate detection
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_ip VARCHAR(45);
CREATE INDEX IF NOT EXISTS idx_referrals_referee_ip ON referrals (referee_ip) WHERE referee_ip IS NOT NULL;
