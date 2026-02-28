-- Migration: 095_content_disclaimer
-- Purpose: Add content_disclaimer consent column to users table

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS content_disclaimer BOOLEAN NOT NULL DEFAULT FALSE;
