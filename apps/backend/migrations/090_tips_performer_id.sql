-- Add performer_id (UUID) column to pnp_tips so tipping works with PostgreSQL performers table
ALTER TABLE pnp_tips ADD COLUMN IF NOT EXISTS performer_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_pnp_tips_performer ON pnp_tips(performer_id);
