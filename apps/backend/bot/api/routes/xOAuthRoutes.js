'use strict';

/**
 * Webapp X (Twitter) OAuth 2.0 PKCE Routes
 *
 * Mounts under /api/webapp/auth/x (registered in routes.js).
 *
 * GET /login   — Generate PKCE verifier/challenge, store state in Redis, redirect to X.
 * GET /callback — Exchange code for tokens, create/link user, set session, redirect to /app.
 *
 * Security model:
 *   - PKCE S256 is mandatory (X OAuth 2.0 requires it).
 *   - State + code_verifier are stored in Redis under x:oauth:state:<state> with a 10-minute TTL.
 *     They are NOT stored in the session cookie to prevent fixation attacks when the session
 *     is regenerated during the callback.
 *   - Tokens are encrypted at rest with AES-256-GCM before being persisted to PostgreSQL.
 *   - The callback endpoint is rate-limited separately from the login endpoint.
 *   - error_description from X is never reflected to the browser; only safe whitelisted codes.
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { getRedis } = require('../../../config/redis');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_TOKEN_URL_ALT = 'https://api.x.com/2/oauth2/token';
const X_USERINFO_URL = 'https://api.twitter.com/2/users/me';
const X_USERINFO_URL_ALT = 'https://api.x.com/2/users/me';
const X_SCOPE = 'tweet.read users.read offline.access';

const REDIS_STATE_PREFIX = 'x:oauth:state:';
const REDIS_STATE_TTL_SECONDS = 600; // 10 minutes

// Safe error codes that may be shown to the browser (X OAuth spec values).
const SAFE_X_ERROR_CODES = new Set([
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'invalid_request',
  'unsupported_response_type',
  'invalid_scope',
  'unauthorized_client',
]);

// ---------------------------------------------------------------------------
// Rate Limiters
// ---------------------------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: 'Too many X login attempts. Please try again later.' },
});

const callbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // More generous — legitimate redirects are server-initiated
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: 'Too many X callback requests. Please try again later.' },
});

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

function b64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption Helpers (same algorithm as atprotoOAuthService.js)
// ---------------------------------------------------------------------------

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256). ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(raw, 'hex');
}

function encryptToken(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ data: encrypted, iv: iv.toString('hex'), authTag });
}

function decryptToken(encryptedJson) {
  const { data, iv, authTag } = JSON.parse(encryptedJson);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// Redis State Store
// ---------------------------------------------------------------------------

async function storeOAuthState(state, payload) {
  const redis = getRedis();
  await redis.set(
    `${REDIS_STATE_PREFIX}${state}`,
    JSON.stringify(payload),
    'EX',
    REDIS_STATE_TTL_SECONDS
  );
}

async function consumeOAuthState(state) {
  const redis = getRedis();
  const key = `${REDIS_STATE_PREFIX}${state}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key); // consume — single-use
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// User upsert helper
// ---------------------------------------------------------------------------

/**
 * Find an existing user by x_user_id or x_username (twitter), or link to the
 * currently authenticated session user. Creates a new user as a last resort.
 * Returns { user, isNew }.
 */
