-- Tip goal per live stream session
ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS tip_goal_amount    NUMERIC(10,2)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tip_goal_label     VARCHAR(120)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tip_goal_progress  NUMERIC(10,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_goal_completed BOOLEAN        NOT NULL DEFAULT FALSE;
