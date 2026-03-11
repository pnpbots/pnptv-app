const { query } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');
const emailService = require('../../../services/emailService');

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
        canva_access_token_encrypted  = NULL,
        canva_refresh_token_encrypted = NULL,
        card_token          = NULL,
        card_token_mask     = NULL,
        password_hash       = NULL,
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

    // Destroy session
    if (req.session) {
      req.session.destroy(() => {});
    }

    // Send confirmation email (fire-and-forget)
    if (record.email) {
      emailService.sendAccountDeletionConfirmationEmail({
        email: record.email,
        userName: record.first_name || 'Member',
        userLanguage: record.language || 'en',
      }).catch(() => {});
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteMyAccount error', err);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
};

module.exports = { searchUsers, deleteMyAccount };
