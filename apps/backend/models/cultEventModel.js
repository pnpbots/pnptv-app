const { query } = require('../config/postgres');
const logger = require('../utils/logger');

class CultEventModel {
  static async register({ userId, eventType, monthKey, eventAt, status = 'registered' }) {
    const sql = `
      INSERT INTO cult_event_registrations (
        user_id,
        event_type,
        month_key,
        event_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, event_type, month_key) DO UPDATE SET
        updated_at = NOW()
      RETURNING *
    `;

    try {
      const result = await query(sql, [userId, eventType, monthKey, eventAt, status]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error registering cult event:', error);
      return null;
    }
  }

  static async markClaimed({ userId, eventType, monthKey }) {
    const sql = `
      UPDATE cult_event_registrations
      SET status = 'claimed',
          claimed_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1 AND event_type = $2 AND month_key = $3
      RETURNING *
    `;

    try {
      const result = await query(sql, [userId, eventType, monthKey]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error marking cult event claimed:', error);
      return null;
    }
  }

  static async getRegistration({ userId, eventType, monthKey }) {
    const sql = `
      SELECT * FROM cult_event_registrations
      WHERE user_id = $1 AND event_type = $2 AND month_key = $3
    `;

    try {
      const result = await query(sql, [userId, eventType, monthKey]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching cult event registration:', error);
      return null;
    }
  }

  static async getUpcomingRegistrations(windowStart, windowEnd) {
    const sql = `
      SELECT *
      FROM cult_event_registrations
      WHERE event_at BETWEEN $1 AND $2
    `;

    try {
      const result = await query(sql, [windowStart, windowEnd]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching cult event registrations:', error);
      return [];
    }
  }

  static async markReminderSent(id, field) {
    const allowedFields = ['reminder_7d_sent', 'reminder_3d_sent', 'reminder_day_sent'];
    if (!allowedFields.includes(field)) {
      return false;
    }

    const sql = `
      UPDATE cult_event_registrations
      SET ${field} = TRUE,
          updated_at = NOW()
      WHERE id = $1
    `;

    try {
      await query(sql, [id]);
      return true;
    } catch (error) {
      logger.error('Error marking cult event reminder sent:', error);
      return false;
    }
  }
}

module.exports = CultEventModel;
