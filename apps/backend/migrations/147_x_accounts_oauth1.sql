ALTER TABLE x_accounts
  ADD COLUMN IF NOT EXISTS encrypted_access_token_secret TEXT,
  ADD COLUMN IF NOT EXISTS oauth_version VARCHAR(5) NOT NULL DEFAULT '2.0';

COMMENT ON COLUMN x_accounts.encrypted_access_token_secret IS 'OAuth 1.0a token secret (AES-encrypted). NULL for OAuth 2.0 accounts.';
COMMENT ON COLUMN x_accounts.oauth_version IS '2.0 = OAuth 2.0 PKCE (tokens expire), 1.0a = OAuth 1.0a (permanent tokens)';
