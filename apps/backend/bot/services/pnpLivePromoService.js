/**
 * PNP Live Promo Codes Service
 * Handles promo code management for PNP Television Live system
 */

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

class PNPLivePromoService {
  /**
   * Create a new promo code
   * @param {string} code - Promo code
   * @param {string} discountType - 'percentage' or 'fixed'
   * @param {number} discountValue - Discount value
   * @param {number} maxUses - Maximum uses (null for unlimited)
   * @param {Date} validUntil - Expiration date (null for no expiration)
   * @param {boolean} active - Whether promo is active
   * @returns {Promise<Object>} Created promo code
   */
  static async createPromoCode(code, discountType, discountValue, maxUses = null, validUntil = null, active = true) {
    try {
      const result = await query(
        `INSERT INTO pnp_live_promo_codes 
         (code, discount_type, discount_value, max_uses, current_uses, valid_until, active, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, NOW())
         RETURNING *`,
        [code.toUpperCase(), discountType, discountValue, maxUses, validUntil, active]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      if (error.code === '23505') { // Unique violation
        throw new Error('Promo code already exists');
      }
      logger.error('Error creating promo code:', error);
      throw new Error('Failed to create promo code');
    }
  }

  /**
   * Validate a promo code
   * @param {string} code - Promo code
   * @param {string} userId - User ID
   * @param {number} modelId - Model ID
   * @param {number} duration - Duration in minutes
   * @param {number} originalAmount - Original amount
   * @returns {Promise<Object>} Validation result with discount info
   */
  static async validatePromoCode(code, userId, modelId, duration, originalAmount) {
    try {
      const result = await query(
        `SELECT * FROM pnp_live_promo_codes WHERE code = $1`,
        [code.toUpperCase()]
      );
      
      if (result.rows.length === 0) {
        return { valid: false, error: 'Promo code not found' };
      }
      
      const promo = result.rows[0];
      
      // Check if active
      if (!promo.active) {
        return { valid: false, error: 'Promo code is not active' };
      }
      
      // Check expiration
      if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
        return { valid: false, error: 'Promo code has expired' };
      }
      
      // Check max uses
      if (promo.max_uses && promo.current_uses >= promo.max_uses) {
        return { valid: false, error: 'Promo code has reached maximum uses' };
      }
      
      // Check if user has already used this promo
      const usageResult = await query(
        `SELECT COUNT(*) as usage_count 
         FROM pnp_live_promo_usage 
         WHERE promo_id = $1 AND user_id = $2`,
        [promo.id, userId]
      );
      
      const usageCount = parseInt(usageResult.rows[0].usage_count);
      if (usageCount > 0) {
        return { valid: false, error: 'You have already used this promo code' };
      }
      
      // Calculate discount
      let discountAmount = 0;
      if (promo.discount_type === 'percentage') {
        discountAmount = originalAmount * (promo.discount_value / 100);
      } else {
        discountAmount = promo.discount_value;
      }
      
      // Ensure discount doesn't exceed original amount
      discountAmount = Math.min(discountAmount, originalAmount);
      
      return {
        valid: true,
        promoId: promo.id,
        code: promo.code,
        discountType: promo.discount_type,
        discountValue: promo.discount_value,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        finalAmount: parseFloat((originalAmount - discountAmount).toFixed(2)),
        promoDetails: promo
      };
    } catch (error) {
      logger.error('Error validating promo code:', error);
      throw new Error('Failed to validate promo code');
    }
  }

