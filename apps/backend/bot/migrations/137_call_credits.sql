-- Migration 137: Call credits (member entitlements for purchased call packages)

CREATE TABLE IF NOT EXISTS call_credits (
  id                 SERIAL PRIMARY KEY,
  member_id          VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id         INT NOT NULL REFERENCES call_packages(id) ON DELETE RESTRICT,
  quantity_total     INT NOT NULL CHECK (quantity_total > 0),
  quantity_used      INT NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
  quantity_scheduled INT NOT NULL DEFAULT 0 CHECK (quantity_scheduled >= 0),
  status             TEXT NOT NULL DEFAULT 'unused'
                       CHECK (status IN ('unused','partial','completed','expired','refunded')),
  payment_id         UUID REFERENCES payments(id),
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credits_used_lte_total
    CHECK (quantity_used + quantity_scheduled <= quantity_total)
);

CREATE INDEX IF NOT EXISTS idx_call_credits_member  ON call_credits(member_id);
CREATE INDEX IF NOT EXISTS idx_call_credits_creator ON call_credits(creator_id);
CREATE INDEX IF NOT EXISTS idx_call_credits_status  ON call_credits(member_id, status)
  WHERE status IN ('unused','partial');

-- Also add call_credit_id to private_call_bookings if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'private_call_bookings') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'private_call_bookings'
                     AND column_name = 'call_credit_id') THEN
      ALTER TABLE private_call_bookings
        ADD COLUMN call_credit_id INT REFERENCES call_credits(id);
    END IF;
  END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_call_credits_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_call_credits_updated_at ON call_credits;

CREATE TRIGGER trg_call_credits_updated_at
  BEFORE UPDATE ON call_credits
  FOR EACH ROW EXECUTE FUNCTION update_call_credits_updated_at();
