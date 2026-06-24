const crypto = require('crypto');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const NotificationEmitter = require('./notificationEmitter');
const sendSystemDM = require('./sendSystemDM');
const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE, EARNINGS_HOLD_HOURS } = require('../config/monetizationConfig');

const TEASER_SECRET = process.env.TEASER_SECRET || 'pnptv-teaser-salt-2026';
if (!process.env.TEASER_SECRET) {
  logger.warn('TEASER_SECRET env var not set — using hardcoded fallback. Set it in .env.production to silence this warning.');
}

function isTeaserPost(postId, viewerId) {
  const hash = crypto.createHmac('sha256', TEASER_SECRET)
    .update(`${postId}:${viewerId}`)
    .digest();
  return hash[0] % 5 === 0; // ~20% teaser rate, viewer-specific and non-enumerable
}

class CreatorService {
  // ── Eligibility ─────────────────────────────────────────────────────────────

  static async checkEligibility(userId) {
    const [mediaPosts, totalLikes, userRow, weeklyConsistency] = await Promise.all([
      query(
        `SELECT COUNT(*)::int as count FROM social_posts
         WHERE user_id = $1 AND media_url IS NOT NULL AND is_deleted = false AND reply_to_id IS NULL`,
        [userId]
      ),
      query(
        `SELECT COALESCE(SUM(likes_count), 0)::int as total FROM social_posts
         WHERE user_id = $1 AND media_url IS NOT NULL AND is_deleted = false`,
        [userId]
      ),
      query('SELECT followers_count FROM users WHERE id = $1', [userId]),
      query(
        `SELECT COUNT(DISTINCT date_trunc('week', created_at))::int as weeks FROM social_posts
         WHERE user_id = $1 AND media_url IS NOT NULL AND is_deleted = false
           AND created_at >= NOW() - INTERVAL '4 weeks'`,
        [userId]
      ),
    ]);

    const criteria = {
      mediaPosts: { current: mediaPosts.rows[0]?.count || 0, required: 10 },
      totalLikes: { current: totalLikes.rows[0]?.total || 0, required: 30 },
      followers: { current: userRow.rows[0]?.followers_count || 0, required: 15 },
      weeklyConsistency: { current: weeklyConsistency.rows[0]?.weeks || 0, required: 4 },
    };

    criteria.mediaPosts.met = criteria.mediaPosts.current >= criteria.mediaPosts.required;
    criteria.totalLikes.met = criteria.totalLikes.current >= criteria.totalLikes.required;
    criteria.followers.met = criteria.followers.current >= criteria.followers.required;
    criteria.weeklyConsistency.met = criteria.weeklyConsistency.current >= criteria.weeklyConsistency.required;

    const missing = Object.entries(criteria)
      .filter(([, v]) => !v.met)
      .map(([k]) => k);

    const eligible = missing.length === 0;

    // Promote to 'eligible' in DB so activateCreator can proceed without requiring a batch job
    if (eligible) {
      await query(
        "UPDATE users SET creator_status = 'eligible' WHERE id = $1 AND creator_status = 'none'",
        [userId]
      ).catch(err => logger.warn('checkEligibility: failed to promote status', { userId, error: err.message }));
    }

    return { eligible, criteria, missing };
  }

