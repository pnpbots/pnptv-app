-- Migration 146: Add consecutive_failures column to x_auto_campaigns
-- Used for auto-pause logic: campaign is paused after 5 consecutive generation failures.
ALTER TABLE x_auto_campaigns
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
