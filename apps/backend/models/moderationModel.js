const { cache } = require('../config/redis');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Moderation Model - Handles all moderation data operations
 */
class ModerationModel {
  // ==================== GROUP SETTINGS ====================

  /**
   * Get default group settings
   */
  static async getGroupSettings(groupId) {
    try {
      const result = await query(
        `SELECT * FROM group_settings WHERE group_id = $1 LIMIT 1`,
        [groupId.toString()]
      );

      if (result.rows.length > 0) {
        // Map database columns to expected property names
        const row = result.rows[0];
        return {
          groupId: row.group_id,
          antiLinksEnabled: row.anti_links_enabled ?? true,
          antiSpamEnabled: row.anti_spam_enabled ?? true,
          antiFloodEnabled: row.anti_flood_enabled ?? true,
          profanityFilterEnabled: row.profanity_filter_enabled ?? true,
          maxWarnings: row.max_warnings ?? 3,
          floodLimit: row.flood_limit ?? 5,
          floodWindow: row.flood_window ?? 10,
          muteDuration: row.mute_duration ?? 3600,
          allowedDomains: row.allowed_domains || [],
          bannedWords: row.banned_words || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }

      // Return default settings if no custom settings exist
      return {
        groupId: groupId.toString(),
        antiLinksEnabled: true,
        antiSpamEnabled: true,
        antiFloodEnabled: true,
        profanityFilterEnabled: true,
        maxWarnings: 3,
        floodLimit: 5,
        floodWindow: 10,
        muteDuration: 3600,
        allowedDomains: [],
        bannedWords: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error getting group settings:', error);
      // Return default settings on error instead of null
      return {
        groupId: groupId.toString(),
        antiLinksEnabled: true,
        antiSpamEnabled: true,
        antiFloodEnabled: true,
        profanityFilterEnabled: true,
        maxWarnings: 3,
        floodLimit: 5,
        floodWindow: 10,
        muteDuration: 3600,
        allowedDomains: [],
        bannedWords: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  /**
   * Update group settings
   */
  static async updateGroupSettings(groupId, updates) {
    try {
      const result = await query(
        `UPDATE group_settings SET
         anti_links_enabled = $1,
         anti_spam_enabled = $2,
         anti_flood_enabled = $3,
         profanity_filter_enabled = $4,
         max_warnings = $5,
         flood_limit = $6,
         flood_window = $7,
         mute_duration = $8,
         allowed_domains = $9,
         banned_words = $10,
         updated_at = CURRENT_TIMESTAMP
         WHERE group_id = $11`,
        [
          updates.antiLinksEnabled,
          updates.antiSpamEnabled,
          updates.antiFloodEnabled,
          updates.profanityFilterEnabled,
          updates.maxWarnings,
          updates.floodLimit,
          updates.floodWindow,
          updates.muteDuration,
          updates.allowedDomains,
          updates.bannedWords,
          groupId.toString()
        ]
      );

      if (result.rowCount === 0) {
        // Insert new settings if none exist
        await query(
          `INSERT INTO group_settings (
            group_id, anti_links_enabled, anti_spam_enabled, anti_flood_enabled,
            profanity_filter_enabled, max_warnings, flood_limit, flood_window,
            mute_duration, allowed_domains, banned_words, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            groupId.toString(),
            updates.antiLinksEnabled,
            updates.antiSpamEnabled,
            updates.antiFloodEnabled,
            updates.profanityFilterEnabled,
            updates.maxWarnings,
            updates.floodLimit,
            updates.floodWindow,
            updates.muteDuration,
            updates.allowedDomains,
            updates.bannedWords
          ]
        );
      }

      return true;
    } catch (error) {
      logger.error('Error updating group settings:', error);
      return false;
    }
  }

  // ==================== USER WARNINGS ====================

  /**
   * Get user warnings
   */
  static async getUserWarnings(userId, groupId) {
    try {
      const result = await query(
        `SELECT w.*, u.username as admin_username
         FROM warnings w
         LEFT JOIN users u ON w.admin_id = u.id
         WHERE w.user_id = $1 AND w.group_id = $2
         ORDER BY w.created_at DESC
         LIMIT 10`,
        [userId.toString(), groupId.toString()]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting user warnings:', error);
      return [];
    }
  }

  /**
   * Add warning
   */
  static async addWarning(userId, groupId, reason, details = '') {
    try {
      await query(
        `INSERT INTO warnings (user_id, admin_id, group_id, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId.toString(), 'system', groupId.toString(), reason]
      );

      // Get active warning count
      const warningCount = await this.getActiveWarningCount(userId, groupId);

      return {
        userId: userId.toString(),
        groupId: groupId.toString(),
        warningCount,
        totalWarnings: warningCount
      };
    } catch (error) {
      logger.error('Error adding warning:', error);
      return { userId: userId.toString(), groupId: groupId.toString(), warnings: [], totalWarnings: 0 };
    }
  }

  /**
   * Get active warning count for a user
   */
  static async getActiveWarningCount(userId, groupId) {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() - 30); // 30 days expiry

      const result = await query(
        `SELECT COUNT(*) as count
         FROM warnings
         WHERE user_id = $1
         AND group_id = $2
         AND created_at > $3
         AND cleared = false`,
        [userId.toString(), groupId.toString(), expiryDate]
      );

      return parseInt(result.rows[0].count) || 0;
    } catch (error) {
      logger.error('Error getting warning count:', error);
      return 0;
    }
  }

  /**
   * Clear warnings
   */
  static async clearWarnings(userId, groupId) {
    try {
      await query(
        `UPDATE warnings
         SET cleared = true, cleared_at = NOW()
         WHERE user_id = $1 AND group_id = $2`,
        [userId.toString(), groupId.toString()]
      );
      return true;
    } catch (error) {
      logger.error('Error clearing warnings:', error);
      return false;
    }
  }

  /**
   * Get group warnings
   */
  static async getGroupWarnings(groupId, limit = 50) {
    try {
      const result = await query(
        `SELECT w.*, u.username as user_username, a.username as admin_username
         FROM warnings w
         LEFT JOIN users u ON w.user_id = u.id
         LEFT JOIN users a ON w.admin_id = a.id
         WHERE w.group_id = $1
         ORDER BY w.created_at DESC
         LIMIT $2`,
        [groupId.toString(), limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting group warnings:', error);
      return [];
    }
  }

  // ==================== BANNED USERS ====================

  /**
   * Ban user
   */
  static async banUser(userId, groupId, reason, bannedBy) {
    try {
      const result = await query(
        `INSERT INTO banned_users (user_id, group_id, reason, banned_by, banned_at, active)
         VALUES ($1, $2, $3, $4, NOW(), TRUE)
         ON CONFLICT (user_id, group_id)
         DO UPDATE SET 
            reason = EXCLUDED.reason,
            banned_by = EXCLUDED.banned_by,
            banned_at = NOW(),
            active = TRUE`,
        [userId.toString(), groupId.toString(), reason, bannedBy.toString()]
      );

      return {
        userId: userId.toString(),
        groupId: groupId.toString(),
        reason,
        bannedBy: bannedBy.toString(),
        bannedAt: new Date()
      };
    } catch (error) {
      logger.error('Error banning user:', error);
      return { userId: userId.toString(), groupId: groupId.toString(), reason, bannedBy: bannedBy.toString(), bannedAt: new Date() };
    }
  }

  /**
   * Unban user
   */
  static async unbanUser(userId, groupId) {
    try {
      await query(
        `UPDATE banned_users
         SET active = FALSE, expires_at = NOW()
         WHERE user_id = $1 AND group_id = $2`,
        [userId.toString(), groupId.toString()]
      );
      return true;
    } catch (error) {
      logger.error('Error unbanning user:', error);
      return false;
    }
  }

  /**
   * Check if user is banned
   */
  static async isUserBanned(userId, groupId) {
    try {
      // Try with 'active' column first, fall back to simpler query if column doesn't exist
      const result = await query(
        `SELECT COUNT(*) as count
         FROM banned_users
         WHERE user_id = $1 AND group_id = $2`,
        [userId.toString(), groupId.toString()]
      );

      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      // If table doesn't exist, user is not banned
      if (error.code === '42P01') {
        return false;
      }
      logger.error('Error checking ban status:', error);
      return false;
    }
  }

  /**
   * Get banned users
   */
  static async getBannedUsers(groupId) {
    try {
      const result = await query(
        `SELECT b.*, u.username as user_username
         FROM banned_users b
         LEFT JOIN users u ON b.user_id = u.id
         WHERE b.group_id = $1 AND b.active = TRUE
         ORDER BY b.banned_at DESC`,
        [groupId.toString()]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting banned users:', error);
      return [];
    }
  }

  // ==================== MODERATION LOGS ====================

  /**
   * Add moderation log
   */
  static async addLog(logData) {
    try {
      // Try with target_user_id column first
      const result = await query(
        `INSERT INTO moderation_logs (
          group_id, action, user_id, moderator_id, target_user_id, reason, details, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id`,
        [
          logData.groupId,
          logData.action,
          logData.userId,
          logData.moderatorId,
          logData.targetUserId,
          logData.reason,
          JSON.stringify(logData.details || {})
        ]
      );

      return result.rows[0].id;
    } catch (error) {
      // If target_user_id column doesn't exist, fall back to simpler insert
      if (error.code === '42703') { // Column does not exist error
        try {
          const fallbackResult = await query(
            `INSERT INTO moderation_logs (
              group_id, action, user_id, moderator_id, reason, details
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id`,
            [
              logData.groupId,
              logData.action,
              logData.userId,
              logData.moderatorId,
              logData.reason,
              JSON.stringify(logData.details || {})
            ]
          );
          return fallbackResult.rows[0].id;
        } catch (fallbackError) {
          logger.error('Error adding moderation log (fallback):', fallbackError);
          return null;
        }
      }
      logger.error('Error adding moderation log:', error);
      return null;
    }
  }

  /**
   * Get group logs
   */
  static async getGroupLogs(groupId, limit = 50) {
    try {
      const result = await query(
        `SELECT l.*,
                u.username as user_username,
                m.username as moderator_username,
                t.username as target_username
         FROM moderation_logs l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN users m ON l.moderator_id = m.id
         LEFT JOIN users t ON l.target_user_id = t.id
         WHERE l.group_id = $1
         ORDER BY l.created_at DESC
         LIMIT $2`,
        [groupId.toString(), limit]
      );

      return result.rows;
    } catch (error) {
      // If target_user_id column doesn't exist, fall back to simpler query
      if (error.code === '42703') {
        try {
          const fallbackResult = await query(
            `SELECT l.*,
                    u.username as user_username,
                    m.username as moderator_username
             FROM moderation_logs l
             LEFT JOIN users u ON l.user_id = u.id
             LEFT JOIN users m ON l.moderator_id = m.id
             WHERE l.group_id = $1
             ORDER BY COALESCE(l.created_at, l.timestamp) DESC
             LIMIT $2`,
            [groupId.toString(), limit]
          );
          return fallbackResult.rows;
        } catch (fallbackError) {
          logger.error('Error getting group logs (fallback):', fallbackError);
          return [];
        }
      }
      logger.error('Error getting group logs:', error);
      return [];
    }
  }

  /**
   * Get user logs
   */
  static async getUserLogs(userId, groupId, limit = 20) {
    try {
      const result = await query(
        `SELECT l.*,
                u.username as user_username,
                m.username as moderator_username,
                t.username as target_username
         FROM moderation_logs l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN users m ON l.moderator_id = m.id
         LEFT JOIN users t ON l.target_user_id = t.id
         WHERE (l.user_id = $1 OR l.target_user_id = $1)
           AND l.group_id = $2
         ORDER BY l.created_at DESC
         LIMIT $3`,
        [userId.toString(), groupId.toString(), limit]
      );

      return result.rows;
    } catch (error) {
      // If target_user_id column doesn't exist, fall back to simpler query
      if (error.code === '42703') {
        try {
          const fallbackResult = await query(
            `SELECT l.*,
                    u.username as user_username,
                    m.username as moderator_username
             FROM moderation_logs l
             LEFT JOIN users u ON l.user_id = u.id
             LEFT JOIN users m ON l.moderator_id = m.id
             WHERE l.user_id = $1
               AND l.group_id = $2
             ORDER BY COALESCE(l.created_at, l.timestamp) DESC
             LIMIT $3`,
            [userId.toString(), groupId.toString(), limit]
          );
          return fallbackResult.rows;
        } catch (fallbackError) {
          logger.error('Error getting user logs (fallback):', fallbackError);
          return [];
        }
      }
      logger.error('Error getting user logs:', error);
      return [];
    }
  }

  /**
   * Get group statistics
   */
  static async getGroupStatistics(groupId) {
    try {
      const [warningsResult, bansResult, recentResult, usersResult] = await Promise.all([
        query(`SELECT COUNT(*) as count FROM warnings WHERE group_id = $1 AND cleared = FALSE`, [groupId.toString()]),
        query(`SELECT COUNT(*) as count FROM banned_users WHERE group_id = $1 AND active = TRUE`, [groupId.toString()]),
        query(`SELECT COUNT(*) as count FROM moderation_logs WHERE group_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [groupId.toString()]),
        query(`SELECT COUNT(DISTINCT user_id) as count FROM warnings WHERE group_id = $1 AND cleared = FALSE`, [groupId.toString()])
      ]);

      return {
        totalWarnings: parseInt(warningsResult.rows[0].count) || 0,
        totalBans: parseInt(bansResult.rows[0].count) || 0,
        recentActions: parseInt(recentResult.rows[0].count) || 0,
        usersWithWarnings: parseInt(usersResult.rows[0].count) || 0,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error getting group statistics:', error);
      return {
        totalWarnings: 0,
        totalBans: 0,
        recentActions: 0,
        usersWithWarnings: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Invalidate cache
   */
  static async invalidateCache(groupId) {
    try {
      await cache.del(`moderation:settings:${groupId}`);
      await cache.del(`moderation:stats:${groupId}`);
      return true;
    } catch (error) {
      logger.error('Error invalidating cache:', error);
      return false;
    }
  }

  // ==================== USERNAME TRACKING ====================

  /**
   * Record username change
   */
  static async recordUsernameChange(userId, oldUsername, newUsername, groupId = null) {
    try {
      const result = await query(
        `INSERT INTO username_history (
          user_id, old_username, new_username, group_id, changed_at
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING id`,
        [userId.toString(), oldUsername, newUsername, groupId]
      );

      return result.rows[0].id;
    } catch (error) {
      logger.error('Error recording username change:', error);
      return null;
    }
  }

  /**
   * Get username history
   */
  static async getUsernameHistory(userId, limit = 20) {
    try {
      const result = await query(
        `SELECT *
         FROM username_history
         WHERE user_id = $1
         ORDER BY changed_at DESC
         LIMIT $2`,
        [userId.toString(), limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting username history:', error);
      return [];
    }
  }

  /**
   * Get recent username changes
   */
  static async getRecentUsernameChanges(groupId, limit = 50) {
    try {
      const result = await query(
        `SELECT h.*, u.username as current_username
         FROM username_history h
         LEFT JOIN users u ON h.user_id = u.id
         WHERE h.group_id = $1
         ORDER BY h.changed_at DESC
         LIMIT $2`,
        [groupId, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting recent username changes:', error);
      return [];
    }
  }

  /**
   * Flag username change
   */
  static async flagUsernameChange(recordId, flaggedBy, reason = '') {
    try {
      await query(
        `UPDATE username_history
         SET flagged = TRUE, flagged_by = $1, flag_reason = $2
         WHERE id = $3`,
        [flaggedBy.toString(), reason, recordId]
      );
      return true;
    } catch (error) {
      logger.error('Error flagging username change:', error);
      return false;
    }
  }

  /**
   * Get flagged username changes
   */
  static async getFlaggedUsernameChanges(groupId = null) {
    try {
      let queryText = `
        SELECT h.*, u.username as current_username
        FROM username_history h
        LEFT JOIN users u ON h.user_id = u.id
        WHERE h.flagged = TRUE
      `;

      const params = [];
      if (groupId) {
        queryText += ' AND h.group_id = $1';
        params.push(groupId);
      }

      queryText += ' ORDER BY h.changed_at DESC';

      const result = await query(queryText, params);

      return result.rows;
    } catch (error) {
      logger.error('Error getting flagged username changes:', error);
      return [];
    }
  }

  /**
   * Check recent username change
   */
  static async hasRecentUsernameChange(userId, hours = 24) {
    try {
      const result = await query(
        `SELECT COUNT(*) as count
         FROM username_history
         WHERE user_id = $1
         AND changed_at > NOW() - INTERVAL '$2 hours'`,
        [userId.toString(), hours]
      );

      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.error('Error checking recent username change:', error);
      return false;
    }
  }
}

module.exports = ModerationModel;