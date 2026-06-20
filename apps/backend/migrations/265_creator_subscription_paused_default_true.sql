-- Creators start with memberships paused; they must opt in to charging.
ALTER TABLE users
  ALTER COLUMN creator_subscription_paused SET DEFAULT TRUE;
