/**
 * Promo Model
 * Handles promotional offers with audience targeting, spot limits, and expiration
 */

const { query, getClient } = require('../config/postgres');
const { cache } = require('../config/redis');
const PlanModel = require('./planModel');
const UserModel = require('./userModel');
const logger = require('../utils/logger');

class PromoModel {
  static TABLE = 'promos';
  static REDEMPTIONS_TABLE = 'promo_redemptions';
  static ANY_PLAN_IDS = new Set(['any', 'all']);

  /**
   * Map database row to promo object
   */
  static mapRowToPromo(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      nameEs: row.name_es,
      description: row.description,
      descriptionEs: row.description_es,
      basePlanId: row.base_plan_id,
      discountType: row.discount_type,
      discountValue: parseFloat(row.discount_value),
      targetAudience: row.target_audience,
      newUserDays: row.new_user_days,
      maxSpots: row.max_spots,
      currentSpotsUsed: row.current_spots_used,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      features: row.features || [],
      featuresEs: row.features_es || [],
      active: row.active,
      hidden: row.hidden,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Check if promo applies to any plan
   * @param {Object} promo
   * @returns {boolean}
   */
  static isAnyPlanPromo(promo) {
    const basePlanId = promo?.basePlanId || promo?.base_plan_id;
    return this.ANY_PLAN_IDS.has(String(basePlanId || '').toLowerCase());
  }

  /**
   * Get promo by code
   */
  static async getByCode(code) {
    try {
      const cacheKey = `promo:${code.toUpperCase()}`;

      return await cache.getOrSet(cacheKey, async () => {
        const result = await query(
          `SELECT * FROM ${this.TABLE} WHERE UPPER(code) = $1`,
          [code.toUpperCase()]
        );
        return this.mapRowToPromo(result.rows[0]);
      }, 300); // Cache for 5 minutes
    } catch (error) {
      logger.error('Error getting promo by code:', error);
      return null;
    }
  }

  /**
   * Get promo by ID
   */
  static async getById(promoId) {
    try {
      const result = await query(
        `SELECT * FROM ${this.TABLE} WHERE id = $1`,
        [promoId]
      );
      return this.mapRowToPromo(result.rows[0]);
    } catch (error) {
      logger.error('Error getting promo by ID:', error);
      return null;
    }
  }

  /**
   * Check if promo is valid (active, within dates, has spots)
   */
  static isPromoValid(promo) {
    if (!promo || !promo.active) return false;

    const now = new Date();

    // Check valid_from
    if (promo.validFrom && new Date(promo.validFrom) > now) return false;

    // Check valid_until
    if (promo.validUntil && new Date(promo.validUntil) < now) return false;

    // Check spots
    if (promo.maxSpots !== null && promo.currentSpotsUsed >= promo.maxSpots) return false;

    return true;
  }

  /**
   * Check if user is eligible for promo based on target audience
   */
  static async isUserEligible(promo, userId) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) return { eligible: false, reason: 'user_not_found' };

      // Check if user already redeemed this promo
      const existingRedemption = await this.getUserRedemption(promo.id, userId);
      if (existingRedemption) {
        return { eligible: false, reason: 'already_redeemed' };
      }

