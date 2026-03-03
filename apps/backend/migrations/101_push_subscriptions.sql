-- 101_push_subscriptions.sql
-- Web Push subscription store.
-- Allows the backend to send browser push notifications to authenticated users.
-- Each user can have multiple subscriptions (one per browser/device).
-- The (user_id, endpoint) pair is unique: a device can only be registered once
-- per user, and duplicate registrations are handled via UPSERT in the service layer.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id        BIGSERIAL    PRIMARY KEY,
  user_id   VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint  TEXT         NOT NULL,
  auth      TEXT         NOT NULL,
  p256dh    TEXT         NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_push_sub_user_endpoint UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
