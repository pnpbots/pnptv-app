const UserService = require('./userService');
const PermissionService = require('./permissionService');
const logger = require('../../utils/logger');

/**
 * Notification Service - Handles all user notifications
 */
class NotificationService {
  /**
   * Notify all admins about an event
   * @param {string} message - Notification message
   * @param {string} action - Optional action to include
   * @returns {Promise<boolean>} Success status
   */
  static async notifyAdmins(message, action = null) {
    try {
      const admins = await PermissionService.getAllAdmins();
      
      if (admins.length === 0) {
        logger.warn('No admins found to notify');
        return false;
      }

      // In a real implementation, this would send messages to each admin
      // For now, we'll just log it
      logger.info(`Notification to ${admins.length} admins: ${message}`, {
        action,
        adminCount: admins.length
      });

      // TODO: Implement actual notification sending via Telegram
      // This would require bot instance access
      
      return true;
    } catch (error) {
      logger.error('Error notifying admins:', error);
      return false;
    }
  }

  /**
   * Notify a specific user
   * @param {string} userId - User ID to notify
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   * @returns {Promise<boolean>} Success status
   */
  static async notifyUser(userId, message, options = {}) {
    try {
      const user = await UserService.getById(userId);
      
      if (!user) {
        logger.warn(`User not found for notification: ${userId}`);
        return false;
      }

      // Log the notification
      logger.info(`Notification to user ${userId}: ${message}`, {
        userId,
        username: user.username,
        options
      });

      // TODO: Implement actual notification sending
      
      return true;
    } catch (error) {
      logger.error('Error notifying user:', error);
      return false;
    }
  }

  /**
   * Send submission status update to user
   * @param {string} userId - User ID
   * @param {string} submissionId - Submission ID
   * @param {string} status - New status (approved, rejected)
   * @param {string} message - Custom message
   * @returns {Promise<boolean>} Success status
   */
  static async notifySubmissionStatus(userId, submissionId, status, message = null) {
    try {
      const baseMessages = {
        approved: {
          en: `🎉 Your submission #${submissionId} has been approved! It's now visible to everyone.`,
          es: `🎉 ¡Tu propuesta #${submissionId} ha sido aprobada! Ahora es visible para todos.`
        },
        rejected: {
          en: `❌ Your submission #${submissionId} was not approved. Reason: ${message || 'Did not meet guidelines'}`,
          es: `❌ Tu propuesta #${submissionId} no fue aprobada. Razón: ${message || 'No cumplió con las guías'}`
        }
      };

      const user = await UserService.getById(userId);
      const lang = user?.language || 'en';
      const langKey = ['en', 'es'].includes(lang) ? lang : 'en';

      const notificationMessage = message || baseMessages[status][langKey];

      return await this.notifyUser(userId, notificationMessage, {
        submissionId,
        status,
        type: 'submission_update'
      });
    } catch (error) {
      logger.error('Error sending submission status notification:', error);
      return false;
    }
  }

  /**
   * Broadcast notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {string} message - Notification message
   * @param {Object} options - Additional options
   * @returns {Promise<{success: number, failed: number}>} Results
   */
  static async broadcastNotification(userIds, message, options = {}) {
    let success = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        const result = await this.notifyUser(userId, message, options);
        if (result) success++;
        else failed++;
      } catch (error) {
        logger.error(`Failed to notify user ${userId}:`, error);
        failed++;
      }
    }

    return { success, failed };
  }
}

module.exports = NotificationService;