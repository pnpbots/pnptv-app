-- Migration 152: Add ab_test_mode column to x_auto_campaigns
-- This column was referenced in code but never created, making A/B test mode unreachable.

ALTER TABLE x_auto_campaigns ADD COLUMN IF NOT EXISTS ab_test_mode BOOLEAN NOT NULL DEFAULT FALSE;
