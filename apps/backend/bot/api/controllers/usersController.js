const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const UserModel = require('../../../models/userModel');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

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

    const { rows } = await query(
      `SELECT id, username, first_name, last_name, photo_file_id, pnptv_id
       FROM users
       WHERE id != $1
         AND (username ILIKE $2 OR first_name ILIKE $2 OR pnptv_id ILIKE $2)
         AND NOT (id = ANY($4::text[]))
       ORDER BY first_name ASC
       LIMIT $3`,
      [user.id, `%${q}%`, lim, excludeIds]
    );
    return res.json({ success: true, users: rows });
  } catch (err) {
    logger.error('searchUsers error', err);
    return res.status(500).json({ error: 'Failed to search users' });
  }
};

module.exports = { searchUsers };
