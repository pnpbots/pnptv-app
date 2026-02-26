ALTER TABLE users
ADD COLUMN telegram_chat_id BIGINT NULL,
ADD COLUMN telegram_group_member BOOLEAN DEFAULT FALSE,
ADD COLUMN telegram_prime_member BOOLEAN DEFAULT FALSE,
ADD COLUMN telegram_joined_at TIMESTAMPTZ NULL;

-- Add index for faster lookups based on telegram_chat_id
CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON users (telegram_chat_id);