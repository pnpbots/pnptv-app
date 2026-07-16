-- Drop the redundant btree index on created_at; BRIN index already covers
-- time-range scans on this append-only table far more efficiently.
-- Each INSERT was maintaining 4 indexes; dropping this reduces it to 3.
DROP INDEX IF EXISTS idx_user_access_logs_created_at_btree;

-- Purge rows older than 90 days to bring the table back under control.
-- (Currently 2.6 GB / 5.37M rows accumulated with no retention policy.)
DELETE FROM user_access_logs WHERE created_at < NOW() - INTERVAL '90 days';

-- Reclaim freed space immediately (table was never vacuumed after mass growth).
VACUUM ANALYZE user_access_logs;
