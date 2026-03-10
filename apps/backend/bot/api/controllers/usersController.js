const { query } = require('../../../config/postgres');
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
    await query(
      `UPDATE users SET
        username = $2,
        first_name = 'Deleted',
        last_name = 'User',
        email = NULL,
        photo_file_id = NULL,
        photo_url = NULL,
        bio = NULL,
        location = NULL,
        date_of_birth = NULL,
        is_active = false
      WHERE id = $1`,
      [user.id, anonUsername]
    );

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
