const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const MODERATION_CONFIG = require('../config/moderationConfig');

/**
 * Warning Service - Manages user warnings and moderation history
 */
class WarningService {
  /**
   * Add a warning to a user
   * @param {Object} params - Warning parameters
   * @param {string} params.userId - User ID
   * @param {string} params.adminId - Admin ID who issued warning
   * @param {string} params.reason - Reason for warning
   * @param {string} params.groupId - Group ID
   * @returns {Promise<Object>} Warning details with action taken
   */
  static async addWarning({ userId, adminId, reason, groupId }) {
    try {
      // Insert warning into database
      await query(
        `INSERT INTO warnings (user_id, admin_id, reason, group_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId.toString(), adminId.toString(), reason, groupId.toString()]
      );

      // Get active warning count
      const warningCount = await this.getActiveWarningCount(userId);

      // Determine action based on warning count
      const action = MODERATION_CONFIG.WARNING_SYSTEM.ACTIONS[warningCount] ||
                     MODERATION_CONFIG.WARNING_SYSTEM.ACTIONS[3];

      logger.info('Warning added', { userId, adminId, reason, warningCount, action: action.type });

      return {
        warningCount,
        action,
        isMaxWarnings: warningCount >= MODERATION_CONFIG.WARNING_SYSTEM.MAX_WARNINGS,
      };
    } catch (error) {
      logger.error('Error adding warning:', error);
      throw error;
    }
  }

  /**
   * Get active warning count for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of active warnings
   */
  static async getActiveWarningCount(userId) {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() - MODERATION_CONFIG.WARNING_SYSTEM.WARNING_EXPIRY_DAYS);

      const result = await query(
        `SELECT COUNT(*) as count
         FROM warnings
         WHERE user_id = $1
         AND created_at > $2
         AND cleared = false`,
        [userId.toString(), expiryDate]
      );

      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      logger.error('Error getting warning count:', error);
      return 0;
    }
  }

  /**
   * Get all warnings for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of warnings
   */
  static async getUserWarnings(userId) {
    try {
      const result = await query(
        `SELECT w.*, u.username as admin_username
         FROM warnings w
         LEFT JOIN users u ON w.admin_id = u.id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC
         LIMIT 10`,
        [userId.toString()]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting user warnings:', error);
      return [];
    }
  }

  /**
   * Clear all warnings for a user
   * @param {string} userId - User ID
   * @param {string} adminId - Admin ID who cleared warnings
   * @returns {Promise<number>} Number of warnings cleared
   */
  static async clearWarnings(userId, adminId) {
    try {
      const result = await query(
        `UPDATE warnings
         SET cleared = true, cleared_by = $2, cleared_at = NOW()
         WHERE user_id = $1 AND cleared = false`,
        [userId.toString(), adminId.toString()]
      );

      logger.info('Warnings cleared', { userId, adminId, count: result.rowCount });
      return result.rowCount;
    } catch (error) {
      logger.error('Error clearing warnings:', error);
      throw error;
    }
  }

  /**
   * Record a moderation action
   * @param {Object} params - Action parameters
   * @returns {Promise<void>}
   */
  static async recordAction({ userId, adminId, action, reason, duration, groupId }) {
    try {
      // Calculate expires_at from duration (duration is in milliseconds)
      const expiresAt = duration ? new Date(Date.now() + duration) : null;

      await query(
        `INSERT INTO moderation_actions (user_id, moderator_id, action_type, reason, expires_at, group_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId.toString(), adminId.toString(), action, reason, expiresAt, groupId.toString()]
      );

      logger.info('Moderation action recorded', { userId, adminId, action, reason });
    } catch (error) {
      logger.error('Error recording moderation action:', error);
    }
  }

  /**
   * Check if user is muted
   * @param {string} userId - User ID
   * @param {string} groupId - Group ID
   * @returns {Promise<Object|null>} Mute info or null
   */
  static async getMuteStatus(userId, groupId) {
    try {
      const result = await query(
        `SELECT * FROM moderation_actions
         WHERE user_id = $1
         AND group_id = $2
         AND action_type = 'mute'
         AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId.toString(), groupId.toString()]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const mute = result.rows[0];
      const expiresAt = new Date(mute.expires_at);
      const duration = expiresAt.getTime() - new Date(mute.created_at).getTime();

      return {
        isMuted: true,
        reason: mute.reason,
        expiresAt,
        duration,
      };
    } catch (error) {
      logger.error('Error checking mute status:', error);
      return null;
    }
  }

  /**
   * Unmute a user
   * @param {string} userId - User ID
   * @param {string} adminId - Admin ID
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  static async unmute(userId, adminId, groupId) {
    try {
      // Set expires_at to NOW() to expire the mute immediately
      await query(
        `UPDATE moderation_actions
         SET expires_at = NOW(), updated_at = NOW()
         WHERE user_id = $1
         AND group_id = $2
         AND action_type = 'mute'
         AND expires_at > NOW()`,
        [userId.toString(), groupId.toString()]
      );

      await this.recordAction({
        userId,
        adminId,
        action: 'unmute',
        reason: 'Unmuted by admin',
        duration: null,
        groupId,
      });

      logger.info('User unmuted', { userId, adminId, groupId });
      return true;
    } catch (error) {
      logger.error('Error unmuting user:', error);
      return false;
    }
  }

  /**
   * Initialize database tables (run once on setup)
   */
  static async initializeTables() {
    try {
      // Create warnings table
      await query(`
        CREATE TABLE IF NOT EXISTS warnings (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          admin_id VARCHAR(255) NOT NULL,
          reason TEXT,
          group_id VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          cleared BOOLEAN DEFAULT false,
          cleared_by VARCHAR(255),
          cleared_at TIMESTAMP
        )
      `);

      // Create moderation_actions table
      await query(`
        CREATE TABLE IF NOT EXISTS moderation_actions (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL,
          group_id BIGINT,
          action_type VARCHAR(50) NOT NULL,
          reason TEXT,
          moderator_id BIGINT,
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      await query(`CREATE INDEX IF NOT EXISTS idx_warnings_user_id ON warnings(user_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_warnings_created_at ON warnings(created_at)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_moderation_actions_user_id ON moderation_actions(user_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_moderation_actions_group_id ON moderation_actions(group_id)`);

      logger.info('Moderation database tables initialized');
    } catch (error) {
      logger.error('Error initializing moderation tables:', error);
      throw error;
    }
  }
}

module.exports = WarningService;
