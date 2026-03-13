-- Migration 154: Unify Bookings Schema
-- Adds a credit_id to the bookings table to link scheduled calls with purchased credits.
-- This is the first step towards deprecating the redundant call_bookings table.

ALTER TABLE bookings
ADD COLUMN credit_id INTEGER;

ALTER TABLE bookings
ADD CONSTRAINT fk_bookings_credit_id
FOREIGN KEY (credit_id) REFERENCES call_credits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_credit_id ON bookings(credit_id);
