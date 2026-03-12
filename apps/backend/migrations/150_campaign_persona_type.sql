-- Migration 150: Add persona_type column to x_auto_campaigns
-- Supported values: 'santino' (dominant SXNTINX voice), 'lex' (submissive Lex voice), 'generic' (default PnP brand voice)
ALTER TABLE x_auto_campaigns
  ADD COLUMN IF NOT EXISTS persona_type VARCHAR(20) NOT NULL DEFAULT 'generic'
    CHECK (persona_type IN ('santino', 'lex', 'generic'));
