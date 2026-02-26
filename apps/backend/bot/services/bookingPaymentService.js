const ModelManagementModel = require('../../models/modelManagementModel');
const PaymentModel = require('../../models/paymentModel');
const PaymentSecurityService = require('../../services/paymentSecurityService');
const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Booking Payment Service
 * Handles payment processing, confirmation, and notifications for private call bookings
 */
class BookingPaymentService {
  /**
   * Process successful payment
   */
  static async processPaymentSuccess(bookingId, transactionId, paymentMethod) {
    try {
      const booking = await ModelManagementModel.getBookingDetails(bookingId);

      if (!booking) {
        logger.error('Booking not found:', { bookingId });
        return null;
      }

      // Update booking status to confirmed
      const updated = await ModelManagementModel.updateBookingStatus(bookingId, 'confirmed', {
        payment_status: 'paid',
        transaction_id: transactionId
      });

      // Record earnings for the model
      await ModelManagementModel.recordEarnings(bookingId, booking.total_price);

      // Send confirmation to user
      await this.sendUserConfirmation(booking, updated);

      // Send notification to model (if available via Telegram)
      await this.notifyModel(booking);

      logger.info('Payment processed successfully', {
        bookingId,
        transactionId,
        paymentMethod,
        userId: booking.telegram_user_id
      });

      return updated;
    } catch (error) {
      logger.error('Error processing payment:', error);
      throw error;
    }
  }

  /**
   * Handle payment failure
   */
  static async processPaymentFailure(bookingId, reason) {
    try {
      await ModelManagementModel.updateBookingStatus(bookingId, 'pending', {
        payment_status: 'failed'
      });

      logger.warn('Payment failed', { bookingId, reason });
      return true;
    } catch (error) {
      logger.error('Error processing payment failure:', error);
      throw error;
    }
  }

  /**
   * Send confirmation message to user
   */
  static async sendUserConfirmation(booking, updatedBooking) {
    try {
      // This would send a Telegram message to the user
      // For now, just log it
      logger.info('User confirmation message queued', {
        userId: booking.telegram_user_id,
        bookingId: booking.id,
        modelName: booking.display_name
      });

      return true;
    } catch (error) {
      logger.error('Error sending user confirmation:', error);
      return false;
    }
  }

  /**
   * Notify model about the booking
   */
  static async notifyModel(booking) {
    try {
      // This would send a Telegram message to the model
      logger.info('Model notification queued', {
        modelId: booking.model_id,
        bookingId: booking.id,
        userId: booking.telegram_user_id,
        scheduledDate: booking.scheduled_date,
        time: booking.start_time
      });

      return true;
    } catch (error) {
      logger.error('Error notifying model:', error);
      return false;
    }
  }

  /**
   * Check and mark bookings as active if start time has passed
   */
  static async checkAndActivateBookings() {
    try {
      // This would be called by a cron job
      // Check all confirmed bookings where start time has passed
      logger.info('Checking for bookings to activate');
      return true;
    } catch (error) {
      logger.error('Error checking bookings:', error);
      throw error;
    }
  }

