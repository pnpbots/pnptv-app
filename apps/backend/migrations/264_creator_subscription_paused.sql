-- Allow creators to pause new subscriptions without losing creator_status or subscriber count.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_subscription_paused BOOLEAN NOT NULL DEFAULT FALSE;
