-- Migration 121: Protect lifetime users from accidental tier downgrades
-- Also normalizes legacy plan_id values

-- Protect lifetime users from accidental tier downgrades.
-- Instead of raising an exception (which would break cron jobs), silently
-- preserve the lifetime user's tier and subscription_status.
CREATE OR REPLACE FUNCTION protect_lifetime_users()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.plan_id ILIKE '%lifetime%' OR OLD.plan_id = 'lifetime100')
    AND OLD.tier != 'banned'
    AND NEW.tier = 'free'
    AND (NEW.subscription_status IN ('free', 'churned', 'expired'))
  THEN
    -- Silently preserve the lifetime user's status
    NEW.tier := OLD.tier;
    NEW.subscription_status := 'active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_lifetime_users ON users;
CREATE TRIGGER trg_protect_lifetime_users
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION protect_lifetime_users();

-- Normalize legacy plan_id values
UPDATE users SET plan_id = 'member-monthly' WHERE plan_id = 'member_monthly';
