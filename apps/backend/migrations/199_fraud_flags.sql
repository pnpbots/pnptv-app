-- 199_fraud_flags.sql
-- Persist fraud detection signals for audit + cross-account linking.
-- Read by FraudDetectionService.checkLinkedFraudAccounts; written by
-- FraudDetectionService.storeFraudFlags after a flagged transaction.

CREATE TABLE IF NOT EXISTS fraud_flags (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT,
  phone TEXT,
  card_last_four TEXT,
  amount NUMERIC(12,2),
  flagged_rules TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_user
  ON fraud_flags (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_email
  ON fraud_flags (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_flags_phone
  ON fraud_flags (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_flags_card
  ON fraud_flags (card_last_four) WHERE card_last_four IS NOT NULL;
