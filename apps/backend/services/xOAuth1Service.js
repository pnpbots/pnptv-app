'use strict';

const crypto = require('crypto');
const axios = require('axios');
const db = require('../utils/db');
const logger = require('../utils/logger');
const { getRedis } = require('../config/redis');
const PaymentSecurityService = require('./paymentSecurityService');

const OAUTH1_REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const OAUTH1_ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';
const X_API_V2_ME = 'https://api.twitter.com/2/users/me';
const REQ_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REQ_TOKEN_KEY_PREFIX = 'oauth1:req_token:';

// ---------------------------------------------------------------------------
// RFC 3986 percent-encoding (stricter than encodeURIComponent)
// ---------------------------------------------------------------------------

function pctEncode(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// ---------------------------------------------------------------------------
// Build the OAuth 1.0a Authorization header
//
// @param {string} method    HTTP method in UPPERCASE (GET, POST, …)
// @param {string} url       Full request URL without query string
// @param {Object} extraParams  Additional request params to include in signature
//                              (for POST body params or GET query params that are part
//                               of the signed base string, e.g. form fields)
// @param {Object} credentials  { consumerKey, consumerSecret, accessToken, tokenSecret }
// ---------------------------------------------------------------------------

function buildAuthHeader(method, url, extraParams, credentials) {
  const { consumerKey, consumerSecret, accessToken, tokenSecret } = credentials;

  // 1. Collect OAuth params
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
  if (accessToken) {
    oauthParams.oauth_token = accessToken;
  }

  // 2. Merge all params for signature (OAuth params + extra request params)
  const allParams = Object.assign({}, extraParams || {}, oauthParams);

  // 3. Percent-encode each key and value, then sort alphabetically by encoded key
  const encodedPairs = Object.entries(allParams)
    .map(([k, v]) => [pctEncode(k), pctEncode(v)])
    .sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      // Identical keys: sort by value
      if (a[1] < b[1]) return -1;
      if (a[1] > b[1]) return 1;
      return 0;
    });

  // 4. Build parameter string
  const paramString = encodedPairs.map(([k, v]) => `${k}=${v}`).join('&');

  // 5. Build signature base string
  const baseString = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramString)}`;

  // 6. Build signing key
  const signingKey = `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret || '')}`;

  // 7. HMAC-SHA1
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  // 8. Build Authorization header value (only OAuth params + signature, not extra request params)
  oauthParams.oauth_signature = signature;
  const headerParts = Object.entries(oauthParams)
    .map(([k, v]) => `${pctEncode(k)}="${pctEncode(v)}"`)
    .join(', ');

  return `OAuth realm="", ${headerParts}`;
}

// ---------------------------------------------------------------------------
// Get Request Token (step 1 of 3-legged OAuth 1.0a)
// ---------------------------------------------------------------------------

async function getRequestToken(credentials = {}) {
  const consumerKey = credentials.consumerKey || process.env.TWITTER_CONSUMER_KEY;
  const consumerSecret = credentials.consumerSecret || process.env.TWITTER_CONSUMER_SECRET;
  const callbackUri = process.env.TWITTER_OAUTH1_CALLBACK_URI;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Consumer key/secret not configured');
  }
  if (!callbackUri) {
    throw new Error('TWITTER_OAUTH1_CALLBACK_URI not configured');
  }

  const extraParams = { oauth_callback: callbackUri };
  const authHeader = buildAuthHeader('POST', OAUTH1_REQUEST_TOKEN_URL, extraParams, {
    consumerKey,
    consumerSecret,
    accessToken: null,
    tokenSecret: null,
  });

  let response;
  try {
    response = await axios.post(
      OAUTH1_REQUEST_TOKEN_URL,
      `oauth_callback=${pctEncode(callbackUri)}`,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const errBody = err.response?.data || err.message;
    logger.error('OAuth 1.0a request_token failed', { status: err.response?.status, body: errBody });
    throw new Error(`Twitter request_token failed: ${typeof errBody === 'string' ? errBody : JSON.stringify(errBody)}`);
  }

  const parsed = new URLSearchParams(response.data);
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');
  const callbackConfirmed = parsed.get('oauth_callback_confirmed');

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error(`Twitter did not return oauth_token/oauth_token_secret: ${response.data}`);
  }
  if (callbackConfirmed !== 'true') {
    logger.warn('OAuth 1.0a: oauth_callback_confirmed is not true', { callbackConfirmed });
  }

  // Temporarily store the request token secret in Redis (needed during callback)
  try {
    const redis = getRedis();
    const key = `${REQ_TOKEN_KEY_PREFIX}${oauthToken}`;
    await redis.set(key, oauthTokenSecret, 'EX', REQ_TOKEN_TTL_SECONDS);
  } catch (redisErr) {
    logger.error('OAuth 1.0a: failed to store request token secret in Redis', { error: redisErr.message });
    throw new Error('Temporary state storage unavailable. Please try again.');
  }

  logger.info('OAuth 1.0a request token obtained', { oauthToken: oauthToken.substring(0, 8) + '...' });
  return { oauth_token: oauthToken, oauth_token_secret: oauthTokenSecret };
}

// ---------------------------------------------------------------------------
// Exchange request token + verifier for permanent access token (step 3)
// ---------------------------------------------------------------------------

async function getAccessToken(oauthToken, oauthVerifier, credentials = {}) {
  const consumerKey = credentials.consumerKey || process.env.TWITTER_CONSUMER_KEY;
  const consumerSecret = credentials.consumerSecret || process.env.TWITTER_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Consumer key/secret not configured');
  }

  // Retrieve the request token secret we stored during step 1
  let requestTokenSecret;
  try {
    const redis = getRedis();
    const key = `${REQ_TOKEN_KEY_PREFIX}${oauthToken}`;
    requestTokenSecret = await redis.get(key);
    if (requestTokenSecret) {
      // Consume it — single use
      await redis.del(key);
    }
  } catch (redisErr) {
    logger.warn('OAuth 1.0a: could not retrieve request token secret from Redis', { error: redisErr.message });
  }

  if (!requestTokenSecret) {
    throw new Error('OAuth 1.0a request token expired or not found. Please start the authorization flow again.');
  }

  const extraParams = {
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
  };
  const authHeader = buildAuthHeader('POST', OAUTH1_ACCESS_TOKEN_URL, extraParams, {
    consumerKey,
    consumerSecret,
    accessToken: oauthToken,
    tokenSecret: requestTokenSecret,
  });

  let response;
  try {
    response = await axios.post(
      OAUTH1_ACCESS_TOKEN_URL,
      `oauth_verifier=${pctEncode(oauthVerifier)}`,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const errBody = err.response?.data || err.message;
    logger.error('OAuth 1.0a access_token exchange failed', { status: err.response?.status, body: errBody });
    throw new Error(`Twitter access_token exchange failed: ${typeof errBody === 'string' ? errBody : JSON.stringify(errBody)}`);
  }

  const parsed = new URLSearchParams(response.data);
  const accessToken = parsed.get('oauth_token');
  const accessTokenSecret = parsed.get('oauth_token_secret');
  const userId = parsed.get('user_id');
  const screenName = parsed.get('screen_name');

  if (!accessToken || !accessTokenSecret) {
    throw new Error(`Twitter did not return permanent access tokens: ${response.data}`);
  }

  logger.info('OAuth 1.0a permanent access token obtained', {
    handle: screenName,
    userId: userId ? userId.substring(0, 6) + '...' : 'unknown',
  });

  // Fetch full user profile from v2 API to get display name
  let handle = screenName;
  let displayName = screenName;
  let xUserId = userId;

  try {
    const meAuthHeader = buildAuthHeader('GET', X_API_V2_ME, { 'user.fields': 'username,name' }, {
      consumerKey,
      consumerSecret,
      accessToken,
      tokenSecret: accessTokenSecret,
    });
    const meRes = await axios.get(`${X_API_V2_ME}?user.fields=username,name`, {
      headers: { Authorization: meAuthHeader },
      timeout: 15000,
    });
    const userData = meRes.data?.data;
    if (userData) {
      handle = userData.username || screenName;
      displayName = userData.name || screenName;
      xUserId = userData.id || userId;
    }
  } catch (meErr) {
    // Non-fatal — we already have screenName and userId from the access_token response
    logger.warn('OAuth 1.0a: v2 users/me failed, falling back to access_token response values', {
      handle: screenName,
      error: meErr.response?.data || meErr.message,
    });
  }

  return {
    accessToken,
    accessTokenSecret,
    xUserId: String(xUserId),
    handle: String(handle).replace(/^@/, '').trim(),
    displayName: String(displayName),
  };
}

// ---------------------------------------------------------------------------
// Persist OAuth 1.0a account to x_accounts table
// ---------------------------------------------------------------------------

async function saveAccount({ oauthToken, oauthTokenSecret, xUserId, handle, displayName, createdBy, consumerKeyRef = 'generic' }) {
  if (!handle) {
    throw new Error('X handle is required to save OAuth 1.0a account');
  }

  const encryptedToken = PaymentSecurityService.encryptSensitiveData({ accessToken: oauthToken });
  if (!encryptedToken) {
    throw new Error('Failed to encrypt OAuth 1.0a access token');
  }

  const encryptedSecret = PaymentSecurityService.encryptSensitiveData({ accessToken: oauthTokenSecret });
  if (!encryptedSecret) {
    throw new Error('Failed to encrypt OAuth 1.0a token secret');
  }

  const upsertQuery = `
    INSERT INTO x_accounts (
      x_user_id,
      handle,
      display_name,
      encrypted_access_token,
      encrypted_access_token_secret,
      is_active,
      oauth_version,
      consumer_key_ref,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, TRUE, '1.0a', $6, $7)
    ON CONFLICT (handle) DO UPDATE SET
      encrypted_access_token = EXCLUDED.encrypted_access_token,
      encrypted_access_token_secret = EXCLUDED.encrypted_access_token_secret,
      is_active = TRUE,
      oauth_version = '1.0a',
      consumer_key_ref = EXCLUDED.consumer_key_ref,
      display_name = EXCLUDED.display_name,
      x_user_id = COALESCE(EXCLUDED.x_user_id, x_accounts.x_user_id),
      updated_at = NOW()
    RETURNING account_id, handle
  `;

  const result = await db.query(upsertQuery, [
    xUserId || null,
    handle,
    displayName || handle,
    encryptedToken,
    encryptedSecret,
    consumerKeyRef,
    createdBy || null,
  ]);

  const row = result.rows[0];
  if (!row) {
    throw new Error('x_accounts upsert returned no rows');
  }

  logger.info('OAuth 1.0a X account saved', { accountId: row.account_id, handle });
  return { accountId: row.account_id, handle };
}

module.exports = {
  buildAuthHeader,
  getRequestToken,
  getAccessToken,
  saveAccount,
};
