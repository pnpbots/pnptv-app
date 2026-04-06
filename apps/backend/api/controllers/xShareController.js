'use strict';

/**
 * xShareController.js
 *
 * HTTP handlers for sharing PNPtv social posts to X (Twitter) using the
 * authenticated user's own OAuth 2.0 PKCE tokens (stored in users table).
 *
 * Routes (registered in routes.js):
 *   GET  /api/social/x-status              — connection + scope status for the UI
 *   POST /api/webapp/social/posts/:postId/share-x — cross-post to X
 *
 * Token encryption:
 *   User tokens in the users table are encrypted with AES-256-GCM using the
 *   same encryptToken/decryptToken helpers that xOAuthRoutes.js uses — NOT
 *   PaymentSecurityService (which is AES-256-CBC and only used for x_accounts).
 *
 * Rate limit (enforced here via Redis):
 *   Max 25 cross-posts per user per 24-hour rolling window.
 */

const axios = require('axios');
const crypto = require('crypto');
const { query } = require('../../config/postgres');
const { getRedis } = require('../../config/redis');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const X_API_BASE = 'https://api.twitter.com/2';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_TOKEN_URL_ALT = 'https://api.x.com/2/oauth2/token';
const X_TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry
const X_MAX_TEXT_LENGTH = 280;
const CROSS_POST_DAILY_LIMIT = 25;
const PNPTV_APP_URL = 'https://pnptv.app';

// ---------------------------------------------------------------------------
// AES-256-GCM helpers — identical to those in xOAuthRoutes.js
// ---------------------------------------------------------------------------

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256).'
    );
  }
  return Buffer.from(raw, 'hex');
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

function encryptToken(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ data: encrypted, iv: iv.toString('hex'), authTag });
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the saved scope string includes tweet.write.
 * Handles both space-separated ('tweet.read tweet.write') and
 * comma-separated formats defensively.
 */
