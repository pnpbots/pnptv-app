-- Migration 113: Nearby place submissions (user-submitted places pending review)
--
-- This migration is written to match the live schema exactly and is fully
-- idempotent. It uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards so it
-- can be re-run safely against a DB where earlier partial versions of this
-- migration already ran.
--
-- Key divergences from the original draft that this corrects:
--   - submitted_by_user_id: VARCHAR(50), no FK to users (live has none)
--   - Timestamp column is named submitted_at (not created_at), TIMESTAMP (no TZ)
--   - location_lat/lng use NUMERIC(10,8)/NUMERIC(11,8) not DOUBLE PRECISION
--   - place_type is NOT NULL with CHECK ('business','place_of_interest')
--   - status has CHECK ('pending','approved','rejected'), nullable in live
--   - category_id has FK -> nearby_place_categories(id)
--   - Added columns: email, telegram_username, is_community_owned, photo_file_id,
--     hours_of_operation, price_range, moderated_by, moderated_at,
--     rejection_reason, admin_notes, created_place_id, updated_at
--   - created_place_id has FK -> nearby_places(id)
--   - updated_at is maintained by a trigger (update_nearby_places_timestamp)
--   - Index names match live: idx_place_submissions_user, idx_place_submissions_status

-- ============================================================
-- STEP 1: Create table with all columns (clean deployment path)
-- ============================================================

CREATE TABLE IF NOT EXISTS nearby_place_submissions (
  id                    SERIAL PRIMARY KEY,
  submitted_by_user_id  VARCHAR(50)           NOT NULL,
  submitted_at          TIMESTAMP             DEFAULT NOW(),
  name                  VARCHAR(200)          NOT NULL,
  description           TEXT,
  address               VARCHAR(500),
  city                  VARCHAR(100),
  country               VARCHAR(100),
  location_lat          NUMERIC(10,8),
  location_lng          NUMERIC(11,8),
  category_id           INTEGER,
  place_type            VARCHAR(50)           NOT NULL,
  phone                 VARCHAR(50),
  email                 VARCHAR(255),
  website               VARCHAR(500),
  telegram_username     VARCHAR(100),
  instagram             VARCHAR(100),
  is_community_owned    BOOLEAN               DEFAULT false,
  photo_file_id         VARCHAR(255),
  hours_of_operation    JSONB                 DEFAULT '{}',
  price_range           VARCHAR(10),
  status                VARCHAR(20)           DEFAULT 'pending',
  moderated_by          VARCHAR(50),
  moderated_at          TIMESTAMP,
  rejection_reason      TEXT,
  admin_notes           TEXT,
  created_place_id      INTEGER,
  updated_at            TIMESTAMP             DEFAULT NOW()
);

-- ============================================================
-- STEP 2: Add missing columns for databases where the old
--         partial migration already ran (idempotent backfill)
-- ============================================================

ALTER TABLE nearby_place_submissions
  ADD COLUMN IF NOT EXISTS email              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telegram_username  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_community_owned BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_file_id      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS hours_of_operation JSONB     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS price_range        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS moderated_by       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS moderated_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason   TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes        TEXT,
  ADD COLUMN IF NOT EXISTS created_place_id   INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP DEFAULT NOW();

-- Rename created_at -> submitted_at if the old draft created it under
-- that name and submitted_at does not yet exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nearby_place_submissions' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nearby_place_submissions' AND column_name = 'submitted_at'
  ) THEN
    ALTER TABLE nearby_place_submissions RENAME COLUMN created_at TO submitted_at;
  END IF;
END $$;

-- Add submitted_at if neither created_at nor submitted_at exists (edge case).
ALTER TABLE nearby_place_submissions
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP DEFAULT NOW();

-- ============================================================
-- STEP 3: CHECK constraints (idempotent via DO block)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nearby_place_submissions'
      AND constraint_name = 'nearby_place_submissions_status_check'
  ) THEN
    ALTER TABLE nearby_place_submissions
      ADD CONSTRAINT nearby_place_submissions_status_check
      CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected']));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nearby_place_submissions'
      AND constraint_name = 'nearby_place_submissions_place_type_check'
  ) THEN
    ALTER TABLE nearby_place_submissions
      ADD CONSTRAINT nearby_place_submissions_place_type_check
      CHECK (place_type = ANY (ARRAY['business', 'place_of_interest']));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nearby_place_submissions'
      AND constraint_name = 'nearby_place_submissions_price_range_check'
  ) THEN
    ALTER TABLE nearby_place_submissions
      ADD CONSTRAINT nearby_place_submissions_price_range_check
      CHECK ((price_range = ANY (ARRAY['$', '$$', '$$$', '$$$$'])) OR price_range IS NULL);
  END IF;
END $$;

-- ============================================================
-- STEP 4: Foreign keys (idempotent via DO block)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nearby_place_submissions'
      AND constraint_name = 'nearby_place_submissions_category_id_fkey'
  ) THEN
    ALTER TABLE nearby_place_submissions
      ADD CONSTRAINT nearby_place_submissions_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES nearby_place_categories(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'nearby_place_submissions'
      AND constraint_name = 'nearby_place_submissions_created_place_id_fkey'
  ) THEN
    ALTER TABLE nearby_place_submissions
      ADD CONSTRAINT nearby_place_submissions_created_place_id_fkey
      FOREIGN KEY (created_place_id) REFERENCES nearby_places(id);
  END IF;
END $$;

-- ============================================================
-- STEP 5: Indexes (match live index names exactly)
-- ============================================================

-- Drop old draft index names if they exist, then create the canonical ones.
DROP INDEX IF EXISTS idx_nearby_place_submissions_user;
DROP INDEX IF EXISTS idx_nearby_place_submissions_status;

CREATE INDEX IF NOT EXISTS idx_place_submissions_user   ON nearby_place_submissions(submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_place_submissions_status ON nearby_place_submissions(status);

-- ============================================================
-- STEP 6: updated_at trigger
-- ============================================================
-- Requires the update_nearby_places_timestamp() function, which is created
-- by the nearby_places migration (runs before this one).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'nearby_place_submissions'
      AND trigger_name = 'trigger_update_place_submissions_timestamp'
  ) THEN
    CREATE TRIGGER trigger_update_place_submissions_timestamp
      BEFORE UPDATE ON nearby_place_submissions
      FOR EACH ROW EXECUTE FUNCTION update_nearby_places_timestamp();
  END IF;
END $$;
