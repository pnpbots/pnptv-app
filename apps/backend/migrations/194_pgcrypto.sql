-- 194_pgcrypto.sql
-- Enable pgcrypto so DB functions that use gen_random_bytes() work on fresh
-- environments. The repo's generate_creator_code() function calls
-- gen_random_bytes(9) and silently rolls back its enclosing transaction when
-- the extension is missing — this migration removes that footgun.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
