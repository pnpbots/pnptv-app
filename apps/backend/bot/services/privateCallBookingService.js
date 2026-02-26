const { v4: uuidv4 } = require('uuid');
const BookingModel = require('../../models/bookingModel');
const CallSessionModel = require('../../models/callSessionModel');
const BookingNotificationModel = require('../../models/bookingNotificationModel');
const PerformerModel = require('../../models/performerModel');
const UserService = require('./userService');
const logger = require('../../utils/logger');

/**
 * Private Call Booking Service
 * Orchestrates the complete booking flow: eligibility -> slot selection -> hold -> payment -> confirm
 */
class PrivateCallBookingService {
  // =====================================================
  // USER ELIGIBILITY
  // =====================================================

  /**
   * Check if user is eligible for private calls
   */
  static async checkEligibility(userId) {
    try {
      const user = await UserService.getUser(userId);

      if (!user) {
        return {
          eligible: false,
          reasons: ['user_not_found'],
          membership: null,
          isRestricted: false,
        };
      }

      const reasons = [];

      // Check age verification
      if (!user.age_verified_at) {
        reasons.push('age_not_verified');
      }

      // Check terms acceptance
      if (!user.termsAccepted && !user.terms_accepted) {
        reasons.push('terms_not_accepted');
      }

      // Check if restricted
      if (user.is_restricted) {
        reasons.push('user_restricted');
      }

      // Check if private calls are enabled for user
      if (user.private_calls_enabled === false) {
        reasons.push('private_calls_disabled');
      }

      // Check membership (require prime for private calls)
      const hasPrime = user.membership_tier === 'prime' || user.membership_tier === 'admin';
      const membershipExpired = user.membership_expires_at && new Date(user.membership_expires_at) < new Date();

      if (!hasPrime) {
        reasons.push('membership_required');
      } else if (membershipExpired) {
        reasons.push('membership_expired');
      }

      return {
        eligible: reasons.length === 0,
        reasons,
        membership: {
          tier: user.membership_tier,
          expiresAt: user.membership_expires_at,
        },
        isRestricted: user.is_restricted || false,
      };
    } catch (error) {
      logger.error('Error checking eligibility:', error);
      return {
        eligible: false,
        reasons: ['error'],
        membership: null,
        isRestricted: false,
      };
    }
  }

  // =====================================================
  // PERFORMER & AVAILABILITY
  // =====================================================

  /**
   * Get available performers
   */
  static async getAvailablePerformers() {
    try {
      return await PerformerModel.getAvailable();
    } catch (error) {
      logger.error('Error getting available performers:', error);
      return [];
    }
  }

  /**
   * Get performer details
   */
  static async getPerformer(performerId) {
    try {
      return await PerformerModel.getById(performerId);
    } catch (error) {
      logger.error('Error getting performer:', error);
      return null;
    }
  }

