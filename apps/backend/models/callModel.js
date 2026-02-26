const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE = 'private_calls';
const AVAILABILITY_TABLE = 'call_availability';

/**
 * Call Model - Manages 1:1 private calls with PostgreSQL
 */
class CallModel {
  /**
   * Create a new call booking
   * @param {Object} callData - { userId, userName, paymentId, scheduledDate, scheduledTime, duration, performer }
   * @returns {Promise<Object>} Created call
   */
  static async create(callData) {
    try {
      const callId = uuidv4();
      const performer = callData.performer || 'Santino';
      const userId = callData.userId?.toString();

      const sql = `
        INSERT INTO ${TABLE} (
          id, caller_id, receiver_id, user_id, user_name, payment_id, scheduled_date, scheduled_time,
          duration, performer, status, meeting_url, reminder_sent,
          reminder_24h_sent, reminder_1h_sent, reminder_15min_sent,
          feedback_submitted, amount, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
        RETURNING *
      `;

      const result = await query(sql, [
        callId,
        userId, // caller_id - the user booking the call
        userId, // receiver_id - temporarily same as caller (will be updated when performer joins)
        userId, // user_id
        callData.userName,
        callData.paymentId,
        callData.scheduledDate,
        callData.scheduledTime,
        callData.duration || 30,
        performer,
        'pending',
        null,
        false,
        false,
        false,
        false,
        false,
        callData.amount || 100,
      ]);

      logger.info('Private call booking created', {
        callId,
        userId: callData.userId,
        performer,
      });

      return this.mapRowToCall(result.rows[0]);
    } catch (error) {
      logger.error('Error creating call booking:', error);
      throw error;
    }
  }

