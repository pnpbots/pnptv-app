'use strict';

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * EntitlementModel
 *
 * Manages add_ons, plan_add_ons, user_entitlements, and subscription_audit_log.
 *
 * Schema notes (migration 133 + 135):
 *   - add_ons.id is TEXT, e.g. 'prime', 'pnp-member'
 *   - plan_add_ons PK: (plan_id, add_on_id); has duration_days INT NULL, is_lifetime BOOL
 *   - user_entitlements UNIQUE NULLS NOT DISTINCT (user_id, add_on_id, creator_id)
 *   - subscription_audit_log requires actor_id, actor_type, action IN ('grant','revoke','extend','expire','consume')
 *   - Lifetime entitlements are protected by a DB trigger; superadmin bypass requires
 *     SET LOCAL pnptv.superadmin_bypass = 'true' within the same transaction.
 */
class EntitlementModel {
  // ─── Add-ons catalog ────────────────────────────────────────────────────────

  /**
   * Get all add-ons from the catalog.
   * @returns {Promise<Array>}
   */
  static async getAllAddOns() {
    const result = await query(
      `SELECT id, name, description, add_on_type, is_active, created_at
       FROM add_ons
       ORDER BY name ASC`
    );
    return result.rows;
  }

  // ─── Plan → add-on mappings ──────────────────────────────────────────────────

  /**
   * Get plan_add_ons for a specific plan, joined with add-on names.
   * @param {string} planId
   * @returns {Promise<Array>}
   */
  static async getPlanAddOns(planId) {
    const result = await query(
      `SELECT pa.plan_id,
              pa.add_on_id,
              a.name          AS add_on_name,
              a.description   AS add_on_description,
              a.add_on_type,
              pa.duration_days,
              pa.is_lifetime
       FROM plan_add_ons pa
       JOIN add_ons a ON a.id = pa.add_on_id
       WHERE pa.plan_id = $1
       ORDER BY a.name ASC`,
      [planId]
    );
    return result.rows;
  }

  /**
   * Replace all plan_add_ons for a plan (delete existing, insert new).
   * Runs in a transaction so the set is atomically replaced.
   *
   * @param {string} planId
   * @param {Array<{add_on_id: string, duration_days: number|null, is_lifetime: boolean}>} addOns
   * @returns {Promise<Array>} The new plan_add_ons rows (joined with add-on names)
   */
  static async setPlanAddOns(planId, addOns) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Verify plan exists
      const planCheck = await client.query(
        'SELECT id FROM plans WHERE id = $1',
        [planId]
      );
      if (planCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        throw Object.assign(new Error(`Plan '${planId}' not found`), { status: 404 });
      }

