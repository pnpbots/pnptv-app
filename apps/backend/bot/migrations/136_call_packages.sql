-- Migration 136: Call packages (creator-defined call bundles with SKU pricing)

CREATE TABLE IF NOT EXISTS call_packages (
  id               SERIAL PRIMARY KEY,
  creator_id       VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_minutes INT NOT NULL CHECK (duration_minutes IN (30, 60)),
  quantity         INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_usd        NUMERIC(10,2) NOT NULL CHECK (price_usd > 0),
  sku              TEXT NOT NULL UNIQUE,
  title            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_packages_creator_active
  ON call_packages(creator_id)
  WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_call_packages_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_call_packages_updated_at ON call_packages;

CREATE TRIGGER trg_call_packages_updated_at
  BEFORE UPDATE ON call_packages
  FOR EACH ROW EXECUTE FUNCTION update_call_packages_updated_at();
