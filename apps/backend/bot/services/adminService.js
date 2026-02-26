const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const userService = require('./userService');
const broadcastUtils = require('../utils/broadcastUtils');

/**
 * Admin Service - Handles admin operations (PostgreSQL)
 */
class AdminService {
  constructor() {
    // No Firestore dependency - using PostgreSQL
  }

  /**
   * Log admin action (logs to application logger)
   */
  async logAction(adminId, action, metadata = {}) {
    try {
      logger.info(`Admin action: ${action}`, {
        adminId,
        action,
        ...metadata,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error logging admin action:', error);
    }
  }

  /**
   * Send broadcast message to all users
   */
  async sendBroadcast(bot, adminId, message, options = {}) {
    try {
      const allUsers = await userService.getAllUsers();

      // Filter out bot users (user IDs ending with specific patterns or flagged as bots)
      const users = allUsers.filter(user => {
        if (user.is_bot === true) return false;
        if (user.id === '1087968824' || user.id === 1087968824) return false;
        return true;
      });

      const results = {
        total: users.length,
        sent: 0,
        failed: 0,
        skippedBots: allUsers.length - users.length,
        errors: [],
      };

      logger.info(`Starting broadcast to ${users.length} users (skipped ${results.skippedBots} bots)`);

      // Create broadcast record in PostgreSQL
      const broadcastId = uuidv4();
      try {
        await query(
          `INSERT INTO broadcasts (id, title, message, media_url, media_type, status, target_tier, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          [
            broadcastId,
            options.title || 'Broadcast',
            message,
            options.mediaUrl || null,
            options.mediaType || null,
            'sending',
            options.targetTier || 'all',
            adminId.toString(),
          ]
        );
      } catch (dbError) {
        logger.warn('Could not create broadcast record:', dbError.message);
      }

      for (const user of users) {
        try {
          const userLanguage = user.language || 'en';
          const standardButtons = broadcastUtils.getStandardButtonOptions(userLanguage);
          const replyMarkup = broadcastUtils.buildInlineKeyboard(standardButtons);

          if (options.mediaType === 'photo' && options.mediaUrl) {
            await bot.telegram.sendPhoto(user.id, options.mediaUrl, {
              caption: message,
              parse_mode: 'Markdown',
              ...(replyMarkup ? { reply_markup: replyMarkup.reply_markup } : {}),
            });
          } else if (options.mediaType === 'video' && options.mediaUrl) {
            await bot.telegram.sendVideo(user.id, options.mediaUrl, {
              caption: message,
              parse_mode: 'Markdown',
              ...(replyMarkup ? { reply_markup: replyMarkup.reply_markup } : {}),
            });
          } else {
            await bot.telegram.sendMessage(user.id, message, {
              parse_mode: 'Markdown',
              ...(replyMarkup ? { reply_markup: replyMarkup.reply_markup } : {}),
            });
          }

          results.sent++;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          results.failed++;
          results.errors.push({
            userId: user.id,
            error: error.message,
          });

          logger.warn(`Failed to send broadcast to user ${user.id}: ${error.message}`);
        }
      }

      // Update broadcast status in PostgreSQL
      try {
        await query(
          `UPDATE broadcasts SET status = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [results.failed === 0 ? 'completed' : 'completed_with_errors', broadcastId]
        );
      } catch (dbError) {
        logger.warn('Could not update broadcast record:', dbError.message);
      }

      // Log admin action
      await this.logAction(adminId, 'broadcast_sent', {
        total: results.total,
        sent: results.sent,
        failed: results.failed,
      });

      logger.info(`Broadcast completed: ${results.sent} sent, ${results.failed} failed`);
      return results;
    } catch (error) {
      logger.error('Error sending broadcast:', error);
      throw error;
    }
  }

  /**
   * Get broadcast history
   */
  async getBroadcastHistory(limit = 50) {
    try {
      const result = await query(
        `SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        message: row.message,
        mediaUrl: row.media_url,
        mediaType: row.media_type,
        scheduledAt: row.scheduled_at,
        sentAt: row.sent_at,
        status: row.status,
        targetTier: row.target_tier,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error('Error getting broadcast history:', error);
      return [];
    }
  }

  /**
   * Get admin logs (returns empty array - logging is done via application logger)
   */
  async getAdminLogs(limit = 100) {
    // Admin logs are now written to application logger, not stored in database
    // To view logs, check PM2 logs or log files
    logger.info('Admin logs requested - check application logs for admin actions');
    return [];
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats() {
    try {
      const [userStats, broadcasts] = await Promise.all([
        userService.getStatistics(),
        this.getBroadcastHistory(10),
      ]);

      const recentBroadcasts = broadcasts.slice(0, 5);

      return {
        users: userStats,
        recentBroadcasts,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting dashboard stats:', error);
      throw error;
    }
  }
}

module.exports = new AdminService();