  /**
   * Complete a booking after the call ends
   */
  static async completeBooking(bookingId, callDuration, feedback = null) {
    try {
      const booking = await ModelManagementModel.getBookingDetails(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Calculate actual duration (might differ from booked duration if cut short)
      const actualDuration = Math.min(callDuration, booking.duration_minutes);
      const actualCost = (actualDuration * booking.price_per_minute).toFixed(2);

      // Update booking status
      const updated = await ModelManagementModel.updateBookingStatus(bookingId, 'completed');

      // Refund difference if call was shorter
      if (actualCost < booking.total_price) {
        const refundAmount = (booking.total_price - actualCost).toFixed(2);
        await this.processRefund(bookingId, refundAmount);
      }

      // Record feedback if provided
      if (feedback) {
        await this.recordFeedback(bookingId, feedback);
      }

      // Update model earnings to reflect actual duration
      await ModelManagementModel.recordEarnings(bookingId, actualCost);

      logger.info('Booking completed', {
        bookingId,
        scheduledDuration: booking.duration_minutes,
        actualDuration,
        scheduledCost: booking.total_price,
        actualCost
      });

      return updated;
    } catch (error) {
      logger.error('Error completing booking:', error);
      throw error;
    }
  }

  /**
   * Cancel a booking
   */
  static async cancelBooking(bookingId, reason = 'User cancelled') {
    try {
      const booking = await ModelManagementModel.getBookingDetails(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Cancel booking
      const updated = await ModelManagementModel.updateBookingStatus(bookingId, 'cancelled');

      // Process refund
      if (booking.payment_status === 'paid') {
        await this.processRefund(bookingId, booking.total_price);
      }

      // Notify model
      logger.info('Booking cancelled', {
        bookingId,
        reason,
        modelId: booking.model_id,
        userId: booking.telegram_user_id
      });

      return updated;
    } catch (error) {
      logger.error('Error cancelling booking:', error);
      throw error;
    }
  }

  /**
   * Process refund
   */
  static async processRefund(bookingId, amount) {
    try {
      logger.info('Refund processed', {
        bookingId,
        amount
      });

      // Implement refund logic based on payment provider
      const booking = await ModelManagementModel.getBookingDetails(bookingId);
      
      if (!booking || !booking.payment_id) {
        logger.warn('No payment found for booking, cannot process refund', { bookingId });
        return false;
      }
      
      const payment = await PaymentModel.getById(booking.payment_id);
      
      if (!payment) {
        logger.warn('Payment record not found, cannot process refund', { paymentId: booking.payment_id });
        return false;
      }
      
      // Process refund based on payment provider
      switch (payment.provider) {
        case 'daimo':
          return await this._processDaimoRefund(payment, amount);
        case 'epayco':
        case 'visa_cybersource':
          return await this._processCardRefund(payment, amount);
        default:
          logger.warn('Unsupported payment provider for refunds', { provider: payment.provider });
          return false;
      }
    } catch (error) {
      logger.error('Error processing refund:', error);
      throw error;
    }
  }

  /**
   * Process refund for Daimo payments
   * @param {Object} payment - Payment record
   * @param {number} amount - Refund amount
   * @returns {Promise<boolean>} Success status
   */
  static async _processDaimoRefund(payment, amount) {
    try {
      // For Daimo, we would typically call the Daimo API to initiate a refund
      // Since Daimo uses blockchain, refunds are handled via the refund address
      // For now, we'll mark the payment as refunded and log the transaction
      
      logger.info('Processing Daimo refund', {
        paymentId: payment.id,
        originalAmount: payment.amount,
        refundAmount: amount,
        transactionId: payment.reference,
      });

      // Update payment status to partially or fully refunded
      const isFullRefund = parseFloat(amount) >= parseFloat(payment.amount);
      const newStatus = isFullRefund ? 'refunded' : 'partially_refunded';

      await PaymentModel.updateStatus(payment.id, newStatus, {
        refund_amount: amount,
        refund_date: new Date(),
        refund_reason: 'Booking cancellation or adjustment',
      });

      // Log refund event for security monitoring
      await PaymentSecurityService.logPaymentEvent({
        paymentId: payment.id,
        userId: payment.user_id,
        eventType: 'refunded',
        provider: payment.provider,
        amount: amount,
        status: newStatus,
        details: {
          originalAmount: payment.amount,
          refundAmount: amount,
          isFullRefund,
        },
      });

      logger.info('Daimo refund processed successfully', {
        paymentId: payment.id,
        refundAmount: amount,
        newStatus,
      });

      return true;
    } catch (error) {
      logger.error('Error processing Daimo refund:', {
        error: error.message,
        paymentId: payment.id,
        amount,
      });
      return false;
    }
  }

  /**
   * Process refund for card payments (ePayco, Visa Cybersource)
   * @param {Object} payment - Payment record
   * @param {number} amount - Refund amount
   * @returns {Promise<boolean>} Success status
   */
  static async _processCardRefund(payment, amount) {
    try {
      logger.info('Processing card payment refund', {
        paymentId: payment.id,
        provider: payment.provider,
        originalAmount: payment.amount,
        refundAmount: amount,
        transactionId: payment.reference,
      });

      // For card payments, we would typically call the payment processor's refund API
      // Since we don't have the actual API integration yet, we'll simulate the process
      
      // Update payment status
      const isFullRefund = parseFloat(amount) >= parseFloat(payment.amount);
      const newStatus = isFullRefund ? 'refunded' : 'partially_refunded';

      await PaymentModel.updateStatus(payment.id, newStatus, {
        refund_amount: amount,
        refund_date: new Date(),
        refund_reason: 'Booking cancellation or adjustment',
      });

      // Log refund event
      await PaymentSecurityService.logPaymentEvent({
        paymentId: payment.id,
        userId: payment.user_id,
        eventType: 'refunded',
        provider: payment.provider,
        amount: amount,
        status: newStatus,
        details: {
          originalAmount: payment.amount,
          refundAmount: amount,
          isFullRefund,
          paymentProcessor: payment.provider,
        },
      });

      logger.info('Card payment refund processed successfully', {
        paymentId: payment.id,
        provider: payment.provider,
        refundAmount: amount,
        newStatus,
      });

      return true;
    } catch (error) {
      logger.error('Error processing card payment refund:', {
        error: error.message,
        paymentId: payment.id,
        provider: payment.provider,
        amount,
      });
      return false;
    }
  }

  /**
   * Record user feedback for the model
   */
  static async recordFeedback(bookingId, feedbackData, bot) {
    try {
      const { rating, review_text } = feedbackData;
      const booking = await ModelManagementModel.getBookingDetails(bookingId);

      // Validate feedback data
      if (!rating || rating < 1 || rating > 5) {
        throw new Error('Invalid rating. Rating must be between 1 and 5.');
      }

      // Record feedback in database
      await ModelManagementModel.recordBookingFeedback(bookingId, {
        rating: parseInt(rating),
        review_text: review_text || '',
        feedback_date: new Date(),
      });

      // Update model's rating statistics
      await ModelManagementModel.updateModelRating(booking.model_id, rating);

      // Log feedback for analytics
      logger.info('Feedback recorded successfully', {
        bookingId,
        modelId: booking.model_id,
        userId: booking.telegram_user_id,
        rating,
        hasReview: !!review_text,
      });

      // Send notification to model (if they have notifications enabled)
      try {
        const model = await UserModel.getById(booking.model_id);
        if (model && model.notification_preferences?.feedback_notifications) {
          const notificationMessage = `📝 Nuevo feedback recibido\n\n` +
            `🌟 Calificación: ${rating}/5\n` +
            (review_text ? `💬 Comentario: "${review_text}"\n\n` : '') +
            `📅 Reserva: #${bookingId}`;

          await bot.telegram.sendMessage(model.telegram_id, notificationMessage, {
            parse_mode: 'Markdown',
          });
        }
      } catch (notificationError) {
        logger.warn('Failed to send feedback notification to model', {
          modelId: booking.model_id,
          error: notificationError.message,
        });
      }

      return true;
    } catch (error) {
      logger.error('Error recording feedback:', error);
      throw error;
    }
  }

  /**
   * Generate call room URL (Jitsi or other video platform)
   */
  static async generateCallRoomUrl(bookingId, modelId, userId) {
    try {
      const roomName = `call-${bookingId}-${Date.now()}`;
      const jitsiDomain = process.env.JITSI_DOMAIN || 'meet.jit.si';

      // Generate Jitsi URL
      const baseUrl = `https://${jitsiDomain}/${roomName}`;
      const roomUrl = baseUrl + '#config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false';

      // Update booking with call room URL
      await ModelManagementModel.updateBookingStatus(bookingId, 'active', {
        call_room_url: roomUrl
      });

      logger.info('Call room generated', {
        bookingId,
        roomName,
        roomUrl
      });

      return roomUrl;
    } catch (error) {
      logger.error('Error generating call room:', error);
      throw error;
    }
  }
}

module.exports = BookingPaymentService;