  /**
   * Apply a promo code to a booking
   * Uses atomic transaction to prevent race conditions
   * @param {number} promoId - Promo ID
   * @param {number} bookingId - Booking ID
   * @param {string} userId - User ID
   * @param {number} discountAmount - Discount amount applied
   * @returns {Promise<Object>} Promo usage record
   */
  static async applyPromoCode(promoId, bookingId, userId, discountAmount) {
    const client = await require('../../config/postgres').getClient();

    try {
      await client.query('BEGIN');

      // Atomic increment with validation (using FOR UPDATE to lock the row)
      const updateResult = await client.query(
        `UPDATE pnp_live_promo_codes
         SET current_uses = current_uses + 1
         WHERE id = $1
           AND active = TRUE
           AND (max_uses IS NULL OR current_uses < max_uses)
           AND (valid_until IS NULL OR valid_until > NOW())
         RETURNING *`,
        [promoId]
      );

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Promo code no longer valid or has reached maximum uses');
      }

      // Check if user already used this promo (within transaction)
      const usageCheck = await client.query(
        `SELECT 1 FROM pnp_live_promo_usage WHERE promo_id = $1 AND user_id = $2`,
        [promoId, userId]
      );

      if (usageCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new Error('You have already used this promo code');
      }

      // Record usage
      const result = await client.query(
        `INSERT INTO pnp_live_promo_usage
         (promo_id, booking_id, user_id, discount_amount, used_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [promoId, bookingId, userId, discountAmount]
      );

      await client.query('COMMIT');

      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error applying promo code:', error);
      throw error.message.includes('already used') || error.message.includes('no longer valid')
        ? error
        : new Error('Failed to apply promo code');
    } finally {
      client.release();
    }
  }

  /**
   * Get active promo codes
   * @returns {Promise<Array>} Active promo codes
   */
  static async getActivePromoCodes() {
    try {
      const result = await query(
        `SELECT * FROM pnp_live_promo_codes 
         WHERE active = TRUE 
           AND (valid_until IS NULL OR valid_until > NOW())
           AND (max_uses IS NULL OR current_uses < max_uses)
         ORDER BY created_at DESC`
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting active promo codes:', error);
      throw new Error('Failed to get active promo codes');
    }
  }

  /**
   * Get promo code by ID
   * @param {number} promoId - Promo ID
   * @returns {Promise<Object>} Promo code details
   */
  static async getPromoCodeById(promoId) {
    try {
      const result = await query(
        `SELECT * FROM pnp_live_promo_codes WHERE id = $1`,
        [promoId]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting promo code by ID:', error);
      throw new Error('Failed to get promo code');
    }
  }

  /**
   * Deactivate a promo code
   * @param {number} promoId - Promo ID
   * @returns {Promise<Object>} Updated promo code
   */
  static async deactivatePromoCode(promoId) {
    try {
      const result = await query(
        `UPDATE pnp_live_promo_codes 
         SET active = FALSE 
         WHERE id = $1
         RETURNING *`,
        [promoId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Promo code not found');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error deactivating promo code:', error);
      throw new Error('Failed to deactivate promo code');
    }
  }

  /**
   * Get promo code usage statistics
   * @param {number} promoId - Promo ID
   * @returns {Promise<Object>} Usage statistics
   */
  static async getPromoUsageStatistics(promoId) {
    try {
      const result = await query(
        `SELECT 
          p.*,
          COUNT(u.id) as total_uses,
          SUM(u.discount_amount) as total_discount,
          COUNT(u.id) FILTER (WHERE u.used_at >= NOW() - INTERVAL '30 days') as uses_30_days
         FROM pnp_live_promo_codes p
         LEFT JOIN pnp_live_promo_usage u ON p.id = u.promo_id
         WHERE p.id = $1
         GROUP BY p.id`,
        [promoId]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting promo usage statistics:', error);
      throw new Error('Failed to get promo usage statistics');
    }
  }

  /**
   * Get all promo codes (admin)
   * @returns {Promise<Array>} All promo codes
   */
  static async getAllPromoCodes() {
    try {
      const result = await query(
        `SELECT * FROM pnp_live_promo_codes ORDER BY created_at DESC`
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting all promo codes:', error);
      throw new Error('Failed to get promo codes');
    }
  }

  /**
   * Check if a user has used a specific promo code
   * @param {string} userId - User ID
   * @param {number} promoId - Promo ID
   * @returns {Promise<boolean>} True if user has used the promo
   */
  static async hasUserUsedPromo(userId, promoId) {
    try {
      const result = await query(
        `SELECT COUNT(*) as count FROM pnp_live_promo_usage 
         WHERE user_id = $1 AND promo_id = $2`,
        [userId, promoId]
      );
      
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.error('Error checking promo usage:', error);
      throw new Error('Failed to check promo usage');
    }
  }
}

module.exports = PNPLivePromoService;