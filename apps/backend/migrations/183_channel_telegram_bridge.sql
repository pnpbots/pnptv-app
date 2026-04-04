-- Telegram Bridge: Link creator_channels to a Telegram channel for auto-mirroring
BEGIN;

ALTER TABLE creator_channels
  ADD COLUMN IF NOT EXISTS telegram_channel_id VARCHAR(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bridge_enabled BOOLEAN NOT NULL DEFAULT false;

-- Unique partial index: no two app channels can claim the same Telegram channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_channels_tg_id
  ON creator_channels (telegram_channel_id)
  WHERE telegram_channel_id IS NOT NULL;

COMMIT;