async function findOrCreateXUser({ xUserId, xUsername, xName, accessToken, refreshToken, expiresAt, sessionUser }) {
  const COLS = `id, pnptv_id, first_name, last_name, username, email,
                subscription_status, tier, terms_accepted, photo_file_id, bio, language,
                telegram, twitter, x_id, x_user_id, x_username, role,
                atproto_did, atproto_handle, atproto_pds_url`;

  const encryptedAccess = encryptToken(accessToken);
  const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;

  // 1. If a session user already exists, link X to that account (merge identity).
  if (sessionUser?.id) {
    await query(
      `UPDATE users
       SET x_user_id = COALESCE(x_user_id, $1),
           x_username = $2,
           twitter = COALESCE(twitter, $2),
           x_id = COALESCE(x_id, $1),
           x_access_token_encrypted = $3,
           x_refresh_token_encrypted = COALESCE($4, x_refresh_token_encrypted),
           x_token_expires_at = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [xUserId, xUsername, encryptedAccess, encryptedRefresh, expiresAt, sessionUser.id]
    );

    const { rows } = await query(`SELECT ${COLS} FROM users WHERE id = $1`, [sessionUser.id]);
    return { user: rows[0], isNew: false };
  }

  // 2. Look up by stable numeric X user ID first.
  {
    const { rows } = await query(`SELECT ${COLS} FROM users WHERE x_user_id = $1`, [xUserId]);
    if (rows.length > 0) {
      const existing = rows[0];
      await query(
        `UPDATE users
         SET x_username = $1,
             twitter = COALESCE(twitter, $1),
             x_access_token_encrypted = $2,
             x_refresh_token_encrypted = COALESCE($3, x_refresh_token_encrypted),
             x_token_expires_at = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [xUsername, encryptedAccess, encryptedRefresh, expiresAt, existing.id]
      );
      const { rows: refreshed } = await query(`SELECT ${COLS} FROM users WHERE id = $1`, [existing.id]);
      return { user: refreshed[0], isNew: false };
    }
  }

  // 3. Fall back to twitter handle lookup (legacy column).
  {
    const { rows } = await query(`SELECT ${COLS} FROM users WHERE twitter = $1`, [xUsername]);
    if (rows.length > 0) {
      const existing = rows[0];
      await query(
        `UPDATE users
         SET x_user_id = COALESCE(x_user_id, $1),
             x_username = $2,
             x_id = COALESCE(x_id, $1),
             x_access_token_encrypted = $3,
             x_refresh_token_encrypted = COALESCE($4, x_refresh_token_encrypted),
             x_token_expires_at = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [xUserId, xUsername, encryptedAccess, encryptedRefresh, expiresAt, existing.id]
      );
      const { rows: refreshed } = await query(`SELECT ${COLS} FROM users WHERE id = $1`, [existing.id]);
      return { user: refreshed[0], isNew: false };
    }
  }

  // 4. No existing user — create a new account.
  const userId = uuidv4();
  const pnptvId = uuidv4();
  const [firstName, ...nameParts] = (xName || xUsername).split(' ');
  const lastName = nameParts.join(' ') || null;

  const { rows } = await query(
    `INSERT INTO users
       (id, pnptv_id, first_name, last_name, username, twitter, x_id, x_user_id, x_username,
        x_access_token_encrypted, x_refresh_token_encrypted, x_token_expires_at,
        subscription_status, tier, role, terms_accepted, is_active, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        'free', 'free', 'user', false, true, NOW(), NOW())
     RETURNING ${COLS}`,
    [
      userId, pnptvId, firstName || 'User', lastName, xUsername,
      xUsername, xUserId, xUserId, xUsername,
      encryptedAccess, encryptedRefresh, expiresAt,
    ]
  );

  logger.info(`[X OAuth] Created new user via X login: ${userId} (@${xUsername})`);
  return { user: rows[0], isNew: true };
}

// ---------------------------------------------------------------------------
// Session builder — consistent with webAppController.buildSession + auth_methods
// ---------------------------------------------------------------------------

function buildXSession(user, extra = {}) {
  return {
    id: user.id,
    pnptvId: user.pnptv_id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    subscriptionStatus: user.subscription_status,
    tier: user.tier || 'free',
    acceptedTerms: user.terms_accepted,
    photoUrl: user.photo_file_id,
    bio: user.bio,
    language: user.language,
    role: user.role || 'user',
    xHandle: user.x_username || user.twitter || null,
    // ATProto fields preserved so a hybrid session survives X login
    atproto_did: user.atproto_did || null,
    atproto_handle: user.atproto_handle || null,
    atproto_pds_url: user.atproto_pds_url || null,
    // Hybrid auth method flags
    auth_methods: {
      telegram: !!user.telegram,
      atproto: !!user.atproto_did,
      x: true,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// GET /login  — Initiate X OAuth 2.0 PKCE flow
// ---------------------------------------------------------------------------

router.get('/login', loginLimiter, async (req, res) => {
  try {
    const clientId = process.env.WEBAPP_X_CLIENT_ID;
    const redirectUri = process.env.WEBAPP_X_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      logger.error('[X OAuth] Missing WEBAPP_X_CLIENT_ID or WEBAPP_X_REDIRECT_URI');
      return res.status(503).json({ error: 'X login is not configured on this server.' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePkce();

    // Store state + verifier in Redis with 10-minute TTL (not in the session cookie).
    await storeOAuthState(state, {
      codeVerifier: verifier,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: X_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    logger.info('[X OAuth] Initiating PKCE flow', { state: state.slice(0, 8) + '...' });

    return res.redirect(`${X_AUTHORIZE_URL}?${params}`);
  } catch (err) {
    logger.error('[X OAuth] Login initiation failed:', err);
    return res.redirect('/?x_error=server_error');
  }
});

// ---------------------------------------------------------------------------
// GET /callback  — Exchange code, create/link user, establish session
// ---------------------------------------------------------------------------

router.get('/callback', callbackLimiter, async (req, res) => {
  const { code, state, error: xError } = req.query;

  // Never reflect error_description from X to the browser.
  if (xError) {
    logger.warn('[X OAuth] Authorization server returned error', {
      error: xError,
      errorDesc: req.query.error_description, // logged internally only
    });
    const safeCode = SAFE_X_ERROR_CODES.has(xError) ? xError : 'login_failed';
    return res.redirect(`/?x_error=${safeCode}`);
  }

  if (!code || !state) {
    logger.warn('[X OAuth] Callback missing required params', { hasCode: !!code, hasState: !!state });
    return res.redirect('/?x_error=invalid_request');
  }

  // Retrieve and consume the Redis state entry (single-use).
  let storedState;
  try {
    storedState = await consumeOAuthState(state);
  } catch (redisErr) {
    logger.error('[X OAuth] Redis state lookup failed:', redisErr);
    return res.redirect('/?x_error=server_error');
  }

  if (!storedState) {
    logger.warn('[X OAuth] State not found or already consumed', { state: state.slice(0, 8) + '...' });
    return res.redirect('/?x_error=state_mismatch');
  }

  const { codeVerifier } = storedState;

  const clientId = process.env.WEBAPP_X_CLIENT_ID;
  const clientSecret = process.env.WEBAPP_X_CLIENT_SECRET;
  const redirectUri = process.env.WEBAPP_X_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    logger.error('[X OAuth] Missing client configuration in callback');
    return res.redirect('/?x_error=server_error');
  }

  // ---------------------------------------------------------------------------
  // Token exchange — try twitter.com then x.com endpoint, try Basic auth then PKCE-only
  // ---------------------------------------------------------------------------

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });

  const tryTokenExchange = async (endpoint, useBasicAuth) => {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    const config = { headers };

    if (useBasicAuth && clientSecret) {
      // X expects URL-encoded client_id when it contains non-alphanumeric chars in Basic auth.
      const encodedId = encodeURIComponent(clientId);
      config.headers = {
        ...headers,
        Authorization: `Basic ${Buffer.from(`${encodedId}:${clientSecret}`).toString('base64')}`,
      };
    }

    return axios.post(endpoint, tokenBody.toString(), config);
  };

  let tokenRes = null;
  let lastError = null;
  const endpoints = [X_TOKEN_URL, X_TOKEN_URL_ALT];
  const authModes = clientSecret ? [true, false] : [false];

  for (const endpoint of endpoints) {
    for (const useBasicAuth of authModes) {
      try {
        tokenRes = await tryTokenExchange(endpoint, useBasicAuth);
        break;
      } catch (tokenErr) {
        lastError = tokenErr;
        const status = tokenErr.response?.status;
        logger.warn('[X OAuth] Token exchange attempt failed', {
          endpoint,
          useBasicAuth,
          status,
          error: tokenErr.response?.data?.error,
        });
        // Only retry on auth errors; propagate network/server errors immediately.
        if (![400, 401, 403].includes(status)) {
          break;
        }
      }
    }
    if (tokenRes) break;
  }

  if (!tokenRes) {
    logger.error('[X OAuth] All token exchange attempts failed', {
      lastStatus: lastError?.response?.status,
      lastError: lastError?.response?.data?.error,
    });
    return res.redirect('/?x_error=token_exchange_failed');
  }

  const accessToken = tokenRes.data.access_token;
  const refreshToken = tokenRes.data.refresh_token || null;
  const expiresIn = tokenRes.data.expires_in || 7200; // X default is 2h
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // ---------------------------------------------------------------------------
  // Fetch X user profile
  // ---------------------------------------------------------------------------

  let xData;
  try {
    const profileRes = await axios.get(X_USERINFO_URL, {
      params: { 'user.fields': 'name,profile_image_url' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    xData = profileRes.data?.data;
  } catch {
    try {
      const profileRes = await axios.get(X_USERINFO_URL_ALT, {
        params: { 'user.fields': 'name,profile_image_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      xData = profileRes.data?.data;
    } catch (profileErr) {
      logger.error('[X OAuth] Failed to fetch user profile from X API:', profileErr.message);
      return res.redirect('/?x_error=profile_fetch_failed');
    }
  }

  if (!xData?.id || !xData?.username) {
    logger.error('[X OAuth] X user profile missing required fields', { xData });
    return res.redirect('/?x_error=profile_missing_fields');
  }

  const xUserId = String(xData.id);
  const xUsername = xData.username;
  const xName = xData.name || xUsername;

  // ---------------------------------------------------------------------------
  // Upsert user in database
  // ---------------------------------------------------------------------------

  let user, isNew;
  try {
    ({ user, isNew } = await findOrCreateXUser({
      xUserId,
      xUsername,
      xName,
      accessToken,
      refreshToken,
      expiresAt,
      sessionUser: req.session?.user || null,
    }));
  } catch (dbErr) {
    logger.error('[X OAuth] Database upsert failed:', dbErr);
    return res.redirect('/?x_error=server_error');
  }

  // ---------------------------------------------------------------------------
  // Build and persist session
  // ---------------------------------------------------------------------------

  req.session.user = buildXSession(user);

  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  } catch (sessionErr) {
    logger.error('[X OAuth] Session save failed:', sessionErr);
    return res.redirect('/?x_error=session_failed');
  }

  logger.info('[X OAuth] Login successful', {
    userId: user.id,
    xUsername,
    isNew,
    authMethods: req.session.user.auth_methods,
  });

  return res.redirect('https://app.pnptv.app');
});

module.exports = router;
