const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Support Ticket Message Model
 * Persists support ticket messages for web widget visibility.
 * Both user-sent messages and agent replies are stored here so the
 * web support widget can display the full conversation thread.
 */
class SupportTicketMessageModel {
  /**
   * Initialize support_ticket_messages table
   */
  static async initTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS support_ticket_messages (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        sender_type VARCHAR(20) NOT NULL,
        sender_name VARCHAR(255),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_stm_user_id ON support_ticket_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_stm_created_at ON support_ticket_messages(created_at);
    `;

    try {
      await getPool().query(query);
      logger.info('Support ticket messages table initialized');
    } catch (error) {
      logger.error('Error initializing support ticket messages table:', error);
      throw error;
    }
  }

  /**
   * Create a new ticket message record
   * @param {Object} data - Message data
   * @param {string} data.userId - The ticket owner's user ID
   * @param {string} data.senderType - 'user' or 'agent'
   * @param {string} [data.senderName] - Display name of sender
   * @param {string} data.content - Message text content
   * @returns {Promise<Object>} Created message row
   */
  static async create({ userId, senderType, senderName, content }) {
    const query = `
      INSERT INTO support_ticket_messages (user_id, sender_type, sender_name, content)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    try {
      const result = await getPool().query(query, [userId, senderType, senderName || null, content]);
      logger.info('Support ticket message created', { userId, senderType });
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating support ticket message:', error);
      throw error;
    }
  }

  /**
   * Get all messages for a user, ordered chronologically
   * @param {string} userId - The ticket owner's user ID
   * @param {string|null} [since] - ISO timestamp; if provided, only return messages after this time
   * @returns {Promise<Array>} Array of message rows ordered by created_at ASC
   */
  static async getByUserId(userId, since = null) {
    let query;
    let params;

    if (since) {
      query = `
        SELECT * FROM support_ticket_messages
        WHERE user_id = $1 AND created_at > $2
        ORDER BY created_at ASC
      `;
      params = [userId, since];
    } else {
      query = `
        SELECT * FROM support_ticket_messages
        WHERE user_id = $1
        ORDER BY created_at ASC
      `;
      params = [userId];
    }

    try {
      const result = await getPool().query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error getting support ticket messages by user ID:', error);
      throw error;
    }
  }

  /**
   * Delete all messages for a user (e.g. when a ticket is closed/reset)
   * @param {string} userId - The ticket owner's user ID
   * @returns {Promise<boolean>} True on success
   */
  static async deleteByUserId(userId) {
    const query = 'DELETE FROM support_ticket_messages WHERE user_id = $1';

    try {
      await getPool().query(query, [userId]);
      logger.info('Support ticket messages deleted for user', { userId });
      return true;
    } catch (error) {
      logger.error('Error deleting support ticket messages:', error);
      throw error;
    }
  }
}

module.exports = SupportTicketMessageModel;
