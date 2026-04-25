'use strict';

const { query } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const logger = require('../../../utils/logger');

/**
 * Generate a URL-safe plan ID from a plan name and add-on hint.
 * E.g. "Hot March Deal" + 30d → "hot-march-deal-30d"
 */
function generatePlanId(name, addOns) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const durations = addOns
    .filter(a => !a.is_lifetime && a.duration_days)
    .map(a => a.duration_days);
  const minDuration = durations.length ? Math.min(...durations) : null;
  const suffix = minDuration
    ? `-${minDuration}d`
    : addOns.some(a => a.is_lifetime) ? '-lifetime' : '';

  return `${base}${suffix}`;
}

/**
 * Generate a structured SKU encoding the entitlements bundled in the plan.
 *
 * Format:
 *   PNP-{member-days}-P-{prime-days}           (member + prime)
 *   PNP-{member-days}                          (member only)
 *   PNP-{member-days}-C-{creator-days}         (member + creator subscription)
 *   PNP-{member-days}-P-{prime-days}-C-{days}  (all three)
 *
 * Day encoding:
 *   000 = lifetime
 *   030 = 30 days
 *   007 = 7 days
 *   etc.
 *
 * Examples:
 *   PNP-030-P-007  → 30-day member + 7-day prime
 *   PNP-000-P-000  → lifetime member + lifetime prime
 *   PNP-030        → 30-day member only
 *   PNP-030-C-030  → 30-day member + 30-day creator subscription
 *
 * @param {Array<{add_on_id: string, duration_days: number|null, is_lifetime: boolean}>} addOns
 * @returns {string}
 */
function generateSku(addOns) {
  const memberAddon  = addOns.find(a => a.add_on_id === 'pnp-member');
  const primeAddon   = addOns.find(a => a.add_on_id === 'prime');
  const creatorAddon = addOns.find(a => a.add_on_id === 'creator-subscription');

  const encodeDays = (addon) => {
    if (!addon) return null;
    if (addon.is_lifetime) return '000';
    return String(addon.duration_days || 30).padStart(3, '0');
  };

  const memberDays  = encodeDays(memberAddon);
  const primeDays   = encodeDays(primeAddon);
  const creatorDays = encodeDays(creatorAddon);

  let sku = 'PNP';
  if (memberDays)  sku += `-${memberDays}`;
  if (primeDays)   sku += `-P-${primeDays}`;
  if (creatorDays) sku += `-C-${creatorDays}`;

  // If the plan has no recognized add-ons, fall back to the old slug-based format
  if (sku === 'PNP') {
    const hasLifetime = addOns.some(a => a.is_lifetime);
    const maxDays = Math.max(...addOns.filter(a => !a.is_lifetime && a.duration_days).map(a => a.duration_days), 0);
    sku = hasLifetime ? 'PNP-000' : `PNP-${String(maxDays || 30).padStart(3, '0')}`;
  }

  return sku;
}

/** Pre-built UI descriptions per add-on. */
const ADD_ON_DESCRIPTIONS = {
  'pnp-member':           'Full platform access — hangouts, live streams, DMs, token purchases & call booking',
  'prime':                'PRIME content — exclusive VOD library, prime chat room & creator subscriptions',
  'creator-subscription': "Access to a specific creator's exclusive content",
  'private-calls':        'One private video call credit with a creator',
};

/**
 * Derive backward-compat tier label from add-ons for the plans.tier column.
 * plans.tier is a display/admin field only — it is NOT used for access control.
 * Access control is exclusively through user_entitlements.
 */
function deriveTier(addOnIds) {
  if (addOnIds.includes('prime')) return 'PRIME';
  if (addOnIds.includes('pnp-member')) return 'member';
  if (addOnIds.includes('creator-subscription')) return 'creator';
  return 'free';
}

/**
 * Generate a human-readable plan description from its add-ons.
 * Example: "pnp-member (30 days) + prime (30 days)"
 */
function generateDescription(name, addOns, durationDays, price) {
  const labels = {
    'pnp-member':           'Platform Access',
    'prime':                'PRIME Content',
    'creator-subscription': 'Creator Content',
    'private-calls':        'Private Call Credit',
  };
  const parts = addOns.map(a => {
    const label = labels[a.add_on_id] || a.add_on_id;
    if (a.is_lifetime) return `${label} (Lifetime)`;
    if (a.duration_days) return `${label} (${a.duration_days} days)`;
    return label;
  });
  const durationText = addOns.some(a => a.is_lifetime)
    ? 'Lifetime'
    : `${durationDays} days`;
  return `${name} — ${parts.join(' + ')} — ${durationText} — $${parseFloat(price).toFixed(2)} USD`;
}

