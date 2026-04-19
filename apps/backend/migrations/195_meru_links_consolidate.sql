-- 195_meru_links_consolidate.sql
-- Consolidate all Meru payment links under the 'lifetime100' product. Both
-- the lifetime-pass and lifetime100 plans pull from the same shared link
-- pool, so tagging them under two product labels was just bookkeeping debt
-- (and made link availability checks miss valid codes).

UPDATE meru_payment_links
   SET product = 'lifetime100'
 WHERE product = 'lifetime-pass';

ALTER TABLE meru_payment_links
  ALTER COLUMN product SET DEFAULT 'lifetime100';
