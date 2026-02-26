const axios = require('axios');
const CallModel = require('../../models/callModel');
const PaymentModel = require('../../models/paymentModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Call Service - Business logic for private 1:1 calls
 */
class CallService {
  /**
   * Create a Daily.co room for a call
   * @param {Object} callData - { callId, userName, scheduledDate }
   * @returns {Promise<string>} Meeting room URL
   */
  static async createMeetingRoom(callData) {
    try {
      const apiKey = process.env.DAILY_API_KEY;

      if (!apiKey) {
        logger.warn('Daily.co API key not configured, using placeholder URL');
        // Fallback: return a Zoom-like generic meeting URL
        return `https://meet.pnptv.com/${callData.callId}`;
      }

      // Create Daily.co room
      const response = await axios.post(
        'https://api.daily.co/v1/rooms',
        {
          name: `pnptv-call-${callData.callId}`,
          properties: {
            max_participants: 2, // 1:1 call
            enable_chat: true,
            enable_screenshare: true,
            enable_recording: 'cloud', // Optional: record calls
            exp: Math.floor(Date.now() / 1000) + (48 * 60 * 60), // Expires in 48 hours
            eject_at_room_exp: true,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const roomUrl = response.data.url;
      logger.info('Daily.co meeting room created', {
        callId: callData.callId,
        roomUrl,
      });

      return roomUrl;
    } catch (error) {
      logger.error('Error creating Daily.co room:', error);

      // Fallback to generic URL if Daily.co fails
      return `https://meet.pnptv.com/${callData.callId}`;
    }
  }

  /**
   * Book a call
   * @param {Object} bookingData - { userId, userName, paymentId, scheduledDate, scheduledTime }
   * @returns {Promise<Object>} { success, call }
   */
  static async bookCall(bookingData) {
    try {
      // Verify payment exists and is successful
      const payment = await PaymentModel.getById(bookingData.paymentId);
      if (!payment || payment.status !== 'success') {
        throw new Error('Payment not found or not completed');
      }

      // Create call booking
      const call = await CallModel.create({
        userId: bookingData.userId.toString(),
        userName: bookingData.userName,
        userUsername: bookingData.userUsername,
        paymentId: bookingData.paymentId,
        scheduledDate: bookingData.scheduledDate,
        scheduledTime: bookingData.scheduledTime,
        duration: 45, // 45 minutes
        amount: 100, // $100 USD
      });

      // Create meeting room
      const meetingUrl = await this.createMeetingRoom({
        callId: call.id,
        userName: bookingData.userName,
        scheduledDate: bookingData.scheduledDate,
      });

      // Update call with meeting URL
      await CallModel.updateStatus(call.id, 'confirmed', {
        meetingUrl,
      });

      logger.info('Call booked successfully', {
        callId: call.id,
        userId: bookingData.userId,
        scheduledDate: bookingData.scheduledDate,
        scheduledTime: bookingData.scheduledTime,
      });

      return {
        success: true,
        call: { ...call, meetingUrl },
      };
    } catch (error) {
      logger.error('Error booking call:', error);
      throw error;
    }
  }

  /**
   * Set admin availability
   * @param {Object} availabilityData - { adminId, available, message, validUntil }
   * @returns {Promise<Object>} Availability data
   */
  static async setAvailability(availabilityData) {
    try {
      const availability = await CallModel.setAvailability(availabilityData);

      logger.info('Availability set', {
        adminId: availabilityData.adminId,
        available: availabilityData.available,
      });

      return availability;
    } catch (error) {
      logger.error('Error setting availability:', error);
      throw error;
    }
  }

  /**
   * Get current availability
   * @returns {Promise<Object>} Current availability
   */
  static async getAvailability() {
    try {
      return await CallModel.getAvailability();
    } catch (error) {
      logger.error('Error getting availability:', error);
      return { available: false, message: 'Error checking availability' };
    }
  }

  /**
   * Broadcast availability notification to all users
   * @param {Object} bot - Telegram bot instance
   * @param {string} message - Availability message
   * @returns {Promise<Object>} { sent, failed }
   */
  static async broadcastAvailability(bot, message) {
    try {
      // Get all active users (you may want to add a subscription filter)
      const users = await UserModel.getAllActive();

      const results = {
        sent: 0,
        failed: 0,
        total: users.length,
      };

      logger.info(`Broadcasting availability to ${users.length} users`);

      // Send in batches to avoid rate limiting
      const BATCH_SIZE = 20;
      const DELAY_BETWEEN_BATCHES = 1000; // 1 second

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (user) => {
            try {
              await bot.telegram.sendMessage(
                user.chatId || user.id,
                message,
                {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '📞 Book 1:1 Call', callback_data: 'book_private_call' }],
                    ],
                  },
                },
              );
              results.sent += 1;
            } catch (error) {
              logger.warn('Failed to send availability notification', {
                userId: user.id,
                error: error.message,
              });
              results.failed += 1;
            }
          }),
        );

        // Wait between batches
        if (i + BATCH_SIZE < users.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
      }

      logger.info('Availability broadcast completed', results);
      return results;
    } catch (error) {
      logger.error('Error broadcasting availability:', error);
      throw error;
    }
  }

  /**
   * Send call reminder
   * @param {Object} bot - Telegram bot instance
   * @param {Object} call - Call data
   * @param {number} minutesBefore - Minutes before call
   * @returns {Promise<boolean>} Success status
   */
  static async sendCallReminder(bot, call, minutesBefore = 15) {
    try {
      const message = `🔔 *Reminder: Private Call in ${minutesBefore} minutes*\n\n`
        + `📅 Date: ${call.scheduledDate}\n`
        + `⏰ Time: ${call.scheduledTime}\n`
        + `⏱ Duration: ${call.duration} minutes\n\n`
        + `🔗 Join here: ${call.meetingUrl}\n\n`
        + 'See you soon! 👋';

      await bot.telegram.sendMessage(call.userId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎥 Join Call Now', url: call.meetingUrl }],
          ],
        },
      });

      // Mark reminder as sent
      await CallModel.updateStatus(call.id, call.status, {
        reminderSent: true,
        reminderSentAt: new Date(),
      });

      logger.info('Call reminder sent', {
        callId: call.id,
        userId: call.userId,
        minutesBefore,
      });

      return true;
    } catch (error) {
      logger.error('Error sending call reminder:', error);
      return false;
    }
  }

  /**
   * Get upcoming calls (for scheduling reminders)
   * @returns {Promise<Array>} Upcoming calls
   */
  static async getUpcomingCalls() {
    try {
      return await CallModel.getUpcoming();
    } catch (error) {
      logger.error('Error getting upcoming calls:', error);
      return [];
    }
  }

  /**
   * Cancel a call
   * @param {string} callId - Call ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<boolean>} Success status
   */
  static async cancelCall(callId, reason = 'User cancellation') {
    try {
      await CallModel.updateStatus(callId, 'cancelled', {
        cancelledAt: new Date(),
        cancellationReason: reason,
      });

      logger.info('Call cancelled', { callId, reason });
      return true;
    } catch (error) {
      logger.error('Error cancelling call:', error);
      return false;
    }
  }

  /**
   * Complete a call
   * @param {string} callId - Call ID
   * @returns {Promise<boolean>} Success status
   */
  static async completeCall(callId) {
    try {
      await CallModel.updateStatus(callId, 'completed', {
        completedAt: new Date(),
      });

      logger.info('Call completed', { callId });
      return true;
    } catch (error) {
      logger.error('Error completing call:', error);
      return false;
    }
  }

  /**
   * Get call statistics
   * @returns {Promise<Object>} Call statistics
   */
  static async getStatistics() {
    try {
      return await CallModel.getStatistics();
    } catch (error) {
      logger.error('Error getting call statistics:', error);
      return {
        total: 0,
        pending: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0,
        revenue: 0,
      };
    }
  }
}

module.exports = CallService;