  /**
   * Compute available slots for a performer within a date range
   */
  static async getAvailableSlots(performerId, fromDate, toDate, durationMinutes = 30) {
    try {
      const performer = await PerformerModel.getById(performerId);
      if (!performer || performer.status !== 'active') {
        return [];
      }

      // Get existing bookings for the performer in the date range
      const existingBookings = await BookingModel.getByPerformer(performerId, {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      });

      // Filter to only active bookings
      const activeBookings = existingBookings.filter(b =>
        ['held', 'awaiting_payment', 'confirmed'].includes(b.status)
      );

      // Get availability rules from performer
      const availabilitySlots = await PerformerModel.getAvailabilitySlots(performerId, {
        startDate: fromDate.toISOString().split('T')[0],
        endDate: toDate.toISOString().split('T')[0],
        isAvailable: true,
        isBooked: false,
      });

      // Compute available slots based on schedule and existing bookings
      const slots = [];
      const bufferBefore = performer.bufferTimeBefore || 5;
      const bufferAfter = performer.bufferTimeAfter || 10;

      // Generate slots for each day
      const currentDate = new Date(fromDate);
      while (currentDate <= toDate) {
        const dayOfWeek = currentDate.getDay();
        const dateStr = currentDate.toISOString().split('T')[0];

        // Get availability for this day of week (from schedule or slots)
        const daySlots = availabilitySlots.filter(s =>
          s.date && s.date.toISOString().split('T')[0] === dateStr
        );

        // Default working hours if no specific slots: 10am - 10pm
        const workingHours = daySlots.length > 0
          ? daySlots.map(s => ({ start: s.startTime, end: s.endTime }))
          : [{ start: '10:00:00', end: '22:00:00' }];

        for (const hours of workingHours) {
          // Generate time slots
          const startHour = parseInt(hours.start.split(':')[0]);
          const startMinute = parseInt(hours.start.split(':')[1] || '0');
          const endHour = parseInt(hours.end.split(':')[0]);
          const endMinute = parseInt(hours.end.split(':')[1] || '0');

          let slotStart = new Date(currentDate);
          slotStart.setHours(startHour, startMinute, 0, 0);

          const dayEnd = new Date(currentDate);
          dayEnd.setHours(endHour, endMinute, 0, 0);

          while (slotStart < dayEnd) {
            const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

            // Check if slot is in the future (with buffer)
            const now = new Date();
            const minStartTime = new Date(now.getTime() + bufferBefore * 60 * 1000);

            if (slotStart >= minStartTime && slotEnd <= dayEnd) {
              // Check for conflicts with existing bookings
              const hasConflict = activeBookings.some(booking => {
                const bookingStart = new Date(booking.startTimeUtc);
                const bookingEnd = new Date(booking.endTimeUtc);
                const bookingStartWithBuffer = new Date(bookingStart.getTime() - bufferBefore * 60 * 1000);
                const bookingEndWithBuffer = new Date(bookingEnd.getTime() + bufferAfter * 60 * 1000);

                return slotStart < bookingEndWithBuffer && slotEnd > bookingStartWithBuffer;
              });

              if (!hasConflict) {
                slots.push({
                  startUtc: slotStart.toISOString(),
                  endUtc: slotEnd.toISOString(),
                  durationMinutes,
                  available: true,
                });
              }
            }

            // Move to next slot (30-minute intervals)
            slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
          }
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return slots;
    } catch (error) {
      logger.error('Error getting available slots:', error);
      return [];
    }
  }

  // =====================================================
  // BOOKING LIFECYCLE
  // =====================================================

  /**
   * Create a draft booking
   */
  static async createBooking(data) {
    try {
      // Calculate price
      const performer = await PerformerModel.getById(data.performerId);
      if (!performer) {
        return { success: false, error: 'performer_not_found' };
      }

      // Price calculation: base_price_cents * (duration / 30)
      const priceMultiplier = data.durationMinutes / 30;
      const priceCents = Math.round(performer.basePriceCents * priceMultiplier);

      // Check slot availability
      const endTime = new Date(new Date(data.startTimeUtc).getTime() + data.durationMinutes * 60 * 1000);
      const isAvailable = await BookingModel.isSlotAvailable(
        data.performerId,
        data.startTimeUtc,
        endTime.toISOString()
      );

      if (!isAvailable) {
        return { success: false, error: 'slot_not_available' };
      }

      const booking = await BookingModel.create({
        userId: data.userId,
        performerId: data.performerId,
        callType: data.callType,
        durationMinutes: data.durationMinutes,
        startTimeUtc: data.startTimeUtc,
        priceCents,
        currency: performer.currency || 'USD',
      });

      return { success: true, booking };
    } catch (error) {
      logger.error('Error creating booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Hold a booking slot
   */
  static async holdBooking(bookingId, holdMinutes = 10) {
    try {
      return await BookingModel.hold(bookingId, holdMinutes);
    } catch (error) {
      logger.error('Error holding booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Confirm rules acceptance
   */
  static async confirmRules(bookingId) {
    try {
      return await BookingModel.confirmRules(bookingId);
    } catch (error) {
      logger.error('Error confirming rules:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel a booking
   */
  static async cancelBooking(bookingId, reason, cancelledBy = 'user') {
    try {
      const result = await BookingModel.cancel(bookingId, reason, cancelledBy);

      if (result.success) {
        // Cancel any scheduled notifications
        await BookingNotificationModel.cancelByBooking(bookingId);

        // Destroy any created session
        const session = await CallSessionModel.getByBookingId(bookingId);
        if (session) {
          await CallSessionModel.destroy(session.id);
        }
      }

      return result;
    } catch (error) {
      logger.error('Error cancelling booking:', error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // PAYMENT FLOW
  // =====================================================

  /**
   * Create payment link for booking
   */
  static async createPaymentLink(bookingId, provider = 'epayco', expiresMinutes = 10) {
    try {
      const booking = await BookingModel.getById(bookingId);
      if (!booking) {
        return { success: false, error: 'booking_not_found' };
      }

      if (booking.status !== 'awaiting_payment') {
        return { success: false, error: 'invalid_booking_status' };
      }

      const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

      // Create payment record
      const payment = await BookingModel.createPayment({
        bookingId,
        provider,
        amountCents: booking.priceCents,
        currency: booking.currency,
        expiresAt: expiresAt.toISOString(),
        metadata: {
          performerName: booking.performerName,
          durationMinutes: booking.durationMinutes,
          callType: booking.callType,
        },
      });

      // Generate payment link based on provider
      let paymentLink = '';
      const paymentId = payment.id;

      switch (provider) {

        case 'daimo':
          paymentLink = `${process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app'}/daimo-checkout/${paymentId}`;
          break;
        case 'epayco':
          paymentLink = `${process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app'}/payment/${paymentId}`;
          break;
        default:
          paymentLink = `${process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app'}/checkout/${paymentId}`;
      }

      // Update payment with link
      await BookingModel.updatePaymentLink(paymentId, paymentLink);

      logger.info('Payment link created', { bookingId, paymentId, provider });

      return {
        success: true,
        paymentId,
        paymentLink,
        expiresAt,
        amountCents: booking.priceCents,
        currency: booking.currency,
      };
    } catch (error) {
      logger.error('Error creating payment link:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle payment completion (called from webhook)
   */
  static async handlePaymentComplete(paymentId, providerPaymentId = null) {
    try {
      // Get payment and booking
      const payment = await this.getPaymentById(paymentId);
      if (!payment) {
        // Try to find by provider payment ID
        if (providerPaymentId) {
          // Would need to implement search by provider ID
          logger.error('Payment not found', { paymentId, providerPaymentId });
        }
        return { success: false, error: 'payment_not_found' };
      }

      // Update payment status
      await BookingModel.updatePaymentStatus(paymentId, 'paid', { providerPaymentId });

      // Confirm booking
      const confirmResult = await BookingModel.confirm(payment.bookingId);
      if (!confirmResult.success) {
        return { success: false, error: 'booking_confirmation_failed' };
      }

      const booking = confirmResult.booking;

      // Create call session
      const session = await this.createCallSession(payment.bookingId);

      // Schedule reminders
      const performer = await PerformerModel.getById(booking.performerId);
      await BookingNotificationModel.scheduleBookingReminders(
        { ...booking, performerName: performer?.displayName },
        performer?.userId
      );

      logger.info('Payment completed, booking confirmed', { paymentId, bookingId: payment.bookingId });

      return {
        success: true,
        booking,
        session,
      };
    } catch (error) {
      logger.error('Error handling payment completion:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get payment by ID
   */
  static async getPaymentById(paymentId) {
    try {
      const { query } = require('../../config/postgres');
      const sql = `SELECT * FROM booking_payments WHERE id = $1`;
      const result = await query(sql, [paymentId]);
      return BookingModel.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error getting payment:', error);
      return null;
    }
  }

  /**
   * Check payment status
   */
  static async checkPaymentStatus(bookingId) {
    try {
      const payment = await BookingModel.getPaymentByBooking(bookingId);
      if (!payment) {
        return { status: 'not_found' };
      }

      return {
        status: payment.status,
        paymentId: payment.id,
        paymentLink: payment.paymentLink,
        expiresAt: payment.expiresAt,
        paidAt: payment.paidAt,
      };
    } catch (error) {
      logger.error('Error checking payment status:', error);
      return { status: 'error' };
    }
  }

  // =====================================================
  // CALL SESSION MANAGEMENT
  // =====================================================

  /**
   * Create call session for confirmed booking
   */
  static async createCallSession(bookingId) {
    try {
      const booking = await BookingModel.getById(bookingId);
      if (!booking) {
        return { success: false, error: 'booking_not_found' };
      }

      // Generate room ID and URLs
      const roomId = `pnptv-${bookingId.slice(0, 8)}`;
      const baseUrl = process.env.JITSI_DOMAIN || 'meet.jit.si';

      // Create session
      const session = await CallSessionModel.create({
        bookingId,
        roomProvider: 'jitsi',
        roomId,
        roomName: `Private Call - ${booking.performerName}`,
        joinUrlUser: `https://${baseUrl}/${roomId}`,
        joinUrlPerformer: `https://${baseUrl}/${roomId}`,
        maxParticipants: 2,
        recordingDisabled: true,
      });

      logger.info('Call session created', { bookingId, sessionId: session.id, roomId });

      return { success: true, session };
    } catch (error) {
      logger.error('Error creating call session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get call session for booking
   */
  static async getCallSession(bookingId) {
    try {
      return await CallSessionModel.getByBookingId(bookingId);
    } catch (error) {
      logger.error('Error getting call session:', error);
      return null;
    }
  }

  /**
   * Start call session
   */
  static async startCallSession(bookingId) {
    try {
      const session = await CallSessionModel.getByBookingId(bookingId);
      if (!session) {
        return { success: false, error: 'session_not_found' };
      }

      return await CallSessionModel.start(session.id);
    } catch (error) {
      logger.error('Error starting call session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End call session
   */
  static async endCallSession(bookingId) {
    try {
      const session = await CallSessionModel.getByBookingId(bookingId);
      if (!session) {
        return { success: false, error: 'session_not_found' };
      }

      const endResult = await CallSessionModel.end(session.id);

      if (endResult.success) {
        // Mark booking as completed
        await BookingModel.complete(bookingId);
      }

      return endResult;
    } catch (error) {
      logger.error('Error ending call session:', error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // USER BOOKINGS
  // =====================================================

  /**
   * Get user's bookings
   */
  static async getUserBookings(userId, options = {}) {
    try {
      return await BookingModel.getByUser(userId, options);
    } catch (error) {
      logger.error('Error getting user bookings:', error);
      return [];
    }
  }

  /**
   * Get booking details
   */
  static async getBooking(bookingId) {
    try {
      return await BookingModel.getById(bookingId);
    } catch (error) {
      logger.error('Error getting booking:', error);
      return null;
    }
  }

  // =====================================================
  // CRON JOBS
  // =====================================================

  /**
   * Expire held bookings (run every minute)
   */
  static async expireHeldBookings() {
    try {
      return await BookingModel.expireHeldBookings();
    } catch (error) {
      logger.error('Error expiring held bookings:', error);
      return 0;
    }
  }

  /**
   * Send pending notifications (run every minute)
   */
  static async sendPendingNotifications(bot) {
    try {
      const notifications = await BookingNotificationModel.getDuePending();
      let sentCount = 0;

      for (const notification of notifications) {
        try {
          const message = this.formatNotificationMessage(notification);

          await bot.telegram.sendMessage(notification.userId, message, {
            parse_mode: 'Markdown',
          });

          await BookingNotificationModel.markSent(notification.id);
          sentCount++;
        } catch (sendError) {
          logger.error('Error sending notification:', { notificationId: notification.id, error: sendError.message });
          await BookingNotificationModel.markFailed(notification.id, sendError.message);
        }
      }

      if (sentCount > 0) {
        logger.info('Sent pending notifications', { count: sentCount });
      }

      return sentCount;
    } catch (error) {
      logger.error('Error sending pending notifications:', error);
      return 0;
    }
  }

  /**
   * Format notification message
   */
  static formatNotificationMessage(notification) {
    const { type, payload, startTimeUtc, performerName, durationMinutes } = notification;

    switch (type) {
      case 'reminder_60':
        return `🔔 *Reminder: Private Call in 60 minutes*\n\n` +
          `🎭 With: ${performerName}\n` +
          `⏱ Duration: ${durationMinutes} minutes\n\n` +
          `Get ready for your call!`;

      case 'reminder_15':
        return `🔔 *Reminder: Private Call in 15 minutes*\n\n` +
          `🎭 With: ${performerName}\n` +
          `⏱ Duration: ${durationMinutes} minutes\n\n` +
          `Make sure you're in a quiet place with good internet.`;

      case 'reminder_5':
        return `⚡ *Your call starts in 5 minutes!*\n\n` +
          `🎭 With: ${performerName}\n\n` +
          `Tap the button below to join when ready.`;

      case 'followup':
        return `✅ *Hope you enjoyed your call with ${payload?.performerName}!*\n\n` +
          `If you have any feedback, we'd love to hear it.`;

      case 'feedback_request':
        return `⭐ *How was your call with ${payload?.performerName}?*\n\n` +
          `Your feedback helps us improve. Would you like to rate your experience?`;

      default:
        return `📢 You have a notification about your private call booking.`;
    }
  }

  /**
   * Auto-end overdue calls (run every minute)
   */
  static async autoEndOverdueCalls() {
    try {
      const overdueSessions = await CallSessionModel.getOverdueSessions();
      let endedCount = 0;

      for (const session of overdueSessions) {
        try {
          await CallSessionModel.end(session.id);
          await BookingModel.complete(session.bookingId);
          endedCount++;
        } catch (endError) {
          logger.error('Error auto-ending session:', { sessionId: session.id, error: endError.message });
        }
      }

      if (endedCount > 0) {
        logger.info('Auto-ended overdue calls', { count: endedCount });
      }

      return endedCount;
    } catch (error) {
      logger.error('Error auto-ending overdue calls:', error);
      return 0;
    }
  }

  /**
   * Check for no-shows (run every 5 minutes)
   */
  static async checkNoShows(gracePeriodMinutes = 10) {
    try {
      const { query } = require('../../config/postgres');

      // Find confirmed bookings where start time + grace period has passed and no session started
      const sql = `
        SELECT b.id as booking_id, s.id as session_id
        FROM bookings b
        LEFT JOIN call_sessions s ON b.id = s.booking_id
        WHERE b.status = 'confirmed'
          AND b.start_time_utc + ($1 || ' minutes')::INTERVAL < NOW()
          AND (s.id IS NULL OR s.status = 'scheduled')
      `;

      const result = await query(sql, [gracePeriodMinutes]);
      let noShowCount = 0;

      for (const row of result.rows) {
        await BookingModel.markNoShow(row.booking_id);
        if (row.session_id) {
          await CallSessionModel.destroy(row.session_id);
        }
        noShowCount++;
      }

      if (noShowCount > 0) {
        logger.info('Marked no-shows', { count: noShowCount });
      }

      return noShowCount;
    } catch (error) {
      logger.error('Error checking no-shows:', error);
      return 0;
    }
  }
}

module.exports = PrivateCallBookingService;
