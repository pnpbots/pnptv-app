-- 225_dm_post_card.sql
-- Add message_type + meta columns to direct_messages so shared feed posts,
-- forwarded hangout post_cards, etc. render with full context (author header,
-- media thumbnail, link to original post) rather than falling back to plain
-- text with a URL.
--
-- Mirrors the chat_messages shape already supporting message_type='post_card'
-- with meta JSONB { postId, snapshot: { authorUsername, authorFirstName,
-- content, mediaUrl, mediaType, note } }.

BEGIN;

ALTER TABLE direct_messages
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS meta JSONB;

CREATE INDEX IF NOT EXISTS idx_dm_post_card
  ON direct_messages ((meta ->> 'postId'))
 WHERE message_type = 'post_card';

COMMENT ON COLUMN direct_messages.message_type IS
  'Message kind: text | post_card | future types. Defaults to text for back-compat.';
COMMENT ON COLUMN direct_messages.meta IS
  'Type-specific payload. For post_card: { postId, snapshot }.';

COMMIT;