/** Features associated with each add-on. */
const ADD_ON_FEATURES = {
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

const VALID_ADD_ON_IDS = ['pnp-member', 'prime', 'creator-subscription', 'private-calls'];

/**
 * Validate the add_ons array from the request body.
 * Returns { valid: true } or { valid: false, error: string }
 */
function validateAddOns(addOns) {
  if (!Array.isArray(addOns) || addOns.length === 0) {
    return { valid: false, error: 'add_ons must be a non-empty array' };
  }
  for (const a of addOns) {
    if (!VALID_ADD_ON_IDS.includes(a.add_on_id)) {
      return { valid: false, error: `Invalid add_on_id: ${a.add_on_id}. Valid values: ${VALID_ADD_ON_IDS.join(', ')}` };
    }
    if (!a.is_lifetime && (!a.duration_days || typeof a.duration_days !== 'number' || a.duration_days < 1)) {
      return { valid: false, error: `duration_days must be a positive integer for non-lifetime add-on: ${a.add_on_id}` };
    }
  }
  return { valid: true };
}

const planBuilderController = {

  /**
   * GET /api/webapp/admin/plans
   * List all plans (active + inactive) with their add-on mappings.
   * Includes all plans in DB; promotional in-memory plans are excluded
   * since they are not DB rows.
   */
  async listPlans(req, res) {
    try {
      // Default to active plans only — admins assigning a plan should not
      // see deprecated/disabled SKUs. Pass ?includeInactive=true to bypass
      // (used by the plan-builder admin to manage retired plans).
      const includeInactive = String(req.query.includeInactive || '') === 'true';
      const { rows } = await query(`
        SELECT p.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id',          pa.add_on_id,
                'add_on_id',   pa.add_on_id,
                'name',        ao.name,
                'duration_days', pa.duration_days,
                'is_lifetime', pa.is_lifetime
              ) ORDER BY pa.add_on_id
            ) FILTER (WHERE pa.add_on_id IS NOT NULL),
            '[]'::json
          ) AS add_ons
        FROM plans p
        LEFT JOIN plan_add_ons pa ON pa.plan_id = p.id
        LEFT JOIN add_ons ao ON ao.id = pa.add_on_id
        ${includeInactive ? '' : 'WHERE p.active = true'}
        GROUP BY p.id
        ORDER BY p.price ASC
      `);
      return res.json({ success: true, plans: rows });
    } catch (error) {
      logger.error('planBuilderController.listPlans error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/webapp/admin/plans
   * Create a new plan with auto-generated ID, SKU, tier, features, description
   * and plan_add_ons mappings.
   *
   * Body:
   *   name         {string}  Human-readable name (e.g. "Hot March Deal")
   *   price        {number}  Price in USD (e.g. 15)
   *   add_ons      {Array}   [{add_on_id, duration_days?, is_lifetime?}]
   *   duration_days {number} Overall plan duration (defaults to max of add-on durations)
   *   is_lifetime  {boolean} Whether the plan grants lifetime access (default false)
   *   is_active    {boolean} Defaults to true  (maps to active column)
   *   id           {string}  Optional explicit plan ID; auto-generated from name if omitted
   *   display_name {string}  Optional display name; defaults to name
   */
  async createPlan(req, res) {
    try {
      const {
        name,
        price,
        add_ons,
        duration_days,
        is_lifetime = false,
        is_active = true,
        id: rawId,
        display_name,
      } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      if (price === undefined || price === null || typeof price !== 'number' || price <= 0) {
        return res.status(400).json({ success: false, error: 'price must be a positive number' });
      }
      const validation = validateAddOns(add_ons);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      // Resolve plan ID
      const addOnsNorm = add_ons.map(a => ({
        add_on_id:    a.add_on_id,
        duration_days: a.duration_days || null,
        is_lifetime:   a.is_lifetime || false,
      }));

      const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;
      if (rawId && String(rawId).trim()) {
        const candidateId = String(rawId).trim();
        if (!PLAN_ID_RE.test(candidateId)) {
          return res.status(400).json({
            success: false,
            error: 'id must be 2-60 characters, lowercase alphanumeric and hyphens only, and must not start or end with a hyphen',
          });
        }
      }
      let planId = rawId && String(rawId).trim()
        ? String(rawId).trim()
        : generatePlanId(name.trim(), addOnsNorm);

      // Ensure uniqueness — append base36 timestamp suffix on collision
      const { rows: existing } = await query('SELECT id FROM plans WHERE id = $1', [planId]);
      if (existing.length > 0) {
        planId = `${planId}-${Date.now().toString(36)}`;
      }

      // Derive metadata from add-ons
      const addOnIds = addOnsNorm.map(a => a.add_on_id);
      // plans.tier is a backward-compat display field only — not used for access control.
      // Access control is exclusively through user_entitlements.
      const tier = deriveTier(addOnIds);
      const hasLifetime = is_lifetime || addOnsNorm.some(a => a.is_lifetime);
      const durations = addOnsNorm.filter(a => !a.is_lifetime && a.duration_days).map(a => a.duration_days);
      const resolvedDuration = duration_days
        || (durations.length ? Math.max(...durations) : 30);

      // New structured SKU format encodes the entitlement composition of the plan.
      // e.g. PNP-030-P-007 = 30-day member + 7-day prime
      const sku = generateSku(addOnsNorm);
      const features = addOnIds.flatMap(id => ADD_ON_FEATURES[id] || []);
      const description = generateDescription(name.trim(), addOnsNorm, resolvedDuration, price);

      // Insert plan
      await query(`
        INSERT INTO plans (
          id, sku, name, display_name, tier,
          price, currency, duration, duration_days,
          description, features, is_lifetime, active,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $7, $8, $9, $10, $11, NOW(), NOW())
      `, [
        planId,
        sku,
        name.trim(),
        (display_name || name).trim(),
        tier,
        price,
        resolvedDuration,
        description,
        JSON.stringify(features),
        hasLifetime,
        is_active,
      ]);

      // Insert plan_add_ons
      for (const addOn of addOnsNorm) {
        await query(`
          INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (plan_id, add_on_id) DO UPDATE
            SET duration_days = EXCLUDED.duration_days,
                is_lifetime   = EXCLUDED.is_lifetime
        `, [planId, addOn.add_on_id, addOn.duration_days, addOn.is_lifetime]);
      }

      // Invalidate plans cache
      await cache.del('plans:all');
      await cache.del(`plan:${planId}`);

      logger.info('Plan created via plan builder', {
        planId, name: name.trim(), price, tier,
        addOnCount: addOnsNorm.length,
        createdBy: req.session?.user?.id || req.user?.id,
      });

      // Return the full plan with add-ons
      const { rows: created } = await query(`
        SELECT p.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id',          pa.add_on_id,
                'add_on_id',   pa.add_on_id,
                'name',        ao.name,
                'duration_days', pa.duration_days,
                'is_lifetime', pa.is_lifetime
              ) ORDER BY pa.add_on_id
            ) FILTER (WHERE pa.add_on_id IS NOT NULL),
            '[]'::json
          ) AS add_ons
        FROM plans p
        LEFT JOIN plan_add_ons pa ON pa.plan_id = p.id
        LEFT JOIN add_ons ao ON ao.id = pa.add_on_id
        WHERE p.id = $1
        GROUP BY p.id
      `, [planId]);

      return res.status(201).json({ success: true, plan: created[0] });
    } catch (error) {
      logger.error('planBuilderController.createPlan error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * PUT /api/webapp/admin/plans/:id
   * Update an existing plan.
   * If add_ons is provided, atomically replaces all plan_add_ons and
   * re-derives tier, features, description.
   * If add_ons is omitted, existing plan_add_ons are preserved.
   *
   * Body (all optional):
   *   name         {string}
   *   price        {number}
   *   is_active    {boolean}  (maps to active column)
   *   add_ons      {Array}    [{add_on_id, duration_days?, is_lifetime?}]
   *   duration_days {number}
   *   display_name {string}
   */
  async updatePlan(req, res) {
    try {
      const { id: planId } = req.params;

      const { rows: found } = await query('SELECT id FROM plans WHERE id = $1', [planId]);
      if (!found.length) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
      }

      const { name, price, is_active, add_ons, duration_days, display_name } = req.body;
      const hasAddOns = Object.prototype.hasOwnProperty.call(req.body, 'add_ons');

      if (price !== undefined) {
        if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 9999.99) {
          return res.status(400).json({ success: false, error: 'price must be a finite number between 0 and 9999.99' });
        }
      }

      if (hasAddOns) {
        const validation = validateAddOns(add_ons);
        if (!validation.valid) {
          return res.status(400).json({ success: false, error: validation.error });
        }
      }

      // Fetch current plan to fill in missing values for derivation
      const { rows: current } = await query('SELECT * FROM plans WHERE id = $1', [planId]);
      const cur = current[0];

      // If add_ons provided, re-derive metadata
      let updateFields = {};
      if (hasAddOns) {
        const addOnsNorm = add_ons.map(a => ({
          add_on_id:    a.add_on_id,
          duration_days: a.duration_days || null,
          is_lifetime:   a.is_lifetime || false,
        }));
        const addOnIds = addOnsNorm.map(a => a.add_on_id);
        const durations = addOnsNorm.filter(a => !a.is_lifetime && a.duration_days).map(a => a.duration_days);
        const resolvedDuration = duration_days
          || (durations.length ? Math.max(...durations) : parseInt(cur.duration_days || cur.duration || 30, 10));

        // Regenerate SKU with new structured format encoding the entitlement composition.
        const newSku = generateSku(addOnsNorm);

        updateFields = {
          // plans.tier is a backward-compat display field only — not used for access control.
          tier:         deriveTier(addOnIds),
          sku:          newSku,
          features:     JSON.stringify(addOnIds.flatMap(id => ADD_ON_FEATURES[id] || [])),
          description:  generateDescription(
            (name || cur.name).trim(),
            addOnsNorm,
            resolvedDuration,
            price !== undefined ? price : parseFloat(cur.price)
          ),
          duration_days: resolvedDuration,
          duration:      resolvedDuration,
        };

        // Replace plan_add_ons atomically
        await query('DELETE FROM plan_add_ons WHERE plan_id = $1', [planId]);
        for (const addOn of addOnsNorm) {
          await query(`
            INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime)
            VALUES ($1, $2, $3, $4)
          `, [planId, addOn.add_on_id, addOn.duration_days, addOn.is_lifetime]);
        }

        logger.info('Plan add-ons replaced via plan builder', {
          planId, count: addOnsNorm.length,
          updatedBy: req.session?.user?.id || req.user?.id,
        });
      }

      // Apply scalar field updates
      const setClauses = [];
      const params = [];
      let idx = 1;

      const addField = (col, val) => {
        if (val !== undefined && val !== null) {
          setClauses.push(`${col} = $${idx++}`);
          params.push(val);
        }
      };

      if (name !== undefined) addField('name', name.trim());
      if (display_name !== undefined) addField('display_name', display_name.trim());
      if (price !== undefined) addField('price', price);
      if (is_active !== undefined) addField('active', is_active);
      if (updateFields.tier) addField('tier', updateFields.tier);
      if (updateFields.sku) addField('sku', updateFields.sku);
      if (updateFields.features) addField('features', updateFields.features);
      if (updateFields.description) addField('description', updateFields.description);
      if (updateFields.duration_days) {
        addField('duration_days', updateFields.duration_days);
        addField('duration', updateFields.duration);
      } else if (duration_days !== undefined) {
        addField('duration_days', duration_days);
        addField('duration', duration_days);
      }

      if (setClauses.length > 0) {
        setClauses.push(`updated_at = NOW()`);
        params.push(planId);
        await query(
          `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $${idx}`,
          params
        );
      }

      // Invalidate cache
      await cache.del('plans:all');
      await cache.del(`plan:${planId}`);

      logger.info('Plan updated via plan builder', {
        planId,
        updatedBy: req.session?.user?.id || req.user?.id,
      });

      return res.json({ success: true });
    } catch (error) {
      logger.error('planBuilderController.updatePlan error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/webapp/admin/plans/:id
   * Soft-deactivate by setting active=false.
   * Hard delete is blocked when payments reference the plan (FK constraint 23503);
   * in that case we fall back to soft-deactivation automatically.
   */
  async deactivatePlan(req, res) {
    try {
      const { id: planId } = req.params;
      const force = req.query.force === 'true';

      if (force) {
        // Attempt hard delete only when explicitly requested
        try {
          await query('DELETE FROM plans WHERE id = $1', [planId]);
          await cache.del('plans:all');
          await cache.del(`plan:${planId}`);
          logger.info('Plan hard-deleted via plan builder', {
            planId, deletedBy: req.session?.user?.id || req.user?.id,
          });
          return res.json({ success: true, deleted: true });
        } catch (err) {
          if (err.code === '23503') {
            // FK violation — fall through to soft-delete
            logger.warn('Plan hard delete blocked by FK constraint, soft-deactivating', { planId });
          } else {
            throw err;
          }
        }
      }

      // Soft deactivate
      const result = await query(
        'UPDATE plans SET active = false, updated_at = NOW() WHERE id = $1',
        [planId]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
      }

      await cache.del('plans:all');
      await cache.del(`plan:${planId}`);

      logger.info('Plan deactivated via plan builder', {
        planId, deactivatedBy: req.session?.user?.id || req.user?.id,
      });
      return res.json({ success: true, deleted: false, deactivated: true });
    } catch (error) {
      logger.error('planBuilderController.deactivatePlan error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/webapp/admin/add-ons
   * List all available add-ons with pre-built UI descriptions.
   */
  async listAddOns(req, res) {
    try {
      const { rows } = await query(
        'SELECT * FROM add_ons ORDER BY id'
      );
      const enriched = rows.map(r => ({
        ...r,
        ui_description: ADD_ON_DESCRIPTIONS[r.id] || r.description,
        features:        ADD_ON_FEATURES[r.id] || [],
      }));
      return res.json({ success: true, addOns: enriched });
    } catch (error) {
      logger.error('planBuilderController.listAddOns error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
};

module.exports = planBuilderController;
