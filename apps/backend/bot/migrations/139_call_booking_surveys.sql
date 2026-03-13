-- Migration 139: Call booking surveys (post-call rating & feedback)

CREATE TABLE IF NOT EXISTS call_booking_surveys (
  id          SERIAL PRIMARY KEY,
  credit_id   INT NOT NULL REFERENCES call_credits(id) ON DELETE CASCADE,
  member_id   VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id  VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (credit_id)
);

CREATE INDEX IF NOT EXISTS idx_call_booking_surveys_creator
  ON call_booking_surveys(creator_id);

CREATE INDEX IF NOT EXISTS idx_call_booking_surveys_member
  ON call_booking_surveys(member_id);
