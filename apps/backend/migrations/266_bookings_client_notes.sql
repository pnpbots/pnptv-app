-- Migration 266: client notes field on bookings + unique constraint on call_sessions
-- Adds a free-text field for members to describe their preferences before a private call.
-- Also enforces one session per booking at the DB level.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_notes TEXT;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_booking_id_unique UNIQUE (booking_id);
