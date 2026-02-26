const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE = 'subscribers';

/**
 * Subscriber Model - Handles subscriber data operations (PostgreSQL)
 */
class SubscriberModel {
  /**
   * Format database row to subscriber object
   */
  static _formatSubscriber(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      telegramId: row.telegram_id,
      plan: row.plan,
      subscriptionId: row.subscription_id,
      provider: row.provider,
      status: row.status,
      lastPaymentAt: row.last_payment_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create a new subscriber
   * @param {Object} subscriberData - Subscriber information
   * @returns {Promise<Object>} Created subscriber
   */
  static async create(subscriberData) {
    try {
      const {
        email, name, telegramId, plan, subscriptionId, provider,
      } = subscriberData;

      const id = uuidv4();
      const timestamp = new Date();

      await query(
        `INSERT INTO ${TABLE} (id, email, name, telegram_id, plan, subscription_id, provider, status, last_payment_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (email) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, ${TABLE}.name),
           telegram_id = COALESCE(EXCLUDED.telegram_id, ${TABLE}.telegram_id),
           plan = EXCLUDED.plan,
           subscription_id = EXCLUDED.subscription_id,
           provider = EXCLUDED.provider,
           status = 'active',
           last_payment_at = EXCLUDED.last_payment_at,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          email,
          name || null,
          telegramId?.toString() || null,
          plan || null,
          subscriptionId || null,
          provider || 'epayco',
          'active',
          timestamp,
          timestamp,
          timestamp,
        ]
      );

      // Invalidate cache
      await cache.del(`subscriber:${email}`);
      if (telegramId) {
        await cache.del(`subscriber:telegram:${telegramId}`);
      }

      logger.info('Subscriber created', {
        email,
        telegramId,
        plan,
        subscriptionId,
      });

      return {
        id,
        email,
        name,
        telegramId: telegramId?.toString(),
        plan,
        subscriptionId,
        provider: provider || 'epayco',
        status: 'active',
        lastPaymentAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    } catch (error) {
      logger.error('Error creating subscriber:', error);
      throw error;
    }
  }

  /**
   * Get subscriber by email
   * @param {string} email - Subscriber email
   * @returns {Promise<Object|null>} Subscriber data or null
   */
  static async getByEmail(email) {
    try {
      const cacheKey = `subscriber:${email}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT * FROM ${TABLE} WHERE email = $1`,
            [email]
          );
          return this._formatSubscriber(result.rows[0]);
        },
        600 // Cache for 10 minutes
      );
    } catch (error) {
      logger.error('Error getting subscriber by email:', error);
      return null;
    }
  }

  /**
   * Get subscriber by Telegram ID
   * @param {string|number} telegramId - Telegram user ID
   * @returns {Promise<Object|null>} Subscriber data or null
   */
  static async getByTelegramId(telegramId) {
    try {
      const cacheKey = `subscriber:telegram:${telegramId}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT * FROM ${TABLE} WHERE telegram_id = $1 LIMIT 1`,
            [telegramId.toString()]
          );
          return this._formatSubscriber(result.rows[0]);
        },
        600 // Cache for 10 minutes
      );
    } catch (error) {
      logger.error('Error getting subscriber by Telegram ID:', error);
      return null;
    }
  }

  /**
   * Get subscriber by ePayco subscription ID (for recurring charge lookups)
   * @param {string} subscriptionId - ePayco subscription reference
   * @returns {Promise<Object|null>} Subscriber data or null
   */
  static async getBySubscriptionId(subscriptionId) {
    try {
      const cacheKey = `subscriber:sub:${subscriptionId}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT * FROM ${TABLE} WHERE subscription_id = $1 LIMIT 1`,
            [subscriptionId]
          );
          return this._formatSubscriber(result.rows[0]);
        },
        600
      );
    } catch (error) {
      logger.error('Error getting subscriber by subscription ID:', error);
      return null;
    }
  }

  /**
   * Update subscriber status
   * @param {string} email - Subscriber email
   * @param {string} status - New status (active, inactive, cancelled)
   * @param {Object} additionalData - Additional fields to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateStatus(email, status, additionalData = {}) {
    try {
      const updates = ['status = $1', 'updated_at = $2'];
      const values = [status, new Date()];
      let paramIndex = 3;

      if (additionalData.plan) {
        updates.push(`plan = $${paramIndex++}`);
        values.push(additionalData.plan);
      }
      if (additionalData.subscriptionId) {
        updates.push(`subscription_id = $${paramIndex++}`);
        values.push(additionalData.subscriptionId);
      }
      if (additionalData.lastPaymentAt) {
        updates.push(`last_payment_at = $${paramIndex++}`);
        values.push(additionalData.lastPaymentAt);
      }

      values.push(email);

      await query(
        `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE email = $${paramIndex}`,
        values
      );

      // Invalidate cache
      const subscriber = await this.getByEmail(email);
      await cache.del(`subscriber:${email}`);
      if (subscriber?.telegramId) {
        await cache.del(`subscriber:telegram:${subscriber.telegramId}`);
      }

      logger.info('Subscriber status updated', { email, status });
      return true;
    } catch (error) {
      logger.error('Error updating subscriber status:', error);
      return false;
    }
  }

  /**
   * Update last payment date
   * @param {string} email - Subscriber email
   * @returns {Promise<boolean>} Success status
   */
  static async updateLastPayment(email) {
    try {
      await query(
        `UPDATE ${TABLE} SET last_payment_at = $1, updated_at = $1 WHERE email = $2`,
        [new Date(), email]
      );

      // Invalidate cache
      const subscriber = await this.getByEmail(email);
      await cache.del(`subscriber:${email}`);
      if (subscriber?.telegramId) {
        await cache.del(`subscriber:telegram:${subscriber.telegramId}`);
      }

      logger.info('Subscriber payment updated', { email });
      return true;
    } catch (error) {
      logger.error('Error updating subscriber payment:', error);
      return false;
    }
  }

  /**
   * Get all active subscribers
   * @returns {Promise<Array>} Active subscribers
   */
  static async getActiveSubscribers() {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE status = 'active'`
      );

      const subscribers = result.rows.map(row => this._formatSubscriber(row));
      logger.info(`Found ${subscribers.length} active subscribers`);
      return subscribers;
    } catch (error) {
      logger.error('Error getting active subscribers:', error);
      return [];
    }
  }

  /**
   * Get subscribers by plan
   * @param {string} planId - Plan ID
   * @returns {Promise<Array>} Subscribers
   */
  static async getByPlan(planId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE plan = $1`,
        [planId]
      );

      const subscribers = result.rows.map(row => this._formatSubscriber(row));
      logger.info(`Found ${subscribers.length} subscribers for plan ${planId}`);
      return subscribers;
    } catch (error) {
      logger.error('Error getting subscribers by plan:', error);
      return [];
    }
  }

  /**
   * Delete subscriber
   * @param {string} email - Subscriber email
   * @returns {Promise<boolean>} Success status
   */
  static async delete(email) {
    try {
      const subscriber = await this.getByEmail(email);

      await query(
        `DELETE FROM ${TABLE} WHERE email = $1`,
        [email]
      );

      // Invalidate cache
      await cache.del(`subscriber:${email}`);
      if (subscriber?.telegramId) {
        await cache.del(`subscriber:telegram:${subscriber.telegramId}`);
      }

      logger.info('Subscriber deleted', { email });
      return true;
    } catch (error) {
      logger.error('Error deleting subscriber:', error);
      return false;
    }
  }

  /**
   * Get subscription statistics
   * @returns {Promise<Object>} Statistics
   */
  static async getStatistics() {
    try {
      const cacheKey = 'stats:subscribers';

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(`
            SELECT
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'active') as active
            FROM ${TABLE}
          `);

          const { total, active } = result.rows[0];
          const totalNum = parseInt(total) || 0;
          const activeNum = parseInt(active) || 0;

          const stats = {
            total: totalNum,
            active: activeNum,
            inactive: totalNum - activeNum,
            timestamp: new Date().toISOString(),
          };

          logger.info('Subscriber statistics calculated', stats);
          return stats;
        },
        60 // Cache for 1 minute
      );
    } catch (error) {
      logger.error('Error getting subscriber statistics:', error);
      return {
        total: 0, active: 0, inactive: 0,
      };
    }
  }
}

module.exports = SubscriberModel;
