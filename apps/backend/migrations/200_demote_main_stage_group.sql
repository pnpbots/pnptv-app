-- Demote the Main Stage hangout group: clear is_main flag.
-- The group row is preserved to keep chat history and members intact.
UPDATE hangout_groups SET is_main = FALSE WHERE is_main = TRUE;
