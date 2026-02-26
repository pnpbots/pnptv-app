'use strict';

const { NodeOAuthClient } = require('@atproto/oauth-client-node');
const { JoseKey } = require('@atproto/jwk-jose');
const { Agent } = require('@atproto/api');
const crypto = require('crypto');
const { getRedis } = require('../../config/redis');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PUBLIC_URL = process.env.ATPROTO_PUBLIC_URL || 'https://pnptv.app';
const CLIENT_METADATA_PATH = '/oauth/client-metadata.json';
const CALLBACK_PATH = '/oauth/callback';
const JWKS_PATH = '/oauth/jwks.json';

const REDIS_STATE_PREFIX = 'atproto:state:';
const REDIS_STATE_TTL = 600; // 10 minutes — PAR request_uri expires in 5 min

const REDIS_LOCK_PREFIX = 'atproto:lock:';
const REDIS_LOCK_TTL = 30; // 30 seconds for token refresh lock

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let oauthClient = null;
let clientKeyset = null;

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

/**
 * Load or generate the ES256 private key used for confidential client auth.
 * The key is stored in ATPROTO_PRIVATE_KEY_ES256 env var as a JWK JSON string.
 * If not set, the client operates as a public client (token_endpoint_auth_method: none).
 */
async function loadKeyset() {
  const rawKey = process.env.ATPROTO_PRIVATE_KEY_ES256;
  if (!rawKey) {
    logger.info('[ATProto] No ATPROTO_PRIVATE_KEY_ES256 set — running as public OAuth client');
    return null;
  }

  try {
    const key = await JoseKey.fromImportable(rawKey, 'pnptv-key-1');
    logger.info('[ATProto] ES256 keyset loaded successfully');
    return [key];
  } catch (err) {
    logger.error('[ATProto] Failed to load ES256 key:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Client Metadata
// ---------------------------------------------------------------------------

function buildClientMetadata(keyset) {
  const clientId = `${PUBLIC_URL}${CLIENT_METADATA_PATH}`;
  const isConfidential = !!keyset;

  const metadata = {
    client_id: clientId,
    client_name: 'PNPtv!',
    client_uri: PUBLIC_URL,
    logo_uri: `${PUBLIC_URL}/pnptv-logo.png`,
    tos_uri: `${PUBLIC_URL}/terms`,
    policy_uri: `${PUBLIC_URL}/privacy`,
    redirect_uris: [`${PUBLIC_URL}${CALLBACK_PATH}`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };

  if (isConfidential) {
    metadata.token_endpoint_auth_method = 'private_key_jwt';
    metadata.token_endpoint_auth_signing_alg = 'ES256';
    metadata.jwks_uri = `${PUBLIC_URL}${JWKS_PATH}`;
  } else {
    metadata.token_endpoint_auth_method = 'none';
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// Redis-backed State Store (for OAuth state/PKCE during auth flow)
// ---------------------------------------------------------------------------

function createStateStore() {
  return {
    async set(key, internalState) {
      const redis = getRedis();
      const fullKey = `${REDIS_STATE_PREFIX}${key}`;
      await redis.set(fullKey, JSON.stringify(internalState), 'EX', REDIS_STATE_TTL);
    },

    async get(key) {
      const redis = getRedis();
      const fullKey = `${REDIS_STATE_PREFIX}${key}`;
      const raw = await redis.get(fullKey);
      if (!raw) return undefined;
      return JSON.parse(raw);
    },

    async del(key) {
      const redis = getRedis();
      const fullKey = `${REDIS_STATE_PREFIX}${key}`;
      await redis.del(fullKey);
    },
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL-backed Session Store (for persisted ATProto sessions keyed by DID)
// ---------------------------------------------------------------------------

function createSessionStore() {
  return {
    async set(sub, session) {
      const encrypted = encryptSessionData(JSON.stringify(session));
      await query(
        `INSERT INTO atproto_oauth_sessions (did, session_data_encrypted, session_iv, session_auth_tag, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (did)
         DO UPDATE SET session_data_encrypted = $2, session_iv = $3, session_auth_tag = $4, updated_at = NOW()`,
        [sub, encrypted.data, encrypted.iv, encrypted.authTag],
        { cache: false }
      );
    },

    async get(sub) {
      const result = await query(
        'SELECT session_data_encrypted, session_iv, session_auth_tag FROM atproto_oauth_sessions WHERE did = $1',
        [sub],
        { cache: false }
      );
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0];
      try {
        const decrypted = decryptSessionData(row.session_data_encrypted, row.session_iv, row.session_auth_tag);
        return JSON.parse(decrypted);
      } catch (err) {
        logger.error('[ATProto] Failed to decrypt session for DID:', sub, err);
        return undefined;
      }
    },

    async del(sub) {
      await query('DELETE FROM atproto_oauth_sessions WHERE did = $1', [sub], { cache: false });
    },
  };
}

// ---------------------------------------------------------------------------
// Encryption Helpers (AES-256-GCM for session data at rest)
// ---------------------------------------------------------------------------

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  // Must be exactly 64 hex characters (= 32 bytes for AES-256)
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(key, 'hex');
}

function encryptSessionData(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { data: encrypted, iv: iv.toString('hex'), authTag };
}

function decryptSessionData(encryptedHex, ivHex, authTagHex) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// Distributed Lock (Redis) for safe concurrent token refresh
// ---------------------------------------------------------------------------

function createRequestLock() {
  return async (key, fn) => {
    const redis = getRedis();
    const lockKey = `${REDIS_LOCK_PREFIX}${key}`;
    const lockValue = crypto.randomUUID();

    // Spin-wait to acquire lock (max ~5s)
    let acquired = false;
    for (let i = 0; i < 50; i++) {
      const result = await redis.set(lockKey, lockValue, 'EX', REDIS_LOCK_TTL, 'NX');
      if (result === 'OK') {
        acquired = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!acquired) {
      throw new Error(`[ATProto] Could not acquire lock for key: ${key}`);
    }

    try {
      return await fn();
    } finally {
      // Release lock only if we still own it (compare-and-delete)
      const current = await redis.get(lockKey);
      if (current === lockValue) {
        await redis.del(lockKey);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Initialize the NodeOAuthClient singleton
// ---------------------------------------------------------------------------

async function getClient() {
  if (oauthClient) return oauthClient;

  // Validate encryption key at startup — fail fast if misconfigured
  getEncryptionKey();

  clientKeyset = await loadKeyset();
  const metadata = buildClientMetadata(clientKeyset);

  const opts = {
    clientMetadata: metadata,
    stateStore: createStateStore(),
    sessionStore: createSessionStore(),
    requestLock: createRequestLock(),
    // Session lifecycle hooks (called by SessionGetter internally)
    onUpdate(sub, session) {
      logger.info('[ATProto] Session tokens refreshed', { sub });
    },
    onDelete(sub, cause) {
      logger.warn('[ATProto] Session deleted', { sub, cause: cause?.constructor?.name });
      // Clean up the local user link if the session was revoked
      handleSessionDeletion(sub).catch((err) =>
        logger.error('[ATProto] Error handling session deletion:', err)
      );
    },
  };

  if (clientKeyset) {
    opts.keyset = clientKeyset;
  }

  // Build client — only assign singleton after successful construction
  const client = new NodeOAuthClient(opts);

  logger.info('[ATProto] OAuth client initialized', {
    clientId: metadata.client_id,
    isConfidential: !!clientKeyset,
  });

  oauthClient = client;
  return oauthClient;
}

// ---------------------------------------------------------------------------
// Handle Resolution  (handle → DID)
// ---------------------------------------------------------------------------

/**
 * Resolve an AT Protocol handle to a DID.
 * Attempts DNS TXT first, then falls back to HTTPS well-known.
 */
async function resolveHandle(handle) {
  // Strip leading @ if present
  const cleanHandle = handle.replace(/^@/, '');

  // The @atproto/oauth-client-node handles resolution internally via authorize(),
  // but we expose a standalone resolver for pre-validation and UI feedback.

  const { default: fetch } = await import('node-fetch').catch(() => {
    // Fallback to global fetch if node-fetch isn't installed
    return { default: globalThis.fetch };
  });

  // Method A: HTTPS well-known (simpler for server-side, DNS requires dig)
  try {
    const url = `https://${cleanHandle}/.well-known/atproto-did`;
    const res = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const did = (await res.text()).trim();
      if (did.startsWith('did:')) {
        return { did, handle: cleanHandle, method: 'https' };
      }
    }
  } catch (err) {
    logger.debug('[ATProto] HTTPS handle resolution failed:', err.message);
  }

  // Method B: DNS TXT _atproto.<handle> via DNS-over-HTTPS (Cloudflare)
  try {
    const dnsUrl = `https://cloudflare-dns.com/dns-query?name=_atproto.${cleanHandle}&type=TXT`;
    const res = await fetch(dnsUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      for (const answer of json.Answer || []) {
        const txt = (answer.data || '').replace(/"/g, '').trim();
        if (txt.startsWith('did=')) {
          const did = txt.slice(4);
          if (did.startsWith('did:')) {
            return { did, handle: cleanHandle, method: 'dns' };
          }
        }
      }
    }
  } catch (err) {
    logger.debug('[ATProto] DNS handle resolution failed:', err.message);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Session Lifecycle — link ATProto DID to PNPtv user
// ---------------------------------------------------------------------------

/**
 * After a successful ATProto OAuth callback, link the DID to the PNPtv user.
 * If the user already has a Telegram session, merge into hybrid session.
 */
async function linkAtprotoToUser(did, handle, pdsUrl, expressSession) {
  // Check if this DID is already linked to any user
  const existing = await query(
    'SELECT id FROM users WHERE atproto_did = $1',
    [did],
    { cache: false }
  );

  let userId;

  if (existing.rows.length > 0) {
    // DID already linked — update handle/pds if changed
    userId = existing.rows[0].id;
    await query(
      `UPDATE users SET atproto_handle = $1, atproto_pds_url = $2, updated_at = NOW() WHERE id = $3`,
      [handle, pdsUrl, userId],
      { cache: false }
    );
  } else if (expressSession?.user?.id) {
    // User is already logged in via Telegram — link ATProto DID to their account
    userId = expressSession.user.id;
    await query(
      `UPDATE users SET atproto_did = $1, atproto_handle = $2, atproto_pds_url = $3, updated_at = NOW() WHERE id = $4`,
      [did, handle, pdsUrl, userId],
      { cache: false }
    );
    logger.info('[ATProto] Linked DID to existing Telegram user', { userId, did });
  } else {
    // No existing user — create a new "atproto-only" user record
    const result = await query(
      `INSERT INTO users (id, username, atproto_did, atproto_handle, atproto_pds_url, subscription_status, tier, status, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'free', 'free', 'active', 'user', NOW(), NOW())
       RETURNING id`,
      [
        crypto.randomUUID(),
        handle, // Use ATProto handle as initial username
        did,
        handle,
        pdsUrl,
      ],
      { cache: false }
    );
    userId = result.rows[0].id;
    logger.info('[ATProto] Created new user from ATProto login', { userId, did, handle });
  }

  return userId;
}

/**
 * Build a hybrid session object for req.session.user
 * Merges Telegram data (if present) with ATProto data.
 */
async function buildHybridSession(userId, did, handle) {
  const result = await query(
    `SELECT id, telegram, username, email, subscription_status, tier, terms_accepted,
            first_name, language, COALESCE(age_verified, false) as age_verified,
            COALESCE(role, 'user') as role, atproto_did, atproto_handle, atproto_pds_url
     FROM users WHERE id = $1`,
    [userId],
    { cache: false }
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  return {
    id: user.id,
    telegramId: user.telegram || null,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    language: user.language,
    subscription_status: user.subscription_status,
    tier: user.tier,
    terms_accepted: user.terms_accepted,
    age_verified: user.age_verified,
    role: user.role,
    // ATProto fields
    atproto_did: user.atproto_did || did,
    atproto_handle: user.atproto_handle || handle,
    atproto_pds_url: user.atproto_pds_url,
    // Auth method flags
    auth_methods: {
      telegram: !!user.telegram,
      atproto: !!did,
    },
  };
}

/**
 * Handle session deletion (token revocation / expiry).
 * Does NOT delete the user — just clears the session from DB.
 */
async function handleSessionDeletion(did) {
  logger.info('[ATProto] Cleaning up revoked session', { did });
  // The sessionStore.del() already handles DB cleanup
  // Optionally update user status
  await query(
    `UPDATE users SET updated_at = NOW() WHERE atproto_did = $1`,
    [did],
    { cache: false }
  );
}

/**
 * Restore an ATProto session for API calls.
 * Returns an @atproto/api Agent bound to the user's DPoP session.
 */
async function restoreSession(did) {
  const client = await getClient();
  const oauthSession = await client.restore(did);
  return new Agent(oauthSession);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getClient,
  buildClientMetadata,
  resolveHandle,
  linkAtprotoToUser,
  buildHybridSession,
  restoreSession,
  handleSessionDeletion,
  CLIENT_METADATA_PATH,
  CALLBACK_PATH,
  JWKS_PATH,
  PUBLIC_URL,
};
