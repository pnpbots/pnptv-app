/**
 * PNP Live Tips Service
 * Handles tip management for PNP Television Live system
 */

const { query, getClient } = require('../../config/postgres');
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
   * @param {string|null} performerId - Performer ID (optional)
   * @returns {Promise<Object>} Created tip
   */
  static async createTip(userId, modelId, bookingId, amount, message = '', performerId = null) {
    // SVC-M2: Validate amount — must be a positive integer within reasonable bounds
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
      const err = new Error('Tip amount must be a positive integer and cannot exceed 100,000');
      err.name = 'ValidationError';
      throw err;
    }

    try {
      const result = await query(
        `INSERT INTO pnp_tips
         (user_id, model_id, performer_id, booking_id, amount, message, payment_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [userId, modelId || null, performerId, bookingId, amount, message, 'pending']
      );

      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      if (error.name === 'ValidationError') throw error;
      logger.error('Error creating tip:', error);
      throw new Error('Failed to create tip');
    }
  }

  /**
   * SVC-C4: Process a token-funded tip atomically.
   * Debits the user wallet, inserts the tip record, and marks it paid — all in one transaction.
   * If any step fails the entire operation rolls back (no tokens lost, no ghost tip created).
   *
   * @param {string} userId - User ID
   * @param {number} amount - Tip amount (positive integer, max 100,000)
   * @param {string} message - Optional tip message
   * @param {string} performerId - Performer ID
   * @param {string|null} idempotencyKey - Optional caller-supplied dedup key
   * @returns {Promise<{tip: Object, newBalance: number}>}
   */
  static async processTipWithTokens(userId, amount, message = '', performerId, idempotencyKey = null) {
    // Validate amount before touching DB
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
      const err = new Error('Tip amount must be a positive integer and cannot exceed 100,000');
      err.name = 'ValidationError';
      throw err;
    }

    let client;
    try {
      client = await getClient();
      await client.query('BEGIN');

      // Debit tokens atomically — fails immediately if balance is insufficient
      const debitResult = await client.query(
        `UPDATE user_token_wallets
         SET balance_tokens = balance_tokens - $2,
             updated_at = NOW()
         WHERE user_id = $1 AND balance_tokens >= $2
         RETURNING balance_tokens`,
        [userId, amount]
      );

      if (debitResult.rows.length === 0) {
        const err = new Error('Insufficient token balance');
        err.name = 'InsufficientFundsError';
        throw err;
      }

      const newBalance = debitResult.rows[0].balance_tokens;

      // Insert tip record as already paid
      const tipResult = await client.query(
        `INSERT INTO pnp_tips
         (user_id, model_id, performer_id, booking_id, amount, message, payment_status, transaction_id, created_at, completed_at)
         VALUES ($1, NULL, $2, NULL, $3, $4, 'completed', $5, NOW(), NOW())
         RETURNING *`,
        [userId, String(performerId), amount, (message || '').slice(0, 200), `TOKEN-${userId}-${Date.now()}`]
      );

      const tip = tipResult.rows[0];

      await client.query('COMMIT');

      // Invalidate wallet cache outside the transaction (best-effort)
      try {
        const { cache } = require('../../config/redis');
        await cache.del(`wallet:${userId}`);
      } catch (cacheErr) {
        logger.warn('Failed to invalidate wallet cache after token tip:', { userId, error: cacheErr.message });
      }

      logger.info('Token tip processed atomically', { userId, performerId, amount, tipId: tip.id });

      return { tip, newBalance };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          logger.warn('Failed to rollback processTipWithTokens transaction:', rollbackErr);
        }
      }
      if (error.name === 'ValidationError' || error.name === 'InsufficientFundsError') {
        throw error;
      }
      logger.error('Error processing token tip:', error);
      throw new Error('Failed to process token tip');
    } finally {
      if (client) {
        client.release();
      }
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
         WHERE id = $2 AND payment_status = 'pending'
         RETURNING *`,
        [transactionId, tipId]
      );

      const updatedRows = Array.isArray(result.rows) ? result.rows : [];
      const updatedCount = typeof result.rowCount === 'number' ? result.rowCount : updatedRows.length;

      if (updatedCount === 0) {
        logger.info('confirmTipPayment: already confirmed or not found — idempotent no-op', { tipId });
        return null;
      }

      return updatedRows[0] || null;
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
         LEFT JOIN users u ON t.user_id = u.id
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
        `SELECT t.*,
                COALESCE(p.display_name, 'Performer') as model_name,
                u.username as user_username
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
         LEFT JOIN users u ON t.user_id = u.id
         WHERE t.created_at >= $1
           AND t.payment_status = 'completed'
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
        `SELECT t.*, COALESCE(p.display_name, 'Performer') as model_name
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
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
        `SELECT t.*, COALESCE(p.display_name, 'Performer') as model_name, u.username as user_username
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
         LEFT JOIN users u ON t.user_id = u.id
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