      switch (promo.targetAudience) {
        case 'all':
          return { eligible: true };

        case 'churned':
          // Users with subscription_status = 'churned' or who had a previous subscription
          if (user.subscriptionStatus === 'churned' || user.subscriptionStatus === 'expired') {
            return { eligible: true };
          }
          // Also check payment history for previous subscriptions
          const payments = await query(
            `SELECT COUNT(*) as count FROM payments
             WHERE user_id = $1 AND status = 'completed'`,
            [userId.toString()]
          );
          if (parseInt(payments.rows[0].count) > 0 && user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'prime') {
            return { eligible: true };
          }
          return { eligible: false, reason: 'not_churned' };

        case 'new_users':
          const dayLimit = promo.newUserDays || 7;
          const userCreatedAt = new Date(user.createdAt);
          const userAge = (new Date() - userCreatedAt) / (1000 * 60 * 60 * 24);
          if (userAge <= dayLimit) {
            return { eligible: true };
          }
          return { eligible: false, reason: 'not_new_user' };

        case 'free_users':
          if (!user.subscriptionStatus || user.subscriptionStatus === 'free' || user.subscriptionStatus === 'inactive') {
            // Also verify they haven't had a previous subscription
            const previousPayments = await query(
              `SELECT COUNT(*) as count FROM payments
               WHERE user_id = $1 AND status = 'completed'`,
              [userId.toString()]
            );
            if (parseInt(previousPayments.rows[0].count) === 0) {
              return { eligible: true };
            }
          }
          return { eligible: false, reason: 'not_free_user' };

        default:
          return { eligible: true };
      }
    } catch (error) {
      logger.error('Error checking user eligibility:', error);
      return { eligible: false, reason: 'error' };
    }
  }

  /**
   * Calculate final price based on discount type
   */
  static async calculatePrice(promo) {
    try {
      if (this.isAnyPlanPromo(promo)) {
        return {
          originalPrice: null,
          discountAmount: null,
          finalPrice: null,
          basePlan: null,
          isAnyPlan: true,
        };
      }

      const basePlan = await PlanModel.getById(promo.basePlanId);
      if (!basePlan) {
        throw new Error('Base plan not found');
      }

      const originalPrice = parseFloat(basePlan.price);
      let finalPrice;
      let discountAmount;

      if (promo.discountType === 'percentage') {
        discountAmount = originalPrice * (promo.discountValue / 100);
        finalPrice = originalPrice - discountAmount;
      } else { // fixed_price
        finalPrice = promo.discountValue;
        discountAmount = originalPrice - finalPrice;
      }

      return {
        originalPrice: parseFloat(originalPrice.toFixed(2)),
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        finalPrice: parseFloat(Math.max(0, finalPrice).toFixed(2)),
        basePlan,
      };
    } catch (error) {
      logger.error('Error calculating promo price:', error);
      throw error;
    }
  }

  /**
   * Calculate promo price for a specific plan
   * @param {Object} promo
   * @param {Object} plan
   * @returns {Object}
   */
  static calculatePriceForPlan(promo, plan) {
    if (!plan) {
      throw new Error('Plan not found');
    }

    const originalPrice = parseFloat(plan.price);
    let finalPrice;
    let discountAmount;

    if (promo.discountType === 'percentage') {
      discountAmount = originalPrice * (promo.discountValue / 100);
      finalPrice = originalPrice - discountAmount;
    } else {
      finalPrice = promo.discountValue;
      discountAmount = originalPrice - finalPrice;
    }

    return {
      originalPrice: parseFloat(originalPrice.toFixed(2)),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalPrice: parseFloat(Math.max(0, finalPrice).toFixed(2)),
      basePlan: plan,
    };
  }

  /**
   * Get user's redemption for a promo
   */
  static async getUserRedemption(promoId, userId) {
    try {
      const result = await query(
        `SELECT * FROM ${this.REDEMPTIONS_TABLE}
         WHERE promo_id = $1 AND user_id = $2`,
        [promoId, userId.toString()]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting user redemption:', error);
      return null;
    }
  }

  /**
   * Claim a promo spot (atomically)
   */
  static async claimSpot(promoId, userId, priceDetails) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Lock the promo row and check availability
      const promoResult = await client.query(
        `SELECT * FROM ${this.TABLE}
         WHERE id = $1
         FOR UPDATE`,
        [promoId]
      );

      const promo = this.mapRowToPromo(promoResult.rows[0]);
      if (!promo || !this.isPromoValid(promo)) {
        await client.query('ROLLBACK');
        return { success: false, error: 'promo_not_valid' };
      }

      // Check if user already claimed
      const existingCheck = await client.query(
        `SELECT 1 FROM ${this.REDEMPTIONS_TABLE}
         WHERE promo_id = $1 AND user_id = $2`,
        [promoId, userId.toString()]
      );

      if (existingCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'already_claimed' };
      }

      // Increment spot counter
      await client.query(
        `UPDATE ${this.TABLE}
         SET current_spots_used = current_spots_used + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [promoId]
      );

      // Create redemption record
      const redemptionResult = await client.query(
        `INSERT INTO ${this.REDEMPTIONS_TABLE}
         (promo_id, user_id, original_price, discount_amount, final_price, status)
         VALUES ($1, $2, $3, $4, $5, 'claimed')
         RETURNING *`,
        [
          promoId,
          userId.toString(),
          priceDetails.originalPrice,
          priceDetails.discountAmount,
          priceDetails.finalPrice,
        ]
      );

      await client.query('COMMIT');

      // Invalidate cache
      await cache.del(`promo:${promo.code.toUpperCase()}`);

      logger.info('Promo spot claimed', {
        promoId,
        userId,
        finalPrice: priceDetails.finalPrice,
      });

      return {
        success: true,
        redemption: redemptionResult.rows[0],
        promo,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error claiming promo spot:', error);
      return { success: false, error: 'internal_error' };
    } finally {
      client.release();
    }
  }

  /**
   * Complete a redemption after successful payment
   */
  static async completeRedemption(redemptionId, paymentId) {
    try {
      const result = await query(
        `UPDATE ${this.REDEMPTIONS_TABLE}
         SET status = 'completed',
             payment_id = $2,
             completed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [redemptionId, paymentId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error completing redemption:', error);
      return null;
    }
  }

  /**
   * Expire uncompleted redemptions (called by cleanup job)
   */
  static async expireStaleRedemptions(hoursOld = 24) {
    try {
      const result = await query(
        `UPDATE ${this.REDEMPTIONS_TABLE}
         SET status = 'expired'
         WHERE status = 'claimed'
         AND claimed_at < NOW() - INTERVAL '${hoursOld} hours'
         RETURNING promo_id, user_id`
      );

      // Decrement spot counters for expired redemptions
      for (const row of result.rows) {
        await query(
          `UPDATE ${this.TABLE}
           SET current_spots_used = GREATEST(0, current_spots_used - 1)
           WHERE id = $1`,
          [row.promo_id]
        );
        // Invalidate cache
        const promo = await this.getById(row.promo_id);
        if (promo) {
          await cache.del(`promo:${promo.code.toUpperCase()}`);
        }
      }

      if (result.rows.length > 0) {
        logger.info(`Expired ${result.rows.length} stale promo redemptions`);
      }

      return result.rows.length;
    } catch (error) {
      logger.error('Error expiring stale redemptions:', error);
      return 0;
    }
  }

  /**
   * Create a new promo (admin)
   */
  static async create(promoData) {
    try {
      const result = await query(
        `INSERT INTO ${this.TABLE} (
          code, name, name_es, description, description_es,
          base_plan_id, discount_type, discount_value,
          target_audience, new_user_days,
          max_spots, valid_from, valid_until,
          features, features_es, active, hidden, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *`,
        [
          promoData.code.toUpperCase(),
          promoData.name,
          promoData.nameEs || null,
          promoData.description || null,
          promoData.descriptionEs || null,
          promoData.basePlanId,
          promoData.discountType,
          promoData.discountValue,
          promoData.targetAudience || 'all',
          promoData.newUserDays || 7,
          promoData.maxSpots || null,
          promoData.validFrom || new Date(),
          promoData.validUntil || null,
          JSON.stringify(promoData.features || []),
          JSON.stringify(promoData.featuresEs || []),
          promoData.active !== false,
          promoData.hidden !== false,
          promoData.createdBy || null,
        ]
      );

      logger.info('Promo created', { code: promoData.code });
      return this.mapRowToPromo(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('Promo code already exists');
      }
      logger.error('Error creating promo:', error);
      throw error;
    }
  }

  /**
   * Update promo
   */
  static async update(promoId, updates) {
    try {
      const fields = [];
      const values = [];
      let paramCount = 1;

      const fieldMap = {
        name: 'name',
        nameEs: 'name_es',
        description: 'description',
        descriptionEs: 'description_es',
        discountType: 'discount_type',
        discountValue: 'discount_value',
        targetAudience: 'target_audience',
        newUserDays: 'new_user_days',
        maxSpots: 'max_spots',
        validFrom: 'valid_from',
        validUntil: 'valid_until',
        features: 'features',
        featuresEs: 'features_es',
        active: 'active',
        hidden: 'hidden',
        currentSpotsUsed: 'current_spots_used',
      };

      for (const [key, column] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          fields.push(`${column} = $${paramCount}`);
          let value = updates[key];
          if (key === 'features' || key === 'featuresEs') {
            value = JSON.stringify(value);
          }
          values.push(value);
          paramCount++;
        }
      }

      if (fields.length === 0) {
        return await this.getById(promoId);
      }

      values.push(promoId);
      const result = await query(
        `UPDATE ${this.TABLE}
         SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $${paramCount}
         RETURNING *`,
        values
      );

      const promo = this.mapRowToPromo(result.rows[0]);
      if (promo) {
        await cache.del(`promo:${promo.code.toUpperCase()}`);
      }

      return promo;
    } catch (error) {
      logger.error('Error updating promo:', error);
      throw error;
    }
  }

  /**
   * Get all promos (admin)
   */
  static async getAll(includeInactive = false) {
    try {
      const whereClause = includeInactive ? '' : 'WHERE active = true';
      const result = await query(
        `SELECT p.*,
         (SELECT COUNT(*) FROM ${this.REDEMPTIONS_TABLE} r
          WHERE r.promo_id = p.id AND r.status = 'completed') as completed_redemptions
         FROM ${this.TABLE} p
         ${whereClause}
         ORDER BY created_at DESC`
      );
      return result.rows.map(row => ({
        ...this.mapRowToPromo(row),
        completedRedemptions: parseInt(row.completed_redemptions) || 0,
      }));
    } catch (error) {
      logger.error('Error getting all promos:', error);
      return [];
    }
  }

  /**
   * Get promo statistics
   */
  static async getStats(promoId) {
    try {
      const result = await query(
        `SELECT
          p.*,
          COUNT(r.id) as total_claims,
          COUNT(r.id) FILTER (WHERE r.status = 'completed') as completed,
          COUNT(r.id) FILTER (WHERE r.status = 'claimed') as pending,
          COUNT(r.id) FILTER (WHERE r.status = 'expired') as expired,
          COALESCE(SUM(r.discount_amount) FILTER (WHERE r.status = 'completed'), 0) as total_discount_given,
          COALESCE(SUM(r.final_price) FILTER (WHERE r.status = 'completed'), 0) as total_revenue
         FROM ${this.TABLE} p
         LEFT JOIN ${this.REDEMPTIONS_TABLE} r ON p.id = r.promo_id
         WHERE p.id = $1
         GROUP BY p.id`,
        [promoId]
      );

      if (!result.rows[0]) return null;

      const row = result.rows[0];
      return {
        ...this.mapRowToPromo(row),
        stats: {
          totalClaims: parseInt(row.total_claims) || 0,
          completed: parseInt(row.completed) || 0,
          pending: parseInt(row.pending) || 0,
          expired: parseInt(row.expired) || 0,
          totalDiscountGiven: parseFloat(row.total_discount_given) || 0,
          totalRevenue: parseFloat(row.total_revenue) || 0,
        },
      };
    } catch (error) {
      logger.error('Error getting promo stats:', error);
      return null;
    }
  }

  /**
   * Deactivate promo
   */
  static async deactivate(promoId) {
    try {
      const result = await query(
        `UPDATE ${this.TABLE} SET active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [promoId]
      );

      const promo = this.mapRowToPromo(result.rows[0]);
      if (promo) {
        await cache.del(`promo:${promo.code.toUpperCase()}`);
      }

      return promo;
    } catch (error) {
      logger.error('Error deactivating promo:', error);
      throw error;
    }
  }

  /**
   * Generate deep link for promo
   */
  static generateDeepLink(promoCode, botUsername = null) {
    const username = botUsername || process.env.BOT_USERNAME || 'pnptvbot';
    return `https://t.me/${username}?start=promo_${promoCode.toUpperCase()}`;
  }
}

module.exports = PromoModel;
