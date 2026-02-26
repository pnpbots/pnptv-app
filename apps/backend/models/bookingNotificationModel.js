const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'booking_notifications';

/**
 * Booking Notification Model - Manages scheduled notifications/reminders
 * Types: reminder_60, reminder_15, reminder_5, booking_confirmed, payment_received,
 *        call_starting, followup, feedback_request, admin_alert
 */
class BookingNotificationModel {
  // =====================================================
  // ROW MAPPING
  // =====================================================

  static mapRowToNotification(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      bookingId: row.booking_id,
      type: row.type,
      recipientType: row.recipient_type,
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      status: row.status,
      payload: row.payload,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      createdAt: row.created_at,
    };
  }

  // =====================================================
  // CRUD OPERATIONS
  // =====================================================

  /**
   * Create a notification
   */
  static async create(data) {
    try {
      const id = uuidv4();
      const sql = `
        INSERT INTO ${TABLE} (
          id, user_id, booking_id, type, recipient_type, scheduled_for, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;

      const result = await query(sql, [
        id,
        data.userId,
        data.bookingId || null,
        data.type,
        data.recipientType || 'user',
        data.scheduledFor,
        JSON.stringify(data.payload || {}),
      ]);

      logger.debug('Notification created', { notificationId: id, type: data.type, scheduledFor: data.scheduledFor });
      return this.mapRowToNotification(result.rows[0]);
    } catch (error) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create multiple notifications at once (for reminders)
   */
  static async createBatch(notifications) {
    try {
      if (!notifications || notifications.length === 0) return [];

      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const notif of notifications) {
        const id = uuidv4();
        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(
          id,
          notif.userId,
          notif.bookingId || null,
          notif.type,
          notif.recipientType || 'user',
          notif.scheduledFor,
          JSON.stringify(notif.payload || {})
        );
      }

      const sql = `
        INSERT INTO ${TABLE} (id, user_id, booking_id, type, recipient_type, scheduled_for, payload)
        VALUES ${placeholders.join(', ')}
        RETURNING *
      `;

      const result = await query(sql, values);
      logger.info('Batch notifications created', { count: result.rows.length });
      return result.rows.map(row => this.mapRowToNotification(row));
    } catch (error) {
      logger.error('Error creating batch notifications:', error);
      throw error;
    }
  }

  /**
   * Get notification by ID
   */
  static async getById(notificationId) {
    try {
      const sql = `SELECT * FROM ${TABLE} WHERE id = $1`;
      const result = await query(sql, [notificationId]);
      return this.mapRowToNotification(result.rows[0]);
    } catch (error) {
      logger.error('Error getting notification by ID:', error);
      return null;
    }
  }

  /**
   * Get notifications for a booking
   */
  static async getByBooking(bookingId) {
    try {
      const sql = `
        SELECT * FROM ${TABLE}
        WHERE booking_id = $1
        ORDER BY scheduled_for ASC
      `;
      const result = await query(sql, [bookingId]);
      return result.rows.map(row => this.mapRowToNotification(row));
    } catch (error) {
      logger.error('Error getting notifications by booking:', error);
      return [];
    }
  }

  // =====================================================
  // NOTIFICATION DISPATCH
  // =====================================================

  /**
   * Get pending notifications that are due
   */
  static async getDuePending() {
    try {
      const sql = `
        SELECT n.*,
               b.performer_id, b.start_time_utc, b.duration_minutes,
               p.display_name as performer_name,
               u.first_name as user_name, u.username as user_username
        FROM ${TABLE} n
        LEFT JOIN bookings b ON n.booking_id = b.id
        LEFT JOIN performers p ON b.performer_id = p.id
        LEFT JOIN users u ON n.user_id = u.id
        WHERE n.status = 'scheduled'
          AND n.scheduled_for <= NOW()
        ORDER BY n.scheduled_for ASC
        LIMIT 100
      `;
      const result = await query(sql);
      return result.rows.map(row => ({
        ...this.mapRowToNotification(row),
        performerId: row.performer_id,
        performerName: row.performer_name,
        userName: row.user_name,
        userUsername: row.user_username,
        startTimeUtc: row.start_time_utc,
        durationMinutes: row.duration_minutes,
      }));
    } catch (error) {
      logger.error('Error getting due pending notifications:', error);
      return [];
    }
  }

  /**
   * Mark notification as sent
   */
  static async markSent(notificationId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'sent',
            sent_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      const result = await query(sql, [notificationId]);
      return this.mapRowToNotification(result.rows[0]);
    } catch (error) {
      logger.error('Error marking notification as sent:', error);
      return null;
    }
  }

  /**
   * Mark notification as failed
   */
  static async markFailed(notificationId, errorMessage) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'failed',
            error_message = $2,
            retry_count = retry_count + 1
        WHERE id = $1
        RETURNING *
      `;
      const result = await query(sql, [notificationId, errorMessage]);
      return this.mapRowToNotification(result.rows[0]);
    } catch (error) {
      logger.error('Error marking notification as failed:', error);
      return null;
    }
  }

  /**
   * Cancel notification
   */
  static async cancel(notificationId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'cancelled'
        WHERE id = $1 AND status = 'scheduled'
        RETURNING *
      `;
      const result = await query(sql, [notificationId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Error cancelling notification:', error);
      return false;
    }
  }

  /**
   * Cancel all pending notifications for a booking
   */
  static async cancelByBooking(bookingId) {
    try {
      const sql = `
        UPDATE ${TABLE}
        SET status = 'cancelled'
        WHERE booking_id = $1 AND status = 'scheduled'
      `;
      const result = await query(sql, [bookingId]);
      logger.info('Cancelled booking notifications', { bookingId, count: result.rowCount });
      return result.rowCount;
    } catch (error) {
      logger.error('Error cancelling booking notifications:', error);
      return 0;
    }
  }

  // =====================================================
  // REMINDER SCHEDULING HELPERS
  // =====================================================

  /**
   * Schedule all reminders for a confirmed booking
   */
  static async scheduleBookingReminders(booking, performerUserId = null) {
    try {
      const notifications = [];
      const startTime = new Date(booking.startTimeUtc);

      // User reminders
      const userReminders = [
        { type: 'reminder_60', minutesBefore: 60 },
        { type: 'reminder_15', minutesBefore: 15 },
        { type: 'reminder_5', minutesBefore: 5 },
      ];

      for (const reminder of userReminders) {
        const scheduledFor = new Date(startTime.getTime() - reminder.minutesBefore * 60 * 1000);
        if (scheduledFor > new Date()) {
          notifications.push({
            userId: booking.userId,
            bookingId: booking.id,
            type: reminder.type,
            recipientType: 'user',
            scheduledFor: scheduledFor.toISOString(),
            payload: {
              minutesBefore: reminder.minutesBefore,
              performerName: booking.performerName,
              callType: booking.callType,
              durationMinutes: booking.durationMinutes,
            },
          });
        }
      }

      // Performer reminders (if performer has a telegram user ID)
      if (performerUserId) {
        for (const reminder of userReminders) {
          const scheduledFor = new Date(startTime.getTime() - reminder.minutesBefore * 60 * 1000);
          if (scheduledFor > new Date()) {
            notifications.push({
              userId: performerUserId,
              bookingId: booking.id,
              type: reminder.type,
              recipientType: 'performer',
              scheduledFor: scheduledFor.toISOString(),
              payload: {
                minutesBefore: reminder.minutesBefore,
                userName: booking.userName,
                callType: booking.callType,
                durationMinutes: booking.durationMinutes,
              },
            });
          }
        }
      }

      // Followup notification (5 minutes after scheduled end)
      const endTime = new Date(startTime.getTime() + booking.durationMinutes * 60 * 1000);
      const followupTime = new Date(endTime.getTime() + 5 * 60 * 1000);
      notifications.push({
        userId: booking.userId,
        bookingId: booking.id,
        type: 'followup',
        recipientType: 'user',
        scheduledFor: followupTime.toISOString(),
        payload: {
          performerName: booking.performerName,
        },
      });

      // Feedback request (30 minutes after call)
      const feedbackTime = new Date(endTime.getTime() + 30 * 60 * 1000);
      notifications.push({
        userId: booking.userId,
        bookingId: booking.id,
        type: 'feedback_request',
        recipientType: 'user',
        scheduledFor: feedbackTime.toISOString(),
        payload: {
          performerName: booking.performerName,
        },
      });

      if (notifications.length > 0) {
        return await this.createBatch(notifications);
      }

      return [];
    } catch (error) {
      logger.error('Error scheduling booking reminders:', error);
      return [];
    }
  }

  // =====================================================
  // STATISTICS
  // =====================================================

  /**
   * Get notification statistics
   */
  static async getStatistics(options = {}) {
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;

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
          COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled_count,
          COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
          COUNT(*) as total_count
        FROM ${TABLE}
        ${whereClause}
      `;

      const result = await query(sql, params);
      const row = result.rows[0];

      return {
        scheduled: parseInt(row.scheduled_count) || 0,
        sent: parseInt(row.sent_count) || 0,
        failed: parseInt(row.failed_count) || 0,
        cancelled: parseInt(row.cancelled_count) || 0,
        total: parseInt(row.total_count) || 0,
      };
    } catch (error) {
      logger.error('Error getting notification statistics:', error);
      return { scheduled: 0, sent: 0, failed: 0, cancelled: 0, total: 0 };
    }
  }
}

module.exports = BookingNotificationModel;
