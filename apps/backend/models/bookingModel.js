const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const BOOKINGS_TABLE = 'bookings';
const PAYMENTS_TABLE = 'booking_payments';
const SLOTS_TABLE = 'booking_slots';

/**
 * Booking Model - Manages private call booking lifecycle
 * Statuses: draft -> held -> awaiting_payment -> confirmed -> completed
 *                         |-> expired
 *                         |-> cancelled
 */
class BookingModel {
  // =====================================================
  // ROW MAPPING
  // =====================================================

  static mapRowToBooking(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      performerId: row.performer_id,
      slotId: row.slot_id,
      callType: row.call_type,
      durationMinutes: row.duration_minutes,
      priceCents: row.price_cents,
      currency: row.currency,
      startTimeUtc: row.start_time_utc,
      endTimeUtc: row.end_time_utc,
      status: row.status,
      holdExpiresAt: row.hold_expires_at,
      cancelReason: row.cancel_reason,
      cancelledBy: row.cancelled_by,
      cancelledAt: row.cancelled_at,
      completedAt: row.completed_at,
      rulesAcceptedAt: row.rules_accepted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Joined fields
      performerName: row.performer_name,
      performerPhoto: row.performer_photo,
      userName: row.user_name,
      userUsername: row.user_username,
    };
  }

  static mapRowToPayment(row) {
    if (!row) return null;
    return {
      id: row.id,
      bookingId: row.booking_id,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      paymentLink: row.payment_link,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
      refundedAt: row.refunded_at,
      refundReason: row.refund_reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =====================================================
  // BOOKING CRUD
  // =====================================================

  /**
   * Create a new booking (draft status)
   */
  static async create(data) {
    try {
      const id = uuidv4();
      const endTime = new Date(new Date(data.startTimeUtc).getTime() + data.durationMinutes * 60 * 1000);

      const sql = `
        INSERT INTO ${BOOKINGS_TABLE} (
          id, user_id, performer_id, call_type, duration_minutes,
          price_cents, currency, start_time_utc, end_time_utc, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
        RETURNING *
      `;

      const result = await query(sql, [
        id,
        data.userId,
        data.performerId,
        data.callType,
        data.durationMinutes,
        data.priceCents,
        data.currency || 'USD',
        data.startTimeUtc,
        endTime.toISOString(),
      ]);

      logger.info('Booking created', { bookingId: id, userId: data.userId, performerId: data.performerId });
      return this.mapRowToBooking(result.rows[0]);
    } catch (error) {
      logger.error('Error creating booking:', error);
      throw error;
    }
  }

  /**
   * Get booking by ID with performer details
   */
  static async getById(bookingId) {
    try {
      const sql = `
        SELECT b.*,
               p.display_name as performer_name,
               p.photo_url as performer_photo,
               u.first_name as user_name,
               u.username as user_username
        FROM ${BOOKINGS_TABLE} b
        LEFT JOIN performers p ON b.performer_id = p.id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.id = $1
      `;
      const result = await query(sql, [bookingId]);
      return this.mapRowToBooking(result.rows[0]);
    } catch (error) {
      logger.error('Error getting booking by ID:', error);
      return null;
    }
  }

  /**
   * Get bookings by user
   */
  static async getByUser(userId, options = {}) {
    try {
      let sql = `
        SELECT b.*,
               p.display_name as performer_name,
               p.photo_url as performer_photo
        FROM ${BOOKINGS_TABLE} b
        LEFT JOIN performers p ON b.performer_id = p.id
        WHERE b.user_id = $1
      `;
      const params = [userId];
      let paramIndex = 2;

      if (options.status) {
        sql += ` AND b.status = $${paramIndex++}`;
        params.push(options.status);
      }

      if (options.statuses && Array.isArray(options.statuses)) {
        sql += ` AND b.status = ANY($${paramIndex++})`;
        params.push(options.statuses);
      }

      if (options.upcoming) {
        sql += ` AND b.start_time_utc > NOW()`;
      }

      sql += ` ORDER BY b.start_time_utc ${options.upcoming ? 'ASC' : 'DESC'}`;

      if (options.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      const result = await query(sql, params);
      return result.rows.map(row => this.mapRowToBooking(row));
    } catch (error) {
      logger.error('Error getting user bookings:', error);
      return [];
    }
  }

  /**
   * Get bookings by performer
   */
  static async getByPerformer(performerId, options = {}) {
    try {
      let sql = `
        SELECT b.*,
               u.first_name as user_name,
               u.username as user_username
        FROM ${BOOKINGS_TABLE} b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.performer_id = $1
      `;
      const params = [performerId];
      let paramIndex = 2;

      if (options.status) {
        sql += ` AND b.status = $${paramIndex++}`;
        params.push(options.status);
      }

      if (options.fromDate) {
        sql += ` AND b.start_time_utc >= $${paramIndex++}`;
        params.push(options.fromDate);
      }

      if (options.toDate) {
        sql += ` AND b.start_time_utc <= $${paramIndex++}`;
        params.push(options.toDate);
      }

      sql += ` ORDER BY b.start_time_utc ASC`;

      if (options.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      const result = await query(sql, params);
      return result.rows.map(row => this.mapRowToBooking(row));
    } catch (error) {
      logger.error('Error getting performer bookings:', error);
      return [];
    }
  }

  // =====================================================
  // BOOKING LIFECYCLE
  // =====================================================

  /**
   * Update booking fields (partial update)
   */
  static async update(bookingId, updates = {}) {
    try {
      const current = await this.getById(bookingId);
      if (!current) {
        return { success: false, error: 'booking_not_found' };
      }

      const fields = [];
      const values = [];
      let paramIndex = 1;

      const setField = (field, value) => {
        fields.push(`${field} = $${paramIndex++}`);
        values.push(value);
      };

      if (updates.callType) {
        setField('call_type', updates.callType);
      }

      if (updates.durationMinutes) {
        setField('duration_minutes', updates.durationMinutes);
      }

      if (updates.priceCents !== undefined) {
        setField('price_cents', updates.priceCents);
      }

      if (updates.currency) {
        setField('currency', updates.currency);
      }

      if (updates.slotId) {
        setField('slot_id', updates.slotId);
      }

      if (updates.status) {
        setField('status', updates.status);
      }

      if (updates.startTimeUtc) {
        setField('start_time_utc', updates.startTimeUtc);
      }

      if (updates.durationMinutes || updates.startTimeUtc) {
        const startTime = updates.startTimeUtc || current.startTimeUtc;
        const durationMinutes = updates.durationMinutes || current.durationMinutes;
        const endTime = new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000);
        setField('end_time_utc', endTime.toISOString());
      }

      if (fields.length === 0) {
        return { success: true, booking: current };
      }

      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      values.push(bookingId);

      const result = await query(sql, values);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found' };
      }

      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error updating booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update booking status
   */
  static async updateStatus(bookingId, status) {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = $2,
            hold_expires_at = CASE WHEN $2 IN ('confirmed', 'cancelled', 'completed', 'expired', 'no_show') THEN NULL ELSE hold_expires_at END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      const result = await query(sql, [bookingId, status]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found' };
      }

      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error updating booking status:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Hold a booking slot for X minutes
   */
  static async hold(bookingId, holdMinutes = 10) {
    try {
      // First check if slot is still available using the DB function
      const checkSql = `
        SELECT is_slot_available(performer_id, start_time_utc, end_time_utc) as available
        FROM ${BOOKINGS_TABLE}
        WHERE id = $1 AND status = 'draft'
      `;
      const checkResult = await query(checkSql, [bookingId]);

      if (!checkResult.rows[0]?.available) {
        logger.warn('Slot no longer available for hold', { bookingId });
        return { success: false, error: 'slot_unavailable' };
      }

      // Hold the booking
      const holdSql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'held',
            hold_expires_at = NOW() + ($2 || ' minutes')::INTERVAL
        WHERE id = $1 AND status = 'draft'
        RETURNING *
      `;
      const result = await query(holdSql, [bookingId, holdMinutes]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found' };
      }

      logger.info('Booking held', { bookingId, holdMinutes });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error holding booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Confirm rules and move to awaiting_payment
   */
  static async confirmRules(bookingId) {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'awaiting_payment',
            rules_accepted_at = NOW()
        WHERE id = $1 AND status = 'held'
        RETURNING *
      `;
      const result = await query(sql, [bookingId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found_or_invalid_status' };
      }

      logger.info('Booking rules confirmed', { bookingId });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error confirming rules:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Confirm booking (after payment)
   */
  static async confirm(bookingId) {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'confirmed',
            hold_expires_at = NULL
        WHERE id = $1 AND status IN ('awaiting_payment', 'held')
        RETURNING *
      `;
      const result = await query(sql, [bookingId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found_or_invalid_status' };
      }

      logger.info('Booking confirmed', { bookingId });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error confirming booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel booking
   */
  static async cancel(bookingId, reason, cancelledBy = 'user') {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'cancelled',
            cancel_reason = $2,
            cancelled_by = $3,
            cancelled_at = NOW(),
            hold_expires_at = NULL
        WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'expired')
        RETURNING *
      `;
      const result = await query(sql, [bookingId, reason, cancelledBy]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found_or_already_final' };
      }

      logger.info('Booking cancelled', { bookingId, reason, cancelledBy });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error cancelling booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark booking as completed
   */
  static async complete(bookingId) {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = $1 AND status = 'confirmed'
        RETURNING *
      `;
      const result = await query(sql, [bookingId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found_or_invalid_status' };
      }

      logger.info('Booking completed', { bookingId });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error completing booking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark booking as no-show
   */
  static async markNoShow(bookingId) {
    try {
      const sql = `
        UPDATE ${BOOKINGS_TABLE}
        SET status = 'no_show',
            completed_at = NOW()
        WHERE id = $1 AND status = 'confirmed'
        RETURNING *
      `;
      const result = await query(sql, [bookingId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'booking_not_found_or_invalid_status' };
      }

      logger.info('Booking marked as no-show', { bookingId });
      return { success: true, booking: this.mapRowToBooking(result.rows[0]) };
    } catch (error) {
      logger.error('Error marking no-show:', error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // HOLD EXPIRY
  // =====================================================

  /**
   * Expire all held/awaiting_payment bookings past their hold time
   */
  static async expireHeldBookings() {
    try {
      const sql = `SELECT expire_held_bookings() as expired_count`;
      const result = await query(sql);
      const expiredCount = result.rows[0]?.expired_count || 0;

      if (expiredCount > 0) {
        logger.info('Expired held bookings', { count: expiredCount });
      }

      return expiredCount;
    } catch (error) {
      logger.error('Error expiring held bookings:', error);
      return 0;
    }
  }

  // =====================================================
  // AVAILABILITY CHECK
  // =====================================================

  /**
   * Check if a time slot is available for a performer
   */
  static async isSlotAvailable(performerId, startTimeUtc, endTimeUtc) {
    try {
      const sql = `SELECT is_slot_available($1, $2, $3) as available`;
      const result = await query(sql, [performerId, startTimeUtc, endTimeUtc]);
      return result.rows[0]?.available || false;
    } catch (error) {
      logger.error('Error checking slot availability:', error);
      return false;
    }
  }

  /**
   * Get conflicting bookings for a time slot
   */
  static async getConflicting(performerId, startTimeUtc, endTimeUtc, excludeBookingId = null) {
    try {
      let sql = `
        SELECT * FROM ${BOOKINGS_TABLE}
        WHERE performer_id = $1
          AND status IN ('held', 'awaiting_payment', 'confirmed')
          AND start_time_utc < $3
          AND end_time_utc > $2
      `;
      const params = [performerId, startTimeUtc, endTimeUtc];

      if (excludeBookingId) {
        sql += ` AND id != $4`;
        params.push(excludeBookingId);
      }

      const result = await query(sql, params);
      return result.rows.map(row => this.mapRowToBooking(row));
    } catch (error) {
      logger.error('Error getting conflicting bookings:', error);
      return [];
    }
  }

  // =====================================================
  // PAYMENT MANAGEMENT
  // =====================================================

  /**
   * Create payment record for booking
   */
  static async createPayment(data) {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO ${PAYMENTS_TABLE} (
          id, booking_id, provider, provider_payment_id, payment_link,
          amount_cents, currency, status, expires_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9)
        RETURNING *
      `;

      const result = await query(sql, [
        id,
        data.bookingId,
        data.provider,
        data.providerPaymentId || null,
        data.paymentLink || null,
        data.amountCents,
        data.currency || 'USD',
        data.expiresAt || null,
        JSON.stringify(data.metadata || {}),
      ]);

      logger.info('Payment created', { paymentId: id, bookingId: data.bookingId, provider: data.provider });
      return this.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error creating payment:', error);
      throw error;
    }
  }

  /**
   * Get payment by booking ID
   */
  static async getPaymentByBooking(bookingId) {
    try {
      const sql = `
        SELECT * FROM ${PAYMENTS_TABLE}
        WHERE booking_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const result = await query(sql, [bookingId]);
      return this.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error getting payment by booking:', error);
      return null;
    }
  }

  /**
   * Get payment by provider payment ID
   */
  static async getPaymentByProviderId(provider, providerPaymentId) {
    try {
      const sql = `
        SELECT * FROM ${PAYMENTS_TABLE}
        WHERE provider = $1 AND provider_payment_id = $2
      `;
      const result = await query(sql, [provider, providerPaymentId]);
      return this.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error getting payment by provider ID:', error);
      return null;
    }
  }

  /**
   * Update payment status
   */
  static async updatePaymentStatus(paymentId, status, extraData = {}) {
    try {
      let sql = `UPDATE ${PAYMENTS_TABLE} SET status = $2`;
      const params = [paymentId, status];
      let paramIndex = 3;

      if (status === 'paid') {
        sql += `, paid_at = NOW()`;
      }

      if (status === 'refunded') {
        sql += `, refunded_at = NOW()`;
        if (extraData.refundReason) {
          sql += `, refund_reason = $${paramIndex++}`;
          params.push(extraData.refundReason);
        }
      }

      if (extraData.providerPaymentId) {
        sql += `, provider_payment_id = $${paramIndex++}`;
        params.push(extraData.providerPaymentId);
      }

      sql += ` WHERE id = $1 RETURNING *`;

      const result = await query(sql, params);
      logger.info('Payment status updated', { paymentId, status });
      return this.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error updating payment status:', error);
      return null;
    }
  }

  /**
   * Update payment with link
   */
  static async updatePaymentLink(paymentId, paymentLink, providerPaymentId = null) {
    try {
      const sql = `
        UPDATE ${PAYMENTS_TABLE}
        SET payment_link = $2,
            provider_payment_id = COALESCE($3, provider_payment_id),
            status = 'pending'
        WHERE id = $1
        RETURNING *
      `;
      const result = await query(sql, [paymentId, paymentLink, providerPaymentId]);
      return this.mapRowToPayment(result.rows[0]);
    } catch (error) {
      logger.error('Error updating payment link:', error);
      return null;
    }
  }

  // =====================================================
  // STATISTICS
  // =====================================================

  /**
   * Get booking statistics
   */
  static async getStatistics(options = {}) {
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (options.performerId) {
        whereClause += ` AND performer_id = $${paramIndex++}`;
        params.push(options.performerId);
      }

      if (options.fromDate) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(options.fromDate);
      }

      if (options.toDate) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(options.toDate);
      }

      const sql = `
        SELECT
          COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
          COUNT(*) FILTER (WHERE status = 'no_show') as no_show_count,
          COUNT(*) FILTER (WHERE status = 'expired') as expired_count,
          COUNT(*) as total_count,
          COALESCE(SUM(price_cents) FILTER (WHERE status IN ('confirmed', 'completed')), 0) as total_revenue_cents
        FROM ${BOOKINGS_TABLE}
        ${whereClause}
      `;

      const result = await query(sql, params);
      const row = result.rows[0];

      return {
        confirmed: parseInt(row.confirmed_count) || 0,
        completed: parseInt(row.completed_count) || 0,
        cancelled: parseInt(row.cancelled_count) || 0,
        noShow: parseInt(row.no_show_count) || 0,
        expired: parseInt(row.expired_count) || 0,
        total: parseInt(row.total_count) || 0,
        totalRevenueCents: parseInt(row.total_revenue_cents) || 0,
      };
    } catch (error) {
      logger.error('Error getting booking statistics:', error);
      return { confirmed: 0, completed: 0, cancelled: 0, noShow: 0, expired: 0, total: 0, totalRevenueCents: 0 };
    }
  }

  /**
   * Get upcoming bookings that need reminders
   */
  static async getUpcomingForReminders(minutesAhead) {
    try {
      const sql = `
        SELECT b.*,
               p.display_name as performer_name,
               u.first_name as user_name,
               u.username as user_username
        FROM ${BOOKINGS_TABLE} b
        LEFT JOIN performers p ON b.performer_id = p.id
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.status = 'confirmed'
          AND b.start_time_utc > NOW()
          AND b.start_time_utc <= NOW() + ($1 || ' minutes')::INTERVAL
        ORDER BY b.start_time_utc ASC
      `;
      const result = await query(sql, [minutesAhead]);
      return result.rows.map(row => this.mapRowToBooking(row));
    } catch (error) {
      logger.error('Error getting upcoming bookings for reminders:', error);
      return [];
    }
  }
}

module.exports = BookingModel;
