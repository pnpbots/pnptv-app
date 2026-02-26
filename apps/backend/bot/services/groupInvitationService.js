const crypto = require('crypto');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

/**
 * Group Invitation Service
 * Generates and manages one-time use invitation links for group access
 */
class GroupInvitationService {
  /**
   * Generate a unique one-time group invitation token
   * @param {Object} params - Invitation parameters
   * @param {string} params.userId - User ID
   * @param {string} params.groupType - Group type (free, premium, vip)
   * @returns {Promise<{token: string, link: string}>} Generated token and link
   */
  static async generateInvitation({ userId, groupType = 'free' }) {
    try {
      // Generate a secure random token (32 bytes = 64 hex chars)
      const token = crypto.randomBytes(32).toString('hex');

      // Store invitation in database with 24-hour expiration
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const invitationLink = this.getInvitationLink(token);

      const result = await query(
        `INSERT INTO group_invitations
         (token, user_id, group_type, expires_at, invitation_link, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING token, invitation_link`,
        [token, userId, groupType, expiresAt, invitationLink]
      );

      if (result.rows.length === 0) {
        throw new Error('Failed to create invitation');
      }

      logger.info('Group invitation generated', {
        userId,
        groupType,
        tokenPrefix: token.substring(0, 8) + '...',
      });

      return {
        token: result.rows[0].token,
        link: result.rows[0].invitation_link,
      };
    } catch (error) {
      logger.error('Error generating group invitation:', error);
      throw error;
    }
  }

  /**
   * Verify and consume a one-time invitation token
   * @param {string} token - Invitation token
   * @returns {Promise<Object|null>} Invitation data if valid, null otherwise
   */
  static async verifyInvitation(token) {
    try {
      const result = await query(
        `SELECT * FROM group_invitations
         WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
        [token]
      );

      if (result.rows.length === 0) {
        logger.warn('Invalid or expired group invitation');
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error verifying group invitation:', error);
      return null;
    }
  }

  /**
   * Mark invitation as used
   * @param {string} token - Invitation token
   * @returns {Promise<boolean>} Success status
   */
  static async consumeInvitation(token) {
    try {
      const result = await query(
        `UPDATE group_invitations
         SET used = TRUE, used_at = NOW()
         WHERE token = $1 AND used = FALSE`,
        [token]
      );

      if (result.rowCount > 0) {
        logger.info('Group invitation consumed', {
          tokenPrefix: token.substring(0, 8) + '...',
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error consuming group invitation:', error);
      return false;
    }
  }

  /**
   * Get invitation link for a token
   * @param {string} token - Invitation token
   * @returns {string} Full invitation URL
   */
  static getInvitationLink(token) {
    const domain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
    return `${domain}/join-group/${token}`;
  }

  /**
   * Get user's invitation history
   * @param {string} userId - User ID
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} Array of invitations
   */
  static async getUserInvitations(userId, limit = 10) {
    try {
      const result = await query(
        `SELECT id, token, group_type, used, created_at, expires_at, used_at
         FROM group_invitations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching user invitations:', error);
      return [];
    }
  }

  /**
   * Clean up expired invitations (can be run periodically)
   * @returns {Promise<number>} Number of invitations deleted
   */
  static async cleanupExpiredInvitations() {
    try {
      const result = await query(
        `DELETE FROM group_invitations
         WHERE expires_at < NOW() OR (used = TRUE AND used_at < NOW() - INTERVAL '7 days')`
      );

      const deletedCount = result.rowCount;

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} expired group invitations`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up group invitations:', error);
      return 0;
    }
  }
}

module.exports = GroupInvitationService;
