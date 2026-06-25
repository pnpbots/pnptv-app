-- Migration 278: Onboarding wizard columns
-- Adds step-tracking columns for the 7-step registration wizard.
-- Existing users are backfilled so they are not forced into the wizard.

BEGIN;

-- Step: rules acceptance
ALTER TABLE users ADD COLUMN IF NOT EXISTS rules_accepted       BOOLEAN     DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rules_accepted_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rules_accepted_ip    VARCHAR(45);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rules_version        VARCHAR(20);

-- Step: values acknowledgement
ALTER TABLE users ADD COLUMN IF NOT EXISTS values_acknowledged_at TIMESTAMPTZ;

-- Step: crypto onboarding
ALTER TABLE users ADD COLUMN IF NOT EXISTS crypto_onboarded_at TIMESTAMPTZ;

-- Step: tiers seen
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiers_seen_at        TIMESTAMPTZ;

-- privacy_version — only add if absent (terms_version already exists per spec)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'privacy_version'
  ) THEN
    ALTER TABLE users ADD COLUMN privacy_version VARCHAR(20);
  END IF;
END $$;

-- Backfill: mark all accounts older than 1 minute as having completed onboarding.
-- Brand-new rows (< 1 min old) stay with onboarding_complete = false so they hit the wizard.
UPDATE users
SET
  onboarding_complete      = true,
  tiers_seen_at            = COALESCE(tiers_seen_at, NOW()),
  values_acknowledged_at   = COALESCE(values_acknowledged_at, NOW()),
  crypto_onboarded_at      = COALESCE(crypto_onboarded_at, NOW()),
  rules_accepted           = true,
  rules_accepted_at        = COALESCE(rules_accepted_at, NOW()),
  rules_version            = COALESCE(rules_version, '1.0'),
  terms_version            = COALESCE(terms_version, '1.0'),
  privacy_version          = COALESCE(privacy_version, '1.0')
WHERE created_at < NOW() - INTERVAL '1 minute'
  AND onboarding_complete  = false;

COMMIT;
