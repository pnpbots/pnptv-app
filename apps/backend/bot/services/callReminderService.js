const CallModel = require('../../models/callModel');
const logger = require('../../utils/logger');

/**
 * Call Reminder Service - Automated reminders for scheduled calls
 */
class CallReminderService {
  /**
   * Send reminder for a specific call
   * @param {Object} bot - Telegram bot instance
   * @param {Object} call - Call data
   * @param {number} hoursBeforeCall - Hours before call time
   * @returns {Promise<boolean>} Success status
   */
  static async sendReminder(bot, call, hoursBeforeCall) {
    try {
      const reminderType = this.getReminderType(hoursBeforeCall);

      let message = '';
      let emoji = '';

      if (hoursBeforeCall === 24) {
        emoji = '📅';
        message = `${emoji} *Call Reminder - Tomorrow*\n\n`;
        message += `You have a scheduled 1:1 call coming up tomorrow!\n\n`;
      } else if (hoursBeforeCall === 1) {
        emoji = '⏰';
        message = `${emoji} *Call Reminder - In 1 Hour*\n\n`;
        message += `Your 1:1 call starts in 1 hour!\n\n`;
      } else if (hoursBeforeCall === 0.25) { // 15 minutes
        emoji = '🔔';
        message = `${emoji} *Call Starting Soon - 15 Minutes*\n\n`;
        message += `Your 1:1 call starts in 15 minutes! Time to get ready!\n\n`;
      } else {
        emoji = '🔔';
        message = `${emoji} *Call Reminder*\n\n`;
        message += `Your 1:1 call is coming up!\n\n`;
      }

      message += `👤 *Performer:* ${call.performer}\n`;
      message += `📅 *Date:* ${call.scheduledDate}\n`;
      message += `⏰ *Time:* ${call.scheduledTime}\n`;
      message += `⏱ *Duration:* ${call.duration} minutes\n\n`;

      if (call.meetingUrl) {
        message += `🔗 *Meeting Link:*\n${call.meetingUrl}\n\n`;
      }

      if (hoursBeforeCall === 0.25) {
        message += `⚡ *Join now to test your connection!*\n`;
        message += `See you in 15 minutes! 🎉`;
      } else {
        message += `Make sure you're ready for an amazing session! 🎉`;
      }

      const keyboard = call.meetingUrl ? {
        inline_keyboard: [
          [{ text: '🎥 Join Call', url: call.meetingUrl }],
          [{ text: '📅 Reschedule', callback_data: `reschedule_call:${call.id}` }],
        ],
      } : {
        inline_keyboard: [
          [{ text: '📅 Reschedule', callback_data: `reschedule_call:${call.id}` }],
        ],
      };

      await bot.telegram.sendMessage(call.userId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

      // Mark reminder as sent
      const reminderField = `reminder${reminderType}Sent`;
      await CallModel.updateStatus(call.id, call.status, {
        [reminderField]: true,
        [`${reminderField}At`]: new Date(),
      });

      logger.info('Call reminder sent', {
        callId: call.id,
        userId: call.userId,
        hoursBeforeCall,
        reminderType,
      });

      return true;
    } catch (error) {
      logger.error('Error sending call reminder:', {
        callId: call.id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get reminder type name
   * @param {number} hoursBeforeCall - Hours before call
   * @returns {string} Reminder type
   */
  static getReminderType(hoursBeforeCall) {
    if (hoursBeforeCall === 24) return '24h';
    if (hoursBeforeCall === 1) return '1h';
    if (hoursBeforeCall === 0.25) return '15min';
    return 'custom';
  }

  /**
   * Check and send due reminders
   * This should be called by a cron job every 5-15 minutes
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<Object>} { sent, failed }
   */
  static async checkAndSendReminders(bot) {
    try {
      const now = new Date();
      const results = { sent: 0, failed: 0 };

      // Get all confirmed and pending calls
      const upcomingCalls = await CallModel.getUpcoming();

      for (const call of upcomingCalls) {
        try {
          // Parse scheduled date/time
          const scheduledDate = this.parseScheduledDateTime(call.scheduledDate, call.scheduledTime);

          if (!scheduledDate) {
            logger.warn('Could not parse scheduled date/time for call', {
              callId: call.id,
              scheduledDate: call.scheduledDate,
              scheduledTime: call.scheduledTime,
            });
            continue;
          }

          const hoursUntilCall = (scheduledDate - now) / (1000 * 60 * 60);

          // Check if we need to send 24h reminder
          if (hoursUntilCall <= 24 && hoursUntilCall > 23 && !call.reminder24hSent) {
            const success = await this.sendReminder(bot, call, 24);
            if (success) results.sent++;
            else results.failed++;
          }

          // Check if we need to send 1h reminder
          if (hoursUntilCall <= 1 && hoursUntilCall > 0.5 && !call.reminder1hSent) {
            const success = await this.sendReminder(bot, call, 1);
            if (success) results.sent++;
            else results.failed++;
          }

          // Check if we need to send 15min reminder
          if (hoursUntilCall <= 0.25 && hoursUntilCall > 0 && !call.reminder15minSent) {
            const success = await this.sendReminder(bot, call, 0.25);
            if (success) results.sent++;
            else results.failed++;
          }

          // Auto-complete calls that are past their end time (duration + 15 min buffer)
          const callEndTime = new Date(scheduledDate.getTime() + ((call.duration || 45) + 15) * 60 * 1000);
          if (now > callEndTime && call.status === 'confirmed') {
            await CallModel.updateStatus(call.id, 'completed', {
              completedAt: new Date(),
              autoCompleted: true,
            });
            logger.info('Call auto-completed', { callId: call.id });
          }
        } catch (error) {
          logger.error('Error processing call reminder:', {
            callId: call.id,
            error: error.message,
          });
          results.failed++;
        }
      }

      if (results.sent > 0 || results.failed > 0) {
        logger.info('Reminder check completed', results);
      }

      return results;
    } catch (error) {
      logger.error('Error checking reminders:', error);
      return { sent: 0, failed: 0 };
    }
  }

  /**
   * Parse scheduled date and time into Date object
   * @param {string} scheduledDate - Date string (e.g., "12/25/2024" or "25/12/2024")
   * @param {string} scheduledTime - Time string (e.g., "2:30 PM EST" or "14:30")
   * @returns {Date|null} Parsed date
   */
  static parseScheduledDateTime(scheduledDate, scheduledTime) {
    try {
      // Handle different date formats
      let dateParts;
      if (scheduledDate.includes('/')) {
        dateParts = scheduledDate.split('/');
      } else if (scheduledDate.includes('-')) {
        dateParts = scheduledDate.split('-');
      } else {
        return null;
      }

      // Try DD/MM/YYYY format first (common in many countries)
      let day, month, year;
      if (dateParts[2] && dateParts[2].length === 4) {
        // Format: DD/MM/YYYY or MM/DD/YYYY
        // Check if first number is > 12 to determine format
        if (parseInt(dateParts[0]) > 12) {
          day = parseInt(dateParts[0]);
          month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
          year = parseInt(dateParts[2]);
        } else {
          // Assume MM/DD/YYYY (US format)
          month = parseInt(dateParts[0]) - 1;
          day = parseInt(dateParts[1]);
          year = parseInt(dateParts[2]);
        }
      } else {
        return null;
      }

      // Parse time
      let hours = 0;
      let minutes = 0;

      // Remove timezone info for parsing
      const timeWithoutTz = scheduledTime.replace(/\s*(EST|EDT|PST|PDT|UTC|GMT|CST|CDT|MST|MDT).*$/, '').trim();

      if (timeWithoutTz.includes(':')) {
        const timeParts = timeWithoutTz.split(':');
        hours = parseInt(timeParts[0]);

        // Handle AM/PM
        if (timeWithoutTz.toLowerCase().includes('pm') && hours !== 12) {
          hours += 12;
        } else if (timeWithoutTz.toLowerCase().includes('am') && hours === 12) {
          hours = 0;
        }

        // Extract minutes (remove AM/PM if present)
        const minutePart = timeParts[1].replace(/[^0-9]/g, '');
        minutes = parseInt(minutePart) || 0;
      } else {
        hours = parseInt(timeWithoutTz);
      }

      const date = new Date(year, month, day, hours, minutes);

      // Validate date
      if (isNaN(date.getTime())) {
        return null;
      }

      return date;
    } catch (error) {
      logger.error('Error parsing scheduled date/time:', {
        scheduledDate,
        scheduledTime,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Initialize reminder service (start cron job)
   * @param {Object} bot - Telegram bot instance
   */
  static initialize(bot) {
    // Run reminder check every 10 minutes
    const interval = 10 * 60 * 1000; // 10 minutes

    setInterval(async () => {
      await this.checkAndSendReminders(bot);
    }, interval);

    logger.info('Call reminder service initialized', {
      checkInterval: '10 minutes',
    });

    // Run immediately on startup
    setTimeout(() => {
      this.checkAndSendReminders(bot);
    }, 5000); // Wait 5 seconds after startup
  }
}

module.exports = CallReminderService;
