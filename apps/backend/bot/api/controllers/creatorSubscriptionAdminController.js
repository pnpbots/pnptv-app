'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const creatorSubscriptionAdminController = {

  /**
   * GET /api/webapp/admin/creator-subscriptions
   * Overview of all active creators with live-computed subscription stats.
   */
  async listCreators(req, res) {
    try {
      const { rows } = await query(`
        SELECT
          u.id                            AS creator_id,
          u.username                      AS creator_username,
          u.first_name                    AS creator_first_name,
          u.avatar_url                    AS creator_avatar,
          u.creator_type,
          u.creator_price_usd,
          COALESCE(live.active_subscribers, 0)::int  AS active_subscribers,
          COALESCE(rev.total_revenue, 0)::numeric    AS total_revenue,
          COALESCE(rev.total_creator_earnings, 0)::numeric AS total_creator_earnings,
          COALESCE(pending.pending_payout, 0)::numeric     AS pending_payout
        FROM users u
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_subscribers
          FROM creator_subscriptions cs
          WHERE cs.creator_id = u.id AND cs.status = 'active'
        ) live ON true
        LEFT JOIN LATERAL (
          SELECT
            SUM(ce.amount_gross)    AS total_revenue,
            SUM(ce.amount_creator)  AS total_creator_earnings
          FROM creator_earnings ce
          WHERE ce.creator_id = u.id
        ) rev ON true
        LEFT JOIN LATERAL (
          SELECT SUM(ce.amount_creator) AS pending_payout
          FROM creator_earnings ce
          WHERE ce.creator_id = u.id AND ce.paid_at IS NULL
        ) pending ON true
        WHERE u.creator_status = 'active'
        ORDER BY live.active_subscribers DESC NULLS LAST, rev.total_revenue DESC NULLS LAST
      `);

      return res.json({ success: true, creators: rows });
    } catch (err) {
      logger.error('listCreators admin error', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to load creator list' });
    }
  },

  /**
   * GET /api/webapp/admin/creator-subscriptions/:creatorId
   * Detailed view: creator info, all subscriber records, 6-month revenue breakdown.
   */
  async getCreatorDetail(req, res) {
    try {
      const { creatorId } = req.params;

      const { rows: creatorRows } = await query(
        `SELECT
           id, username, first_name, avatar_url, creator_type, creator_price_usd,
           creator_subscriber_count, creator_wallet_address, payout_method, email
         FROM users
         WHERE id = $1 AND creator_status = 'active'`,
        [creatorId]
      );

      if (!creatorRows[0]) {
        return res.status(404).json({ success: false, error: 'Creator not found or not active' });
      }

      const { rows: subs } = await query(
        `SELECT
           cs.id,
           cs.subscriber_id,
           u.username          AS subscriber_username,
           u.first_name        AS subscriber_first_name,
           u.avatar_url        AS subscriber_avatar,
           cs.started_at,
           cs.expires_at,
           cs.status,
           cs.price_usd,
           cs.auto_renew,
           COALESCE(sub_rev.revenue, 0)::numeric AS revenue
         FROM creator_subscriptions cs
         JOIN users u ON u.id = cs.subscriber_id
         LEFT JOIN LATERAL (
           SELECT SUM(ce.amount_gross) AS revenue
           FROM creator_earnings ce
           WHERE ce.creator_id = $1 AND ce.subscription_id = cs.id
         ) sub_rev ON true
         WHERE cs.creator_id = $1
         ORDER BY
           (cs.status = 'active') DESC,
           cs.expires_at DESC`,
        [creatorId]
      );

      const { rows: monthlyRevenue } = await query(
        `SELECT
           TO_CHAR(period_month, 'YYYY-MM')  AS month,
           SUM(amount_gross)::numeric        AS gross,
           SUM(amount_creator)::numeric      AS creator_share,
           SUM(amount_platform)::numeric     AS platform_share,
           COUNT(*)::int                     AS subscription_count,
           SUM(CASE WHEN paid_at IS NULL THEN amount_creator ELSE 0 END)::numeric AS pending_amount
         FROM creator_earnings
         WHERE creator_id = $1
         GROUP BY period_month
         ORDER BY period_month DESC
         LIMIT 6`,
        [creatorId]
      );

      const { rows: payoutSummary } = await query(
        `SELECT
           SUM(CASE WHEN paid_at IS NULL THEN amount_creator ELSE 0 END)::numeric AS pending_total,
           SUM(CASE WHEN paid_at IS NOT NULL THEN amount_creator ELSE 0 END)::numeric AS paid_total,
           COUNT(CASE WHEN paid_at IS NULL THEN 1 END)::int AS pending_count
         FROM creator_earnings
         WHERE creator_id = $1`,
        [creatorId]
      );

      return res.json({
        success: true,
        creator: creatorRows[0],
        subscriptions: subs,
        monthlyRevenue,
        payoutSummary: payoutSummary[0] || { pending_total: 0, paid_total: 0, pending_count: 0 },
      });
    } catch (err) {
      logger.error('getCreatorDetail admin error', { error: err.message, creatorId: req.params.creatorId });
      return res.status(500).json({ success: false, error: 'Failed to load creator detail' });
    }
  },

  /**
   * POST /api/webapp/admin/creator-subscriptions/:creatorId/payout
   * Marks all unpaid earnings for a single creator as paid.
   */
  async processCreatorPayout(req, res) {
    try {
      const { creatorId } = req.params;

      const { rows: creatorInfo } = await query(
        `SELECT id, username, creator_wallet_address, payout_method, email
         FROM users WHERE id = $1 AND creator_status = 'active'`,
        [creatorId]
      );

      if (!creatorInfo[0]) {
        return res.status(404).json({ success: false, error: 'Creator not found or not active' });
      }

      const { rows: pendingRows } = await query(
        `SELECT SUM(amount_creator) AS pending, COUNT(*)::int AS count
         FROM creator_earnings
         WHERE creator_id = $1 AND paid_at IS NULL`,
        [creatorId]
      );

      const pending = parseFloat(pendingRows[0]?.pending || '0');

      if (pending <= 0) {
        return res.json({
          success: true,
          message: 'No pending payout for this creator',
          amount: 0,
          earningsCount: 0,
        });
      }

      const { rowCount } = await query(
        `UPDATE creator_earnings
         SET paid_at = NOW(), status = 'paid_out'
         WHERE creator_id = $1 AND paid_at IS NULL`,
        [creatorId]
      );

      logger.info('Creator payout processed', {
        creatorId,
        creatorUsername: creatorInfo[0].username,
        amount: pending,
        earningsCount: rowCount,
        method: creatorInfo[0].payout_method || 'manual',
        walletAddress: creatorInfo[0].creator_wallet_address || null,
        processedBy: req.session?.user?.id,
      });

      return res.json({
        success: true,
        amount: pending,
        earningsCount: rowCount,
        creator: creatorInfo[0].username,
        method: creatorInfo[0].payout_method || 'manual',
        walletAddress: creatorInfo[0].creator_wallet_address || null,
      });
    } catch (err) {
      logger.error('processCreatorPayout admin error', { error: err.message, creatorId: req.params.creatorId });
      return res.status(500).json({ success: false, error: 'Failed to process payout' });
    }
  },

  /**
   * POST /api/webapp/admin/creator-subscriptions/payouts/process-all
   * Batch-marks all unpaid earnings across all creators as paid.
   * IMPORTANT: registered BEFORE the :creatorId param route to avoid route shadowing.
   */
  async processAllPayouts(req, res) {
    try {
      const { rows: creators } = await query(
        `SELECT ce.creator_id, u.username, SUM(ce.amount_creator) AS pending
         FROM creator_earnings ce
         JOIN users u ON u.id = ce.creator_id
         WHERE ce.paid_at IS NULL
         GROUP BY ce.creator_id, u.username
         HAVING SUM(ce.amount_creator) > 0`
      );

      if (creators.length === 0) {
        return res.json({ success: true, message: 'No pending payouts found', payouts: [] });
      }

      const results = [];
      for (const c of creators) {
        await query(
          `UPDATE creator_earnings
           SET paid_at = NOW(), status = 'paid_out'
           WHERE creator_id = $1 AND paid_at IS NULL`,
          [c.creator_id]
        );
        results.push({
          creatorId: c.creator_id,
          creatorUsername: c.username,
          amount: parseFloat(c.pending),
        });
      }

      const totalAmount = results.reduce((sum, r) => sum + r.amount, 0);

      logger.info('Batch creator payout processed', {
        creatorsCount: results.length,
        totalAmount,
        processedBy: req.session?.user?.id,
      });

      return res.json({
        success: true,
        creatorsCount: results.length,
        totalAmount,
        payouts: results,
      });
    } catch (err) {
      logger.error('processAllPayouts admin error', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to process batch payouts' });
    }
  },

  /**
   * POST /api/webapp/admin/creator-subscriptions/:creatorId/subscriptions/:subscriptionId/cancel
   * Admin-cancel a specific subscription.
   */
  async cancelSubscription(req, res) {
    try {
      const { creatorId, subscriptionId } = req.params;

      const { rowCount } = await query(
        `UPDATE creator_subscriptions
         SET status = 'cancelled', cancelled_at = NOW()
         WHERE id = $1 AND creator_id = $2 AND status = 'active'`,
        [subscriptionId, creatorId]
      );

      if (rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Subscription not found or not active' });
      }

      logger.info('Admin cancelled creator subscription', {
        subscriptionId,
        creatorId,
        cancelledBy: req.session?.user?.id,
      });

      return res.json({ success: true, message: 'Subscription cancelled' });
    } catch (err) {
      logger.error('cancelSubscription admin error', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to cancel subscription' });
    }
  },

  /**
   * POST /api/webapp/admin/creator-subscriptions/:creatorId/subscriptions/:subscriptionId/extend
   * Extend a subscription's expiry by N days (body: { days: number }).
   */
  async extendSubscription(req, res) {
    try {
      const { creatorId, subscriptionId } = req.params;
      const days = parseInt(req.body?.days, 10);

      if (!days || days < 1 || days > 365) {
        return res.status(400).json({ success: false, error: 'days must be between 1 and 365' });
      }

      const { rows, rowCount } = await query(
        `UPDATE creator_subscriptions
         SET expires_at = GREATEST(expires_at, NOW()) + ($1 || ' days')::interval
         WHERE id = $2 AND creator_id = $3
         RETURNING expires_at`,
        [days, subscriptionId, creatorId]
      );

      if (rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      logger.info('Admin extended creator subscription', {
        subscriptionId,
        creatorId,
        days,
        newExpiry: rows[0].expires_at,
        extendedBy: req.session?.user?.id,
      });

      return res.json({ success: true, newExpiresAt: rows[0].expires_at });
    } catch (err) {
      logger.error('extendSubscription admin error', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to extend subscription' });
    }
  },

  /**
   * GET /api/webapp/admin/creator-subscriptions/summary
   * Platform-wide payout summary card: total pending, paid this month.
   * IMPORTANT: registered BEFORE the :creatorId param route.
   */
  async getPlatformSummary(req, res) {
    try {
      const { rows } = await query(`
        SELECT
          SUM(CASE WHEN paid_at IS NULL THEN amount_creator ELSE 0 END)::numeric          AS total_pending,
          SUM(CASE WHEN DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', NOW())
                   THEN amount_creator ELSE 0 END)::numeric                               AS paid_this_month,
          COUNT(DISTINCT CASE WHEN paid_at IS NULL THEN creator_id END)::int              AS creators_with_pending,
          SUM(amount_gross)::numeric                                                       AS total_gross_all_time,
          SUM(amount_platform)::numeric                                                    AS total_platform_revenue
        FROM creator_earnings
      `);

      const { rows: monthlyRows } = await query(`
        SELECT
          TO_CHAR(period_month, 'YYYY-MM') AS month,
          SUM(amount_gross)::numeric       AS gross,
          SUM(amount_creator)::numeric     AS creator_share,
          SUM(amount_platform)::numeric    AS platform_share,
          COUNT(DISTINCT creator_id)::int  AS active_creators
        FROM creator_earnings
        WHERE period_month >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
        GROUP BY period_month
        ORDER BY period_month ASC
      `);

      return res.json({
        success: true,
        summary: rows[0] || {
          total_pending: 0,
          paid_this_month: 0,
          creators_with_pending: 0,
          total_gross_all_time: 0,
          total_platform_revenue: 0,
        },
        monthlyRevenue: monthlyRows,
      });
    } catch (err) {
      logger.error('getPlatformSummary admin error', { error: err.message });
      return res.status(500).json({ success: false, error: 'Failed to load platform summary' });
    }
  },
};

module.exports = creatorSubscriptionAdminController;
