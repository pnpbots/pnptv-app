const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const promotionalPlans = require('../config/promotionalPlans');
const logger = require('../utils/logger');

/**
 * Plan Model - Handles subscription plan data with PostgreSQL
 */
class Plan {
  static TABLE = 'plans';

  /**
   * Get all active plans (with caching)
   * @returns {Promise<Array>} All subscription plans
   */
  static async getAll() {
    try {
      const cacheKey = 'plans:all';

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT * FROM ${this.TABLE} WHERE active = true ORDER BY price ASC`
          );

          const plans = result.rows.map((row) => this.mapRowToPlan(row));

          logger.info(`Fetched ${plans.length} plans from PostgreSQL`);
          return plans.length > 0 ? plans : this.getDefaultPlans();
        },
        3600, // Cache for 1 hour
      );
    } catch (error) {
      logger.error('Error getting plans:', error);
      return this.getDefaultPlans();
    }
  }

  /**
   * Get public plans (exclude promo/hidden plans)
   * @returns {Promise<Array>} Public subscription plans
   */
  static async getPublicPlans() {
    const plans = await this.getAll();
    const hiddenIds = new Set(this.getPromotionalPlans().map((plan) => plan.id));
    return plans.filter((plan) => !hiddenIds.has(plan.id));
  }

  /**
   * Get plans for admin management (includes promotional plans)
   * @returns {Promise<Array>} All plans available to admins
   */
  static async getAdminPlans() {
    const plans = await this.getAll();
    return this.mergePlans(plans, this.getPromotionalPlans());
  }

  /**
   * Get plan by ID (with caching)
   * @param {string} planId - Plan ID
   * @returns {Promise<Object|null>} Plan data
   */
  static async getById(planId) {
    try {
      const cacheKey = `plan:${planId}`;

      return await cache.getOrSet(
        cacheKey,
        async () => {
          const result = await query(
            `SELECT * FROM ${this.TABLE} WHERE id = $1`,
            [planId]
          );

          if (result.rows.length === 0) {
            const promoPlan = this.getPromotionalPlanById(planId);
            if (promoPlan) {
              logger.info(`Fetched promotional plan: ${planId}`);
              return promoPlan;
            }
            logger.warn(`Plan not found: ${planId}`);
            return null;
          }

          logger.info(`Fetched plan from PostgreSQL: ${planId}`);
          return this.mapRowToPlan(result.rows[0]);
        },
        3600, // Cache for 1 hour
      );
    } catch (error) {
      logger.error('Error getting plan:', error);
      return null;
    }
  }

  /**
   * Map database row to plan object
   * @param {Object} row - Database row
   * @returns {Object} Plan object
   */
  static mapRowToPlan(row) {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name || row.display_name,
      nameEs: row.name_es,
      price: parseFloat(row.price),
      currency: row.currency || 'USD',
      duration: row.duration_days || row.duration || 30,
      features: this.normalizeFeatures(row.features),
      featuresEs: this.normalizeFeatures(row.features_es),
      active: row.active,
      isLifetime: row.is_lifetime || false,
      isPromo: row.is_promo || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Normalize features fields to a consistent array shape.
   * @param {any} value - Features value from DB
   * @returns {Array<string>} Features array
   */
  static normalizeFeatures(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        logger.warn('Failed to parse plan features JSON', { error: error.message });
        return [];
      }
    }

    return [];
  }

  /**
   * Get promotional plans from config
   * @returns {Array} Promotional plans list
   */
  static getPromotionalPlans() {
    return promotionalPlans.map((plan) => ({
      ...plan,
      active: plan.active !== undefined ? plan.active : true,
      duration: plan.duration || 30,
      currency: plan.currency || 'USD',
      isPromo: true,
    }));
  }

  /**
   * Get a promotional plan by ID
   * @param {string} planId - Plan ID
   * @returns {Object|null} Promotional plan
   */
  static getPromotionalPlanById(planId) {
    return this.getPromotionalPlans().find((plan) => plan.id === planId) || null;
  }

  /**
   * Merge plans by ID, prioritizing database plans.
   * @param {Array} plans - Base plans
   * @param {Array} extraPlans - Additional plans
   * @returns {Array} Merged plans
   */
  static mergePlans(plans, extraPlans) {
    const merged = new Map(plans.map((plan) => [plan.id, plan]));
    extraPlans.forEach((plan) => {
      if (!merged.has(plan.id)) {
        merged.set(plan.id, plan);
      }
    });
    return Array.from(merged.values()).sort((a, b) => (a.price || 0) - (b.price || 0));
  }

  /**
   * Create or update plan
   * @param {string} planId - Plan ID
   * @param {Object} planData - Plan data
   * @returns {Promise<Object>} Created/updated plan
   */
  static async createOrUpdate(planId, planData) {
    try {
      // Auto-generate SKU if not provided
      const data = { ...planData };
      if (!data.sku && data.duration) {
        data.sku = this.generateSKU(planId, data.duration);
        logger.info(`Auto-generated SKU: ${data.sku} for plan: ${planId}`);
      }

      const sql = `
        INSERT INTO ${this.TABLE} (id, sku, name, name_es, price, currency, duration_days, features, features_es, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          name_es = EXCLUDED.name_es,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          duration_days = EXCLUDED.duration_days,
          features = EXCLUDED.features,
          features_es = EXCLUDED.features_es,
          active = EXCLUDED.active,
          updated_at = NOW()
        RETURNING *
      `;

      const result = await query(sql, [
        planId,
        data.sku,
        data.name,
        data.nameEs,
        data.price,
        data.currency || 'USD',
        data.duration || 30,
        JSON.stringify(data.features || []),
        JSON.stringify(data.featuresEs || []),
        data.active !== undefined ? data.active : true,
      ]);

      // Invalidate cache
      await cache.del(`plan:${planId}`);
      await cache.del('plans:all');

      logger.info('Plan created/updated', { planId, sku: data.sku });
      return this.mapRowToPlan(result.rows[0]);
    } catch (error) {
      logger.error('Error creating/updating plan:', error);
      throw error;
    }
  }

  /**
   * Delete plan
   * @param {string} planId - Plan ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(planId) {
    try {
      await query(`DELETE FROM ${this.TABLE} WHERE id = $1`, [planId]);

      // Invalidate cache
      await cache.del(`plan:${planId}`);
      await cache.del('plans:all');

      logger.info('Plan deleted', { planId });
      return true;
    } catch (error) {
      logger.error('Error deleting plan:', error);
      return false;
    }
  }

  /**
   * Generate SKU for a plan
   * SKU format: EASYBOTS-PNP-XXX where XXX is duration in days (3 digits)
   * Example: EASYBOTS-PNP-007 (7 days), EASYBOTS-PNP-030 (30 days), EASYBOTS-PNP-000 (lifetime)
   * @param {string} planId - Plan ID
   * @param {number} duration - Duration in days
   * @returns {string} Generated SKU
   */
  static generateSKU(planId, duration) {
    // For lifetime plans (very large duration), use 000
    if (duration >= 36500 || planId.includes('lifetime')) {
      return 'EASYBOTS-PNP-000';
    }

    // Convert duration to 3-digit format with zero padding
    const durationStr = String(duration).padStart(3, '0');
    return `EASYBOTS-PNP-${durationStr}`;
  }

  /**
   * Get default plans (fallback if database is empty)
   * @returns {Array} Default plans
   */
  static getDefaultPlans() {
    return [
      {
        id: 'week_pass',
        sku: '007PASS',
        display_name: 'WEEK PASS',
        name: 'Week Pass',
        nameEs: 'Pase Semanal',
        price: 14.99,
        currency: 'USD',
        duration: 7,
        description: 'WEEK PASS - 007PASS - $14.99 USD',
        descriptionEs: 'PASE SEMANAL - 007PASS - $14.99 USD',
        features: [
          '🔥 Videorama: Unlimited hot content',
          '📍 Find papis nearby ready to connect',
          '🎥 1 Hangout session per week',
        ],
        featuresEs: [
          '🔥 Videorama: Contenido caliente ilimitado',
          '📍 Encuentra papis cerca listos para conectar',
          '🎥 1 sesión de Hangout por semana',
        ],
        active: true,
      },
      {
        id: 'three_months_pass',
        sku: '090PASS',
        display_name: '3X MONTHLY PASS',
        name: '3 Months Pass',
        nameEs: 'Pase Trimestral',
        price: 49.99,
        currency: 'USD',
        duration: 90,
        description: '3X MONTHLY PASS - 090PASS - $49.99 USD',
        descriptionEs: 'PASE TRIMESTRAL - 090PASS - $49.99 USD',
        features: [
          '💎 Full Videorama library access',
          '📍 Who is Nearby - your local circle',
          '🎥 9 Hangouts quarterly - join the party',
          '📺 PNP Latino Live streams',
          '⚡ Priority support',
        ],
        featuresEs: [
          '💎 Acceso completo a Videorama',
          '📍 Quién está Cerca - tu círculo local',
          '🎥 9 Hangouts trimestrales - únete a la fiesta',
          '📺 Transmisiones en vivo de PNP Latino',
          '⚡ Soporte prioritario',
        ],
        active: true,
      },
      {
        id: 'crystal_pass',
        sku: '180PASS',
        display_name: 'CRYSTAL PASS',
        name: 'Crystal Pass',
        nameEs: 'Pase Crystal',
        price: 74.99,
        currency: 'USD',
        duration: 180,
        description: 'CRYSTAL PASS - 180PASS - $74.99 USD',
        descriptionEs: 'PASE CRYSTAL - 180PASS - $74.99 USD',
        features: [
          '💎 Extended Videorama access + premieres',
          '📍 Premium Nearby filters unlocked',
          '🎥 12 Hangouts credit with the crew',
          '📺 PNP Latino Live + private shows',
          '⚡ Priority Cristina support whenever you need it',
        ],
        featuresEs: [
          '💎 Acceso extendido a Videorama + estrenos',
          '📍 Filtros Nearby Premium desbloqueados',
          '🎥 12 créditos de Hangouts con la crew',
          '📺 PNP Latino Live + shows privados',
          '⚡ Soporte prioritario de Cristina cuando lo necesites',
        ],
        active: true,
      },
      {
        id: 'six_months_pass',
        sku: '180PASS',
        display_name: 'CRYSTAL PASS',
        name: 'Crystal Pass',
        nameEs: 'Pase Crystal',
        price: 74.99,
        currency: 'USD',
        duration: 180,
        description: 'CRYSTAL PASS - 180PASS - $74.99 USD',
        descriptionEs: 'PASE CRYSTAL - 180PASS - $74.99 USD',
        features: [
          '💎 Extended Videorama access + premieres',
          '📍 Premium Nearby filters unlocked',
          '🎥 12 Hangouts credit with the crew',
          '📺 PNP Latino Live + private shows',
          '⚡ Priority Cristina support whenever you need it',
        ],
        featuresEs: [
          '💎 Acceso extendido a Videorama + estrenos',
          '📍 Filtros Nearby Premium desbloqueados',
          '🎥 12 créditos de Hangouts con la crew',
          '📺 PNP Latino Live + shows privados',
          '⚡ Soporte prioritario de Cristina cuando lo necesites',
        ],
        active: true,
      },
      {
        id: 'yearly_pass',
        sku: 'EASYBOTS-PNP-365',
        name: 'Yearly Pass',
        nameEs: 'Pase Anual',
        price: 99.99,
        currency: 'USD',
        duration: 365,
        features: [
          '👑 VIP access to everything',
          '🔥 Videorama: Exclusive drops first',
          '📍 Premium Nearby - see who is watching',
          '🎥 Unlimited Hangouts with Santino & Lex',
          '📺 All PNP Latino Live events',
          '🎁 Exclusive content & early access',
        ],
        featuresEs: [
          '👑 Acceso VIP a todo',
          '🔥 Videorama: Estrenos exclusivos primero',
          '📍 Nearby Premium - ve quién está mirando',
          '🎥 Hangouts ilimitados con Santino & Lex',
          '📺 Todos los eventos de PNP Latino Live',
          '🎁 Contenido exclusivo y acceso anticipado',
        ],
        active: true,
      },
      {
        id: 'lifetime_pass',
        sku: 'EASYBOTS-PNP-000',
        name: 'Lifetime Pass',
        nameEs: 'Pase de por Vida',
        price: 249.99,
        currency: 'USD',
        duration: 36500,
        features: [
          '♾️ Lifetime access - pay once, stay forever',
          '👑 Full VIP status in The Circle',
          '🔥 Videorama: Everything, always',
          '📍 Premium Nearby with priority visibility',
          '🎥 Unlimited Hangouts - you are the party',
          '📺 All PNP Latino Live + private streams',
          '🎬 Live sessions with Santino himself',
        ],
        featuresEs: [
          '♾️ Acceso de por vida - paga una vez, quédate siempre',
          '👑 Estatus VIP completo en El Círculo',
          '🔥 Videorama: Todo, siempre',
          '📍 Nearby Premium con visibilidad prioritaria',
          '🎥 Hangouts ilimitados - tú eres la fiesta',
          '📺 Todo PNP Latino Live + streams privados',
          '🎬 Sesiones en vivo con Santino',
        ],
        active: true,
      },
      {
        id: 'lifetime100_promo',
        sku: 'EASYBOTS-PNP-100',
        name: 'Lifetime100 Promo',
        nameEs: 'Lifetime100 Promo',
        price: 100.00,
        currency: 'USD',
        duration: 36500,
        features: [
          '🔥 LIMITED PROMO - Lifetime at $100!',
          '♾️ Forever access to The Circle',
          '🎥 Videorama + Hangouts unlimited',
          '📍 Premium Nearby features',
          '📺 All PNP Latino Live events',
          '🎬 Live sessions with Santino',
          '👑 Full VIP treatment, papi',
        ],
        featuresEs: [
          '🔥 PROMO LIMITADA - Lifetime a $100!',
          '♾️ Acceso para siempre a El Círculo',
          '🎥 Videorama + Hangouts ilimitados',
          '📍 Funciones Nearby Premium',
          '📺 Todos los eventos de PNP Latino Live',
          '🎬 Sesiones en vivo con Santino',
          '👑 Trato VIP completo, papi',
        ],
        active: true,
        isLifetime: true,
        isPromo: true,
      },
    ];
  }

  /**
   * Initialize default plans in database
   * @returns {Promise<boolean>} Success status
   */
  static async initializeDefaultPlans() {
    try {
      const defaultPlans = this.getDefaultPlans();

      for (const plan of defaultPlans) {
        await this.createOrUpdate(plan.id, plan);
      }

      logger.info('Default plans initialized');
      return true;
    } catch (error) {
      logger.error('Error initializing default plans:', error);
      return false;
    }
  }

  /**
   * Prewarm cache with all plans
   * Call this on application startup to ensure fast first requests
   * @returns {Promise<boolean>} Success status
   */
  static async prewarmCache() {
    try {
      logger.info('Prewarming plans cache...');

      // Load all plans into cache
      const plans = await this.getAll();

      // Load individual plan caches
      for (const plan of plans) {
        await this.getById(plan.id);
      }

      logger.info(`Cache prewarmed with ${plans.length} plans`);
      return true;
    } catch (error) {
      logger.error('Error prewarming plans cache:', error);
      return false;
    }
  }

  /**
   * Invalidate all plan caches
   * @returns {Promise<boolean>} Success status
   */
  static async invalidateCache() {
    try {
      await cache.delPattern('plan:*');
      await cache.del('plans:all');
      logger.info('All plan caches invalidated');
      return true;
    } catch (error) {
      logger.error('Error invalidating plan cache:', error);
      return false;
    }
  }
}

module.exports = Plan;