  static async updateEligibilityStatus(userId) {
    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0] || userRes.rows[0].creator_status !== 'none') return false;

    const { eligible } = await this.checkEligibility(userId);
    if (!eligible) return false;

    await query(
      "UPDATE users SET creator_status = 'eligible' WHERE id = $1 AND creator_status = 'none'",
      [userId]
    );

    NotificationEmitter.emit({
      type: 'creator_eligible',
      category: 'commerce',
      priority: 'normal',
      actorId: userId,
      targetUserId: userId,
      entityType: 'creator',
      entityId: userId,
      message: 'You qualify as a creator! Activate your creator profile to start earning.',
    });

    return true;
  }

  static async runBatchEligibilityCheck() {
    const { rows } = await query(
      `SELECT id FROM users
       WHERE creator_status = 'none'
         AND (SELECT COUNT(*) FROM social_posts WHERE user_id = users.id AND media_url IS NOT NULL AND is_deleted = false AND reply_to_id IS NULL) >= 8`
    );

    let promoted = 0;
    for (const row of rows) {
      try {
        const result = await this.updateEligibilityStatus(row.id);
        if (result) promoted++;
      } catch (err) {
        logger.error('Batch eligibility check failed for user', { userId: row.id, error: err.message });
      }
    }
    logger.info('Batch eligibility check complete', { checked: rows.length, promoted });
    return { checked: rows.length, promoted };
  }

  // ── Tier Config ──────────────────────────────────────────────────────────────

  static TIERS = {
    ice:     { price: 5.00,  label: 'Ice Profile' },
    crystal: { price: 10.00, label: 'Crystal Profile' },
    diamond: { price: 15.00, label: 'Diamond Profile' },
  };

  /**
   * Grant lifetime pnp-member entitlement to a newly-active creator/model and
   * invalidate their entitlement caches. Idempotent — safe to call repeatedly.
   * Per project_creator_entitlements policy: creators get pnp-member (full
   * platform access except PRIME-exclusive content), not prime.
   */
  static async _grantCreatorMembership(userId) {
    if (!userId) return;
    try {
      // Route through the canonical EntitlementModel.grantEntitlement so the
      // creator-onboarding path inherits the same invariant guards, audit
      // log, and cascade behavior as paid grants. Direct INSERTs here used
      // to be a structural smell (FS-architect L-6 finding 2026-04-28).
      const EntitlementModel = require('../models/entitlementModel');
      await EntitlementModel.grantEntitlement(String(userId), 'pnp-member', {
        isLifetime: true,
        source: 'system',
        actorId: 'creator-onboarding',
        reason: 'auto-grant on creator role assignment',
      });
      const EntitlementAccessService = require('./entitlementAccessService');
      await EntitlementAccessService.invalidateCache(userId);
      logger.info('Granted lifetime pnp-member to new creator', { userId });
    } catch (err) {
      logger.error('_grantCreatorMembership failed (non-fatal)', { userId, error: err.message });
    }
  }

  // ── Activate (Tiered) ─────────────────────────────────────────────────────

  static async activateCreator(userId, tier = 'ice', termsAccepted = false) {
    if (!this.TIERS[tier]) throw new Error('Invalid tier. Choose ice, crystal, or diamond.');
    if (!termsAccepted) throw new Error('You must accept the Creator Terms & Conditions to activate.');

    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) throw new Error('User not found');
    if (user.creator_status !== 'eligible') {
      throw new Error('User is not eligible to activate as a creator');
    }

    const { price } = this.TIERS[tier];

    await query(
      `UPDATE users SET
         creator_status = 'active',
         creator_type = $2,
         creator_price_usd = $3,
         creator_enabled_at = NOW(),
         creator_terms_accepted_at = NOW(),
         creator_strikes = 0,
         creator_subscription_paused = TRUE,
         role = CASE WHEN role = 'user' THEN 'model' ELSE role END
       WHERE id = $1`,
      [userId, tier, price]
    );

    // C-03: ensure every newly-active creator has a 2257 grace deadline
    await query(
      `UPDATE users
         SET identity_verification_required_by = COALESCE(identity_verification_required_by, NOW() + INTERVAL '30 days'),
             updated_at = NOW()
       WHERE id = $1 AND identity_verified = false`,
      [userId]
    );

    // Grant lifetime pnp-member so the creator immediately has full platform access
    await this._grantCreatorMembership(userId);

    // Sync Authentik Creators group — non-fatal
    try {
      const subRes = await query('SELECT authentik_sub FROM users WHERE id = $1', [userId]);
      if (subRes.rows[0]?.authentik_sub) {
        const AuthentikService = require('./authentikService');
        await AuthentikService.addUserToCreatorsGroup(subRes.rows[0].authentik_sub);
      }
    } catch (authErr) {
      logger.warn('activateCreator: Authentik group sync failed (non-fatal)', { userId, error: authErr.message });
    }

    CreatorService.notifyCreatorActivated(userId, { actorId: String(userId), source: 'self' });

    return { success: true, type: tier, price };
  }

  // ── Full-Time Application ──────────────────────────────────────────────────

  // Full-time applications use the existing model_applications table via /api/apply.
  // No separate submitApplication needed — admin approve/reject works on model_applications.

  static async approveApplication(applicationId, adminId, notes) {
    const appRes = await query(
      'SELECT * FROM model_applications WHERE id = $1',
      [applicationId]
    );
    const app = appRes.rows[0];
    if (!app) throw new Error('Application not found');
    if (app.status === 'approved') throw new Error('Application already approved');

    await query(
      `UPDATE model_applications SET
         status = 'approved', reviewed_by = $2, admin_notes = $3, reviewed_at = NOW()
       WHERE id = $1`,
      [applicationId, adminId, notes || null]
    );

    const priceUsd = app.requested_price_usd || 15.00;

    await query(
      `UPDATE users SET
         creator_status = 'active',
         creator_type = 'full_time',
         creator_price_usd = $2,
         creator_verified = true,
         creator_featured = true,
         creator_enabled_at = NOW(),
         creator_subscription_paused = TRUE,
         role = CASE WHEN role IN ('user', 'model') THEN 'model' ELSE role END
       WHERE id = $1`,
      [app.user_id, priceUsd]
    );

    // C-03: ensure every newly-active creator has a 2257 grace deadline
    await query(
      `UPDATE users
         SET identity_verification_required_by = COALESCE(identity_verification_required_by, NOW() + INTERVAL '30 days'),
             updated_at = NOW()
       WHERE id = $1 AND identity_verified = false`,
      [app.user_id]
    );

    // C-04: ensure the full-time application path produces a creator_2257_records row.
    // Apply.tsx collects legal_full_name + date_of_birth + ID docs; the self-service
    // enrollment flow writes to creator_2257_records directly, but the full-time path
    // does not. Upsert here so admin approval always leaves a 2257 record behind.
    if (app.legal_full_name || app.id_front_url) {
      await query(
        `INSERT INTO creator_2257_records
           (user_id, legal_name, date_of_birth, id_document_path, verification_status,
            submitted_at, verified_at, admin_notes)
         VALUES ($1, $2, $3, $4, 'admin_approved', NOW(), NOW(), 'Auto-created from approved full-time application')
         ON CONFLICT (user_id) DO UPDATE SET
           verification_status = EXCLUDED.verification_status,
           verified_at         = EXCLUDED.verified_at,
           admin_notes         = EXCLUDED.admin_notes
           WHERE creator_2257_records.verification_status NOT IN ('verified', 'admin_approved')`,
        [app.user_id, app.legal_full_name || null, app.date_of_birth || null, app.id_front_url || null]
      );
    }

    // Grant lifetime pnp-member so the approved creator immediately has full access
    await this._grantCreatorMembership(app.user_id);

    // Generate subscription code, live channel slug, and set DM policy
    try {
      await this.finaliseCreatorActivation(app.user_id, 'full_time');
    } catch (activationErr) {
      logger.warn('approveApplication: finaliseCreatorActivation failed (non-fatal)', {
        applicationId,
        userId: app.user_id,
        error: activationErr.message,
      });
    }

    // Sync Authentik Creators group — non-fatal
    try {
      const subRes = await query('SELECT authentik_sub FROM users WHERE id = $1', [app.user_id]);
      if (subRes.rows[0]?.authentik_sub) {
        const AuthentikService = require('./authentikService');
        await AuthentikService.addUserToCreatorsGroup(subRes.rows[0].authentik_sub);
      }
    } catch (authErr) {
      logger.warn('approveApplication: Authentik group sync failed (non-fatal)', { userId: app.user_id, error: authErr.message });
    }

    CreatorService.notifyCreatorActivated(app.user_id, { actorId: String(adminId), source: 'application' });

    return { success: true };
  }

  static async rejectApplication(applicationId, adminId, notes) {
    const appRes = await query(
      'SELECT * FROM model_applications WHERE id = $1',
      [applicationId]
    );
    const app = appRes.rows[0];
    if (!app) throw new Error('Application not found');

    await query(
      `UPDATE model_applications SET
         status = 'rejected', reviewed_by = $2, admin_notes = $3, reviewed_at = NOW()
       WHERE id = $1`,
      [applicationId, adminId, notes || null]
    );

    // Do NOT reset creator_status — the user remains an active tier creator.
    // Only full-time promotion is denied; their existing tier enrollment is preserved.

    NotificationEmitter.emit({
      type: 'creator_rejected',
      category: 'commerce',
      priority: 'normal',
      actorId: adminId,
      targetUserId: app.user_id,
      entityType: 'model_application',
      entityId: applicationId,
      message: 'Your creator application was not approved at this time.',
    });

    return { success: true };
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Reject any monetization action whose target creator is in the temporary
   * onboarding-lock state. Called from subscribe/tip/book-call paths so users
   * cannot pay a locked creator. Throws a tagged Error the controllers can
   * surface as a 423.
   */
  static async assertCreatorUnlocked(targetUserId) {
    if (!targetUserId) return;
    const { rows } = await query(
      'SELECT creator_locked FROM users WHERE id = $1',
      [targetUserId]
    );
    if (rows.length > 0 && rows[0].creator_locked === true) {
      const err = new Error('This creator is completing onboarding and cannot receive payments yet.');
      err.code = 'CREATOR_LOCKED';
      err.statusCode = 423;
      throw err;
    }
  }

  static async subscribeToCreator(subscriberId, creatorId, paymentId) {
    // paymentId is required — null would break ON CONFLICT (source_payment_id) deduplication
    // in creator_earnings, silently losing earnings on duplicate calls.
    if (!paymentId) throw new Error('subscribeToCreator: paymentId is required');

    // Validate creator is active (outside transaction — read-only, no locking needed)
    const creatorRes = await query(
      'SELECT creator_status, creator_locked, creator_subscription_paused, creator_price_usd FROM users WHERE id = $1',
      [creatorId]
    );
    const creator = creatorRes.rows[0];
    if (!creator || creator.creator_status !== 'active') {
      throw new Error('Creator is not active');
    }
    if (creator.creator_locked === true) {
      const err = new Error('This creator is completing onboarding and cannot accept new subscriptions yet.');
      err.code = 'CREATOR_LOCKED';
      err.statusCode = 423;
      throw err;
    }
    if (creator.creator_subscription_paused === true) {
      const err = new Error('This creator has paused new memberships.');
      err.code = 'SUBSCRIPTIONS_PAUSED';
      err.statusCode = 423;
      throw err;
    }

    // Payment verification is the caller's responsibility:
    // - REST controller verifies ownership, status, plan_id, and creatorId before reaching here.
    // - Webhook handlers (BTCPay/NowPayments/ePayco) verify payment server-side before calling.
    // The former hasPrime gate was removed: it conflated platform PRIME with per-creator payment,
    // allowing any PRIME user to subscribe to any creator for free.

    const EntitlementAccessService = require('./entitlementAccessService');
    const priceUsd = parseFloat(creator.creator_price_usd);

    // FIX 5: Read duration from plan_add_ons instead of hardcoding 30 days.
    let durationDays = 30; // safe default
    try {
      const { rows: durationRows } = await query(
        `SELECT duration_days FROM plan_add_ons WHERE plan_id = 'creator_monthly' AND add_on_id = 'creator-subscription' LIMIT 1`
      );
      if (durationRows[0]?.duration_days) durationDays = durationRows[0].duration_days;
    } catch (_) { /* non-fatal, use default */ }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // Wrap all DB writes in a transaction so a mid-flight crash leaves no partial state
    const { getPool } = require('../config/postgres');
    const client = await getPool().connect();
    let rows;
    try {
      await client.query('BEGIN');

      // Upsert subscription
      const subResult = await client.query(
        `INSERT INTO creator_subscriptions (creator_id, subscriber_id, price_usd, expires_at, payment_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (creator_id, subscriber_id)
         DO UPDATE SET status = 'active', price_usd = $3, expires_at = $4, payment_id = $5,
                       cancelled_at = NULL, auto_renew = TRUE
         RETURNING id`,
        [creatorId, subscriberId, priceUsd, expiresAt, paymentId || null]
      );
      rows = subResult.rows;

      // Recompute the visible subscriber count from canonical rows instead of
      // incrementing blindly, which drifts on renewals and idempotent replays.
      await client.query(
        `UPDATE users
            SET creator_subscriber_count = (
              SELECT COUNT(*)
              FROM creator_subscriptions
              WHERE creator_id = $1
                AND status = 'active'
                AND (expires_at IS NULL OR expires_at > NOW())
            )
          WHERE id = $1`,
        [creatorId]
      );

      // Write creator-subscription entitlement so entitlement-based access checks work
      await client.query(`
        INSERT INTO user_entitlements (user_id, add_on_id, creator_id, expires_at, source_plan_id, source_payment_id)
        VALUES ($1, 'creator-subscription', $2, $4::timestamptz, 'creator_monthly', $3)
        ON CONFLICT (user_id, add_on_id, creator_id)
        DO UPDATE SET
          expires_at = CASE
            WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
            WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
              THEN user_entitlements.expires_at + ($5::integer * INTERVAL '1 day')
            ELSE $4::timestamptz
          END,
          is_consumed = false,
          source_payment_id = COALESCE(EXCLUDED.source_payment_id, user_entitlements.source_payment_id),
          updated_at = NOW()
        WHERE NOT user_entitlements.is_lifetime
      `, [String(subscriberId), String(creatorId), paymentId || null, expiresAt, durationDays]);

      // Record earnings (70/30 split) — held for EARNINGS_HOLD_HOURS before maturing to 'available'
      const amountCreator = Math.round(priceUsd * CREATOR_REVENUE_RATE * 100) / 100;
      const amountPlatform = Math.round(priceUsd * PLATFORM_COMMISSION_RATE * 100) / 100;

      await client.query(
        `INSERT INTO creator_earnings (creator_id, subscription_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
         VALUES ($1, $2, $3, $4, $5, 'holding', NOW() + ($6 || ' hours')::interval, $7, date_trunc('month', CURRENT_DATE)::date)
         ON CONFLICT (source_payment_id) DO NOTHING`,
        [creatorId, rows[0].id, priceUsd, amountCreator, amountPlatform, String(EARNINGS_HOLD_HOURS), paymentId || null]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Cache invalidation runs outside the transaction (non-fatal)
    try {
      await EntitlementAccessService.invalidateCache(String(subscriberId));
    } catch (cacheErr) {
      logger.warn('subscribeToCreator: cache invalidation failed (non-fatal)', { subscriberId, error: cacheErr.message });
    }

    // Notify subscriber's frontend to refresh subscription state
    try {
      const socketSingleton = require('./socketSingleton');
      const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
      if (io) {
        io.to(`user:${subscriberId}`).emit('subscription:updated', {
          creatorId,
          status: 'active',
          expiresAt,
        });
      }
    } catch (socketErr) {
      logger.warn('subscribeToCreator: failed to emit subscription:updated socket event', {
        subscriberId,
        creatorId,
        error: socketErr.message,
      });
    }

    // Notify creator of new subscriber (in-app notification)
    try {
      const subscriberRes = await query(
        'SELECT username, first_name FROM users WHERE id = $1',
        [subscriberId]
      );
      const subscriberName =
        subscriberRes.rows[0]?.first_name ||
        subscriberRes.rows[0]?.username ||
        'Someone';

      NotificationEmitter.emit({
        type: 'creator_new_subscriber',
        category: 'commerce',
        priority: 'normal',
        actorId: subscriberId,
        targetUserId: creatorId,
        entityType: 'creator_subscription',
        entityId: String(rows[0].id),
        message: `${subscriberName} subscribed to your creator profile for $${priceUsd}/mo`,
      });
    } catch (notifyErr) {
      logger.warn('subscribeToCreator: failed to emit new-subscriber notification', {
        subscriberId,
        creatorId,
        error: notifyErr.message,
      });
    }

    // Notify creator via Telegram DM (non-fatal)
    try {
      const creatorNotifRes = await query(
        'SELECT telegram, first_name FROM users WHERE id = $1', [creatorId]
      );
      const subscriberRes = await query(
        'SELECT first_name, username FROM users WHERE id = $1', [subscriberId]
      );
      const creatorRow = creatorNotifRes.rows[0];
      const subscriberRow = subscriberRes.rows[0];
      if (creatorRow?.telegram) {
        const bot = (() => {
          try {
            const m = require('../bot/core/bot');
            const inst = typeof m.getBotInstance === 'function' ? m.getBotInstance() : null;
            if (inst) return inst;
          } catch (_) {}
          const { Telegraf } = require('telegraf');
          return new Telegraf(process.env.BOT_TOKEN);
        })();
        const subName = subscriberRow?.first_name || subscriberRow?.username || 'Someone';
        await bot.telegram.sendMessage(
          creatorRow.telegram,
          `💸 *New subscriber!* ${subName} just subscribed to your creator profile for $${priceUsd}/mo.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (notifErr) {
      logger.warn('subscribeToCreator: failed to notify creator via Telegram', { creatorId, error: notifErr.message });
    }

    return { subscriptionId: rows[0].id, expiresAt, price: priceUsd };
  }

  static async unsubscribeFromCreator(subscriberId, creatorId) {
    const result = await query(
      `UPDATE creator_subscriptions SET
         status = 'cancelled', cancelled_at = NOW(), auto_renew = FALSE
       WHERE creator_id = $1 AND subscriber_id = $2 AND status = 'active'
       RETURNING id`,
      [creatorId, subscriberId]
    );
    if (result.rowCount === 0) throw new Error('No active subscription found');

    await query(
      `UPDATE users SET creator_subscriber_count = (
         SELECT COUNT(*) FROM creator_subscriptions
         WHERE creator_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
       ) WHERE id = $1`,
      [creatorId]
    );

    // Revoke creator-subscription entitlement immediately on cancellation
    try {
      const { query: dbQuery } = require('../config/postgres');
      await dbQuery(
        `DELETE FROM user_entitlements
         WHERE user_id = $1 AND add_on_id = 'creator-subscription' AND creator_id = $2`,
        [String(subscriberId), String(creatorId)]
      );
      try {
        const EntitlementAccessService = require('./entitlementAccessService');
        await EntitlementAccessService.invalidateCache(String(subscriberId));
      } catch (_) { /* non-critical */ }
      logger.info('Entitlement revoked on creator subscription cancel', { subscriberId, creatorId });
    } catch (err) {
      logger.error('Failed to revoke entitlement on cancel', { subscriberId, creatorId, error: err.message });
    }

    // Void any earnings still in 'holding' for this subscription so the creator
    // is not paid out for a cancelled/refunded subscription within the hold window.
    await query(
      `UPDATE creator_earnings SET status = 'void', updated_at = NOW()
       WHERE subscription_id = (
         SELECT id FROM creator_subscriptions
         WHERE creator_id = $1 AND subscriber_id = $2
         LIMIT 1
       ) AND status = 'holding'`,
      [creatorId, subscriberId]
    ).catch(err => logger.warn('unsubscribeFromCreator: failed to void holding earnings', { error: err.message }));

    // Notify creator that a subscriber left
    try {
      NotificationEmitter.emit({
        type: 'creator_subscriber_left',
        category: 'commerce',
        priority: 'low',
        actorId: subscriberId,
        targetUserId: creatorId,
        entityType: 'creator_subscription',
        entityId: null,
        message: 'A subscriber cancelled their subscription to your creator profile.',
      });
    } catch (notifyErr) {
      logger.warn('unsubscribeFromCreator: failed to emit subscriber-left notification', {
        subscriberId,
        creatorId,
        error: notifyErr.message,
      });
    }

    return { success: true };
  }

  static async expireCreatorSubscriptions() {
    // Prevent concurrent runs from double-processing the same expired rows
    // (e.g., on a PM2 cluster restart overlap or multi-instance deploy).
    const { cache } = require('../config/redis');
    const lockKey = 'creator:expire-subscriptions:lock';
    const lockAcquired = await cache.acquireLock(lockKey, 120).catch(() => false);
    if (!lockAcquired) {
      logger.info('expireCreatorSubscriptions: lock held by another instance, skipping');
      return { expired: 0 };
    }

    let rows = [];
    try {
    const result = await query(
      `UPDATE creator_subscriptions SET status = 'expired'
       WHERE status = 'active' AND expires_at < NOW()
       RETURNING subscriber_id, creator_id`
    );
    rows = result.rows;

    // Recompute subscriber counts and revoke entitlements for each affected creator
    const creatorIds = [...new Set(rows.map(r => r.creator_id))];
    for (const creatorId of creatorIds) {
      await query(
        `UPDATE users SET creator_subscriber_count = (
           SELECT COUNT(*) FROM creator_subscriptions
           WHERE creator_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
         ) WHERE id = $1`,
        [creatorId]
      );
    }

    // Revoke user_entitlements for all expired subscriptions and invalidate caches
    const EntitlementAccessService = require('./entitlementAccessService');
    if (rows.length > 0) {
      const userIds    = rows.map(r => String(r.subscriber_id));
      const creatorIds2 = rows.map(r => String(r.creator_id));
      try {
        await query(
          `UPDATE user_entitlements
           SET expires_at = NOW(), updated_at = NOW()
           WHERE (user_id::text, creator_id::text) IN (
             SELECT unnest($1::text[]), unnest($2::text[])
           )
             AND add_on_id = 'creator-subscription'
             AND expires_at > NOW()`,
          [userIds, creatorIds2]
        );
      } catch (entErr) {
        logger.warn('expireCreatorSubscriptions: failed to bulk-revoke entitlements', {
          count: rows.length, error: entErr.message,
        });
      }
    }
    for (const { subscriber_id: subscriberId } of rows) {
      try {
        await EntitlementAccessService.invalidateCache(String(subscriberId));
      } catch (cacheErr) {
        logger.warn('expireCreatorSubscriptions: cache invalidation failed (non-fatal)', {
          subscriberId, error: cacheErr.message,
        });
      }
    }

    logger.info('Expired creator subscriptions', { expired: rows.length, creators: creatorIds.length });
    return { expired: rows.length };
    } finally {
      await cache.releaseLock(lockKey).catch(() => {});
    }
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  static async getCreatorDashboard(creatorId) {
    const [subscriberRes, earningsRes, exclusiveRes, applicationRes, enrollmentRes] = await Promise.all([
      query(
        'SELECT creator_subscriber_count, creator_status, creator_type, creator_price_usd, creator_verified, creator_featured, creator_dash_address, stream_rules, creator_subscription_paused FROM users WHERE id = $1',
        [creatorId]
      ),
      query(
        `SELECT
           COALESCE(SUM(amount_creator), 0)::numeric as total_earnings,
           COALESCE(SUM(CASE WHEN period_month = date_trunc('month', CURRENT_DATE)::date THEN amount_creator ELSE 0 END), 0)::numeric as monthly_earnings
         FROM creator_earnings WHERE creator_id = $1`,
        [creatorId]
      ),
      query(
        'SELECT COUNT(*)::int as count FROM social_posts WHERE user_id = $1 AND is_exclusive = true AND is_deleted = false',
        [creatorId]
      ),
      query(
        'SELECT id, status, call_scheduled, call_scheduled_at, created_at FROM model_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [creatorId]
      ),
      query(
        'SELECT id, tier, status, admin_notes, created_at, reviewed_at FROM creator_enrollments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [creatorId]
      ),
    ]);

    const user = subscriberRes.rows[0] || {};
    return {
      subscriberCount: user.creator_subscriber_count || 0,
      creatorStatus: user.creator_status || 'none',
      creatorType: user.creator_type || null,
      priceUsd: parseFloat(user.creator_price_usd) || 15.00,
      verified: user.creator_verified || false,
      featured: user.creator_featured || false,
      totalEarnings: parseFloat(earningsRes.rows[0]?.total_earnings) || 0,
      monthlyEarnings: parseFloat(earningsRes.rows[0]?.monthly_earnings) || 0,
      exclusivePostCount: exclusiveRes.rows[0]?.count || 0,
      application: applicationRes.rows[0] || null,
      enrollment: enrollmentRes.rows[0] || null,
      walletAddress: user.creator_dash_address || null,
      streamRules: user.stream_rules || null,
      subscriptionPaused: user.creator_subscription_paused || false,
    };
  }

  // ── Exclusive Content Access ───────────────────────────────────────────────

  static async canViewExclusivePost(viewerId, creatorId, postId) {
    // Owner always sees their own exclusive content
    if (viewerId === creatorId) return { status: 'unlocked', reason: 'owner' };

    // Check viewer's role and entitlements via live data (not stale users.tier)
    const viewerRes = await query(
      "SELECT role FROM users WHERE id = $1",
      [viewerId]
    );
    const viewerRole = viewerRes.rows[0]?.role || '';
    const isAdminRole = viewerRole === 'admin' || viewerRole === 'superadmin';
    const EntitlementAccessService = require('./entitlementAccessService');

    // Admin always unlocked
    if (isAdminRole) {
      return { status: 'unlocked', reason: 'admin' };
    }

    // Check creator-subscription entitlement first (subscriber wins unconditionally)
    const hasCreatorSub = await EntitlementAccessService.hasEntitlement(
      viewerId, 'creator-subscription', { creatorId }
    );
    if (hasCreatorSub) {
      return { status: 'unlocked', reason: 'subscribed' };
    }

    // PRIME users get a teaser preview (not full unlock without subscribing)
    const hasPrimeEnt = await EntitlementAccessService.hasEntitlement(viewerId, 'prime');
    if (hasPrimeEnt) {
      if (isTeaserPost(postId, viewerId)) {
        return { status: 'teaser', reason: 'prime_preview' };
      }
      return { status: 'locked', reason: 'not_subscribed' };
    }

    return { status: 'locked', reason: 'not_subscribed' };
  }

  static async filterFeedExclusivePosts(posts, viewerId, viewerTier) {
    if (!posts || posts.length === 0) return posts;

    const exclusivePosts = posts.filter(p => p.is_exclusive);
    if (exclusivePosts.length === 0) return posts;

    const isPrime = (viewerTier || '').toLowerCase() === 'prime';

    // Batch-check subscriptions unconditionally — subscribers without PRIME must
    // still see content from creators they pay for.
    const creatorIds = [...new Set(exclusivePosts.map(p => p.author_id || p.user_id))];
    let subscribedCreatorIds = new Set();

    if (creatorIds.length > 0 && viewerId) {
      try {
        const subsRes = await query(
          `SELECT creator_id FROM creator_subscriptions
           WHERE subscriber_id = $1 AND creator_id = ANY($2) AND status = 'active'
             AND (expires_at IS NULL OR expires_at > NOW())`,
          [viewerId, creatorIds]
        );
        subscribedCreatorIds = new Set(subsRes.rows.map(r => String(r.creator_id)));
      } catch (subsErr) {
        logger.warn('filterFeedExclusivePosts: subscription batch-check failed (non-fatal)', {
          viewerId, error: subsErr.message,
        });
      }
    }

    return posts.map(p => {
      if (!p.is_exclusive) return p;

      const postCreatorId = p.author_id || p.user_id;

      // Owner sees their own posts regardless of tier
      if (viewerId && String(postCreatorId) === String(viewerId)) {
        return { ...p, exclusive_status: 'unlocked' };
      }

      // Active subscriber always gets full access
      if (subscribedCreatorIds.has(String(postCreatorId))) {
        return { ...p, exclusive_status: 'unlocked' };
      }

      // PRIME users (non-subscribed) get a teaser preview
      if (isPrime) {
        if (isTeaserPost(p.id, viewerId)) {
          return { ...p, exclusive_status: 'teaser' };
        }
        return {
          ...p,
          exclusive_status: 'locked',
          locked_reason: 'not_subscribed',
          content: null,
          media_url: null,
          media_urls: null,
        };
      }

      // Non-PRIME, non-subscribed: locked
      return {
        ...p,
        exclusive_status: 'locked',
        locked_reason: 'not_subscribed',
        content: null,
        media_url: null,
        media_urls: null,
      };
    });
  }

  // ── Subscription Status ────────────────────────────────────────────────────

  static async getSubscriptionStatus(subscriberId, creatorId) {
    const [subRes, creatorRes] = await Promise.all([
      query(
        `SELECT id, status, price_usd, started_at, expires_at, auto_renew
         FROM creator_subscriptions
         WHERE creator_id = $1 AND subscriber_id = $2
           AND status = 'active'
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT 1`,
        [creatorId, subscriberId]
      ),
      query(
        'SELECT creator_status, creator_type, creator_price_usd, creator_verified, creator_subscriber_count FROM users WHERE id = $1',
        [creatorId]
      ),
    ]);

    const creator = creatorRes.rows[0] || {};
    const sub = subRes.rows[0] || null;

    return {
      subscribed: sub?.status === 'active',
      subscription: sub,
      creator: {
        status: creator.creator_status,
        type: creator.creator_type,
        priceUsd: parseFloat(creator.creator_price_usd) || 15.00,
        verified: creator.creator_verified || false,
        subscriberCount: creator.creator_subscriber_count || 0,
      },
    };
  }

  // ── Admin: List Applications ───────────────────────────────────────────────

  static async listApplications(statusFilter) {
    const params = [];
    // Application rows from model_applications
    let appWhere = '';
    if (statusFilter) {
      params.push(statusFilter);
      appWhere = 'WHERE ma.status = $1';
    }

    // Manually-promoted creators (no model_applications row) always show as
    // 'approved' — only include them when no status filter or filter = 'approved'
    const includeManual = !statusFilter || statusFilter === 'approved';

    const { rows } = await query(
      `SELECT ma.id, ma.user_id, ma.application_type, ma.stage_name, ma.bio,
              ma.status, ma.admin_notes, ma.reviewed_by, ma.reviewed_at,
              ma.requested_price_usd, ma.call_scheduled, ma.call_scheduled_at,
              ma.created_at, ma.updated_at,
              u.username, u.first_name, u.photo_file_id
       FROM model_applications ma
       JOIN users u ON ma.user_id = u.id
       ${appWhere}

       ${includeManual ? `
       UNION ALL

       SELECT
         NULL::uuid          AS id,
         u.id                AS user_id,
         'both'              AS application_type,
         COALESCE(u.first_name, u.username) AS stage_name,
         NULL                AS bio,
         'approved'          AS status,
         'Manually assigned by admin' AS admin_notes,
         NULL::text          AS reviewed_by,
         u.creator_enabled_at AS reviewed_at,
         NULL::numeric       AS requested_price_usd,
         false               AS call_scheduled,
         NULL::timestamptz   AS call_scheduled_at,
         COALESCE(u.creator_enabled_at, u.created_at) AS created_at,
         u.updated_at,
         u.username,
         u.first_name,
         u.photo_file_id
       FROM users u
       WHERE u.creator_status = 'active'
         AND NOT EXISTS (SELECT 1 FROM model_applications ma2 WHERE ma2.user_id = u.id)
       ` : ''}

       ORDER BY created_at DESC`,
      params
    );

    return rows;
  }

  // ── Admin: Strike Management ───────────────────────────────────────────────

  static async issueStrike(creatorId, issuedBy, reason) {
    const userRes = await query(
      'SELECT creator_strikes, creator_status FROM users WHERE id = $1',
      [creatorId]
    );
    const user = userRes.rows[0];
    if (!user) throw new Error('Creator not found');
    if (user.creator_status !== 'active') throw new Error('Creator is not active');

    const newStrikeCount = (user.creator_strikes || 0) + 1;

    await query(
      'INSERT INTO creator_strike_log (creator_id, strike_number, reason, issued_by) VALUES ($1, $2, $3, $4)',
      [creatorId, newStrikeCount, reason, issuedBy]
    );

    const newStatus = newStrikeCount >= 3 ? 'suspended' : user.creator_status;
    await query(
      'UPDATE users SET creator_strikes = $1, creator_status = $2 WHERE id = $3',
      [newStrikeCount, newStatus, creatorId]
    );

    // Remove from Authentik Creators group on suspension — non-fatal
    if (newStrikeCount >= 3) {
      try {
        const subRes = await query('SELECT authentik_sub FROM users WHERE id = $1', [creatorId]);
        if (subRes.rows[0]?.authentik_sub) {
          const AuthentikService = require('./authentikService');
          await AuthentikService.removeUserFromCreatorsGroup(subRes.rows[0].authentik_sub);
        }
      } catch (authErr) {
        logger.warn('issueStrike: Authentik group removal failed (non-fatal)', { creatorId, error: authErr.message });
      }
    }

    const messages = {
      1: `Strike 1/3: ${reason}. You have 14 days to restore activity.`,
      2: `Strike 2/3: ${reason}. Final warning — 7 days to restore activity.`,
      3: `Strike 3/3: Your creator profile has been suspended. ${reason}`,
    };

    try {
      NotificationEmitter.emit({
        type: newStrikeCount >= 3 ? 'creator_suspended' : 'creator_strike',
        category: 'system',
        priority: newStrikeCount >= 3 ? 'high' : 'normal',
        actorId: issuedBy,
        targetUserId: creatorId,
        entityType: 'creator',
        entityId: String(creatorId),
        message: messages[Math.min(newStrikeCount, 3)],
      });
    } catch (notifyErr) {
      logger.warn('issueStrike: failed to emit notification', {
        creatorId,
        strike: newStrikeCount,
        error: notifyErr.message,
      });
    }

    return { strikeCount: newStrikeCount, suspended: newStrikeCount >= 3 };
  }

  static async getCreatorStrikes(creatorId) {
    const { rows } = await query(
      'SELECT * FROM creator_strike_log WHERE creator_id = $1 ORDER BY created_at DESC',
      [creatorId]
    );
    return rows;
  }

  // ── Milestone Notifications ──────────────────────────────────────────────────

  /**
   * Check eligibility and, if newly met, insert a milestone notification row.
   * Called after post creation, receiving likes, or gaining followers.
   * @returns {{ eligible: boolean, notificationId: number|null }}
   */
  static async checkAndNotifyMilestones(userId) {
    const { eligible } = await this.checkEligibility(userId);
    if (!eligible) return { eligible: false, notificationId: null };

    // Only insert if no pending or accepted notification already exists
    const existing = await query(
      `SELECT id FROM creator_milestone_notifications
       WHERE user_id = $1
         AND milestone_type = 'eligible'
         AND status IN ('pending', 'accepted')
       LIMIT 1`,
      [userId]
    );
    if (existing.rows.length > 0) {
      return { eligible: true, notificationId: null };
    }

    // Also skip if user declined within the 30-day cooldown window
    const declined = await query(
      `SELECT id FROM creator_milestone_notifications
       WHERE user_id = $1
         AND milestone_type = 'eligible'
         AND status = 'declined'
         AND decline_cooldown_until > NOW()
       LIMIT 1`,
      [userId]
    );
    if (declined.rows.length > 0) {
      return { eligible: true, notificationId: null };
    }

    const { rows } = await query(
      `INSERT INTO creator_milestone_notifications
         (user_id, milestone_type, status)
       VALUES ($1, 'eligible', 'pending')
       RETURNING id`,
      [userId]
    );

    const notificationId = rows[0].id;

    NotificationEmitter.emit({
      type: 'creator_eligible',
      category: 'commerce',
      priority: 'normal',
      actorId: userId,
      targetUserId: userId,
      entityType: 'creator_milestone',
      entityId: String(notificationId),
      message: 'You qualify as a creator! Tap to activate your creator profile and start earning.',
    });

    return { eligible: true, notificationId };
  }

  /**
   * Accept or decline a milestone notification.
   * @param {string} userId
   * @param {number|string} notificationId
   * @param {'accepted'|'declined'} response
   */
  static async respondToMilestone(userId, notificationId, response) {
    if (!['accepted', 'declined'].includes(response)) {
      throw new Error("response must be 'accepted' or 'declined'");
    }

    const { rows } = await query(
      `SELECT * FROM creator_milestone_notifications
       WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [notificationId, userId]
    );
    if (rows.length === 0) {
      throw Object.assign(new Error('Milestone notification not found or already responded'), { statusCode: 404 });
    }

    if (response === 'declined') {
      await query(
        `UPDATE creator_milestone_notifications
         SET status = 'declined',
             responded_at = NOW(),
             decline_cooldown_until = NOW() + INTERVAL '30 days',
             updated_at = NOW()
         WHERE id = $1`,
        [notificationId]
      );
      return { responded: true, response: 'declined' };
    }

    // Accepted — mark as accepted and kick off enrollment
    await query(
      `UPDATE creator_milestone_notifications
       SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [notificationId]
    );

    return { responded: true, response: 'accepted', redirectToEnrollment: true };
  }

  // ── Engagement Score ──────────────────────────────────────────────────────────

  /**
   * Calculate engagement score for the last 30 days and suggest a tier.
   * @returns {{ score: number, suggestedTier: 'ice'|'crystal'|'diamond', suggestedPrice: number }}
   */
  static async calculateEngagementScore(userId) {
    const [likesRes, commentsRes, followersRes] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(sp.likes_count), 0)::int AS likes
         FROM social_posts sp
         WHERE sp.user_id = $1
           AND sp.is_deleted = false
           AND sp.created_at >= NOW() - INTERVAL '30 days'`,
        [userId]
      ),
      query(
        `SELECT COUNT(*)::int AS comments
         FROM social_posts c
         JOIN social_posts p ON c.reply_to_id = p.id
         WHERE p.user_id = $1
           AND c.is_deleted = false
           AND c.created_at >= NOW() - INTERVAL '30 days'`,
        [userId]
      ),
      query(
        `SELECT COUNT(*)::int AS new_followers
         FROM user_follows
         WHERE following_id = $1
           AND created_at >= NOW() - INTERVAL '30 days'`,
        [userId]
      ),
    ]);

    const likes = likesRes.rows[0]?.likes || 0;
    const comments = commentsRes.rows[0]?.comments || 0;
    const newFollowers = followersRes.rows[0]?.new_followers || 0;
    const score = likes + comments + newFollowers;

    let suggestedTier = 'ice';
    let suggestedPrice = 5.00;
    if (score >= 200) {
      suggestedTier = 'diamond';
      suggestedPrice = 15.00;
    } else if (score >= 50) {
      suggestedTier = 'crystal';
      suggestedPrice = 10.00;
    }

    return { score, suggestedTier, suggestedPrice, breakdown: { likes, comments, newFollowers } };
  }

  /**
   * Returns suggested subscription price based on current engagement score.
   * @returns {{ price: number, tier: string }}
   */
  static async getCreatorSubscriptionPrice(creatorId) {
    const { suggestedTier, suggestedPrice } = await this.calculateEngagementScore(creatorId);
    return { price: suggestedPrice, tier: suggestedTier };
  }

  // ── Post-Approval Activation Steps ────────────────────────────────────────────

  /**
   * Called after approveEnrollment / approveApplication to generate the subscription
   * code, live channel slug, set role, and lock DM policy for the newly active creator.
   * @param {string} userId
   * @param {string} creatorType  e.g. 'ice', 'crystal', 'diamond', 'full_time'
   */
  static async finaliseCreatorActivation(userId, creatorType) {
    // Fetch the username so we can derive a meaningful channel slug
    const userRes = await query(
      'SELECT username, live_channel, creator_subscription_code, privacy FROM users WHERE id = $1',
      [userId]
    );
    const user = userRes.rows[0];
    if (!user) throw new Error('User not found during creator activation');

    const updates = {};

    // Generate subscription code only if not already set
    if (!user.creator_subscription_code) {
      const codeRes = await query('SELECT generate_creator_code() AS code');
      updates.creator_subscription_code = codeRes.rows[0].code;
    }

    // Generate live_channel slug only if not already set
    if (!user.live_channel) {
      const channelRes = await query(
        'SELECT generate_live_channel($1, $2) AS channel',
        [user.username || 'creator', userId]
      );
      updates.live_channel = channelRes.rows[0].channel;
    }

    // Merge creatorDmPolicy into existing privacy JSONB
    const existingPrivacy = user.privacy || {};
    if (!existingPrivacy.creatorDmPolicy) {
      existingPrivacy.creatorDmPolicy = 'subscribers_and_mutuals';
      updates.privacy = existingPrivacy;
    }

    if (Object.keys(updates).length === 0) return; // Nothing to change

    const setClauses = [];
    const params = [];
    let paramIdx = 1;

    if (updates.creator_subscription_code !== undefined) {
      setClauses.push(`creator_subscription_code = $${paramIdx++}`);
      params.push(updates.creator_subscription_code);
    }
    if (updates.live_channel !== undefined) {
      setClauses.push(`live_channel = $${paramIdx++}`);
      params.push(updates.live_channel);
    }
    if (updates.privacy !== undefined) {
      setClauses.push(`privacy = $${paramIdx++}`);
      params.push(JSON.stringify(updates.privacy));
    }

    params.push(userId);
    await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params
    );

    logger.info('finaliseCreatorActivation: applied', {
      userId,
      creatorType,
      appliedKeys: Object.keys(updates),
    });
  }

  // ── Enrollment ──────────────────────────────────────────────────────────────

  static async submitEnrollment(userId, { tier, paymentMethod, paymentAddress, paymentNetwork, signatureData }, idDocumentPath, ip) {
    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) throw new Error('User not found');
    if (user.creator_status === 'active') throw new Error('Creator profile already active');
    if (user.creator_status === 'pending_review') throw new Error('Enrollment already submitted and under review');

    const validTiers = { ice: 5.00, crystal: 10.00, diamond: 15.00 };
    if (!validTiers[tier]) throw new Error('Invalid tier. Choose ice, crystal, or diamond.');

    // 'dash' is the canonical crypto payout path (BTCPay Pull Payments) since
    // the Daimo USDC retirement on 2026-04-21. usdc/usdt remain accepted for
    // compatibility with creators enrolled pre-retirement; the monthly cron
    // routes them to the manual review queue rather than auto-paying.
    const validMethods = ['dash', 'meru', 'usdc', 'usdt'];
    if (!validMethods.includes(paymentMethod)) throw new Error('Invalid payment method.');
    if (!paymentAddress?.trim()) throw new Error('Payment address or Meru account ID is required.');
    if (!signatureData) throw new Error('Digital signature is required.');
    if (!idDocumentPath) throw new Error('ID document photo is required.');

    await query(
      `INSERT INTO creator_enrollments
         (user_id, tier, status, terms_accepted_at, terms_accepted_ip, content_commitment_accepted_at,
          payment_method, payment_address, payment_network, id_document_path, signature_data, submitted_at)
       VALUES ($1, $2, 'pending_review', NOW(), $3, NOW(), $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         tier = $2, status = 'pending_review',
         terms_accepted_at = NOW(), terms_accepted_ip = $3,
         content_commitment_accepted_at = NOW(),
         payment_method = $4, payment_address = $5, payment_network = $6,
         id_document_path = $7, signature_data = $8,
         submitted_at = NOW(), reviewed_at = NULL, reviewed_by = NULL, admin_notes = NULL,
         updated_at = NOW()`,
      [userId, tier, ip || null, paymentMethod, paymentAddress.trim(), paymentNetwork || null, idDocumentPath, signatureData]
    );

    await query(
      `UPDATE users SET creator_status = 'pending_review', creator_type = $2, creator_price_usd = $3 WHERE id = $1`,
      [userId, tier, validTiers[tier]]
    );

    try {
      NotificationEmitter.emit({
        type: 'creator_enrollment_submitted',
        category: 'commerce',
        priority: 'normal',
        actorId: userId,
        targetUserId: userId,
        entityType: 'creator_enrollment',
        entityId: userId,
        message: `Your ${tier} creator enrollment has been submitted and is under review. We'll notify you within 24-48 hours.`,
      });
    } catch (_) {}

    return { submitted: true, tier, status: 'pending_review' };
  }

  static async getEnrollment(userId) {
    const { rows } = await query(
      `SELECT id, tier, status, payment_method, payment_address, payment_network,
              submitted_at, reviewed_at, admin_notes, created_at
       FROM creator_enrollments WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  }

  static async listEnrollments(statusFilter) {
    const params = [];
    let where = '';
    if (statusFilter) {
      params.push(statusFilter);
      where = 'WHERE ce.status = $1';
    }
    const { rows } = await query(
      `SELECT ce.id, ce.user_id, ce.tier, ce.status, ce.payment_method, ce.payment_address,
              ce.payment_network, ce.id_document_path, ce.submitted_at, ce.reviewed_at,
              ce.admin_notes, u.username, u.first_name, u.photo_file_id
       FROM creator_enrollments ce
       JOIN users u ON ce.user_id = u.id
       ${where}
       ORDER BY ce.submitted_at DESC`,
      params
    );
    return rows;
  }

  static async approveEnrollment(enrollmentId, adminId, notes) {
    const { rows } = await query('SELECT * FROM creator_enrollments WHERE id = $1', [enrollmentId]);
    const enrollment = rows[0];
    if (!enrollment) throw new Error('Enrollment not found');
    if (enrollment.status === 'approved') throw new Error('Already approved');

    const validTiers = { ice: 5.00, crystal: 10.00, diamond: 15.00 };
    const price = validTiers[enrollment.tier] || 5.00;

    await query(
      `UPDATE creator_enrollments SET status = 'approved', reviewed_by = $2, admin_notes = $3,
         reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId, adminId, notes || null]
    );

    await query(
      `UPDATE users SET
         creator_status = 'active',
         creator_type = $2,
         creator_price_usd = $3,
         creator_enabled_at = NOW(),
         creator_terms_accepted_at = NOW(),
         creator_strikes = 0,
         creator_locked = TRUE,
         creator_subscription_paused = TRUE,
         role = CASE WHEN role = 'user' THEN 'model' ELSE role END
       WHERE id = $1`,
      [enrollment.user_id, enrollment.tier, price]
    );

    // C-03: ensure every newly-active creator has a 2257 grace deadline
    await query(
      `UPDATE users
         SET identity_verification_required_by = COALESCE(identity_verification_required_by, NOW() + INTERVAL '30 days'),
             updated_at = NOW()
       WHERE id = $1 AND identity_verified = false`,
      [enrollment.user_id]
    );

    // Generate subscription code, live channel slug, and set DM policy
    try {
      await this.finaliseCreatorActivation(enrollment.user_id, enrollment.tier);
    } catch (activationErr) {
      logger.warn('approveEnrollment: finaliseCreatorActivation failed (non-fatal)', {
        enrollmentId,
        userId: enrollment.user_id,
        error: activationErr.message,
      });
    }

    // Sync Authentik Creators group — non-fatal
    try {
      const subRes = await query('SELECT authentik_sub FROM users WHERE id = $1', [enrollment.user_id]);
      if (subRes.rows[0]?.authentik_sub) {
        const AuthentikService = require('./authentikService');
        await AuthentikService.addUserToCreatorsGroup(subRes.rows[0].authentik_sub);
      }
    } catch (authErr) {
      logger.warn('approveEnrollment: Authentik group sync failed (non-fatal)', { userId: enrollment.user_id, error: authErr.message });
    }

    try {
      NotificationEmitter.emit({
        type: 'creator_approved',
        category: 'commerce',
        priority: 'high',
        actorId: adminId,
        targetUserId: enrollment.user_id,
        entityType: 'creator_enrollment',
        entityId: String(enrollmentId),
        message: `Your ${enrollment.tier} creator profile has been approved! You can now start posting exclusive content and earning.`,
      });
    } catch (_) {}

    return { success: true };
  }

  static async checkAndUpgradeTier(userId) {
    const { rows } = await query(
      `SELECT creator_type, creator_subscriber_count FROM users WHERE id = $1 AND creator_status = 'active'`,
      [userId]
    );
    const user = rows[0];
    if (!user) return { upgraded: false, from: null, to: null };

    const tierOrder = ['ice', 'crystal', 'diamond'];
    const thresholds = { ice: 10, crystal: 25 };
    const prices = { ice: 5.00, crystal: 10.00, diamond: 15.00 };

    const currentTier = user.creator_type;
    const subscriberCount = user.creator_subscriber_count || 0;

    if (currentTier === 'diamond') return { upgraded: false, from: 'diamond', to: 'diamond' };

    const currentIndex = tierOrder.indexOf(currentTier);
    if (currentIndex === -1) return { upgraded: false, from: currentTier, to: null };

    const nextTier = tierOrder[currentIndex + 1];
    if (!nextTier) return { upgraded: false, from: currentTier, to: null };

    const threshold = thresholds[currentTier];
    if (subscriberCount < threshold) return { upgraded: false, from: currentTier, to: nextTier };

    const newPrice = prices[nextTier];

    await query(
      `UPDATE users SET creator_type = $2, creator_price_usd = $3, updated_at = NOW() WHERE id = $1`,
      [userId, nextTier, newPrice]
    );

    await query(
      `UPDATE creator_enrollments SET tier = $2, updated_at = NOW()
       WHERE user_id = $1 AND status = 'approved'`,
      [userId, nextTier]
    );

    try {
      NotificationEmitter.emit({
        type: 'creator_tier_upgraded',
        category: 'commerce',
        priority: 'high',
        actorId: userId,
        targetUserId: userId,
        entityType: 'creator_tier',
        entityId: userId,
        message: `Congratulations! Your creator profile has been upgraded to ${nextTier} tier 🎉 Your new subscription price is $${newPrice}/mo for new subscribers.`,
      });
    } catch (_) {}

    logger.info('Creator tier upgraded', { userId, from: currentTier, to: nextTier, subscriberCount });

    return { upgraded: true, from: currentTier, to: nextTier };
  }

  static async rejectEnrollment(enrollmentId, adminId, notes) {
    const { rows } = await query('SELECT * FROM creator_enrollments WHERE id = $1', [enrollmentId]);
    const enrollment = rows[0];
    if (!enrollment) throw new Error('Enrollment not found');

    await query(
      `UPDATE creator_enrollments SET status = 'rejected', reviewed_by = $2, admin_notes = $3,
         reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [enrollmentId, adminId, notes || null]
    );

    await query(
      `UPDATE users SET creator_status = 'none' WHERE id = $1`,
      [enrollment.user_id]
    );

    try {
      NotificationEmitter.emit({
        type: 'creator_rejected',
        category: 'commerce',
        priority: 'normal',
        actorId: adminId,
        targetUserId: enrollment.user_id,
        entityType: 'creator_enrollment',
        entityId: String(enrollmentId),
        message: `Your creator enrollment was not approved at this time. ${notes || 'Please contact support for more information.'}`,
      });
    } catch (_) {}

    return { success: true };
  }

  /**
   * Send creator-activation notifications on all three channels.
   * Fire-and-forget — never throws, never blocks the caller.
   *
   * @param {string} userId
   * @param {object} opts
   * @param {string} [opts.actorId]   - Admin or 'system'
   * @param {string} [opts.source]    - 'admin' | 'self' | 'application'
   */
  static notifyCreatorActivated(userId, { actorId = 'system', source = 'admin' } = {}) {
    setImmediate(async () => {
      try {
        const { rows } = await query(
          'SELECT first_name, username, email, language FROM users WHERE id = $1',
          [userId]
        );
        const user = rows[0];
        if (!user) return;

        const name = user.first_name || user.username || 'Creator';
        const isEs = (user.language || 'en').startsWith('es');

        // ── 1. In-app notification + Telegram (via NotificationEmitter) ─────
        NotificationEmitter.emit({
          type: 'creator_activated',
          category: 'system',
          priority: 'high',
          actorId,
          targetUserId: String(userId),
          entityType: 'user',
          entityId: String(userId),
          message: isEs
            ? '¡Felicidades! Ya eres creador en PNPtv!'
            : 'Congratulations! You are now a creator on PNPtv!',
          metadata: {
            url: '/profile',
            pushTitle: isEs ? '¡Eres creador en PNPtv! 🎉' : 'You\'re a PNPtv creator! 🎉',
            pushBody: isEs
              ? 'Tu cuenta de creador ha sido activada. ¡Empieza a publicar!'
              : 'Your creator account is live. Start posting!',
          },
        }).catch(() => {});

        // ── 2. In-app DM from Cristina ───────────────────────────────────────
        const dmContent = isEs
          ? [
              `¡Hola ${name}! 🎉 Tu cuenta de creador en PNPtv ha sido activada.`,
              ``,
              `Ahora puedes publicar contenido exclusivo, configurar suscripciones y conectar con tu audiencia. ¡Bienvenido al equipo creador!`,
              ``,
              `Visita tu perfil para completar tu configuración: nombre artístico, precio de suscripción y enlace de canal en vivo.`,
            ].join('\n')
          : [
              `Hey ${name}! 🎉 Your PNPtv creator account has just been activated.`,
              ``,
              `You can now post exclusive content, set up subscriptions, and connect with your audience. Welcome to the creator team!`,
              ``,
              `Visit your profile to complete your setup: display name, subscription price, and live channel link.`,
            ].join('\n');

        await sendSystemDM('cristina-ai', String(userId), dmContent, query);

        // ── 3. Email ─────────────────────────────────────────────────────────
        if (user.email && user.email.includes('@')) {
          const emailService = require('./emailService');
          await emailService.sendCreatorActivatedEmail({
            to: user.email,
            name,
            language: user.language || 'en',
          });
        }

        logger.info('notifyCreatorActivated: all channels delivered', { userId, source });
      } catch (err) {
        logger.warn('notifyCreatorActivated: delivery error (non-fatal)', { userId, error: err.message });
      }
    });
  }
}

module.exports = CreatorService;
