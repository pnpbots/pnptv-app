const { v4: uuidv4 } = require('uuid');
const PerformerModel = require('../../models/performerModel');
const CallModel = require('../../models/callModel');
const PaymentModel = require('../../models/paymentModel');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');
const axios = require('axios');

/**
 * Private Call Service - Business logic for 1:1 private calls
 */
class PrivateCallService {
  
  // =====================================================
  // PAYMENT INTEGRATION
  // =====================================================
  
  /**
   * Create payment for private call
   * @param {Object} paymentData - Payment data
   * @returns {Promise<Object>} { success, paymentId, paymentUrl, error }
   */
  static async createPayment(paymentData) {
    try {
      const paymentId = uuidv4();
      const userId = paymentData.userId.toString();
      
      // Create payment record
      const payment = await PaymentModel.create({
        id: paymentId,
        user_id: userId,
        plan_id: `private_call_${paymentData.duration}min`,
        plan_name: `${paymentData.duration} min call with ${paymentData.performerName}`,
        amount: paymentData.price,
        currency: 'USD',
        provider: this.getPaymentProvider(paymentData.paymentMethod),
        payment_method: paymentData.paymentMethod,
        status: 'pending',
        payment_id: paymentId,
        reference: `CALL-${paymentId}`,
        payment_url: '', // Will be set based on provider
        chain: JSON.stringify({ chainId: 10 }), // Optimism chain ID
      });
      
      if (!payment) {
        throw new Error('Failed to create payment record');
      }
      
      // Generate payment URL based on method
      let paymentUrl = '';
      
      switch (paymentData.paymentMethod) {
        case 'card':
          paymentUrl = await this.generateCardPaymentUrl(paymentId, paymentData);
          break;
        case 'crypto':
          paymentUrl = await this.generateCryptoPaymentUrl(paymentId, paymentData);
          break;
        case 'bank':
          paymentUrl = await this.generateBankPaymentUrl(paymentId, paymentData);
          break;
        default:
          throw new Error('Unsupported payment method');
      }
      
      // Update payment with URL
      await PaymentModel.update(paymentId, {
        payment_url: paymentUrl,
        status: 'pending',
      });
      
      logger.info('Private call payment created', {
        paymentId,
        userId,
        performerId: paymentData.performerId,
        amount: paymentData.price,
        method: paymentData.paymentMethod,
      });
      
      return {
        success: true,
        paymentId,
        paymentUrl,
      };
    } catch (error) {
      logger.error('Error creating private call payment:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Get payment provider based on method
   */
  static getPaymentProvider(method) {
    const providers = {
      card: 'manual',
      crypto: 'daimo',
      bank: 'wompi',
    };
    return providers[method] || 'manual';
  }
  

  
  /**
   * Generate crypto payment URL (Daimo)
   */
  static async generateCryptoPaymentUrl(paymentId, paymentData) {
    try {
      // In a real implementation, this would call Daimo API
      // For now, return a placeholder URL
      return `https://daimo.com/pay/${paymentId}`;
    } catch (error) {
      logger.error('Error generating crypto payment URL:', error);
      throw error;
    }
  }
  
  /**
   * Generate bank payment URL (Wompi)
   */
  static async generateBankPaymentUrl(paymentId, paymentData) {
    try {
      // In a real implementation, this would call Wompi API
      // For now, return a placeholder URL
      return `https://wompi.com/pay/${paymentId}`;
    } catch (error) {
      logger.error('Error generating bank payment URL:', error);
      throw error;
    }
  }
  
  /**
   * Check payment status
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Payment status
   */
  static async checkPaymentStatus(paymentId) {
    try {
      const payment = await PaymentModel.getById(paymentId);
      
      if (!payment) {
        return { status: 'not_found' };
      }
      
      // In a real implementation, this would check with the payment provider
      // For simulation purposes, we'll return the stored status
      return {
        status: payment.status,
        paymentId: payment.id,
        amount: payment.amount,
        method: payment.payment_method,
        completedAt: payment.completed_at,
      };
    } catch (error) {
      logger.error('Error checking payment status:', error);
      return { status: 'error' };
    }
  }
  
  /**
   * Mark payment as completed (for webhook or manual completion)
   * @param {string} paymentId - Payment ID
   * @returns {Promise<boolean>} Success status
   */
  static async markPaymentCompleted(paymentId) {
    try {
      const result = await PaymentModel.update(paymentId, {
        status: 'success',
        completed_at: new Date(),
      });
      
      logger.info('Payment marked as completed', { paymentId });
      return result;
    } catch (error) {
      logger.error('Error marking payment as completed:', error);
      return false;
    }
  }
  
  // =====================================================
  // BOOKING MANAGEMENT
  // =====================================================
  
  /**
   * Complete booking after successful payment
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} { success, booking, error }
   */
  static async completeBooking(paymentId) {
    try {
      // Get payment details
      const payment = await PaymentModel.getById(paymentId);
      
      if (!payment || payment.status !== 'success') {
        throw new Error('Payment not found or not completed');
      }
      
      // Get user details
      const user = await UserModel.getById(payment.user_id);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Parse performer ID from plan ID (private_call_Xmin_with_PERFORMER_ID)
      const planParts = payment.plan_id.split('_');
      const duration = parseInt(planParts[2]);
      const performerId = planParts[4]; // This would need to be stored properly
      
      // Get performer details
      const performer = await PerformerModel.getById(performerId);
      
      if (!performer) {
        throw new Error('Performer not found');
      }
      
      // Calculate call date and time (for simulation, use current time + 1 hour)
      const now = new Date();
      const callDate = now.toISOString().split('T')[0];
      const callTime = now.toTimeString().split(' ')[0];
      const scheduledAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
      
      // Create the call booking
      const call = await CallModel.create({
        userId: user.id,
        userName: user.first_name + (user.last_name ? ` ${user.last_name}` : ''),
        userUsername: user.username,
        paymentId: payment.id,
        scheduledDate: callDate,
        scheduledTime: callTime,
        duration: duration,
        performer: performer.displayName,
        performerId: performer.id,
        amount: payment.amount,
        status: 'confirmed',
      });
      
      if (!call) {
        throw new Error('Failed to create call booking');
      }
      
      // Create meeting room
      const meetingUrl = await this.createMeetingRoom({
        callId: call.id,
        userName: user.first_name,
        performerName: performer.displayName,
        scheduledDate: callDate,
      });
      
      // Update call with meeting URL
      await CallModel.updateStatus(call.id, 'confirmed', {
        meetingUrl,
      });
      
      // Update performer statistics
      await PerformerModel.updateStatistics(performer.id, {
        totalCalls: performer.total_calls + 1,
      });
      
      logger.info('Private call booking completed', {
        bookingId: call.id,
        userId: user.id,
        performerId: performer.id,
        paymentId: payment.id,
      });
      
      return {
        success: true,
        booking: {
          id: call.id,
          userId: user.id,
          performerId: performer.id,
          performerName: performer.displayName,
          date: callDate,
          time: callTime,
          duration: duration,
          price: payment.amount,
          meetingUrl: meetingUrl,
          status: 'confirmed',
        },
      };
    } catch (error) {
      logger.error('Error completing private call booking:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Cancel booking
   * @param {string} paymentId - Payment ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} { success, error }
   */
  static async cancelBooking(paymentId, reason) {
    try {
      // Get payment details
      const payment = await PaymentModel.getById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      // Update payment status
      await PaymentModel.update(paymentId, {
        status: 'cancelled',
      });
      
      // Find and cancel any associated call
      const calls = await CallModel.getByPaymentId(paymentId);
      
      for (const call of calls) {
        await CallModel.updateStatus(call.id, 'cancelled', {
          cancellationReason: reason,
        });
        
        // Release the time slot
        if (call.slot_id) {
          await PerformerModel.releaseSlot(call.slot_id);
        }
      }
      
      logger.info('Private call booking cancelled', {
        paymentId,
        reason,
      });
      
      return {
        success: true,
      };
    } catch (error) {
      logger.error('Error cancelling private call booking:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  // =====================================================
  // CALL ROOM MANAGEMENT
  // =====================================================
  
  /**
   * Create meeting room for private call
   * @param {Object} callData - Call data
   * @returns {Promise<string>} Meeting room URL
   */
  static async createMeetingRoom(callData) {
    try {
      const apiKey = process.env.DAILY_API_KEY;
      
      if (!apiKey) {
        logger.warn('Daily.co API key not configured, using placeholder URL');
        // Fallback: return a generic meeting URL
        return `https://meet.pnptv.com/call-${callData.callId}`;
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
        }
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
      return `https://meet.pnptv.com/call-${callData.callId}`;
    }
  }
  
  /**
   * Get meeting room details
   * @param {string} callId - Call ID
   * @returns {Promise<Object>} Meeting room details
   */
  static async getMeetingRoom(callId) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call || !call.meeting_url) {
        return null;
      }
      
      return {
        meetingUrl: call.meeting_url,
        status: call.status,
      };
    } catch (error) {
      logger.error('Error getting meeting room:', error);
      return null;
    }
  }
  
  // =====================================================
  // USER BOOKINGS
  // =====================================================
  
  /**
   * Get user's bookings
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User's bookings
   */
  static async getUserBookings(userId) {
    try {
      const calls = await CallModel.getByUser(userId);
      
      // Map calls to booking format
      return calls.map(call => ({
        id: call.id,
        performerId: call.performer_id,
        performerName: call.performer,
        date: call.scheduled_date,
        time: call.scheduled_time,
        duration: call.duration,
        price: call.amount,
        meetingUrl: call.meeting_url,
        status: call.status,
        paymentStatus: call.payment_status,
      }));
    } catch (error) {
      logger.error('Error getting user bookings:', error);
      return [];
    }
  }
  
  /**
   * Get booking by ID
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object|null>} Booking details
   */
  static async getBookingById(bookingId) {
    try {
      const call = await CallModel.getById(bookingId);
      
      if (!call) {
        return null;
      }
      
      return {
        id: call.id,
        userId: call.user_id,
        performerId: call.performer_id,
        performerName: call.performer,
        date: call.scheduled_date,
        time: call.scheduled_time,
        duration: call.duration,
        price: call.amount,
        meetingUrl: call.meeting_url,
        status: call.status,
        paymentStatus: call.payment_status,
      };
    } catch (error) {
      logger.error('Error getting booking by ID:', error);
      return null;
    }
  }
  
  // =====================================================
  // REMINDER SYSTEM
  // =====================================================
  
  /**
   * Send call reminders
   * @param {Object} bot - Telegram bot instance
   * @param {string} callId - Call ID
   * @param {number} minutesBefore - Minutes before call
   * @returns {Promise<boolean>} Success status
   */
  static async sendCallReminder(bot, callId, minutesBefore = 15) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call || call.status !== 'confirmed') {
        return false;
      }
      
      const userId = call.user_id;
      const performerName = call.performer;
      const date = call.scheduled_date;
      const time = call.scheduled_time;
      const meetingUrl = call.meeting_url;
      
      const message = `🔔 *Reminder: Private Call in ${minutesBefore} minutes*
\n` +
        `🎭 With: ${performerName}
` +
        `📅 Date: ${date}
` +
        `⏰ Time: ${time}
` +
        `⏱ Duration: ${call.duration} minutes
\n` +
        `🔗 Join here: ${meetingUrl}
\n` +
        'See you soon! 👋';
      
      await bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎥 Join Call Now', url: meetingUrl }],
          ],
        },
      });
      
