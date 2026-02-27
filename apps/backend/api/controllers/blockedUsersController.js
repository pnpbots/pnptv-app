const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Blocked Users Controller
 * Handles user blocking/unblocking functionality
 */

/**
 * Block a user
 * POST /api/webapp/users/block
 * Body: { blockedUserId }
 */
async function blockUser(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { blockedUserId } = req.body;

    if (!blockedUserId) {
      return res.status(400).json({
        success: false,
        error: 'blockedUserId is required'
      });
    }

    // Prevent self-blocking (also enforced by DB constraint)
    if (userId === blockedUserId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot block yourself'
      });
    }

    // Check if user exists
    const userCheck = await query(
      'SELECT id FROM users WHERE id = $1',
      [blockedUserId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Insert block (will fail if already blocked due to unique constraint)
    try {
      await query(
        'INSERT INTO blocked_users (user_id, blocked_user_id) VALUES ($1, $2)',
        [userId, blockedUserId]
      );

      logger.info(`User ${userId} blocked user ${blockedUserId}`);

      res.json({
        success: true,
        message: 'User blocked successfully'
      });
    } catch (err) {
      // If unique constraint violation, user is already blocked
      if (err.code === '23505') {
        return res.json({
          success: true,
          message: 'User already blocked'
        });
      }
      throw err;
    }

  } catch (error) {
    logger.error('Block user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to block user'
    });
  }
}

/**
 * Unblock a user
 * DELETE /api/webapp/users/unblock/:blockedUserId
 */
async function unblockUser(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { blockedUserId } = req.params;

    if (!blockedUserId) {
      return res.status(400).json({
        success: false,
        error: 'blockedUserId is required'
      });
    }

    const result = await query(
      'DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2 RETURNING id',
      [userId, blockedUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User was not blocked'
      });
    }

    logger.info(`User ${userId} unblocked user ${blockedUserId}`);

    res.json({
      success: true,
      message: 'User unblocked successfully'
    });

  } catch (error) {
    logger.error('Unblock user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unblock user'
    });
  }
}

/**
 * Get list of blocked users
 * GET /api/webapp/users/blocked
 */
async function getBlockedUsers(req, res) {
  try {
    const userId = req.session?.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const result = await query(
      `SELECT
        bu.id,
        bu.blocked_user_id,
        bu.blocked_at,
        u.username,
        u.first_name,
        u.photo_file_id
      FROM blocked_users bu
      JOIN users u ON bu.blocked_user_id = u.id
      WHERE bu.user_id = $1
      ORDER BY bu.blocked_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      blockedUsers: result.rows.map(row => ({
        id: row.blocked_user_id,
        username: row.username,
        firstName: row.first_name,
        photoUrl: row.photo_file_id,
        blockedAt: row.blocked_at
      })),
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Get blocked users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get blocked users'
    });
  }
}

/**
 * Check if a user is blocked
 * GET /api/webapp/users/is-blocked/:userId
 */
async function isUserBlocked(req, res) {
  try {
    const currentUserId = req.session?.user?.id;

    if (!currentUserId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { userId } = req.params;

    const result = await query(
      'SELECT id FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2',
      [currentUserId, userId]
    );

    res.json({
      success: true,
      isBlocked: result.rows.length > 0
    });

  } catch (error) {
    logger.error('Check blocked status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check blocked status'
    });
  }
}

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  isUserBlocked
};
