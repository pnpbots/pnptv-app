-- Migration 161: Seed standard call packages for all active performers
-- Inserts 30-min/$60 and 60-min/$100 packages for every active performer who
-- doesn't already have them. Idempotent — safe to run multiple times.

INSERT INTO call_packages (creator_id, duration_minutes, quantity, price_usd, sku, title, is_active, created_at, updated_at)
SELECT
  p.user_id,
  dur.duration,
  1,
  dur.price,
  'CALL-' || UPPER(COALESCE(u.username, REPLACE(p.user_id::text, '-', ''))) || '-' || dur.duration || 'M-Q1',
  dur.title,
  true,
  NOW(),
  NOW()
FROM performers p
JOIN users u ON u.id = p.user_id
CROSS JOIN (VALUES
  (30, 60.00::numeric, '30-Minute Private Call'),
  (60, 100.00::numeric, '60-Minute Private Call')
) AS dur(duration, price, title)
WHERE p.status = 'active'
AND NOT EXISTS (
  SELECT 1 FROM call_packages cp
  WHERE cp.creator_id = p.user_id
  AND cp.duration_minutes = dur.duration
  AND cp.is_active = true
);

-- Trigger function: auto-seed standard packages when a performer is activated
CREATE OR REPLACE FUNCTION seed_performer_call_packages()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'active') THEN
    INSERT INTO call_packages (creator_id, duration_minutes, quantity, price_usd, sku, title, is_active, created_at, updated_at)
    SELECT
      NEW.user_id,
      dur.duration,
      1,
      dur.price,
      'CALL-' || UPPER(COALESCE(
        (SELECT username FROM users WHERE id = NEW.user_id),
        REPLACE(NEW.user_id::text, '-', '')
      )) || '-' || dur.duration || 'M-Q1',
      dur.title,
      true,
      NOW(),
      NOW()
    FROM (VALUES
      (30, 60.00::numeric, '30-Minute Private Call'),
      (60, 100.00::numeric, '60-Minute Private Call')
    ) AS dur(duration, price, title)
    WHERE NOT EXISTS (
      SELECT 1 FROM call_packages cp
      WHERE cp.creator_id = NEW.user_id
      AND cp.duration_minutes = dur.duration
      AND cp.is_active = true
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_performer_packages ON performers;
CREATE TRIGGER trg_seed_performer_packages
  AFTER INSERT OR UPDATE ON performers
  FOR EACH ROW EXECUTE FUNCTION seed_performer_call_packages();
