const crypto = require('crypto');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const NotificationEmitter = require('./notificationEmitter');

const TEASER_SECRET = process.env.TEASER_SECRET || 'pnptv-teaser-salt-2026';

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
         role = CASE WHEN role = 'user' THEN 'model' ELSE role END
       WHERE id = $1`,
      [userId, tier, price]
    );

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
         role = CASE WHEN role IN ('user', 'model') THEN 'model' ELSE role END
       WHERE id = $1`,
      [app.user_id, priceUsd]
    );

    NotificationEmitter.emit({
      type: 'creator_approved',
      category: 'commerce',
      priority: 'high',
      actorId: adminId,
      targetUserId: app.user_id,
      entityType: 'model_application',
      entityId: applicationId,
      message: 'Your full-time creator application has been approved!',
    });

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

  static async subscribeToCreator(subscriberId, creatorId, paymentId) {
    // Validate creator is active
    const creatorRes = await query(
      'SELECT creator_status, creator_price_usd FROM users WHERE id = $1',
      [creatorId]
    );
    const creator = creatorRes.rows[0];
    if (!creator || creator.creator_status !== 'active') {
      throw new Error('Creator is not active');
    }

    // Validate subscriber has PRIME entitlement (live check, not stale users.tier)
    const EntitlementAccessService = require('./entitlementAccessService');
    const hasPrime = await EntitlementAccessService.hasEntitlement(subscriberId, 'prime');
    if (!hasPrime) {
      throw new Error('PRIME subscription required to subscribe to creators');
    }

    const priceUsd = parseFloat(creator.creator_price_usd);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Upsert subscription
    const { rows } = await query(
      `INSERT INTO creator_subscriptions (creator_id, subscriber_id, price_usd, expires_at, payment_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (creator_id, subscriber_id)
       DO UPDATE SET status = 'active', price_usd = $3, expires_at = $4, payment_id = $5,
                     cancelled_at = NULL, auto_renew = TRUE
       RETURNING id`,
      [creatorId, subscriberId, priceUsd, expiresAt, paymentId || null]
    );

    // Increment subscriber count
    await query(
      'UPDATE users SET creator_subscriber_count = creator_subscriber_count + 1 WHERE id = $1',
      [creatorId]
    );

    // Write creator-subscription entitlement so entitlement-based access checks work
    try {
      await query(`
        INSERT INTO user_entitlements (user_id, add_on_id, creator_id, expires_at, source_plan_id)
        VALUES ($1, 'creator-subscription', $2, NOW() + INTERVAL '30 days', 'creator_monthly')
        ON CONFLICT (user_id, add_on_id, creator_id)
        DO UPDATE SET
          expires_at = GREATEST(user_entitlements.expires_at, NOW() + INTERVAL '30 days'),
          is_consumed = false,
          updated_at = NOW()
        WHERE NOT user_entitlements.is_lifetime
      `, [String(subscriberId), String(creatorId)]);
    } catch (entErr) {
      logger.warn('subscribeToCreator: failed to write entitlement', { subscriberId, creatorId, error: entErr.message });
    }

    // Record earnings (70/30 split)
    const amountCreator = Math.round(priceUsd * 0.70 * 100) / 100;
    const amountPlatform = Math.round(priceUsd * 0.30 * 100) / 100;

    await query(
      `INSERT INTO creator_earnings (creator_id, subscription_id, amount_gross, amount_creator, amount_platform, period_month)
       VALUES ($1, $2, $3, $4, $5, date_trunc('month', CURRENT_DATE)::date)`,
      [creatorId, rows[0].id, priceUsd, amountCreator, amountPlatform]
    );

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

    // Notify creator of new subscriber
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
      'UPDATE users SET creator_subscriber_count = GREATEST(0, creator_subscriber_count - 1) WHERE id = $1',
      [creatorId]
    );

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
    const { rows } = await query(
      `UPDATE creator_subscriptions SET status = 'expired'
       WHERE status = 'active' AND expires_at < NOW()
       RETURNING creator_id`
    );

    // Decrement subscriber counts
    const creatorIds = [...new Set(rows.map(r => r.creator_id))];
    for (const creatorId of creatorIds) {
      const expiredCount = rows.filter(r => r.creator_id === creatorId).length;
      await query(
        'UPDATE users SET creator_subscriber_count = GREATEST(0, creator_subscriber_count - $2) WHERE id = $1',
        [creatorId, expiredCount]
      );
    }

    logger.info('Expired creator subscriptions', { expired: rows.length, creators: creatorIds.length });
    return { expired: rows.length };
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  static async getCreatorDashboard(creatorId) {
    const [subscriberRes, earningsRes, exclusiveRes, applicationRes] = await Promise.all([
      query(
        'SELECT creator_subscriber_count, creator_status, creator_type, creator_price_usd, creator_verified, creator_featured, creator_wallet_address FROM users WHERE id = $1',
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
      walletAddress: user.creator_wallet_address || null,
    };
  }

  // ── Exclusive Content Access ───────────────────────────────────────────────

  static async canViewExclusivePost(viewerId, creatorId, postId) {
    // Owner always sees their own exclusive content
    if (viewerId === creatorId) return { status: 'unlocked', reason: 'owner' };

    // Check viewer's PRIME status via live entitlement (not stale users.tier)
    const viewerRes = await query(
      "SELECT role FROM users WHERE id = $1",
      [viewerId]
    );
    const viewerRole = viewerRes.rows[0]?.role || '';
    const isAdminRole = viewerRole === 'admin' || viewerRole === 'superadmin';
    const EntitlementAccessService = require('./entitlementAccessService');
    const hasPrimeEnt = isAdminRole || await EntitlementAccessService.hasEntitlement(viewerId, 'prime');

    if (!hasPrimeEnt) {
      return { status: 'locked', reason: 'not_prime' };
    }

    // Check active subscription
    const subRes = await query(
      `SELECT id FROM creator_subscriptions
       WHERE creator_id = $1 AND subscriber_id = $2 AND status = 'active'`,
      [creatorId, viewerId]
    );

    if (subRes.rows.length > 0) {
      return { status: 'unlocked', reason: 'subscribed' };
    }

    // Teaser: ~20% of posts, keyed to viewer so enumeration by post ID is not possible
    if (isTeaserPost(postId, viewerId)) {
      return { status: 'teaser', reason: 'prime_preview' };
    }

    return { status: 'locked', reason: 'not_subscribed' };
  }

  static async filterFeedExclusivePosts(posts, viewerId, viewerTier) {
    if (!posts || posts.length === 0) return posts;

    const exclusivePosts = posts.filter(p => p.is_exclusive);
    if (exclusivePosts.length === 0) return posts;

    const isPrime = (viewerTier || '').toLowerCase() === 'prime';

    // If not PRIME, lock all exclusive posts — EXCEPT posts owned by the viewer themselves
    // (creators who are not yet prime-tier must still see their own exclusive content)
    if (!isPrime) {
      return posts.map(p => {
        if (!p.is_exclusive) return p;
        const postCreatorId = p.author_id || p.user_id;
        // Owner always sees their own exclusive posts regardless of tier
        if (viewerId && String(postCreatorId) === String(viewerId)) {
          return { ...p, exclusive_status: 'unlocked' };
        }
        return {
          ...p,
          exclusive_status: 'locked',
          locked_reason: 'not_prime',
          content: null,
          media_url: null,
          media_urls: null,
        };
      });
    }

    // For PRIME users, batch-check subscriptions
    const creatorIds = [...new Set(exclusivePosts.map(p => p.author_id || p.user_id))];
    let subscribedCreatorIds = new Set();

    if (creatorIds.length > 0) {
      const subsRes = await query(
        `SELECT creator_id FROM creator_subscriptions
         WHERE subscriber_id = $1 AND creator_id = ANY($2) AND status = 'active'`,
        [viewerId, creatorIds]
      );
      subscribedCreatorIds = new Set(subsRes.rows.map(r => r.creator_id));
    }

    return posts.map(p => {
      if (!p.is_exclusive) return p;

      const postCreatorId = p.author_id || p.user_id;

      // Owner sees their own posts
      if (String(postCreatorId) === String(viewerId)) {
        return { ...p, exclusive_status: 'unlocked' };
      }

      // Subscribed
      if (subscribedCreatorIds.has(String(postCreatorId))) {
        return { ...p, exclusive_status: 'unlocked' };
      }

      // Teaser (~20% — keyed to viewer so post IDs cannot be enumerated to find teasers)
      if (isTeaserPost(p.id, viewerId)) {
        return { ...p, exclusive_status: 'teaser' };
      }

      // Locked for non-subscribed PRIME users
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
    let whereClause = '';
    if (statusFilter) {
      params.push(statusFilter);
      whereClause = 'WHERE ma.status = $1';
    }

    const { rows } = await query(
      `SELECT ma.*, u.username, u.first_name, u.photo_file_id
       FROM model_applications ma
       JOIN users u ON ma.user_id = u.id
       ${whereClause}
       ORDER BY ma.created_at DESC`,
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

  // ── Enrollment ──────────────────────────────────────────────────────────────

  static async submitEnrollment(userId, { tier, paymentMethod, paymentAddress, paymentNetwork, signatureData }, idDocumentPath, ip) {
    const userRes = await query('SELECT creator_status FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) throw new Error('User not found');
    if (user.creator_status === 'active') throw new Error('Creator profile already active');
    if (user.creator_status === 'pending_review') throw new Error('Enrollment already submitted and under review');

    const validTiers = { ice: 5.00, crystal: 10.00, diamond: 15.00 };
    if (!validTiers[tier]) throw new Error('Invalid tier. Choose ice, crystal, or diamond.');

    const validMethods = ['meru', 'usdc', 'usdt'];
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
         role = CASE WHEN role = 'user' THEN 'model' ELSE role END
       WHERE id = $1`,
      [enrollment.user_id, enrollment.tier, price]
    );

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
}

module.exports = CreatorService;
