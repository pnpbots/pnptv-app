/**
 * BlockedUser Model
 * Tracks blocked user relationships for privacy
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class BlockedUser {
  /**
   * Block a user
   */
  static async blockUser(userId, userToBlockId) {
    if (userId === userToBlockId) {
      throw new Error('Cannot block yourself');
    }
    await query(
      `INSERT INTO blocked_users (user_id, blocked_user_id, blocked_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
      [userId, userToBlockId]
    );
  }

  /**
   * Unblock a user
   */
  static async unblockUser(userId, userToUnblockId) {
    await query(
      `DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2`,
      [userId, userToUnblockId]
    );
  }

  /**
   * Check if a user is blocked
   */
  static async isBlocked(userId, blockedUserId) {
    const result = await query(
      `SELECT 1 FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2 LIMIT 1`,
      [userId, blockedUserId]
    );
    return result.rowCount > 0;
  }

  /**
   * Get list of user IDs blocked by this user
   */
  static async getBlockedByUser(userId) {
    const result = await query(
      `SELECT blocked_user_id FROM blocked_users WHERE user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get all blocked relationships for a user (both directions)
   */
  static async getBlockedRelationships(userId) {
    const result = await query(
      `SELECT user_id, blocked_user_id, blocked_at
       FROM blocked_users
       WHERE user_id = $1 OR blocked_user_id = $1`,
      [userId]
    );
    return result.rows;
  }
}

module.exports = BlockedUser;
