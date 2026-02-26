/**
 * PNP Live Tips Service
 * Handles tip management for PNP Television Live system
 */

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

class PNPLiveTipsService {
  // Standard tip amounts
  static TIP_AMOUNTS = [5, 10, 20, 50, 100];

  /**
   * Create a new tip
   * @param {string} userId - User ID (Telegram)
   * @param {number} modelId - Model ID
   * @param {number} bookingId - Booking ID (optional)
   * @param {number} amount - Tip amount in USD
   * @param {string} message - Optional message
   * @returns {Promise<Object>} Created tip
   */
  static async createTip(userId, modelId, bookingId, amount, message = '') {
    try {
      const result = await query(
        `INSERT INTO pnp_tips 
         (user_id, model_id, booking_id, amount, message, payment_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [userId, modelId, bookingId, amount, message, 'pending']
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error creating tip:', error);
      throw new Error('Failed to create tip');
    }
  }

  /**
   * Confirm tip payment
   * @param {number} tipId - Tip ID
   * @param {string} transactionId - Payment transaction ID
   * @returns {Promise<Object>} Updated tip
   */
  static async confirmTipPayment(tipId, transactionId) {
    try {
      const result = await query(
        `UPDATE pnp_tips 
         SET payment_status = 'completed', 
             transaction_id = $1,
             completed_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [transactionId, tipId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Tip not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error confirming tip payment:', error);
      throw new Error('Failed to confirm tip payment');
    }
  }

  /**
   * Get tips for a model
   * @param {number} modelId - Model ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Tips for the model
   */
  static async getModelTips(modelId, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const result = await query(
        `SELECT t.*, u.username as user_username
         FROM pnp_tips t
         LEFT JOIN users u ON t.user_id = u.telegram_id
         WHERE t.model_id = $1 AND t.created_at >= $2
         ORDER BY t.created_at DESC`,
        [modelId, startDate]
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting model tips:', error);
      throw new Error('Failed to get model tips');
    }
  }

  /**
   * Get tip statistics for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Tip statistics
   */
  static async getTipStatistics(modelId, startDate, endDate) {
    try {
      const result = await query(
        `SELECT 
          COUNT(*) as total_tips,
          SUM(amount) as total_amount,
          COUNT(*) FILTER (WHERE payment_status = 'completed') as completed_tips,
          SUM(amount) FILTER (WHERE payment_status = 'completed') as completed_amount
         FROM pnp_tips
         WHERE model_id = $1 
           AND created_at >= $2
           AND created_at <= $3`,
        [modelId, startDate, endDate]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : {
        total_tips: 0,
        total_amount: 0,
        completed_tips: 0,
        completed_amount: 0
      };
    } catch (error) {
      logger.error('Error getting tip statistics:', error);
      throw new Error('Failed to get tip statistics');
    }
  }

  /**
   * Get recent tips across all models
   * @param {number} limit - Maximum number of tips to return
   * @param {number} days - Number of days to look back
   * @returns {Promise<Array>} Recent tips
   */
  static async getRecentTips(limit = 10, days = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const result = await query(
        `SELECT t.*, m.name as model_name, u.username as user_username
         FROM pnp_tips t
         JOIN pnp_models m ON t.model_id = m.id
         LEFT JOIN users u ON t.user_id = u.telegram_id
         WHERE t.created_at >= $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [startDate, limit]
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting recent tips:', error);
      throw new Error('Failed to get recent tips');
    }
  }

  /**
   * Get tips by user
   * @param {string} userId - User ID (Telegram)
   * @param {number} limit - Maximum number of tips to return
   * @returns {Promise<Array>} Tips by user
   */
  static async getTipsByUser(userId, limit = 10) {
    try {
      const result = await query(
        `SELECT t.*, m.name as model_name
         FROM pnp_tips t
         JOIN pnp_models m ON t.model_id = m.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting tips by user:', error);
      throw new Error('Failed to get tips by user');
    }
  }

  /**
   * Get tip by ID
   * @param {number} tipId - Tip ID
   * @returns {Promise<Object>} Tip details
   */
  static async getTipById(tipId) {
    try {
      const result = await query(
        `SELECT t.*, m.name as model_name, u.username as user_username
         FROM pnp_tips t
         JOIN pnp_models m ON t.model_id = m.id
         LEFT JOIN users u ON t.user_id = u.telegram_id
         WHERE t.id = $1`,
        [tipId]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting tip by ID:', error);
      throw new Error('Failed to get tip');
    }
  }

  /**
   * Cancel a tip
   * @param {number} tipId - Tip ID
   * @returns {Promise<Object>} Updated tip
   */
  static async cancelTip(tipId) {
    try {
      const result = await query(
        `UPDATE pnp_tips 
         SET payment_status = 'cancelled',
             cancelled_at = NOW()
         WHERE id = $1 AND payment_status = 'pending'
         RETURNING *`,
        [tipId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Tip not found or already processed');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error cancelling tip:', error);
      throw new Error('Failed to cancel tip');
    }
  }
}

module.exports = PNPLiveTipsService;