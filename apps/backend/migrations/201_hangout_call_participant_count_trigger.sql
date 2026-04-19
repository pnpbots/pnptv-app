-- Keep hangout_video_calls.participant_count in sync with hangout_call_participants.
-- Single source of truth: the participants table. Counter is derived.
-- call_id is UUID (confirmed from 076_hangout_video_calls.sql).

CREATE OR REPLACE FUNCTION sync_hangout_call_participant_count()
RETURNS TRIGGER AS $$
DECLARE
  target_call_id UUID;
BEGIN
  target_call_id := COALESCE(NEW.call_id, OLD.call_id);
  UPDATE hangout_video_calls
  SET participant_count = (
    SELECT COUNT(*)::int
    FROM hangout_call_participants
    WHERE call_id = target_call_id AND left_at IS NULL
  )
  WHERE id = target_call_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_hangout_call_participant_count
  ON hangout_call_participants;
CREATE TRIGGER trg_sync_hangout_call_participant_count
AFTER INSERT OR UPDATE OF left_at OR DELETE ON hangout_call_participants
FOR EACH ROW
EXECUTE FUNCTION sync_hangout_call_participant_count();

-- One-shot reconciliation so existing active calls show correct count.
UPDATE hangout_video_calls v
SET participant_count = COALESCE((
  SELECT COUNT(*)::int FROM hangout_call_participants
  WHERE call_id = v.id AND left_at IS NULL
), 0);
