const crypto = require('crypto');
const { query } = require('../../../config/postgres');
const { cache, getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const emailService = require('../../../services/emailService');

const SYNAPSE_INTERNAL_URL = process.env.MATRIX_SYNAPSE_URL || 'http://synapse:8008';

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

/**
 * Escape LIKE/ILIKE metacharacters in a user-supplied search string.
 * PostgreSQL treats % (any sequence), _ (any single char), and \ (escape char)
 * as special. Without escaping, user-supplied values can widen or distort pattern matches.
 * The escaped value must be used with ESCAPE '\' in the SQL clause.
 */
const escapeLike = (str) => str.replace(/[%_\\]/g, '\\$&');

// Search users
const searchUsers = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { q = '', limit = 20 } = req.query;
  const lim = Math.min(Number(limit) || 20, 50);
  try {
    // Fetch viewer's block list and users who have blocked the viewer (bidirectional exclusion)
    const [viewerRecord, reverseBlockResult] = await Promise.all([
      UserModel.getById(user.id),
      query(
        `SELECT id FROM users WHERE $1 = ANY(blocked)`,
        [user.id]
      ),
    ]);

    const viewerBlocked = (viewerRecord?.blocked || []).map(String);
    const blockedByOthers = reverseBlockResult.rows.map(r => String(r.id));
    const excludeIds = [...new Set([...viewerBlocked, ...blockedByOthers])];

    const safeQ = escapeLike(q);
    const { rows } = await query(
      `SELECT id, username, first_name, last_name, photo_file_id, pnptv_id
       FROM users
       WHERE id != $1
         AND is_deleted = false
         AND (username ILIKE $2 ESCAPE '\\' OR first_name ILIKE $2 ESCAPE '\\' OR pnptv_id ILIKE $2 ESCAPE '\\')
         AND NOT (id = ANY($4::text[]))
       ORDER BY first_name ASC
       LIMIT $3`,
      [user.id, `%${safeQ}%`, lim, excludeIds]
    );
    return res.json({ success: true, users: rows });
  } catch (err) {
    logger.error('searchUsers error', err);
    return res.status(500).json({ error: 'Failed to search users' });
  }
};

