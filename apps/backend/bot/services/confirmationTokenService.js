const crypto = require('crypto');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

/**
 * Confirmation Token Service
 * Generates and manages one-time use confirmation tokens for payment completions
 */
class ConfirmationTokenService {
  /**
   * Generate a unique one-time confirmation token
   * @param {Object} params - Token parameters
   * @param {string} params.paymentId - Payment ID
   * @param {string} params.userId - User ID
   * @param {string} params.planId - Plan ID
   * @param {string} params.provider - Payment provider (daimo, epayco)
   * @returns {Promise<string>} Generated token
   */
  static async generateToken({ paymentId, userId, planId, provider }) {
    try {
      // Generate a secure random token (32 bytes = 64 hex chars)
      const token = crypto.randomBytes(32).toString('hex');

      // Store token in database with expiration (24 hours)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await query(
        `INSERT INTO confirmation_tokens
         (token, payment_id, user_id, plan_id, provider, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [token, paymentId, userId, planId, provider, expiresAt]
      );

      logger.info('Confirmation token generated', {
        paymentId,
        userId,
        provider,
        tokenPrefix: token.substring(0, 8) + '...',
      });

      return token;
    } catch (error) {
      logger.error('Error generating confirmation token:', error);
      throw error;
    }
  }

  /**
   * Verify and consume a one-time token
   * @param {string} token - Token to verify
   * @returns {Promise<Object|null>} Token data if valid, null otherwise
   */
  static async verifyToken(token) {
    try {
      const result = await query(
        `SELECT * FROM confirmation_tokens
         WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
        [token]
      );

      if (result.rows.length === 0) {
        logger.warn('Invalid or expired confirmation token');
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error verifying confirmation token:', error);
      return null;
    }
  }

  /**
   * Mark token as used
   * @param {string} token - Token to mark as used
   * @returns {Promise<boolean>} Success status
   */
  static async consumeToken(token) {
    try {
      const result = await query(
        `UPDATE confirmation_tokens
         SET used = TRUE, used_at = NOW()
         WHERE token = $1 AND used = FALSE`,
        [token]
      );

      if (result.rowCount > 0) {
        logger.info('Confirmation token consumed', {
          tokenPrefix: token.substring(0, 8) + '...',
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error consuming confirmation token:', error);
      return false;
    }
  }

  /**
   * Get confirmation link for payment
   * @param {string} token - Confirmation token
   * @returns {string} Full confirmation URL
   */
  static getConfirmationLink(token) {
    const domain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
    return `${domain}/confirm-payment/${token}`;
  }

  /**
   * Clean up expired tokens (can be run periodically)
   * @returns {Promise<number>} Number of tokens deleted
   */
  static async cleanupExpiredTokens() {
    try {
      const result = await query(
        `DELETE FROM confirmation_tokens
         WHERE expires_at < NOW() OR (used = TRUE AND used_at < NOW() - INTERVAL '7 days')`
      );

      const deletedCount = result.rowCount;

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} expired confirmation tokens`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up confirmation tokens:', error);
      return 0;
    }
  }
}

module.exports = ConfirmationTokenService;
