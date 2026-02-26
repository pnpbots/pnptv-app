const logger = require('../utils/logger');
const { query } = require('../utils/db');

/**
 * PaymentHistoryService
 * Centralized service for recording and querying payment history
 * Used by all payment methods (ePayco, Daimo, Meru, Lifetime100, etc.)
 */
class PaymentHistoryService {
  /**
   * Record a payment in history and update user's last payment fields
   * Call this after any successful payment activation
   *
   * @param {Object} paymentData - Payment details
   * @param {string} paymentData.userId - User ID (required)
   * @param {string} paymentData.paymentMethod - Payment method (required)
   *   Values: 'epayco', 'daimo', 'meru', 'lifetime100', 'bold', 'paypal', 'stripe'
   * @param {number} paymentData.amount - Payment amount (required)
   * @param {string} paymentData.currency - Currency code (default: 'USD')
   * @param {string} paymentData.planId - Plan ID
   * @param {string} paymentData.planName - Human readable plan name
   * @param {string} paymentData.product - Product type (e.g., 'lifetime-pass', 'monthly')
   * @param {string} paymentData.paymentReference - Main reference (transaction ID, code, etc.) (required)
   * @param {string} paymentData.providerTransactionId - Secondary transaction ID from provider
   * @param {string} paymentData.providerPaymentId - Provider's payment ID
   * @param {Object} paymentData.webhookData - Full webhook payload for audit
   * @param {string} paymentData.status - Payment status (default: 'completed')
   * @param {string} paymentData.ipAddress - IP address of request
   * @param {string} paymentData.userAgent - User agent from request
   * @param {Object} paymentData.metadata - Additional metadata (promo code, verification method, etc.)
   *
   * @returns {Promise<Object>} Created payment history record
   * @throws {Error} If required fields are missing or database error occurs
   */
  async recordPayment({
    userId,
    paymentMethod,
    amount,
    currency = 'USD',
    planId = null,
    planName = null,
    product = null,
    paymentReference,
    providerTransactionId = null,
    providerPaymentId = null,
    webhookData = null,
    status = 'completed',
    ipAddress = null,
    userAgent = null,
    metadata = null,
  }) {
    // Validate required fields
    if (!userId || !paymentMethod || !amount || !paymentReference) {
      throw new Error('Missing required payment fields: userId, paymentMethod, amount, paymentReference');
    }

    try {
      const result = await query(
        `INSERT INTO payment_history (
          user_id, payment_method, amount, currency, plan_id, plan_name,
          product, payment_reference, provider_transaction_id, provider_payment_id,
          webhook_data, status, ip_address, user_agent, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING *`,
        [
          userId,
          paymentMethod,
          amount,
          currency,
          planId,
          planName,
          product,
          paymentReference,
          providerTransactionId,
          providerPaymentId,
          webhookData ? JSON.stringify(webhookData) : null,
          status,
          ipAddress || null,
          userAgent || null,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      if (result.rows.length > 0) {
        logger.info('Payment recorded in history', {
          paymentHistoryId: result.rows[0].id,
          userId,
          paymentMethod,
          amount,
          reference: paymentReference,
          status,
        });
        return result.rows[0];
      }

      throw new Error('Failed to insert payment history');
    } catch (error) {
      logger.error('Error recording payment in history:', error);
      throw error;
    }
  }

  /**
   * Get payment history for a user
   * Returns paginated list of payments ordered by date (newest first)
   *
   * @param {string} userId - User ID (required)
   * @param {number} limit - Max records to return (default: 20)
   * @param {number} offset - Pagination offset (default: 0)
   * @returns {Promise<Array>} Payment history records
   */
  async getUserPaymentHistory(userId, limit = 20, offset = 0) {
    try {
      const result = await query(
        `SELECT
          id, user_id, payment_method, amount, currency,
          plan_id, plan_name, product, payment_reference,
          provider_transaction_id, provider_payment_id,
          status, payment_date, processed_at, metadata,
          created_at
        FROM payment_history
        WHERE user_id = $1
        ORDER BY payment_date DESC
        LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching payment history:', error);
      return [];
    }
  }

  /**
   * Get the last (most recent) payment for a user
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Last payment record or null if no payments
   */
  async getLastPayment(userId) {
    try {
      const result = await query(
        `SELECT
          id, user_id, payment_method, amount, currency,
          plan_id, plan_name, product, payment_reference,
          provider_transaction_id, provider_payment_id,
          status, payment_date, processed_at, metadata
        FROM payment_history
        WHERE user_id = $1 AND status = 'completed'
        ORDER BY payment_date DESC
        LIMIT 1`,
        [userId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching last payment:', error);
      return null;
    }
  }

  /**
   * Get aggregated payment statistics for a user
   *
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Statistics object
   */
  async getUserPaymentStats(userId) {
    try {
      const result = await query(
        `SELECT
          COUNT(*) as total_payments,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_payments,
          COUNT(DISTINCT payment_method) as payment_methods_used,
          SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_amount_paid,
          MIN(payment_date) as first_payment_date,
          MAX(payment_date) as last_payment_date,
          STRING_AGG(DISTINCT payment_method, ', ' ORDER BY payment_method) as methods_list
        FROM payment_history
        WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      }

      return {
        total_payments: 0,
        completed_payments: 0,
        payment_methods_used: 0,
        total_amount_paid: 0,
        first_payment_date: null,
        last_payment_date: null,
        methods_list: null,
      };
    } catch (error) {
      logger.error('Error fetching payment statistics:', error);
      return null;
    }
  }

  /**
   * Get payment history by payment reference
   * Useful for looking up a specific transaction
   *
   * @param {string} paymentReference - Payment reference (transaction ID, code, etc.)
   * @returns {Promise<Object|null>} Payment record or null
   */
  async getByReference(paymentReference) {
    try {
      const result = await query(
        `SELECT * FROM payment_history
         WHERE payment_reference = $1
         LIMIT 1`,
        [paymentReference]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching payment by reference:', error);
      return null;
    }
  }

  /**
   * Get all payments by a specific method
   * Useful for payment method analysis
   *
   * @param {string} paymentMethod - Payment method to filter by
   * @param {number} limit - Max records
   * @returns {Promise<Array>} Payment records
   */
  async getByMethod(paymentMethod, limit = 100) {
    try {
      const result = await query(
        `SELECT * FROM payment_history
         WHERE payment_method = $1 AND status = 'completed'
         ORDER BY payment_date DESC
         LIMIT $2`,
        [paymentMethod, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching payments by method:', error);
      return [];
    }
  }

  /**
   * Get revenue statistics for a date range
   *
   * @param {Date} startDate - Start of date range
   * @param {Date} endDate - End of date range
   * @returns {Promise<Array>} Revenue stats grouped by payment method
   */
  async getRevenueStats(startDate, endDate) {
    try {
      const result = await query(
        `SELECT
          payment_method,
          COUNT(*) as transaction_count,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_transaction,
          MIN(amount) as min_transaction,
          MAX(amount) as max_transaction,
          product,
          currency
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date <= $2
        GROUP BY payment_method, product, currency
        ORDER BY total_revenue DESC`,
        [startDate, endDate]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching revenue stats:', error);
      return [];
    }
  }

  /**
   * Get users who paid within a specific date range
   * Useful for identifying active payers and churned users
   *
   * @param {Date} startDate - Start of date range
   * @param {Date} endDate - End of date range
   * @param {number} limit - Max records
   * @returns {Promise<Array>} User payment records
   */
  async getUsersWithPaymentsBetween(startDate, endDate, limit = 100) {
    try {
      const result = await query(
        `SELECT DISTINCT u.id, u.username, u.email, u.subscription_status,
           ph.payment_date, ph.amount, ph.payment_method
        FROM users u
        JOIN payment_history ph ON u.id = ph.user_id
        WHERE ph.status = 'completed'
          AND ph.payment_date >= $1
          AND ph.payment_date <= $2
        ORDER BY ph.payment_date DESC
        LIMIT $3`,
        [startDate, endDate, limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error fetching users with payments:', error);
      return [];
    }
  }

  /**
   * Check if a user has ever made a payment
   *
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if user has completed payments
   */
  async hasUserPaid(userId) {
    try {
      const result = await query(
        `SELECT COUNT(*) as count FROM payment_history
         WHERE user_id = $1 AND status = 'completed'
         LIMIT 1`,
        [userId]
      );

      return result.rows[0].count > 0;
    } catch (error) {
      logger.error('Error checking if user paid:', error);
      return false;
    }
  }

  /**
   * Get days since last payment for a user
   * Useful for subscription renewal reminders and churn analysis
   *
   * @param {string} userId - User ID
   * @returns {Promise<number|null>} Days since last payment, or null if no payments
   */
  async getDaysSinceLastPayment(userId) {
    try {
      const result = await query(
        `SELECT
          EXTRACT(DAY FROM (NOW() - MAX(payment_date))) as days_since
        FROM payment_history
        WHERE user_id = $1 AND status = 'completed'`,
        [userId]
      );

      if (result.rows[0] && result.rows[0].days_since !== null) {
        return Math.floor(result.rows[0].days_since);
      }

      return null;
    } catch (error) {
      logger.error('Error calculating days since last payment:', error);
      return null;
    }
  }
}

module.exports = new PaymentHistoryService();