function hasWriteScope(scopeString) {
  if (!scopeString) return false;
  return scopeString.split(/[\s,]+/).includes('tweet.write');
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refreshes the user's X access token using their stored refresh token.
 * Updates the users row with the new encrypted tokens.
 * Returns the fresh access token string.
 */
async function refreshUserXTokens(userId, refreshTokenJson) {
  const clientId = process.env.WEBAPP_X_CLIENT_ID;
  const clientSecret = process.env.WEBAPP_X_CLIENT_SECRET;

  if (!clientId) {
    throw new Error('WEBAPP_X_CLIENT_ID is not configured');
  }

  const refreshToken = decryptToken(refreshTokenJson);

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (clientSecret) {
    const encodedId = encodeURIComponent(clientId);
    headers.Authorization = `Basic ${Buffer.from(`${encodedId}:${clientSecret}`).toString('base64')}`;
  }

  let tokenRes = null;
  let lastError = null;

  for (const endpoint of [X_TOKEN_URL, X_TOKEN_URL_ALT]) {
    try {
      tokenRes = await axios.post(endpoint, payload.toString(), { headers, timeout: 15000 });
      break;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (![400, 401, 403].includes(status)) break;
    }
  }

  if (!tokenRes) {
    const errData = lastError?.response?.data;
    throw new Error(
      `X token refresh failed: ${errData?.error_description || errData?.error || lastError?.message || 'unknown'}`
    );
  }

  const newAccessToken = tokenRes.data.access_token;
  const newRefreshToken = tokenRes.data.refresh_token || null;
  const expiresIn = tokenRes.data.expires_in || 7200;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
  const grantedScopes = tokenRes.data.scope || null;

  const encryptedAccess = encryptToken(newAccessToken);
  const encryptedRefresh = newRefreshToken ? encryptToken(newRefreshToken) : null;

  await query(
    `UPDATE users
     SET x_access_token_encrypted  = $1,
         x_refresh_token_encrypted = COALESCE($2, x_refresh_token_encrypted),
         x_token_expires_at        = $3,
         x_oauth_scopes            = COALESCE($4, x_oauth_scopes),
         updated_at                = NOW()
     WHERE id = $5`,
    [encryptedAccess, encryptedRefresh, newExpiresAt, grantedScopes, userId],
    { cache: false }
  );

  logger.info('[X Share] Token refreshed', { userId, newExpiresAt });
  return newAccessToken;
}

// ---------------------------------------------------------------------------
// Rate limit (Redis counter, 24-hour rolling window by UTC date)
// ---------------------------------------------------------------------------

async function checkAndIncrementRateLimit(userId) {
  const redis = getRedis();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const key = `pnptv:x_share:${userId}:${today}`;

  const count = await redis.incr(key);
  if (count === 1) {
    // New key — expire at midnight UTC
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    await redis.expire(key, ttl);
  }

  if (count > CROSS_POST_DAILY_LIMIT) {
    // Undo the increment — the share is not happening
    await redis.decr(key);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// POST text to X API v2
// ---------------------------------------------------------------------------

async function postTweetText(accessToken, text) {
  const response = await axios.post(
    `${X_API_BASE}/tweets`,
    { text },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// GET /api/social/x-status
//
// Returns whether the session user has X connected and whether tweet.write
// is in their stored scopes. The frontend uses this to decide:
//   connected=false         → show "Connect X" CTA
//   connected=true, !write  → show "Reconnect X" CTA (upgrade scopes)
//   connected=true, write   → show "Share to X" button
// ---------------------------------------------------------------------------

const getXStatus = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    const { rows } = await query(
      `SELECT x_username, x_user_id, x_oauth_scopes, x_access_token_encrypted,
              twitter, x_id
       FROM users WHERE id = $1`,
      [sessionUser.id],
      { cache: false }
    );

    const user = rows[0];
    // Not linked at all (neither new nor legacy columns)
    if (!user || (!user.x_user_id && !user.x_id && !user.twitter)) {
      return res.json({ success: true, status: { linked: false, hasWriteScope: false, handle: null } });
    }

    // Linked but token not saved yet (legacy users who connected before migration 125
    // or before token-save code was deployed) — prompt reconnect
    if (!user.x_access_token_encrypted) {
      return res.json({
        success: true,
        status: {
          linked: true,
          hasWriteScope: false,
          handle: user.x_username || user.twitter || null,
          scopesUnknown: true,
        },
      });
    }

    const write = hasWriteScope(user.x_oauth_scopes);

    return res.json({
      success: true,
      status: {
        linked: true,
        hasWriteScope: write,
        handle: user.x_username || user.twitter || null,
        scopesUnknown: user.x_oauth_scopes === null,
      },
    });
  } catch (err) {
    logger.error('[X Share] getXStatus error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch X status' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/social/posts/:postId/share-x
//
// Cross-posts the given PNPtv social post to the session user's X account.
// Only the post author may share their own post.
//
// Response shapes:
//   { success: true,  tweetId: '...', tweetUrl: '...' }
//   { success: true,  already_posted: true, tweetId: '...' }
//   { success: false, error: 'reconnect_required', message: '...' }  → scope issue
//   { success: false, error: '...' }                                 → other errors
// ---------------------------------------------------------------------------

const shareToX = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const postId = parseInt(req.params.postId, 10);
  if (!postId || isNaN(postId)) {
    return res.status(400).json({ success: false, error: 'Invalid post ID' });
  }

  try {
    // ── 1. Fetch user's X credentials from DB ──────────────────────────────
    const { rows: userRows } = await query(
      `SELECT x_user_id, x_username, x_access_token_encrypted,
              x_refresh_token_encrypted, x_token_expires_at, x_oauth_scopes
       FROM users
       WHERE id = $1`,
      [sessionUser.id],
      { cache: false }
    );

    const dbUser = userRows[0];

    if (!dbUser || !dbUser.x_user_id || !dbUser.x_access_token_encrypted) {
      return res.status(400).json({
        success: false,
        code: 'x_not_connected',
        error: 'Connect your X account first.',
      });
    }

    // ── 2. Verify tweet.write scope ────────────────────────────────────────
    if (!hasWriteScope(dbUser.x_oauth_scopes)) {
      return res.status(403).json({
        success: false,
        code: 'reconnect_required',
        error: 'Please reconnect X to enable posting. New permissions are required.',
      });
    }

    // ── 3. Fetch the social post ───────────────────────────────────────────
    const { rows: postRows } = await query(
      `SELECT id, user_id, content, media_type, media_url, media_urls, video_thumbnail_url FROM social_posts WHERE id = $1 AND is_deleted = false`,
      [postId],
      { cache: false }
    );

    if (postRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = postRows[0];

    if (post.user_id !== sessionUser.id) {
      return res.status(403).json({ success: false, error: 'You can only share your own posts' });
    }

    // ── 4. Check for duplicate cross-post (idempotency via log table) ──────
    const { rows: existingLog } = await query(
      `SELECT x_tweet_id, status FROM x_cross_post_log
       WHERE social_post_id = $1 AND user_id = $2`,
      [postId, sessionUser.id],
      { cache: false }
    );

    if (existingLog.length > 0 && existingLog[0].status === 'posted' && existingLog[0].x_tweet_id) {
      return res.json({
        success: true,
        already_posted: true,
        tweetId: existingLog[0].x_tweet_id,
        tweetUrl: `https://x.com/${dbUser.x_username}/status/${existingLog[0].x_tweet_id}`,
        message: 'This post has already been shared to X.',
      });
    }

    // ── 5. Rate limit: max 25 shares per user per 24 h ────────────────────
    const allowed = await checkAndIncrementRateLimit(sessionUser.id);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        code: 'rate_limit_exceeded',
        error: `You can share up to ${CROSS_POST_DAILY_LIMIT} posts per day. Try again tomorrow.`,
      });
    }

    // Insert a pending log row (upsert to handle retries after earlier failures)
    await query(
      `INSERT INTO x_cross_post_log (user_id, social_post_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (social_post_id, user_id) DO UPDATE SET status = 'pending', updated_at = NOW()`,
      [sessionUser.id, postId],
      { cache: false }
    );

    // ── 6. Resolve a valid access token (refresh if needed) ───────────────
    let accessToken;
    try {
      const expiresAt = dbUser.x_token_expires_at ? new Date(dbUser.x_token_expires_at) : null;
      // Treat missing expiry as expired so we attempt a refresh (safer than using a potentially stale token)
      const isExpired = !expiresAt || (expiresAt.getTime() - Date.now() <= X_TOKEN_EXPIRY_BUFFER_MS);

      if (isExpired) {
        if (!dbUser.x_refresh_token_encrypted) {
          throw new Error('Token expired and no refresh token available');
        }
        accessToken = await refreshUserXTokens(sessionUser.id, dbUser.x_refresh_token_encrypted);
      } else {
        accessToken = decryptToken(dbUser.x_access_token_encrypted);
      }
    } catch (tokenErr) {
      logger.warn('[X Share] Token error, updating log to failed', {
        userId: sessionUser.id,
        postId,
        error: tokenErr.message,
      });
      await query(
        `UPDATE x_cross_post_log SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE social_post_id = $2 AND user_id = $3`,
        [tokenErr.message, postId, sessionUser.id],
        { cache: false }
      );
      return res.status(401).json({
        success: false,
        code: 'reconnect_required',
        error: 'Your X session has expired. Please reconnect your account.',
      });
    }

    // ── 7. Build tweet text ────────────────────────────────────────────────
    // Reserve 24 chars for the PNPtv link (23 T.co-shortened + 1 space),
    // leaving 256 chars for the post content.
    const postLink = post.media_type === 'video'
      ? `${PNPTV_APP_URL}/v/${postId}`
      : `${PNPTV_APP_URL}/social/post/${postId}`;
    const linkLength = 24; // T.co wraps all links to 23 chars + 1 space separator
    const maxContent = X_MAX_TEXT_LENGTH - linkLength;

    let content = (post.content || '').trim();
    if (content.length > maxContent) {
      content = content.slice(0, maxContent - 1).trimEnd() + '\u2026'; // …
    }

    const tweetText = content ? `${content}\n${postLink}` : postLink;

    // ── 8. Post to X (with media upload if available) ────────────────────
    let xResponse;
    try {
      // Resolve media URL for native X upload (image or video thumbnail)
      // For video posts, upload the thumbnail image instead of the full video file —
      // it is much smaller, posts reliably, and the tweet text already includes the
      // /v/:id link so viewers can click through to watch on PNPtv.
      let mediaUrl = null;
      if (post.media_type === 'video' && post.video_thumbnail_url) {
        mediaUrl = post.video_thumbnail_url.startsWith('http')
          ? post.video_thumbnail_url
          : `${PNPTV_APP_URL}${post.video_thumbnail_url}`;
      } else if (post.media_url) {
        mediaUrl = post.media_url.startsWith('http')
          ? post.media_url
          : `${PNPTV_APP_URL}${post.media_url}`;
      } else if (post.media_urls) {
        try {
          const parsed = typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : post.media_urls;
          const first = Array.isArray(parsed) ? parsed[0] : null;
          const firstUrl = first?.url || first;
          if (firstUrl) {
            mediaUrl = firstUrl.startsWith('http') ? firstUrl : `${PNPTV_APP_URL}${firstUrl}`;
          }
        } catch (_) { /* ignore parse errors */ }
      }

      if (mediaUrl) {
        // Upload media natively to X for rich embedding
        const XPostService = require('../../services/xPostService');
        let mediaId = null;
        try {
          mediaId = await XPostService.uploadMediaToX({ accessToken, mediaUrl });
        } catch (uploadErr) {
          logger.warn('[X Share] Media upload failed, posting text-only', {
            postId, error: uploadErr.message,
          });
        }

        if (mediaId) {
          xResponse = await axios.post(
            `${X_API_BASE}/tweets`,
            { text: tweetText, media: { media_ids: [String(mediaId)] } },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 30000 }
          );
        } else {
          xResponse = await postTweetText(accessToken, tweetText);
        }
      } else {
        xResponse = await postTweetText(accessToken, tweetText);
      }
    } catch (xErr) {
      const status = xErr.response?.status;
      const xErrData = xErr.response?.data;

      // Scope error — user's token lacks tweet.write (shouldn't happen if DB is correct,
      // but X can revoke individual scopes)
      if (status === 403) {
        await query(
          `UPDATE x_cross_post_log SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE social_post_id = $2 AND user_id = $3`,
          ['403 Forbidden from X API — tweet.write scope may have been revoked', postId, sessionUser.id],
          { cache: false }
        );
        return res.status(403).json({
          success: false,
          code: 'reconnect_required',
          error: 'X posting permission was revoked. Please reconnect your account.',
        });
      }

      // Rate limited by X
      if (status === 429) {
        await query(
          `UPDATE x_cross_post_log SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE social_post_id = $2 AND user_id = $3`,
          ['X API rate limit (429)', postId, sessionUser.id],
          { cache: false }
        );
        return res.status(429).json({
          success: false,
          code: 'x_rate_limited',
          error: 'X is rate limiting posts right now. Please try again in a few minutes.',
        });
      }

      const errMsg = xErrData?.detail || xErrData?.title || xErr.message || 'X API error';
      logger.error('[X Share] X API post failed', {
        status,
        errData: xErrData,
        userId: sessionUser.id,
        postId,
      });

      await query(
        `UPDATE x_cross_post_log SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE social_post_id = $2 AND user_id = $3`,
        [String(errMsg).slice(0, 500), postId, sessionUser.id],
        { cache: false }
      );

      return res.status(502).json({
        success: false,
        code: 'x_api_error',
        error: 'Failed to post to X. Please try again.',
      });
    }

    const tweetId = xResponse?.data?.id;
    if (!tweetId) {
      logger.error('[X Share] X response missing tweet id', { xResponse, userId: sessionUser.id, postId });
      await query(
        `UPDATE x_cross_post_log SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE social_post_id = $2 AND user_id = $3`,
        ['X response did not include tweet id', postId, sessionUser.id],
        { cache: false }
      );
      return res.status(502).json({ success: false, code: 'x_api_error', error: 'Failed to post to X. Please try again.' });
    }

    // ── 9. Persist success to log ──────────────────────────────────────────
    await query(
      `UPDATE x_cross_post_log
       SET status = 'posted', x_tweet_id = $1, error_message = NULL, updated_at = NOW()
       WHERE social_post_id = $2 AND user_id = $3`,
      [tweetId, postId, sessionUser.id],
      { cache: false }
    );

    logger.info('[X Share] Cross-posted to X', {
      userId: sessionUser.id,
      xUsername: dbUser.x_username,
      postId,
      tweetId,
    });

    const xUsername = dbUser.x_username || 'user';
    return res.json({
      success: true,
      tweetId,
      tweetUrl: `https://x.com/${xUsername}/status/${tweetId}`,
    });
  } catch (err) {
    logger.error('[X Share] shareToX unexpected error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = { shareToX, getXStatus };
