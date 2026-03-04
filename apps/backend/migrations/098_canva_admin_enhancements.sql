-- Migration 098: Canva Admin Enhancements
-- Add export_url, started_at, completed_at columns to canva_export_jobs

ALTER TABLE canva_export_jobs ADD COLUMN IF NOT EXISTS export_url TEXT;
ALTER TABLE canva_export_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE canva_export_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