// Delete own account (anonymise + deactivate, then fire confirmation email)
const deleteMyAccount = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const { rows } = await query(
      `SELECT email, first_name, language FROM users WHERE id = $1`,
      [user.id]
    );
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'User not found' });

    const anonUsername = `deleted_${Date.now()}`;
    // Anonymise the record in-place (soft delete + PII wipe).
    // Columns set here must exist on users — confirmed against live schema 2026-03-11:
    //   - photo_url and location do NOT exist; the real columns are photo_file_id,
    //     location_lat, location_lng, location_name, location_geohash.
    //   - is_deleted and deleted_at exist and must be set so feed/search queries
    //     using WHERE is_deleted = false exclude this record automatically.
    //   - Social media handles (instagram, twitter, x_id, x_username, etc.) are also
    //     PII that must be cleared.
    //   - PDS/Bluesky credentials contain private keys and must be cleared.
    await query(
      `UPDATE users SET
        username            = $2,
        first_name          = 'Deleted',
        last_name           = 'User',
        email               = NULL,
        photo_file_id       = NULL,
        bio                 = NULL,
        location_lat        = NULL,
        location_lng        = NULL,
        location_name       = NULL,
        location_geohash    = NULL,
        date_of_birth       = NULL,
        city                = NULL,
        country             = NULL,
        instagram           = NULL,
        twitter             = NULL,
        facebook            = NULL,
        tiktok              = NULL,
        youtube             = NULL,
        telegram            = NULL,
        x_id                = NULL,
        x_user_id           = NULL,
        x_username          = NULL,
        x_access_token_encrypted  = NULL,
        x_refresh_token_encrypted = NULL,
        atproto_password    = NULL,
        atproto_did         = NULL,
        atproto_handle      = NULL,
        atproto_pds_url     = NULL,
        canva_access_token_encrypted  = NULL,
        canva_refresh_token_encrypted = NULL,
        canva_user_id       = NULL,
        canva_display_name  = NULL,
        canva_connected_at  = NULL,
        canva_token_expires_at = NULL,
        x_token_expires_at  = NULL,
        card_token          = NULL,
        card_token_mask     = NULL,
        password_hash       = NULL,
        interests           = NULL,
        looking_for         = NULL,
        tribe               = NULL,
        ref_code            = NULL,
        last_login_method   = NULL,
        last_login_at       = NULL,
        is_active           = false,
        is_deleted          = true,
        deleted_at          = NOW(),
        updated_at          = NOW()
      WHERE id = $1`,
      [user.id, anonUsername]
    );

    // Flush all Redis keys that cache this user's data.
    // Without this, profile caches and geo presence survive for up to 10 minutes
    // after deletion, meaning the deleted account continues to appear in search
    // results and the nearby-users feed.
    await Promise.allSettled([
      cache.del(`user:${user.id}`),
      cache.del(`user:subscriptions:${user.id}`),
      // Remove from geo ZSET and per-user geo hash so the account disappears
      // from the Nearby feature immediately.
      cache.del(`geo:user:${user.id}`),
      cache.zrem('geo:users:online', user.id),
    ]);

    // Send confirmation email (fire-and-forget, before session destruction)
    if (record.email) {
      emailService.sendAccountDeletionConfirmationEmail({
        email: record.email,
        userName: record.first_name || 'Member',
        userLanguage: record.language || 'en',
      }).catch(() => {});
    }

    // Destroy session, clear cookie, then respond
    const sendResponse = () => {
      res.clearCookie('__pnptv_sid', {
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      return res.json({ success: true });
    };

    if (req.session) {
      req.session.destroy((err) => {
        if (err) logger.error('deleteMyAccount: session destroy error', { userId: user.id, err: err.message });
        sendResponse();
      });
    } else {
      sendResponse();
    }
  } catch (err) {
    logger.error('deleteMyAccount error', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
};

// ─── Right to be Forgotten — hard delete ──────────────────────────────────────

/**
 * Scan all session keys in Redis and delete any that belong to the target user.
 * Sessions are stored by connect-redis under keys `sess:<sessionId>` (no keyPrefix —
 * the session store uses a raw client, not the `cache` wrapper). Returns the count
 * of session keys deleted.
 *
 * @param {string} userId - The user's internal ID to match against session data
 * @returns {Promise<number>} Number of session keys deleted
 */
async function _purgeUserSessions(userId) {
  const redis = getRedis();
  let deletedCount = 0;
  try {
    // Sessions live outside the pnptv: keyPrefix namespace. We use the raw
    // client so ioredis does NOT prepend the configured keyPrefix.
    // Duplicate the client call using the underlying connection directly.
    const stream = redis.scanStream({ match: 'sess:*', count: 200 });

    const keysToDelete = [];
    for await (const batch of stream) {
      if (!batch.length) continue;
      // Raw GET on each session key to read the stored JSON
      const values = await redis.mget(...batch);
      for (let i = 0; i < batch.length; i++) {
        if (!values[i]) continue;
        try {
          const sessionData = JSON.parse(values[i]);
          // connect-redis stores: { cookie: {...}, user: { id: ... } }
          const sessionUserId = String(sessionData?.user?.id || sessionData?.userId || '');
          if (sessionUserId === String(userId)) {
            keysToDelete.push(batch[i]);
          }
        } catch {
          // Malformed session data — skip
        }
      }
    }

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      deletedCount = keysToDelete.length;
    }
  } catch (err) {
    logger.error('hardDeleteUser: _purgeUserSessions error', { userId, err: err.message });
  }
  return deletedCount;
}

/**
 * Deactivate a Matrix/Synapse user via the admin API with erase=true.
 * This instructs Synapse to redact all messages and purge the user account.
 * Returns { deactivated, erased, matrixUserId } or { deactivated: false } if skipped.
 *
 * @param {string|null} matrixUserId - e.g. "@pnptv_123456789:matrix.pnptv.app"
 * @returns {Promise<{deactivated: boolean, erased: boolean, matrixUserId: string|null}>}
 */
async function _deactivateMatrixUser(matrixUserId) {
  if (!matrixUserId) {
    return { deactivated: false, erased: false, matrixUserId: null };
  }

  const adminToken = process.env.MATRIX_ADMIN_TOKEN;
  if (!adminToken) {
    logger.warn('hardDeleteUser: MATRIX_ADMIN_TOKEN not set — skipping Matrix deactivation', { matrixUserId });
    return { deactivated: false, erased: false, matrixUserId };
  }

  // URL-encode the localpart+domain since it contains @ and :
  const encodedUserId = encodeURIComponent(matrixUserId);
  const url = `${SYNAPSE_INTERNAL_URL}/_synapse/admin/v1/deactivate/${encodedUserId}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ erase: true }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error('hardDeleteUser: Synapse deactivate failed', {
        matrixUserId,
        status: response.status,
        body,
      });
      return { deactivated: false, erased: false, matrixUserId };
    }

    logger.info('hardDeleteUser: Matrix user deactivated and erased', { matrixUserId });
    return { deactivated: true, erased: true, matrixUserId };
  } catch (err) {
    logger.error('hardDeleteUser: Synapse deactivate request error', { matrixUserId, err: err.message });
    return { deactivated: false, erased: false, matrixUserId };
  }
}

/**
 * Purge all Redis cache keys belonging to a user using cache.delPattern which
 * correctly applies the pnptv: keyPrefix. Returns total keys deleted.
 *
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function _purgeUserCacheKeys(userId) {
  const uid = String(userId);
  const patterns = [
    `user:${uid}*`,
    `ent:${uid}*`,
    `user_label:${uid}*`,
    `tier_check:${uid}*`,
    `geo:user:${uid}*`,
  ];

  let total = 0;
  const results = await Promise.allSettled(
    patterns.map((p) => cache.delPattern(p))
  );
  for (const result of results) {
    if (result.status === 'fulfilled') {
      total += result.value || 0;
    }
  }

  // Remove from geo sorted set — this key has no keyPrefix issue as it is
  // a global set, accessed via cache helper which applies the prefix correctly.
  try {
    const redis = getRedis();
    // geo:users:online is stored under pnptv:geo:users:online because ioredis
    // applies the keyPrefix. Using cache.zrem would be ideal but cache only
    // exposes del/get/set. Use raw client with the full prefixed key.
    const prefix = process.env.REDIS_KEY_PREFIX || 'pnptv:';
    await redis.zrem(`${prefix}geo:users:online`, uid);
    total += 1;
  } catch (err) {
    logger.error('hardDeleteUser: geo zrem error', { userId, err: err.message });
  }

  return total;
}

/**
 * Hard-delete a user account — the GDPR "Right to be Forgotten" erasure.
 *
 * Execution order:
 *   1. Fetch the user record (need matrix_user_id before the row is gone)
 *   2. Hard-DELETE from PostgreSQL (CASCADE handles all dependent tables)
 *   3. Deactivate + erase on Matrix Synapse
 *   4. Purge all Redis cache keys and active sessions
 *   5. Return a compliance receipt
 *
 * @param {string} userId   - The target user's internal UUID/ID
 * @param {string} actorId  - The admin's ID (or same as userId for self-erase)
 * @returns {Promise<object>} Compliance receipt object
 */
const hardDeleteUser = async (userId, actorId) => {
  const erasureId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  logger.info('hardDeleteUser: initiating erasure', { erasureId, userId, actorId });

  // 1. Fetch user record before deletion (we need matrix_user_id)
  const { rows } = await query(
    `SELECT id, matrix_user_id, matrix_access_token, matrix_device_id, email, first_name
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  const userRecord = rows[0];

  // 2. PostgreSQL hard delete — FK CASCADE takes care of all child rows.
  //    The cascade relationships confirmed in migration 139 cover:
  //    user_entitlements, payments, social_posts, chat_messages (where user_id),
  //    direct_messages (sender_id / recipient_id with ON DELETE CASCADE),
  //    audit_logs, notifications, user_badges, hangout_memberships,
  //    event_rsvps, hangout_video_call_participants, user_follows, etc.
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  logger.info('hardDeleteUser: PostgreSQL row deleted', { erasureId, userId });

  // 3. Matrix Synapse deactivation (non-blocking — failure does not abort receipt)
  const matrixResult = await _deactivateMatrixUser(userRecord.matrix_user_id);

  // 4. Redis cleanup
  const cacheKeysDeleted = await _purgeUserCacheKeys(userId);
  const sessionKeysDeleted = await _purgeUserSessions(userId);
  const totalRedisKeys = cacheKeysDeleted + sessionKeysDeleted;

  logger.info('hardDeleteUser: Redis purged', {
    erasureId,
    userId,
    cacheKeysDeleted,
    sessionKeysDeleted,
  });

  // 5. Compliance receipt
  const receipt = {
    erasure_id: erasureId,
    user_id: userId,
    actor_id: actorId,
    timestamp,
    scope: {
      postgresql: {
        deleted: true,
        tables_cascaded: [
          'users',
          'user_entitlements',
          'payments',
          'social_posts',
          'chat_messages',
          'direct_messages',
          'audit_logs',
          'notifications',
          'user_badges',
          'hangout_memberships',
          'event_rsvps',
          'hangout_video_call_participants',
          'user_follows',
        ],
      },
      matrix: {
        deactivated: matrixResult.deactivated,
        erased: matrixResult.erased,
        user_id: matrixResult.matrixUserId,
      },
      redis: {
        keys_deleted: totalRedisKeys,
      },
    },
  };

  logger.info('hardDeleteUser: erasure complete', { erasureId, userId });
  return receipt;
};

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * DELETE /api/admin/users/:userId/erase
 * Admin-triggered hard delete. Requires admin role (enforced upstream by
 * requireAdminAccess middleware on the admin router).
 */
const adminEraseUser = async (req, res) => {
  const actor = req.session?.user || req.user;
  if (!actor) return res.status(401).json({ error: 'Not authenticated' });

  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  // Prevent admins from erasing themselves via this endpoint
  if (String(userId) === String(actor.id)) {
    return res.status(400).json({ error: 'Use /api/users/me/erase to erase your own account' });
  }

  try {
    const receipt = await hardDeleteUser(userId, actor.id);
    return res.status(200).json({ success: true, receipt });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'User not found' });
    }
    logger.error('adminEraseUser error', { userId, actorId: actor.id, err: err.message });
    return res.status(500).json({ error: 'Erasure failed' });
  }
};

