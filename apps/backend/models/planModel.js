const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const promotionalPlans = require('../config/promotionalPlans');
const logger = require('../utils/logger');
const EntitlementModel = require('./entitlementModel');

/**
 * Plan Model - Handles subscription plan data with PostgreSQL
 */
class Plan {
  static TABLE = 'plans';

  static ADD_ON_FEATURES = {
    'pnp-member': [
      'Social feed, posts & reactions',
      'DMs & messaging',
      'Hangouts — group video rooms',
      'PNP Live — watch streams & tip',
      'PNP Radio — music & audio',
      'Videorama — VOD & series',
      'Nearby — map, places & people',
      'Creator profiles & subscriptions',
    ],
    'prime': [
      'PRIME exclusive live shows',
      'PRIME-only Videorama VOD',
      'PRIME-exclusive posts & content',
      'Early access & priority queue',
    ],
    'creator-subscription': [
      'Exclusive creator content',
      'Direct creator messaging',
    ],
    'private-calls': [
      '1 private video call credit',
    ],
  };

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
            `SELECT p.*,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', pa.add_on_id,
                     'name', ao.name,
                     'duration_days', pa.duration_days,
                     'is_lifetime', pa.is_lifetime
                   ) ORDER BY pa.add_on_id
                 ) FILTER (WHERE pa.add_on_id IS NOT NULL),
                 '[]'::json
               ) AS add_ons
             FROM ${this.TABLE} p
             LEFT JOIN plan_add_ons pa ON pa.plan_id = p.id
             LEFT JOIN add_ons ao ON ao.id = pa.add_on_id
             WHERE p.active = true
             GROUP BY p.id
             ORDER BY p.price ASC`
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
    return plans.filter((plan) => !hiddenIds.has(plan.id) && plan.tier !== 'creator');
  }

  /**
   * Get plans for admin management (includes inactive + promotional plans)
   * @returns {Promise<Array>} All plans available to admins
   */
  static async getAdminPlans() {
    try {
      const result = await query(
        `SELECT p.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', pa.add_on_id,
                 'name', ao.name,
                 'duration_days', pa.duration_days,
                 'is_lifetime', pa.is_lifetime
               ) ORDER BY pa.add_on_id
             ) FILTER (WHERE pa.add_on_id IS NOT NULL),
             '[]'::json
           ) AS add_ons
         FROM ${this.TABLE} p
         LEFT JOIN plan_add_ons pa ON pa.plan_id = p.id
         LEFT JOIN add_ons ao ON ao.id = pa.add_on_id
         WHERE p.active = true
         GROUP BY p.id
         ORDER BY p.price ASC`
      );
      const plans = result.rows.map((row) => this.mapRowToPlan(row));
      return this.mergePlans(plans, this.getPromotionalPlans());
    } catch (error) {
      logger.error('Error getting admin plans:', error);
      return this.getPromotionalPlans();
    }
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
            `SELECT p.*,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', pa.add_on_id,
                     'name', ao.name,
                     'duration_days', pa.duration_days,
                     'is_lifetime', pa.is_lifetime
                   ) ORDER BY pa.add_on_id
                 ) FILTER (WHERE pa.add_on_id IS NOT NULL),
                 '[]'::json
               ) AS add_ons
             FROM ${this.TABLE} p
             LEFT JOIN plan_add_ons pa ON pa.plan_id = p.id
             LEFT JOIN add_ons ao ON ao.id = pa.add_on_id
             WHERE p.id = $1
             GROUP BY p.id`,
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
    let addOns = [];
    if (Array.isArray(row.add_ons)) {
      addOns = row.add_ons;
    } else if (row.add_ons && typeof row.add_ons === 'string') {
      try { addOns = JSON.parse(row.add_ons); } catch (_) { addOns = []; }
    }

    return {
      id: row.id,
      sku: row.sku,
      display_name: row.display_name || row.name,
      name: row.name || row.display_name,
      tier: row.tier || null,
      price: parseFloat(row.price),
      currency: row.currency || 'USD',
      // duration_days is the canonical column; duration is the legacy NOT NULL column.
      // Both may be set; prefer duration_days, fall back to duration.
      duration: parseInt(row.duration_days || row.duration || 30, 10),
      duration_days: parseInt(row.duration_days || row.duration || 30, 10),
      description: row.description || null,
      features: this.normalizeFeatures(row.features),
      addOns,
      active: row.active,
      isLifetime: row.is_lifetime || false,
      // is_promo does not exist as a DB column; derive from the plan id convention.
      isPromo: false,
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
   * Create or update plan.
   * @param {string|null|undefined} planId - Plan ID (auto-generated from name if falsy)
   * @param {Object} planData - Plan data
   * @param {Array<{add_on_id: string, duration_days?: number|null, is_lifetime?: boolean}>} [addOns] - Optional add-ons to set
   * @returns {Promise<Object>} Created/updated plan
   */
  static async createOrUpdate(planId, planData, addOns) {
    try {
      const data = { ...planData };

      // Auto-generate id from name if not provided
      const resolvedPlanId = (planId && planId.trim())
        ? planId.trim()
        : this.slugify(data.name || data.display_name || 'plan');

      const isLifetime = data.isLifetime !== undefined
        ? data.isLifetime
        : (data.is_lifetime || false);
      const durationDays = parseInt(data.duration || data.duration_days || 30, 10);

      // If addOns provided, derive tier / features / description from them
      if (Array.isArray(addOns) && addOns.length > 0) {
        const derived = this.deriveFromAddOns(
          addOns,
          data.name || data.display_name || resolvedPlanId,
          data.price,
          durationDays,
          isLifetime
        );
        data.tier = derived.tier;
        data.features = derived.features;
        data.description = derived.description;
        logger.info('Derived plan metadata from addOns', {
          planId: resolvedPlanId, tier: derived.tier, featureCount: derived.features.length,
        });
      }

      // Auto-generate SKU
      if (!data.sku) {
        data.sku = this.generateSKU(resolvedPlanId, durationDays, isLifetime);
        logger.info(`Auto-generated SKU: ${data.sku} for plan: ${resolvedPlanId}`);
      }

      const sql = `
        INSERT INTO ${this.TABLE} (id, sku, name, display_name, tier, price, currency, duration, duration_days, description, features, is_lifetime, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          display_name = EXCLUDED.display_name,
          tier = EXCLUDED.tier,
          price = EXCLUDED.price,
          currency = EXCLUDED.currency,
          duration = EXCLUDED.duration,
          duration_days = EXCLUDED.duration_days,
          description = EXCLUDED.description,
          features = EXCLUDED.features,
          is_lifetime = EXCLUDED.is_lifetime,
          active = EXCLUDED.active,
          updated_at = NOW()
        RETURNING *
      `;

      const result = await query(sql, [
        resolvedPlanId,
        data.sku,
        data.name,
        data.display_name || data.displayName || data.name,
        data.tier || null,
        data.price,
        data.currency || 'USD',
        durationDays,       // duration — NOT NULL column
        durationDays,       // duration_days — nullable but kept in sync
        data.description || null,
        JSON.stringify(data.features || []),
        isLifetime,
        data.active !== undefined ? data.active : true,
      ]);

      // Persist add-on mappings if provided
      if (Array.isArray(addOns) && addOns.length > 0) {
        await EntitlementModel.setPlanAddOns(resolvedPlanId, addOns);
        logger.info('Plan add-ons set', { planId: resolvedPlanId, count: addOns.length });
      }

      // Invalidate cache
      await cache.del(`plan:${resolvedPlanId}`);
      await cache.del('plans:all');

      logger.info('Plan created/updated', { planId: resolvedPlanId, sku: data.sku });
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
    const result = await query(`DELETE FROM ${this.TABLE} WHERE id = $1`, [planId]);

    // Invalidate cache
    await cache.del(`plan:${planId}`);
    await cache.del('plans:all');

    logger.info('Plan deleted', { planId, found: result.rowCount > 0 });
    return result.rowCount > 0;
  }

  /**
   * Convert a human-readable plan name to a URL-safe slug.
   * Example: "Gold Pass" → "gold-pass"
   * @param {string} name
   * @returns {string}
   */
  static slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Generate a unique SKU for a plan.
   * Format: PNP-<SLUG>-LTF (lifetime) or PNP-<SLUG>-<DDD> (timed)
   * @param {string} planId
   * @param {number} duration - duration in days
   * @param {boolean} isLifetime
   * @returns {string}
   */
  static generateSKU(planId, duration, isLifetime) {
    const slug = planId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (isLifetime || duration >= 36500) {
      return `PNP-${slug}-LTF`;
    }
    return `PNP-${slug}-${String(Math.round(duration)).padStart(3, '0')}`;
  }

  /**
   * Derive tier, features, and description automatically from an addOns array.
   * @param {Array<{add_on_id?: string, id?: string}>} addOns
   * @param {string} planName
   * @param {number|string} price
   * @param {number} duration - duration in days
   * @param {boolean} isLifetime
   * @returns {{ tier: string, features: string[], description: string }}
   */
  static deriveFromAddOns(addOns, planName, price, duration, isLifetime) {
    const ids = addOns.map((a) => a.add_on_id || a.id).filter(Boolean);

    // Tier precedence: prime > pnp-member > creator-subscription > free
    let tier = 'free';
    if (ids.includes('prime')) {
      tier = 'PRIME';
    } else if (ids.includes('pnp-member')) {
      tier = 'member';
    } else if (ids.includes('creator-subscription')) {
      tier = 'creator';
    }

    // Collect features in the order the add-ons appear
    const features = [];
    for (const id of ids) {
      const addonFeatures = this.ADD_ON_FEATURES[id];
      if (addonFeatures) {
        features.push(...addonFeatures);
      }
    }

    // Build human-readable description
    const addOnLabels = {
      'pnp-member': 'Platform Access',
      'prime': 'PRIME Content',
      'creator-subscription': 'Creator Content',
      'private-calls': 'Private Call Credit',
    };
    const parts = ids
      .map((id) => addOnLabels[id] || id)
      .filter(Boolean);
    const durationText = isLifetime ? 'Lifetime' : `${duration} days`;
    const description = `${planName} — ${parts.join(' + ')} — ${durationText} — $${parseFloat(price).toFixed(2)} USD`;

    return { tier, features, description };
  }

  /**
   * Get default plans (fallback if database is empty)
   * @returns {Array} Default plans
   */
  static getDefaultPlans() {
    return [
      {
        id: 'member-monthly',
        sku: 'EASYBOTS-PNP-M30',
        display_name: 'PNP MEMBER',
        name: 'PNP Member',
        nameEs: 'PNP Miembro',
        tier: 'member',
        price: 4.99,
        currency: 'USD',
        duration: 30,
        description: 'PNP MEMBER - EASYBOTS-PNP-M30 - $4.99 USD',
        descriptionEs: 'PNP MIEMBRO - EASYBOTS-PNP-M30 - $4.99 USD',
        features: [
          '🔒 Private hangout rooms',
          '📱 Social feed access',
          '📍 Nearby users discovery',
        ],
        featuresEs: [
          '🔒 Salas de hangout privadas',
          '📱 Acceso al feed social',
          '📍 Descubrimiento de usuarios cercanos',
        ],
        active: true,
      },
      {
        id: 'week_pass',
        sku: '007PASS',
        display_name: 'WEEK PASS',
        name: 'Week Pass',
        nameEs: 'Pase Semanal',
        tier: 'PRIME',
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
        tier: 'PRIME',
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
        tier: 'PRIME',
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
        display_name: 'YEARLY PASS',
        name: 'Yearly Pass',
        nameEs: 'Pase Anual',
        tier: 'PRIME',
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
        id: 'lifetime-pass',
        sku: 'EASYBOTS-PNP-000',
        display_name: 'LIFETIME PASS',
        name: 'Lifetime Pass',
        nameEs: 'Pase de por Vida',
        tier: 'PRIME',
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
        id: 'lifetime100-promo',
        sku: 'EASYBOTS-PNP-100',
        display_name: 'LIFETIME100 PROMO',
        name: 'Lifetime100 Promo',
        nameEs: 'Lifetime100 Promo',
        tier: 'PRIME',
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