      // Mark reminder as sent
      const reminderField = `reminder_${minutesBefore}min_sent`;
      await CallModel.updateStatus(callId, call.status, {
        [reminderField]: true,
      });
      
      logger.info('Call reminder sent', {
        callId,
        userId,
        minutesBefore,
      });
      
      return true;
    } catch (error) {
      logger.error('Error sending call reminder:', error);
      return false;
    }
  }
  
  /**
   * Check and send upcoming call reminders
   * @param {Object} bot - Telegram bot instance
   * @returns {Promise<number>} Number of reminders sent
   */
  static async checkAndSendReminders(bot) {
    try {
      const now = new Date();
      const upcomingCalls = await CallModel.getUpcoming(now);
      let remindersSent = 0;
      
      for (const call of upcomingCalls) {
        const callDateTime = new Date(`${call.scheduled_date}T${call.scheduled_time}`);
        const diffMs = callDateTime - now;
        const diffMins = Math.ceil(diffMs / (1000 * 60));
        
        // Check if we need to send 24h reminder
        if (diffMins <= 1440 && diffMins > 1380 && !call.reminder_24h_sent) {
          await this.sendCallReminder(bot, call.id, 1440);
          remindersSent++;
        }
        
        // Check if we need to send 1h reminder
        else if (diffMins <= 60 && diffMins > 45 && !call.reminder_1h_sent) {
          await this.sendCallReminder(bot, call.id, 60);
          remindersSent++;
        }
        
        // Check if we need to send 15min reminder
        else if (diffMins <= 15 && diffMins > 0 && !call.reminder_15min_sent) {
          await this.sendCallReminder(bot, call.id, 15);
          remindersSent++;
        }
      }
      
      logger.info('Call reminders checked and sent', {
        remindersSent,
        totalUpcomingCalls: upcomingCalls.length,
      });
      
      return remindersSent;
    } catch (error) {
      logger.error('Error checking and sending call reminders:', error);
      return 0;
    }
  }
  
  // =====================================================
  // CALL LIFECYCLE MANAGEMENT
  // =====================================================
  
  /**
   * Start a call
   * @param {string} callId - Call ID
   * @returns {Promise<boolean>} Success status
   */
  static async startCall(callId) {
    try {
      const result = await CallModel.updateStatus(callId, 'active', {
        started_at: new Date(),
      });
      
      logger.info('Call started', { callId });
      return result;
    } catch (error) {
      logger.error('Error starting call:', error);
      return false;
    }
  }
  
  /**
   * End a call
   * @param {string} callId - Call ID
   * @returns {Promise<boolean>} Success status
   */
  static async endCall(callId) {
    try {
      const result = await CallModel.updateStatus(callId, 'completed', {
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      logger.info('Call ended', { callId });
      return result;
    } catch (error) {
      logger.error('Error ending call:', error);
      return false;
    }
  }
  
  /**
   * Mark call as no-show
   * @param {string} callId - Call ID
   * @param {string} userType - 'user' or 'performer'
   * @returns {Promise<boolean>} Success status
   */
  static async markNoShow(callId, userType) {
    try {
      const result = await CallModel.updateStatus(callId, 'completed', {
        no_show: true,
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      logger.info('Call marked as no-show', {
        callId,
        userType,
      });
      
      return result;
    } catch (error) {
      logger.error('Error marking call as no-show:', error);
      return false;
    }
  }
  
  /**
   * Report incident during call
   * @param {string} callId - Call ID
   * @param {string} incidentDetails - Incident details
   * @returns {Promise<boolean>} Success status
   */
  static async reportIncident(callId, incidentDetails) {
    try {
      const result = await CallModel.updateStatus(callId, 'completed', {
        incident_reported: true,
        incident_details: incidentDetails,
        ended_at: new Date(),
        completed_at: new Date(),
      });
      
      logger.info('Incident reported during call', {
        callId,
        incidentDetails,
      });
      
      return result;
    } catch (error) {
      logger.error('Error reporting incident:', error);
      return false;
    }
  }
  
  // =====================================================
  // STATISTICS AND REPORTING
  // =====================================================
  
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
  
  /**
   * Get performer call statistics
   * @param {string} performerId - Performer ID
   * @returns {Promise<Object>} Performer statistics
   */
  static async getPerformerStatistics(performerId) {
    try {
      const performerStats = await PerformerModel.getStatistics(performerId);
      
      // Get calls for this performer
      const calls = await CallModel.getByPerformer(performerId);
      
      return {
        ...performerStats,
        recentCalls: calls.slice(0, 10), // Last 10 calls
      };
    } catch (error) {
      logger.error('Error getting performer statistics:', error);
      return {
        totalCalls: 0,
        averageRating: 0.00,
        ratingCount: 0,
        recentCalls: [],
      };
    }
  }
  
  // =====================================================
  // FEEDBACK SYSTEM
  // =====================================================
  
  /**
   * Submit call feedback
   * @param {string} callId - Call ID
   * @param {Object} feedback - Feedback data
   * @returns {Promise<boolean>} Success status
   */
  static async submitFeedback(callId, feedback) {
    try {
      const call = await CallModel.getById(callId);
      
      if (!call) {
        throw new Error('Call not found');
      }
      
      // Update call with feedback
      const updates = {
        feedback_submitted: true,
      };
      
      if (feedback.userRating) {
        updates.caller_rating = feedback.userRating;
      }
      
      if (feedback.userFeedback) {
        updates.caller_feedback = feedback.userFeedback;
      }
      
      if (feedback.performerRating) {
        updates.receiver_rating = feedback.performerRating;
      }
      
      if (feedback.performerFeedback) {
        updates.receiver_feedback = feedback.performerFeedback;
      }
      
      const result = await CallModel.updateStatus(callId, call.status, updates);
      
      if (result && feedback.performerRating) {
        // Update performer statistics
        const performer = await PerformerModel.getById(call.performer_id);
        
        if (performer) {
          const newTotalRating = performer.total_rating + feedback.performerRating;
          const newRatingCount = performer.rating_count + 1;
          
          await PerformerModel.updateStatistics(call.performer_id, {
            total_rating: newTotalRating,
            rating_count: newRatingCount,
          });
        }
      }
      
      logger.info('Call feedback submitted', {
        callId,
        userRating: feedback.userRating,
        performerRating: feedback.performerRating,
      });
      
      return result;
    } catch (error) {
      logger.error('Error submitting call feedback:', error);
      return false;
    }
  }
}

module.exports = PrivateCallService;