  /**
   * Map database row to call object
   */
  static mapRowToCall(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      paymentId: row.payment_id,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      duration: row.duration,
      performer: row.performer,
      status: row.status,
      meetingUrl: row.meeting_url,
      reminderSent: row.reminder_sent,
      reminder24hSent: row.reminder_24h_sent,
      reminder1hSent: row.reminder_1h_sent,
      reminder15minSent: row.reminder_15min_sent,
      feedbackSubmitted: row.feedback_submitted,
      amount: row.amount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get call by ID
   */
  static async getById(callId) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [callId]);
      if (result.rows.length === 0) return null;
      return this.mapRowToCall(result.rows[0]);
    } catch (error) {
      logger.error('Error getting call:', error);
      return null;
    }
  }

  /**
   * Get calls by payment ID
   */
  static async getByPaymentId(paymentId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE payment_id = $1`,
        [paymentId]
      );
      return result.rows.map((row) => this.mapRowToCall(row));
    } catch (error) {
      logger.error('Error getting calls by payment ID:', error);
      return [];
    }
  }

  /**
   * Get calls by performer ID
   */
  static async getByPerformer(performerId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE performer_id = $1 ORDER BY created_at DESC`,
        [performerId]
      );
      return result.rows.map((row) => this.mapRowToCall(row));
    } catch (error) {
      logger.error('Error getting calls by performer ID:', error);
      return [];
    }
  }

  /**
   * Get user's calls
   */
  static async getByUser(userId, limit = 20) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId.toString(), limit]
      );
      return result.rows.map((row) => this.mapRowToCall(row));
    } catch (error) {
      logger.error('Error getting user calls:', error);
      return [];
    }
  }

  /**
   * Get calls by status
   */
  static async getByStatus(status, limit = 100) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE status = $1 ORDER BY scheduled_date ASC LIMIT $2`,
        [status, limit]
      );
      return result.rows.map((row) => this.mapRowToCall(row));
    } catch (error) {
      logger.error('Error getting calls by status:', error);
      return [];
    }
  }

  /**
   * Update call status
   */
  static async updateStatus(callId, status, metadata = {}) {
    try {
      const updates = ['status = $2', 'updated_at = NOW()'];
      const values = [callId, status];
      let paramIndex = 3;

      if (metadata.meetingUrl !== undefined) {
        updates.push(`meeting_url = $${paramIndex++}`);
        values.push(metadata.meetingUrl);
      }
      if (metadata.reminderSent !== undefined) {
        updates.push(`reminder_sent = $${paramIndex++}`);
        values.push(metadata.reminderSent);
      }
      if (metadata.reminder24hSent !== undefined) {
        updates.push(`reminder_24h_sent = $${paramIndex++}`);
        values.push(metadata.reminder24hSent);
      }
      if (metadata.reminder1hSent !== undefined) {
        updates.push(`reminder_1h_sent = $${paramIndex++}`);
        values.push(metadata.reminder1hSent);
      }
      if (metadata.reminder15minSent !== undefined) {
        updates.push(`reminder_15min_sent = $${paramIndex++}`);
        values.push(metadata.reminder15minSent);
      }
      if (metadata.feedbackSubmitted !== undefined) {
        updates.push(`feedback_submitted = $${paramIndex++}`);
        values.push(metadata.feedbackSubmitted);
      }

      await query(`UPDATE ${TABLE} SET ${updates.join(', ')} WHERE id = $1`, values);
      logger.info('Call status updated', { callId, status });
      return true;
    } catch (error) {
      logger.error('Error updating call status:', error);
      return false;
    }
  }

  /**
   * Set admin availability
   */
  static async setAvailability(availabilityData) {
    try {
      // Use id=1 as singleton row for current availability
      const sql = `
        INSERT INTO ${AVAILABILITY_TABLE} (id, admin_id, available, message, valid_until, updated_at)
        VALUES (1, $1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
          admin_id = EXCLUDED.admin_id,
          available = EXCLUDED.available,
          message = EXCLUDED.message,
          valid_until = EXCLUDED.valid_until,
          updated_at = NOW()
        RETURNING *
      `;

      const result = await query(sql, [
        availabilityData.adminId,
        availabilityData.available,
        availabilityData.message,
        availabilityData.validUntil,
      ]);

      logger.info('Call availability updated', {
        adminId: availabilityData.adminId,
        available: availabilityData.available,
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Error setting availability:', error);
      throw error;
    }
  }

  /**
   * Get current availability
   */
  static async getAvailability() {
    try {
      const result = await query(`SELECT * FROM ${AVAILABILITY_TABLE} WHERE id = 1`);

      if (result.rows.length === 0) {
        return { available: false, message: 'Not available' };
      }

      const data = result.rows[0];

      // Check if availability has expired
      if (data.valid_until && new Date(data.valid_until) < new Date()) {
        return { available: false, message: 'Availability expired' };
      }

      return {
        available: data.available,
        message: data.message,
        adminId: data.admin_id,
        validUntil: data.valid_until,
      };
    } catch (error) {
      logger.error('Error getting availability:', error);
      return { available: false, message: 'Error checking availability' };
    }
  }

  /**
   * Get upcoming calls
   */
  static async getUpcoming(fromDate = new Date()) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE}
         WHERE status IN ('pending', 'confirmed')
         AND scheduled_date >= $1
         ORDER BY scheduled_date ASC
         LIMIT 50`,
        [fromDate]
      );
      return result.rows.map((row) => this.mapRowToCall(row));
    } catch (error) {
      logger.error('Error getting upcoming calls:', error);
      return [];
    }
  }

  /**
   * Get call statistics
   */
  static async getStatistics() {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(amount, 100) ELSE 0 END), 0) as revenue
        FROM ${TABLE}
      `);

      const row = result.rows[0];
      return {
        total: parseInt(row.total) || 0,
        pending: parseInt(row.pending) || 0,
        confirmed: parseInt(row.confirmed) || 0,
        completed: parseInt(row.completed) || 0,
        cancelled: parseInt(row.cancelled) || 0,
        revenue: parseFloat(row.revenue) || 0,
      };
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

module.exports = CallModel;