      // Verify all add_on_ids exist
      if (addOns.length > 0) {
        const addOnIds = addOns.map((a) => a.add_on_id);
        const addOnCheck = await client.query(
          'SELECT id FROM add_ons WHERE id = ANY($1::text[])',
          [addOnIds]
        );
        const foundIds = new Set(addOnCheck.rows.map((r) => r.id));
        const missing = addOnIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          await client.query('ROLLBACK');
          throw Object.assign(
            new Error(`Unknown add_on_id(s): ${missing.join(', ')}`),
            { status: 400 }
          );
        }
      }

      // Delete existing mappings for this plan
      await client.query('DELETE FROM plan_add_ons WHERE plan_id = $1', [planId]);

      // Insert new mappings
      const inserted = [];
      for (const addon of addOns) {
        const durationDays = addon.duration_days != null ? addon.duration_days : null;
        const isLifetime = addon.is_lifetime === true;

        const row = await client.query(
          `INSERT INTO plan_add_ons (plan_id, add_on_id, duration_days, is_lifetime)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [planId, addon.add_on_id, durationDays, isLifetime]
        );
        inserted.push(row.rows[0]);
      }

      await client.query('COMMIT');

      // Return enriched rows
      return this.getPlanAddOns(planId);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── User entitlements ───────────────────────────────────────────────────────

  /**
   * Get all entitlements for a user, joined with add-on names.
   * Includes both active and expired rows so the admin can see history.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  static async getUserEntitlements(userId) {
    const result = await query(
      `SELECT ue.id,
              ue.user_id,
              ue.add_on_id,
              a.name          AS add_on_name,
              a.description   AS add_on_description,
              a.add_on_type,
              ue.source_plan_id,
              ue.source_payment_id,
              ue.creator_id,
              ue.is_lifetime,
              ue.is_consumed,
              ue.granted_at,
              ue.expires_at,
              ue.created_at,
              ue.updated_at,
              CASE
                WHEN ue.is_lifetime THEN true
                WHEN ue.expires_at IS NULL THEN true
                WHEN ue.expires_at > NOW() THEN true
                ELSE false
              END AS is_active
       FROM user_entitlements ue
       JOIN add_ons a ON a.id = ue.add_on_id
       WHERE ue.user_id = $1
       ORDER BY ue.granted_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Grant a single entitlement (upsert — extend expiry if a timed one exists).
   * Mirrors the logic in PaymentService.grantEntitlementsForPlan but targets the
   * new schema (migration 133): three-column unique, actor-aware audit log.
   *
   * @param {string} userId
   * @param {string} addOnId  — text slug e.g. 'prime'
   * @param {object} opts
   * @param {boolean} [opts.isLifetime=false]
   * @param {number}  [opts.durationDays=30]   — ignored when isLifetime=true
   * @param {string}  [opts.sourcePlanId=null]
   * @param {string}  [opts.sourcePaymentId=null]
   * @param {string}  [opts.creatorId=null]    — for creator-subscription add-on
   * @param {string}  [opts.source='admin']    — actor_type for audit log
   * @param {string}  [opts.actorId='system']  — who triggered this
   * @param {string}  [opts.reason='']
   * @returns {Promise<object>} The upserted row
   */
  static async grantEntitlement(
    userId,
    addOnId,
    {
      isLifetime = false,
      durationDays = 30,
      sourcePlanId = null,
      sourcePaymentId = null,
      creatorId = null,
      source = 'admin',
      actorId = 'system',
      reason = '',
    } = {}
  ) {
    // Validate add-on exists
    const addOnCheck = await query('SELECT id, name FROM add_ons WHERE id = $1', [addOnId]);
    if (addOnCheck.rows.length === 0) {
      throw Object.assign(new Error(`Unknown add_on_id: '${addOnId}'`), { status: 400 });
    }
    const addOnName = addOnCheck.rows[0].name;

    let entitlementRow;

    if (isLifetime) {
      // Lifetime upsert — no expiry, override any existing timed row.
      // The DB trigger blocks modification of existing lifetime rows unless bypass is set;
      // but an INSERT ON CONFLICT DO UPDATE that sets is_lifetime=true on a lifetime row
      // only touches allowed columns (is_consumed, updated_at) — safe without bypass.
      // To be explicit about intent, we use a clean upsert.
      const result = await query(
        `INSERT INTO user_entitlements
           (user_id, add_on_id, source_plan_id, source_payment_id, creator_id,
            is_lifetime, is_consumed, granted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, true, false, NOW(), NULL)
         ON CONFLICT (user_id, add_on_id, creator_id)
         DO UPDATE SET
           is_lifetime      = true,
           expires_at       = NULL,
           is_consumed      = false,
           source_plan_id   = COALESCE(EXCLUDED.source_plan_id, user_entitlements.source_plan_id),
           source_payment_id = COALESCE(EXCLUDED.source_payment_id, user_entitlements.source_payment_id),
           updated_at       = NOW()
         RETURNING *`,
        [userId, addOnId, sourcePlanId, sourcePaymentId, creatorId]
      );
      entitlementRow = result.rows[0];
    } else {
      // Time-limited upsert — extend from current expiry if still active, else from now.
      // The trigger blocks structural changes to lifetime rows; the WHERE NOT is_lifetime
      // clause prevents accidental downgrade.
      const result = await query(
        `INSERT INTO user_entitlements
           (user_id, add_on_id, source_plan_id, source_payment_id, creator_id,
            is_lifetime, is_consumed, granted_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, false, false, NOW(), NOW() + ($6 || ' days')::interval)
         ON CONFLICT (user_id, add_on_id, creator_id)
         DO UPDATE SET
           expires_at = CASE
             WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
             WHEN user_entitlements.expires_at IS NOT NULL
                  AND user_entitlements.expires_at > NOW()
               THEN user_entitlements.expires_at + ($6 || ' days')::interval
             ELSE NOW() + ($6 || ' days')::interval
           END,
           is_consumed      = false,
           source_plan_id   = COALESCE(EXCLUDED.source_plan_id, user_entitlements.source_plan_id),
           source_payment_id = COALESCE(EXCLUDED.source_payment_id, user_entitlements.source_payment_id),
           updated_at       = NOW()
         WHERE NOT user_entitlements.is_lifetime
         RETURNING *`,
        [userId, addOnId, sourcePlanId, sourcePaymentId, creatorId, String(durationDays)]
      );
      // If the WHERE NOT is_lifetime filtered out the update (row IS lifetime),
      // fetch the existing row so we always return something.
      if (result.rows.length === 0) {
        const existing = await query(
          `SELECT * FROM user_entitlements
           WHERE user_id = $1 AND add_on_id = $2
             AND (creator_id = $3 OR (creator_id IS NULL AND $3 IS NULL))`,
          [userId, addOnId, creatorId]
        );
        entitlementRow = existing.rows[0] || null;
      } else {
        entitlementRow = result.rows[0];
      }
    }

    // Audit log
    try {
      await this._auditLog({
        userId,
        actorId,
        actorType: source === 'payment' ? 'payment' : source === 'system' ? 'system' : 'admin',
        action: 'grant',
        entitlementId: entitlementRow?.id ?? null,
        newValues: {
          add_on_id: addOnId,
          add_on_name: addOnName,
          source_plan_id: sourcePlanId,
          is_lifetime: isLifetime,
          duration_days: isLifetime ? null : durationDays,
          expires_at: entitlementRow?.expires_at ?? null,
        },
        reason,
      });
    } catch (auditErr) {
      logger.warn('EntitlementModel.grantEntitlement: audit log failed (non-fatal)', {
        userId, addOnId, error: auditErr.message,
      });
    }

    logger.info('Entitlement granted', { userId, addOnId, isLifetime, durationDays, actorId });
    return entitlementRow;
  }

  /**
   * Revoke a user's entitlement for an add-on.
   * For lifetime entitlements, superadmin bypass is required; pass isSuperadmin=true.
   *
   * @param {string} userId
   * @param {string} addOnId
   * @param {object} opts
   * @param {string}  [opts.creatorId=null]
   * @param {string}  [opts.reason='']
   * @param {string}  [opts.revokedBy='system']
   * @param {boolean} [opts.isSuperadmin=false]
   * @returns {Promise<object>} The deleted row
   */
  static async revokeEntitlement(
    userId,
    addOnId,
    { creatorId = null, reason = '', revokedBy = 'system', isSuperadmin = false } = {}
  ) {
    // Fetch the existing row first to capture old_values for audit log
    const existing = await query(
      `SELECT * FROM user_entitlements
       WHERE user_id = $1 AND add_on_id = $2
         AND (creator_id = $3 OR (creator_id IS NULL AND $3 IS NULL))`,
      [userId, addOnId, creatorId]
    );

    if (existing.rows.length === 0) {
      throw Object.assign(
        new Error(`No entitlement found for user ${userId}, add-on '${addOnId}'`),
        { status: 404 }
      );
    }

    const row = existing.rows[0];

    if (row.is_lifetime && !isSuperadmin) {
      throw Object.assign(
        new Error(
          'Cannot revoke a lifetime entitlement without superadmin privileges. ' +
          'Set isSuperadmin=true to proceed.'
        ),
        { status: 403 }
      );
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      if (row.is_lifetime && isSuperadmin) {
        // Set the session-level bypass so the DB trigger allows the DELETE
        await client.query("SET LOCAL pnptv.superadmin_bypass = 'true'");
      }

      await client.query(
        `DELETE FROM user_entitlements
         WHERE user_id = $1 AND add_on_id = $2
           AND (creator_id = $3 OR (creator_id IS NULL AND $3 IS NULL))`,
        [userId, addOnId, creatorId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Audit log (outside the transaction — non-critical)
    try {
      await this._auditLog({
        userId,
        actorId: revokedBy,
        actorType: 'admin',
        action: 'revoke',
        entitlementId: row.id,
        oldValues: {
          add_on_id: row.add_on_id,
          is_lifetime: row.is_lifetime,
          expires_at: row.expires_at,
          is_consumed: row.is_consumed,
        },
        reason: reason || `Revoked by ${revokedBy}`,
      });
    } catch (auditErr) {
      logger.warn('EntitlementModel.revokeEntitlement: audit log failed (non-fatal)', {
        userId, addOnId, error: auditErr.message,
      });
    }

    logger.info('Entitlement revoked', { userId, addOnId, revokedBy, wasLifetime: row.is_lifetime });
    return row;
  }

  /**
   * Extend an entitlement's expiry by extraDays.
   * Lifetime entitlements cannot be extended (they have no expiry).
   *
   * @param {string} userId
   * @param {string} addOnId
   * @param {number} extraDays
   * @param {object} opts
   * @param {string} [opts.creatorId=null]
   * @param {string} [opts.reason='']
   * @param {string} [opts.extendedBy='system']
   * @returns {Promise<object>} The updated row
   */
  static async extendEntitlement(
    userId,
    addOnId,
    extraDays,
    { creatorId = null, reason = '', extendedBy = 'system' } = {}
  ) {
    if (!Number.isInteger(extraDays) || extraDays <= 0) {
      throw Object.assign(new Error('extraDays must be a positive integer'), { status: 400 });
    }

    const existing = await query(
      `SELECT * FROM user_entitlements
       WHERE user_id = $1 AND add_on_id = $2
         AND (creator_id = $3 OR (creator_id IS NULL AND $3 IS NULL))`,
      [userId, addOnId, creatorId]
    );

    if (existing.rows.length === 0) {
      throw Object.assign(
        new Error(`No entitlement found for user ${userId}, add-on '${addOnId}'`),
        { status: 404 }
      );
    }

    const row = existing.rows[0];

    if (row.is_lifetime) {
      throw Object.assign(
        new Error('Cannot extend a lifetime entitlement — it already has no expiry.'),
        { status: 400 }
      );
    }

    // Extend from current expiry if still active, else from now
    const result = await query(
      `UPDATE user_entitlements
       SET expires_at = CASE
             WHEN expires_at IS NOT NULL AND expires_at > NOW()
               THEN expires_at + ($1 || ' days')::interval
             ELSE NOW() + ($1 || ' days')::interval
           END,
           updated_at = NOW()
       WHERE user_id = $2 AND add_on_id = $3
         AND (creator_id = $4 OR (creator_id IS NULL AND $4 IS NULL))
         AND is_lifetime = false
       RETURNING *`,
      [String(extraDays), userId, addOnId, creatorId]
    );

    const updated = result.rows[0];

    // Audit log
    try {
      await this._auditLog({
        userId,
        actorId: extendedBy,
        actorType: 'admin',
        action: 'extend',
        entitlementId: row.id,
        oldValues: { expires_at: row.expires_at },
        newValues: { expires_at: updated?.expires_at ?? null, extra_days: extraDays },
        reason: reason || `Extended by ${extendedBy} (+${extraDays} days)`,
      });
    } catch (auditErr) {
      logger.warn('EntitlementModel.extendEntitlement: audit log failed (non-fatal)', {
        userId, addOnId, error: auditErr.message,
      });
    }

    logger.info('Entitlement extended', { userId, addOnId, extraDays, extendedBy });
    return updated;
  }

  /**
   * Check if a user has an active entitlement for the given add-on slug.
   * Active means: is_lifetime=true, OR (is_consumed=false AND (expires_at IS NULL OR expires_at > NOW()))
   *
   * @param {string} userId
   * @param {string} addOnSlug  — e.g. 'prime', 'pnp-member'
   * @param {string} [creatorId=null]  — pass for creator-subscription checks
   * @returns {Promise<boolean>}
   */
  static async hasEntitlement(userId, addOnSlug, creatorId = null) {
    const result = await query(
      `SELECT 1
       FROM user_entitlements
       WHERE user_id = $1
         AND add_on_id = $2
         AND (creator_id = $3 OR (creator_id IS NULL AND $3 IS NULL))
         AND is_consumed = false
         AND (
           is_lifetime = true
           OR (expires_at IS NOT NULL AND expires_at > NOW())
         )
       LIMIT 1`,
      [userId, addOnSlug, creatorId]
    );
    return result.rows.length > 0;
  }

  /**
   * Get audit log entries for a user (most recent first).
   * @param {string} userId
   * @param {object} opts
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   * @returns {Promise<{rows: Array, total: number}>}
   */
  static async getAuditLog(userId, { limit = 50, offset = 0 } = {}) {
    const [rowsResult, countResult] = await Promise.all([
      query(
        `SELECT id, user_id, actor_id, actor_type, action, entitlement_id,
                old_values, new_values, reason, created_at
         FROM subscription_audit_log
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      query(
        'SELECT COUNT(*)::int AS total FROM subscription_audit_log WHERE user_id = $1',
        [userId]
      ),
    ]);

    return {
      rows: rowsResult.rows,
      total: countResult.rows[0]?.total ?? 0,
    };
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Insert a row into subscription_audit_log.
   * action must be one of: 'grant', 'revoke', 'extend', 'expire', 'consume'
   * actorType must be one of: 'system', 'admin', 'payment', 'user'
   * @private
   */
  static async _auditLog({
    userId,
    actorId,
    actorType,
    action,
    entitlementId = null,
    oldValues = null,
    newValues = null,
    reason = '',
  }) {
    await query(
      `INSERT INTO subscription_audit_log
         (user_id, actor_id, actor_type, action, entitlement_id, old_values, new_values, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        String(actorId),
        actorType,
        action,
        entitlementId ?? null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        reason || null,
      ]
    );
  }
}

module.exports = EntitlementModel;
