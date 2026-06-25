-- Migration 279: campaign invite links
-- Adds prime_hours (grant N hours of PRIME on redemption) and
-- click_count (increment on every landing-page load) to invite_links.

ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS prime_hours INT NOT NULL DEFAULT 0;
ALTER TABLE invite_links ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0;