/**
 * DELETE /api/users/me/erase
 * User-triggered hard delete (Right to be Forgotten). Requires the user to
 * supply their password or a one-time re-auth confirmation in the request body.
 *
 * Body: { confirm: "DELETE MY ACCOUNT" }
 *
 * The explicit confirmation string prevents accidental erasure from stale
 * frontend states or CSRF-adjacent conditions. No password re-check is
 * implemented here because the session already proves the user is authenticated
 * (session auth happens upstream). A CSRF token or the confirmation string is
 * the appropriate second factor for a web-session flow.
 */
const selfEraseAccount = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const { confirm } = req.body || {};
  if (confirm !== 'DELETE MY ACCOUNT') {
    return res.status(400).json({
      error: 'Confirmation required',
      detail: 'Send { "confirm": "DELETE MY ACCOUNT" } in the request body to proceed.',
    });
  }

  try {
    const receipt = await hardDeleteUser(user.id, user.id);

    // Destroy session after erasure — the user row is already gone
    const sendResponse = () => {
      res.clearCookie('__pnptv_sid', {
        path: '/',
        domain: process.env.NODE_ENV === 'production' ? '.pnptv.app' : undefined,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      return res.status(200).json({ success: true, receipt });
    };

    if (req.session) {
      req.session.destroy((err) => {
        if (err) logger.error('selfEraseAccount: session destroy error', { userId: user.id, err: err.message });
        sendResponse();
      });
    } else {
      sendResponse();
    }
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'User not found' });
    }
    logger.error('selfEraseAccount error', { userId: user.id, err: err.message });
    return res.status(500).json({ error: 'Erasure failed' });
  }
};

module.exports = { searchUsers, deleteMyAccount, hardDeleteUser, adminEraseUser, selfEraseAccount };
