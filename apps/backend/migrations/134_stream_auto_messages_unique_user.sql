-- Add UNIQUE constraint on user_id for proper UPSERT support
ALTER TABLE stream_auto_messages ADD CONSTRAINT stream_auto_messages_user_id_unique UNIQUE (user_id);
