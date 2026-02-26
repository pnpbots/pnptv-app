const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const TABLE_PLANS = 'subscription_plans';
const TABLE_SUBSCRIPTIONS = 'user_subscriptions';

class SubscriptionModel {
  /**
   * Format subscription plan row
   */
  static _formatPlan(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role,
      description: row.description,
      priceUsd: parseFloat(row.price_usd),
      priceCop: parseFloat(row.price_cop),
      billingCycle: row.billing_cycle,
      features: row.features || {},
      revenueSplitPercentage: parseFloat(row.revenue_split_percentage),
      maxStreamsPerWeek: row.max_streams_per_week,
      maxContentUploads: row.max_content_uploads,
      priorityFeatured: row.priority_featured,
      prioritySupport: row.priority_support,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Format subscription row
   */
  static _formatSubscription(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      status: row.status,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      autoRenew: row.auto_renew,
      paymentMethod: row.payment_method,
      externalSubscriptionId: row.external_subscription_id,
      externalProvider: row.external_provider,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create subscription plan
   */
  static async createPlan(planData) {
    try {
      const id = uuidv4();
      const timestamp = new Date();

      const result = await query(
        `INSERT INTO ${TABLE_PLANS} (id, name, slug, role, description, price_usd, price_cop, billing_cycle, features, revenue_split_percentage, max_streams_per_week, max_content_uploads, priority_featured, priority_support, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          id,
          planData.name,
          planData.slug,
          planData.role,
          planData.description || null,
          planData.priceUsd || 0,
          planData.priceCop || 0,
          planData.billingCycle || 'monthly',
          JSON.stringify(planData.features || {}),
          planData.revenueSplitPercentage || 80,
          planData.maxStreamsPerWeek || null,
          planData.maxContentUploads || null,
          planData.priorityFeatured || false,
          planData.prioritySupport || false,
          planData.isActive !== false,
          timestamp,
          timestamp,
        ]
      );

      await cache.del(`plans:${planData.role}`);
      logger.info('Subscription plan created', { id, name: planData.name });
      return this._formatPlan(result.rows[0]);
    } catch (error) {
      logger.error('Error creating subscription plan:', error);
      throw error;
    }
  }

  /**
   * Get all plans for role
   */
  static async getPlansByRole(role) {
    try {
      const cacheKey = `plans:${role}`;
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await query(
        `SELECT * FROM ${TABLE_PLANS} WHERE role = $1 AND is_active = TRUE ORDER BY price_usd ASC`,
        [role]
      );

      const plans = result.rows.map(row => this._formatPlan(row));
      await cache.setex(cacheKey, 3600, JSON.stringify(plans));
      return plans;
    } catch (error) {
      logger.error('Error getting plans by role:', error);
      throw error;
    }
  }

  /**
   * Get plan by ID
   */
  static async getPlanById(planId) {
    try {
      const cacheKey = `plan:${planId}`;
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await query(
        `SELECT * FROM ${TABLE_PLANS} WHERE id = $1`,
        [planId]
      );

      const plan = this._formatPlan(result.rows[0]);
      if (plan) {
        await cache.setex(cacheKey, 3600, JSON.stringify(plan));
      }
      return plan;
    } catch (error) {
      logger.error('Error getting plan by id:', error);
      throw error;
    }
  }

  /**
   * Get plan by slug
   */
  static async getPlanBySlug(slug) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_PLANS} WHERE slug = $1 AND is_active = TRUE`,
        [slug]
      );

      return this._formatPlan(result.rows[0]);
    } catch (error) {
      logger.error('Error getting plan by slug:', error);
      throw error;
    }
  }

  /**
   * Create user subscription
   */
  static async createSubscription(subscriptionData) {
    try {
      const id = uuidv4();
      const timestamp = new Date();

      const result = await query(
        `INSERT INTO ${TABLE_SUBSCRIPTIONS} (id, user_id, plan_id, status, started_at, expires_at, auto_renew, payment_method, external_subscription_id, external_provider, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         RETURNING *`,
        [
          id,
          subscriptionData.userId,
          subscriptionData.planId,
          subscriptionData.status || 'active',
          subscriptionData.startedAt || timestamp,
          subscriptionData.expiresAt,
          subscriptionData.autoRenew !== false,
          subscriptionData.paymentMethod || null,
          subscriptionData.externalSubscriptionId || null,
          subscriptionData.externalProvider || null,
          JSON.stringify(subscriptionData.metadata || {}),
          timestamp,
          timestamp,
        ]
      );

      await cache.del(`user:subscriptions:${subscriptionData.userId}`);
      logger.info('Subscription created', {
        id,
        userId: subscriptionData.userId,
        planId: subscriptionData.planId,
      });

      return this._formatSubscription(result.rows[0]);
    } catch (error) {
      logger.error('Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Get active subscription for user
   */
  static async getActiveSubscription(userId) {
    try {
      const cacheKey = `user:subscriptions:${userId}`;
      const cached = await cache.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const result = await query(
        `SELECT s.*, p.name, p.role, p.price_usd, p.price_cop, p.features, p.revenue_split_percentage
         FROM ${TABLE_SUBSCRIPTIONS} s
         LEFT JOIN ${TABLE_PLANS} p ON s.plan_id = p.id
         WHERE s.user_id = $1 AND s.status = 'active' AND s.expires_at > NOW()
         LIMIT 1`,
        [userId]
      );

      const subscription = this._formatSubscription(result.rows[0]);
      if (subscription) {
        await cache.setex(cacheKey, 300, JSON.stringify(subscription));
      }
      return subscription;
    } catch (error) {
      logger.error('Error getting active subscription:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(subscriptionId) {
    try {
      const result = await query(
        `UPDATE ${TABLE_SUBSCRIPTIONS}
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [subscriptionId]
      );

      const subscription = this._formatSubscription(result.rows[0]);
      if (subscription) {
        await cache.del(`user:subscriptions:${subscription.userId}`);
      }

      logger.info('Subscription cancelled', { subscriptionId });
      return subscription;
    } catch (error) {
      logger.error('Error cancelling subscription:', error);
      throw error;
    }
  }

  /**
   * List all active plans
   */
  static async getAllPlans() {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_PLANS} WHERE is_active = TRUE ORDER BY role, price_usd ASC`
      );

      return result.rows.map(row => this._formatPlan(row));
    } catch (error) {
      logger.error('Error getting all plans:', error);
      throw error;
    }
  }

  /**
   * Update plan
   */
  static async updatePlan(planId, updates) {
    try {
      const setClause = [];
      const values = [planId];
      let paramIndex = 2;

      Object.entries(updates).forEach(([key, value]) => {
        const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (column === 'metadata' || column === 'features') {
          setClause.push(`${column} = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          setClause.push(`${column} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      });

      setClause.push(`updated_at = NOW()`);

      const result = await query(
        `UPDATE ${TABLE_PLANS}
         SET ${setClause.join(', ')}
         WHERE id = $1
         RETURNING *`,
        values
      );

      const plan = this._formatPlan(result.rows[0]);
      if (plan) {
        await cache.del(`plan:${planId}`);
        await cache.del(`plans:${plan.role}`);
      }

      logger.info('Plan updated', { planId });
      return plan;
    } catch (error) {
      logger.error('Error updating plan:', error);
      throw error;
    }
  }
}

module.exports = SubscriptionModel;
