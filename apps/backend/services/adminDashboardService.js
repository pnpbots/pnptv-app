const logger = require('../utils/logger');
const { query, getPool } = require('../config/postgres');
const { cache } = require('../config/redis');
const { Pool } = require('pg');

// Analytics queries scan millions of rows — run inside a transaction so SET LOCAL
// actually takes effect (SET LOCAL is a no-op outside a transaction block).
// work_mem=256MB avoids 200MB+ disk spill; 90s timeout for admin-only cold loads.
async function analyticsQuery(text, params = []) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL statement_timeout = 90000");
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const MembershipCleanupService = require('./membershipCleanupService');

const DASHBOARD_CACHE_KEY = 'pnpapp:admin:stats';
const DASHBOARD_CACHE_TTL = 300; // 5 minutes

// Normalize all amounts to USD — COP payments are stored in COP and need conversion.
// Guard against NaN amounts (3 expired Dash rows stored NaN from an old Dash SDK bug).
const AMOUNT_USD = `CASE WHEN amount::text = 'NaN' THEN 0 WHEN currency = 'COP' THEN amount / 4250.0 ELSE amount END`;

// Resolve the real payment provider from payment_method + metadata fallback chain.
// payment_method is NULL for NowPayments, BTCPay, ePayco, Stripe, and Daimo rows
// that were recorded before the field was standardized.
const PROVIDER_COALESCE = `COALESCE(
  CASE WHEN payment_method = 'usdc' THEN 'nowpayments' END,
  NULLIF(payment_method, ''),
  NULLIF(metadata->>'provider', ''),
  CASE WHEN metadata->>'epayco_ref'       IS NOT NULL THEN 'epayco'      END,
  CASE WHEN metadata->>'btcpay_invoice_id' IS NOT NULL THEN 'btcpay'     END,
  CASE WHEN metadata->>'stripe_session_id' IS NOT NULL THEN 'stripe'     END,
  CASE WHEN metadata->>'daimo_event_id'    IS NOT NULL THEN 'daimo'      END,
  'unknown'
)`;
let authentikPool = null;

function getAuthentikPool() {
  if (authentikPool) return authentikPool;

  const host = process.env.PG_AUTH_HOST;
  const database = process.env.PG_AUTH_DB;
  const user = process.env.PG_AUTH_USER;
  const password = process.env.PG_AUTH_PASSWORD;
  const port = parseInt(process.env.PG_AUTH_PORT || '5432', 10);

  if (!host || !database || !user) {
    throw new Error('Authentik Postgres credentials are not configured');
  }

  authentikPool = new Pool({
    host,
    port,
    database,
    user,
    password,
    max: 2,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });

  authentikPool.on('error', (error) => {
    logger.error('Authentik PostgreSQL pool error:', error);
  });

  return authentikPool;
}

/**
 * AdminDashboardService
 * Provides comprehensive dashboard statistics for admin monitoring
 * Includes payments, revenue, churn, and subscription metrics
 * All monetary values are normalized to USD
 */
class AdminDashboardService {
  /**
   * Get complete dashboard overview
   * @returns {Promise<Object>} Dashboard data
   */
  static async getDashboardOverview() {
    try {
      const cached = await cache.get(DASHBOARD_CACHE_KEY);
      if (cached) return cached;

      const [
        paymentStats,
        revenueStats,
        membershipStats,
        churnAnalysis,
        topPaymentMethods,
        recentPayments,
        identityStats,
        conversionMetrics,
      ] = await Promise.all([
        this.getPaymentOverview(),
        this.getRevenueOverview(),
        this.getMembershipOverview(),
        MembershipCleanupService.getChurnAnalysis(),
        this.getTopPaymentMethods(),
        this.getRecentTransactions(),
        this.getIdentityOverview(),
        this.getConversionMetrics(),
      ]);

      const result = {
        timestamp: new Date(),
        payments: paymentStats,
        revenue: revenueStats,
        membership: membershipStats,
        churn: churnAnalysis,
        topMethods: topPaymentMethods,
        recentTransactions: recentPayments.slice(0, 10),
        identity: identityStats,
        conversion: conversionMetrics,
      };

      await cache.set(DASHBOARD_CACHE_KEY, result, DASHBOARD_CACHE_TTL);
      return result;
    } catch (error) {
      logger.error('Error getting dashboard overview:', error);
      return null;
    }
  }

  /**
   * Get payment overview statistics
   * @returns {Promise<Object>} Payment stats
   */
  static async getPaymentOverview() {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total_payments,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN user_id END) as unique_payers,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          SUM(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE 0 END) as total_revenue,
          AVG(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE NULL END) as avg_transaction,
          MIN(CASE WHEN status = 'completed' THEN created_at END) as first_payment,
          MAX(CASE WHEN status = 'completed' THEN created_at END) as last_payment
        FROM payments
      `);

      return result.rows[0];
    } catch (error) {
      logger.error('Error getting payment overview:', error);
      return null;
    }
  }

  /**
   * Get revenue overview for current month/period
   * @returns {Promise<Object>} Revenue stats
   */
  static async getRevenueOverview() {
    try {
      const result = await query(`
        SELECT
          DATE_TRUNC('day', created_at)::DATE as payment_day,
          COUNT(*) as transactions,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(${AMOUNT_USD}) as daily_revenue,
          AVG(${AMOUNT_USD}) as avg_transaction
        FROM payments
        WHERE status = 'completed'
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY payment_day ASC
      `);

      const totalResult = await query(`
        SELECT
          SUM(${AMOUNT_USD}) as monthly_revenue,
          COUNT(*) as monthly_transactions,
          COUNT(DISTINCT user_id) as monthly_unique_payers
        FROM payments
        WHERE status = 'completed'
          AND created_at >= NOW() - INTERVAL '30 days'
      `);

      return {
        daily: result.rows,
        monthly: totalResult.rows[0],
        period: 'Rolling 30 days',
      };
    } catch (error) {
      logger.error('Error getting revenue overview:', error);
      return null;
    }
  }

  /**
   * Get membership overview statistics
   * @returns {Promise<Object>} Membership stats
   */
  static async getMembershipOverview() {
    try {
      // Membership breakdown — reclassify stale-active users (plan_expiry passed but status
      // not yet updated) as 'active_stale' so the breakdown is consistent with the stat card.
      const result = await query(`
        SELECT
          CASE
            WHEN subscription_status = 'active' AND plan_expiry IS NOT NULL AND plan_expiry < NOW()
              THEN 'active_stale'
            ELSE subscription_status
          END as subscription_status,
          COUNT(*) as count,
          COUNT(CASE WHEN plan_expiry > NOW() THEN 1 END) as with_valid_expiry,
          COUNT(CASE WHEN plan_id LIKE '%lifetime%' THEN 1 END) as lifetime_users
        FROM users
        WHERE is_active = true
        GROUP BY 1
        ORDER BY count DESC
      `);

      const totalResult = await query(`
        SELECT
          COUNT(*) as total_active_users,
          -- active = status is 'active' AND (no expiry = lifetime, OR expiry is future)
          COUNT(CASE WHEN subscription_status = 'active'
                      AND (plan_expiry IS NULL OR plan_expiry > NOW()) THEN 1 END) as active_subscribers,
          COUNT(CASE WHEN subscription_status IN ('churned', 'expired')
                      OR (subscription_status = 'active' AND plan_expiry < NOW()) THEN 1 END) as churned_users,
          COUNT(CASE WHEN subscription_status = 'free' THEN 1 END) as free_users,
          COUNT(CASE WHEN plan_id LIKE '%lifetime%' THEN 1 END) as lifetime_members
        FROM users
        WHERE is_active = true
      `);

      return {
        byStatus: result.rows,
        totals: totalResult.rows[0],
      };
    } catch (error) {
      logger.error('Error getting membership overview:', error);
      return null;
    }
  }

  /**
   * Get top payment methods by volume and revenue.
   * Groups by resolved provider (PROVIDER_COALESCE).
   * Success rate = completed / (completed + failed) — abandoned invoices excluded.
   * @returns {Promise<Array>} Top methods stats
   */
  static async getTopPaymentMethods() {
    try {
      const result = await query(`
        SELECT
          ${PROVIDER_COALESCE} as payment_method,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN user_id END) as unique_users,
          SUM(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE 0 END) as total_revenue,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
          COUNT(CASE WHEN status IN ('completed', 'failed', 'refunded') THEN 1 END) as transaction_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          CASE
            WHEN COUNT(CASE WHEN status IN ('completed','failed') THEN 1 END) = 0 THEN 0
            ELSE ROUND(
              100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END)
                    / COUNT(CASE WHEN status IN ('completed','failed') THEN 1 END),
              2
            )
          END as success_rate,
          AVG(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE NULL END) as avg_successful_transaction
        FROM payments
        GROUP BY 1
        HAVING COUNT(CASE WHEN status = 'completed' THEN 1 END) > 0
        ORDER BY total_revenue DESC NULLS LAST
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error getting top payment methods:', error);
      return [];
    }
  }

  /**
   * Get recent transactions across ALL payment methods with user info
   * @returns {Promise<Array>} Recent transactions
   */
  static async getRecentTransactions() {
    try {
      const result = await query(`
        SELECT ph.user_id,
               CASE WHEN ph.currency = 'COP' THEN ph.amount / 4250.0 ELSE ph.amount END as amount,
               ph.status,
               COALESCE(
                 NULLIF(ph.payment_method, ''),
                 NULLIF(ph.metadata->>'provider', ''),
                 CASE WHEN ph.metadata->>'epayco_ref'        IS NOT NULL THEN 'epayco' END,
                 CASE WHEN ph.metadata->>'btcpay_invoice_id' IS NOT NULL THEN 'btcpay' END,
                 CASE WHEN ph.metadata->>'stripe_session_id' IS NOT NULL THEN 'stripe' END,
                 CASE WHEN ph.metadata->>'daimo_event_id'    IS NOT NULL THEN 'daimo'  END,
                 'unknown'
               ) as payment_method,
               ph.created_at as payment_date, ph.currency,
               u.username, u.first_name
        FROM payments ph
        LEFT JOIN users u ON ph.user_id = u.id
        WHERE ph.status = 'completed'
        ORDER BY ph.created_at DESC
        LIMIT 10
      `);
      return result.rows;
    } catch (error) {
      logger.error('Error getting recent transactions:', error);
      return [];
    }
  }

  /**
   * Get identity overview comparing app users vs Authentik identities.
   * Authentik count is fetched from the Admin API count endpoint.
   * @returns {Promise<Object>}
   */
  static async getIdentityOverview() {
    try {
      const [appUsersRes, activeUsersRes, linkedIdsRes, authentikIdsRes] = await Promise.all([
        query('SELECT COUNT(*) AS count FROM users'),
        query('SELECT COUNT(*) AS count FROM users WHERE is_active = true'),
        query(`
          SELECT LOWER(pnptv_id) AS pnptv_id
          FROM users
          WHERE pnptv_id IS NOT NULL
        `),
        this.getAuthentikUserIds(),
      ]);

      const appUsers = parseInt(appUsersRes.rows[0]?.count || '0', 10);
      const activeAppUsers = parseInt(activeUsersRes.rows[0]?.count || '0', 10);
      const appIdentityIds = new Set(linkedIdsRes.rows.map((row) => row.pnptv_id).filter(Boolean));
      const authentikIdentityIds = new Set(authentikIdsRes);
      const linkedAppUsers = appIdentityIds.size;
      const authentikUsers = authentikIdentityIds.size;

      let missingAuthentik = 0;
      for (const pnptvId of appIdentityIds) {
        if (!authentikIdentityIds.has(pnptvId)) missingAuthentik += 1;
      }

      let orphanAuthentik = 0;
      for (const uuid of authentikIdentityIds) {
        if (!appIdentityIds.has(uuid)) orphanAuthentik += 1;
      }

      return {
        app_users: appUsers,
        active_app_users: activeAppUsers,
        linked_app_users: linkedAppUsers,
        authentik_users: authentikUsers,
        orphan_authentik_identities: orphanAuthentik,
        app_users_missing_authentik_identity: missingAuthentik,
      };
    } catch (error) {
      logger.error('Error getting identity overview:', error);
      return {
        app_users: 0,
        active_app_users: 0,
        linked_app_users: 0,
        authentik_users: 0,
        orphan_authentik_identities: 0,
        app_users_missing_authentik_identity: 0,
      };
    }
  }

  static async getAuthentikUserIds() {
    const pool = getAuthentikPool();
    const result = await pool.query('SELECT LOWER(uuid::text) AS uuid FROM authentik_core_user');
    return result.rows.map((row) => row.uuid).filter(Boolean);
  }

  /**
   * Get conversion metrics.
   * conversion_rate / payers   = 90-day new-user cohort who ever paid (free → paid funnel)
   * payers_90d                 = platform-wide unique payers who paid IN the last 90 days
   * active_rate                = of 90-day cohort, % currently holding an active subscription
   * @returns {Promise<Object>} Conversion data
   */
  static async getConversionMetrics() {
    try {
      const [cohortRes, payers90dRes] = await Promise.all([
        query(`
          SELECT
            COUNT(DISTINCT u.id) as total_users,
            COUNT(DISTINCT p.user_id) as payers,
            ROUND(
              100.0 * COUNT(DISTINCT p.user_id) / NULLIF(COUNT(DISTINCT u.id), 0),
              2
            ) as conversion_rate,
            COUNT(DISTINCT CASE WHEN u.subscription_status = 'active'
                                 AND (u.plan_expiry IS NULL OR u.plan_expiry > NOW())
                                 THEN u.id END) as active_subscribers,
            ROUND(
              100.0 * COUNT(DISTINCT CASE WHEN u.subscription_status = 'active'
                                           AND (u.plan_expiry IS NULL OR u.plan_expiry > NOW())
                                           THEN u.id END) / NULLIF(COUNT(DISTINCT u.id), 0),
              2
            ) as active_rate
          FROM users u
          LEFT JOIN payments p
            ON p.user_id = u.id AND p.status = 'completed'
          WHERE u.is_active = true
            AND u.created_at > NOW() - INTERVAL '90 days'
        `),
        // Separate count: unique users who made a completed payment in the last 90 days
        // (regardless of when they signed up — this is what "Total Payers (90d)" should show)
        query(`
          SELECT COUNT(DISTINCT user_id) as payers_90d
          FROM payments
          WHERE status = 'completed'
            AND created_at > NOW() - INTERVAL '90 days'
        `),
      ]);

      return {
        ...cohortRes.rows[0],
        payers_90d: parseInt(payers90dRes.rows[0]?.payers_90d || '0', 10),
      };
    } catch (error) {
      logger.error('Error getting conversion metrics:', error);
      return null;
    }
  }

  /**
   * Get payment method adoption over time
   * @returns {Promise<Array>} Method adoption data
   */
  static async getMethodAdoption() {
    try {
      const result = await query(`
        SELECT
          DATE_TRUNC('day', created_at)::DATE as payment_day,
          payment_method,
          COUNT(*) as transaction_count,
          SUM(${AMOUNT_USD}) as daily_revenue
        FROM payments
        WHERE status = 'completed'
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', created_at), payment_method
        ORDER BY payment_day DESC, daily_revenue DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error getting method adoption:', error);
      return [];
    }
  }

  /**
   * Get average customer lifetime value
   * @returns {Promise<Object>} CLV statistics
   */
  static async getCustomerLifetimeValue() {
    try {
      const result = await query(`
        SELECT
          payment_method,
          COUNT(DISTINCT user_id) as users,
          SUM(${AMOUNT_USD}) as total_revenue,
          AVG(${AMOUNT_USD}) as avg_payment,
          SUM(${AMOUNT_USD}) / COUNT(DISTINCT user_id) as clv,
          MAX(created_at) - MIN(created_at) as customer_lifespan_days
        FROM payments
        WHERE status = 'completed'
        GROUP BY payment_method
        ORDER BY clv DESC NULLS LAST
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error calculating CLV:', error);
      return [];
    }
  }

  /**
   * Weekly signups vs plan expirations over the last N complete ISO weeks.
   * - Signups: only active users (excludes soft-deleted accounts)
   * - Expirations: only users whose subscription actually lapsed (status != 'active')
   *   so re-granted/auto-renewed users don't inflate churn
   * - Window aligned to ISO week boundaries to avoid the 13-bar off-by-one
   * @param {number} weeks
   * @returns {Promise<{ signups: Array, churn: Array }>}
   */
  static async getChurnTrend(weeks = 12) {
    try {
      const [signupsRes, churnRes] = await Promise.all([
        query(`
          SELECT date_trunc('week', created_at)::date AS week_start,
                 COUNT(*) AS signup_count
          FROM users
          WHERE is_active = true
            AND created_at >= date_trunc('week', NOW()) - ($1 * INTERVAL '1 week')
          GROUP BY 1
          ORDER BY 1
        `, [weeks]),
        query(`
          SELECT date_trunc('week', plan_expiry)::date AS week_start,
                 COUNT(*) AS churn_count
          FROM users
          WHERE plan_expiry IS NOT NULL
            AND plan_expiry < NOW()
            AND plan_expiry >= date_trunc('week', NOW()) - ($1 * INTERVAL '1 week')
            AND subscription_status IN ('churned', 'expired', 'free')
          GROUP BY 1
          ORDER BY 1
        `, [weeks]),
      ]);
      return { signups: signupsRes.rows, churn: churnRes.rows };
    } catch (error) {
      logger.error('Error getting churn trend:', error);
      return { signups: [], churn: [] };
    }
  }

  /**
   * Top creators ranked by earnings + stream activity
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  static async getCreatorLeaderboard(limit = 10, since = '2026-07-10') {
    try {
      const result = await query(`
        WITH ce_agg AS (
          SELECT creator_id,
                 SUM(amount_creator) FILTER (WHERE amount_creator::text != 'NaN') AS total_earnings_usd
          FROM creator_earnings
          WHERE created_at >= $2::date
          GROUP BY creator_id
        ),
        ss_agg AS (
          SELECT creator_id,
                 COUNT(*)                                                                    AS total_streams,
                 COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600.0)
                   FILTER (WHERE ended_at IS NOT NULL), 0)                                  AS total_hours_live,
                 COALESCE(AVG(peak_viewers) FILTER (WHERE ended_at IS NOT NULL), 0)         AS avg_peak_viewers,
                 COALESCE(SUM(total_tips_usd), 0)                                           AS total_tips_usd,
                 MAX(started_at)                                                             AS last_streamed_at
          FROM stream_sessions
          WHERE started_at >= $2::date
          GROUP BY creator_id
        )
        SELECT
          u.id,
          u.first_name,
          u.username,
          CASE
            WHEN u.photo_file_id IS NULL THEN NULL
            WHEN u.photo_file_id LIKE 'http%' THEN u.photo_file_id
            ELSE '/uploads/avatars/' || u.photo_file_id
          END AS photo,
          COALESCE(ce.total_earnings_usd, 0)::numeric   AS total_earnings_usd,
          COALESCE(ss.total_streams, 0)::bigint          AS total_streams,
          COALESCE(ss.total_hours_live, 0)::numeric      AS total_hours_live,
          COALESCE(ss.avg_peak_viewers, 0)::numeric      AS avg_peak_viewers,
          COALESCE(ss.total_tips_usd, 0)::numeric        AS total_tips_usd,
          ss.last_streamed_at
        FROM users u
        LEFT JOIN ce_agg ce ON ce.creator_id = u.id
        LEFT JOIN ss_agg ss ON ss.creator_id = u.id
        WHERE u.role IN ('creator', 'admin', 'superadmin')
           OR ce.creator_id IS NOT NULL
           OR ss.creator_id IS NOT NULL
        ORDER BY COALESCE(ce.total_earnings_usd, 0) DESC NULLS LAST, COALESCE(ss.total_streams, 0) DESC
        LIMIT $1
      `, [limit, since]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting creator leaderboard:', error);
      return [];
    }
  }

  /**
   * Generate admin report (text format for Telegram)
   * @returns {Promise<string>} Formatted report
   */
  static async generateAdminReport() {
    try {
      const overview = await this.getDashboardOverview();
      if (!overview) return 'Error generating report';

      const p = overview.payments;
      const r = overview.revenue.monthly;
      const m = overview.membership.totals;
      const c = overview.churn.byMethod || [];

      let report = `
📊 *PNPtv Dashboard Report*
_Generated: ${new Date().toLocaleString()}_

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *PAYMENTS*
• Total: ${p?.total_payments || 0}
• Completed: ${p?.completed || 0}
• Revenue: $${(p?.total_revenue || 0).toFixed(2)}
• Avg Transaction: $${(p?.avg_transaction || 0).toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 *REVENUE (30 Days)*
• Monthly: $${(r?.monthly_revenue || 0).toFixed(2)}
• Transactions: ${r?.monthly_transactions || 0}
• Unique Payers: ${r?.monthly_unique_payers || 0}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *MEMBERSHIP*
• Active Users: ${m?.total_active_users || 0}
• Subscribers: ${m?.active_subscribers || 0}
• Churned: ${m?.churned_users || 0}
• Lifetime: ${m?.lifetime_members || 0}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *TOP METHODS*
${overview.topMethods.slice(0, 3).map(m => `• ${m.payment_method}: $${m.total_revenue} (${m.transaction_count} txn)`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

      return report;
    } catch (error) {
      logger.error('Error generating admin report:', error);
      return 'Error generating report';
    }
  }
}

// ── Usage Analytics ──────────────────────────────────────────────────────────

// 3-level /api/webapp/* entries must come before 2-level fallbacks
const FEATURE_MAP = [
  { prefix: '/api/webapp/dm',            label: 'Messages / DMs' },
  { prefix: '/api/webapp/hangouts',      label: 'Hangouts' },
  { prefix: '/api/webapp/nearby',        label: 'Nearby' },
  { prefix: '/api/webapp/social',        label: 'Social Feed' },
  { prefix: '/api/webapp/notifications', label: 'Notifications' },
  { prefix: '/api/webapp/creator',       label: 'Creator Tools' },
  { prefix: '/api/webapp/creators',      label: 'Creator Profiles' },
  { prefix: '/api/webapp/channels',      label: 'Channels' },
  { prefix: '/api/webapp/users',         label: 'User Profiles' },
  { prefix: '/api/webapp/payments',      label: 'Payments' },
  { prefix: '/api/webapp/streams',       label: 'Live Streams' },
  { prefix: '/api/webapp/live',          label: 'PNP Live' },
  { prefix: '/api/webapp/support',       label: 'Support' },
  { prefix: '/api/webapp/messages',      label: 'Messages / DMs' },
  { prefix: '/api/webapp/events',        label: 'Events' },
  { prefix: '/api/webapp/bookings',      label: 'Bookings' },
  { prefix: '/api/webapp/discover',      label: 'Discovery' },
  { prefix: '/api/webapp/profile',       label: 'User Profiles' },
  { prefix: '/api/webapp/me',            label: 'My Profile' },
  { prefix: '/api/main-stage',           label: 'Main Stage' },
  { prefix: '/api/social',               label: 'Social Feed' },
  { prefix: '/api/radio',                label: 'Radio' },
  { prefix: '/api/media',                label: 'Videorama' },
  { prefix: '/api/videorama',            label: 'Videorama' },
  { prefix: '/api/subscription',         label: 'Subscriptions' },
  { prefix: '/api/wallet',               label: 'Wallet' },
  { prefix: '/api/invite',               label: 'Invites' },
  { prefix: '/api/casting',              label: 'Casting' },
  { prefix: '/api/performers',           label: 'Performers' },
  { prefix: '/api/livekit',              label: 'Video Calls' },
  { prefix: '/api/calls',                label: 'Video Calls' },
  { prefix: '/api/tips',                 label: 'Tips' },
  { prefix: '/api/tokens',               label: 'Tokens' },
  { prefix: '/api/playlists',            label: 'Playlists' },
  { prefix: '/api/channel',              label: 'Channels' },
  { prefix: '/api/events',               label: 'Events' },
  { prefix: '/api/support',              label: 'Support' },
  { prefix: '/api/booking',              label: 'Bookings' },
  { prefix: '/api/hangouts',             label: 'Hangouts' },
  { prefix: '/api/groups',               label: 'Groups' },
  { prefix: '/api/messages',             label: 'Messages / DMs' },
  { prefix: '/api/nearby',               label: 'Nearby' },
  { prefix: '/api/gamification',         label: 'Gamification' },
  { prefix: '/api/donate',               label: 'Donations' },
  { prefix: '/api/profile',              label: 'User Profiles' },
  { prefix: '/api/model',                label: 'Creator Profiles' },
  { prefix: '/api/stats',                label: 'Stats' },
  { prefix: '/api/cashout',              label: 'Payouts' },
];

function resolveFeatureLabel(pathPrefix) {
  for (const { prefix, label } of FEATURE_MAP) {
    if (pathPrefix && pathPrefix.startsWith(prefix)) return label;
  }
  return 'Other';
}

// Extend the class with usage analytics static methods
Object.assign(AdminDashboardService, {
  async getNewMembersSummary(role = null) {
    const params = [];
    const roleFilter = role ? `AND role = $1` : '';
    if (role) params.push(role);
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS h24,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS d7,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS d30
      FROM users
      WHERE deactivated_at IS NULL ${roleFilter}
    `, params);
    const r = result.rows[0] || {};
    return { h24: parseInt(r.h24) || 0, d7: parseInt(r.d7) || 0, d30: parseInt(r.d30) || 0 };
  },

  async getNewMembersTrend(days = 30, role = null) {
    const params = [days];
    const roleFilter = role ? `AND role = $2` : '';
    if (role) params.push(role);
    const result = await query(`
      SELECT
        DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
        COUNT(*) AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND deactivated_at IS NULL
        ${roleFilter}
      GROUP BY 1
      ORDER BY 1
    `, params);
    return result.rows.map(r => ({ day: r.day, count: parseInt(r.count) }));
  },

  async getActiveUsersTrend(days = 30, role = null) {
    const params = [days];
    const roleJoin   = role ? `JOIN users u ON u.id = l.user_id` : '';
    const roleFilter = role ? `AND u.role = $2` : '';
    if (role) params.push(role);
    const result = await analyticsQuery(`
      SELECT
        DATE_TRUNC('day', l.created_at AT TIME ZONE 'UTC') AS day,
        COUNT(DISTINCT l.user_id) AS dau
      FROM user_access_logs l
      ${roleJoin}
      WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
      ${roleFilter}
      GROUP BY 1
      ORDER BY 1
    `, params);
    return result.rows.map(r => ({ day: r.day, dau: parseInt(r.dau) }));
  },

  async getPopularFeatures(days = 7, role = null) {
    const params = [days];
    const roleJoin   = role ? `JOIN users u ON u.id = l.user_id` : '';
    const roleFilter = role ? `AND u.role = $2` : '';
    if (role) params.push(role);
    // Exclude /uploads/* (static file serving — not feature interactions).
    // For /api/webapp/* use 3 path segments so each sub-feature is distinct.
    // Skip internal/noise paths (use-tracker, og-preview, push, admin, auth, onboarding).
    const NOISE = `'/api/webapp/use-tracker', '/api/webapp/og-preview', '/api/webapp/push',
                   '/api/webapp/admin', '/api/webapp/auth', '/api/webapp/onboarding',
                   '/api/auth-status', '/api/telegram-auth', '/api/logout', '/api/proxy'`;
    const result = await analyticsQuery(`
      SELECT
        CASE
          WHEN path LIKE '/api/webapp/%'
            THEN '/' || SPLIT_PART(LTRIM(path, '/'), '/', 1)
                     || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 2)
                     || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 3)
          ELSE '/' || SPLIT_PART(LTRIM(path, '/'), '/', 1)
                   || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 2)
        END AS path_prefix,
        COUNT(*) AS hits
      FROM user_access_logs l
      ${roleJoin}
      WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
        AND path IS NOT NULL
        AND path != '/'
        AND path NOT LIKE '/uploads/%'
        AND ('/' || SPLIT_PART(LTRIM(path, '/'), '/', 1) || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 2) || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 3))
            NOT IN (${NOISE})
      ${roleFilter}
      GROUP BY 1
      ORDER BY hits DESC
      LIMIT 100
    `, params);

    const featureMap = new Map();
    for (const row of result.rows) {
      const label = resolveFeatureLabel(row.path_prefix);
      if (label === 'Other') continue; // skip anything not in the feature map
      if (featureMap.has(label)) {
        featureMap.get(label).hits += parseInt(row.hits);
      } else {
        featureMap.set(label, { label, hits: parseInt(row.hits) });
      }
    }
    return Array.from(featureMap.values())
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);
  },

  async getAvgSessionDuration(days = 7, role = null) {
    const params = [days];
    const roleJoin   = role ? `JOIN users u ON u.id = l.user_id` : '';
    const roleFilter = role ? `AND u.role = $2` : '';
    if (role) params.push(role);
    const result = await analyticsQuery(`
      SELECT
        ROUND(AVG(duration_seconds))::int AS avg_seconds,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds))::int AS median_seconds,
        COUNT(*) AS session_count,
        COUNT(CASE WHEN duration_seconds >= 300 THEN 1 END) AS long_sessions
      FROM (
        SELECT
          l.session_id,
          EXTRACT(EPOCH FROM (MAX(l.created_at) - MIN(l.created_at))) AS duration_seconds
        FROM user_access_logs l
        ${roleJoin}
        WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
          AND l.session_id IS NOT NULL
        ${roleFilter}
        GROUP BY l.session_id
        HAVING COUNT(*) > 1
      ) sessions
    `, params);
    const r = result.rows[0] || {};
    return {
      avg_seconds:    parseInt(r.avg_seconds)    || 0,
      median_seconds: parseInt(r.median_seconds) || 0,
      session_count:  parseInt(r.session_count)  || 0,
      long_sessions:  parseInt(r.long_sessions)  || 0,
    };
  },

  async getFeatureTierSplit(days = 30) {
    const cacheKey = `pnpapp:admin:tier-features:${days}`;
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
    } catch (_) {}

    const NOISE = `'/api/webapp/use-tracker', '/api/webapp/og-preview', '/api/webapp/push',
                   '/api/webapp/admin', '/api/webapp/auth', '/api/webapp/onboarding',
                   '/api/auth-status', '/api/telegram-auth', '/api/logout', '/api/proxy'`;

    // Step A: active users per tier
    const tierUsersResult = await analyticsQuery(`
      SELECT u.tier, COUNT(DISTINCT l.user_id) AS active_users
      FROM user_access_logs l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
        AND u.tier IN ('free', 'member', 'PRIME')
      GROUP BY u.tier
    `, [days]);

    const activeUsers = { PRIME: 0, member: 0, free: 0 };
    for (const row of tierUsersResult.rows) {
      activeUsers[row.tier] = parseInt(row.active_users) || 0;
    }

    // Step B: feature hits per tier
    const hitsResult = await analyticsQuery(`
      SELECT
        CASE
          WHEN path LIKE '/api/webapp/%'
            THEN '/' || SPLIT_PART(LTRIM(path, '/'), '/', 1)
                     || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 2)
                     || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 3)
          ELSE '/' || SPLIT_PART(LTRIM(path, '/'), '/', 1)
                   || '/' || SPLIT_PART(LTRIM(path, '/'), '/', 2)
        END AS path_prefix,
        u.tier,
        COUNT(*) AS hits
      FROM user_access_logs l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= NOW() - INTERVAL '1 day' * $1
        AND l.path IS NOT NULL AND l.path != '/'
        AND l.path NOT LIKE '/uploads/%'
        AND u.tier IN ('free', 'member', 'PRIME')
        AND ('/' || SPLIT_PART(LTRIM(l.path, '/'), '/', 1) || '/' || SPLIT_PART(LTRIM(l.path, '/'), '/', 2) || '/' || SPLIT_PART(LTRIM(l.path, '/'), '/', 3))
            NOT IN (${NOISE})
      GROUP BY 1, 2
      ORDER BY hits DESC
      LIMIT 300
    `, [days]);

    // Step C: aggregate by label
    const featureMap = new Map();
    for (const row of hitsResult.rows) {
      const label = resolveFeatureLabel(row.path_prefix);
      if (label === 'Other') continue;
      const hits = parseInt(row.hits) || 0;
      if (!featureMap.has(label)) {
        featureMap.set(label, { label, prime: 0, member: 0, free: 0 });
      }
      const entry = featureMap.get(label);
      if (row.tier === 'PRIME')  entry.prime  += hits;
      if (row.tier === 'member') entry.member += hits;
      if (row.tier === 'free')   entry.free   += hits;
    }

    // Step D: normalize + sort
    const features = Array.from(featureMap.values())
      .map(f => ({
        ...f,
        primePerUser:  parseFloat((f.prime  / (activeUsers.PRIME  || 1)).toFixed(2)),
        memberPerUser: parseFloat((f.member / (activeUsers.member || 1)).toFixed(2)),
        freePerUser:   parseFloat((f.free   / (activeUsers.free   || 1)).toFixed(2)),
      }))
      .sort((a, b) => (b.prime + b.member + b.free) - (a.prime + a.member + a.free))
      .slice(0, 12);

    const result = { features, activeUsers, days };
    try { await cache.set(cacheKey, result, 3600); } catch (_) {}
    return result;
  },

  async getUsageAnalytics(days = 30, role = null) {
    const cacheKey = `pnpapp:admin:usage-analytics:${days}:${role || 'all'}`;
    try {
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
    } catch (_) {}

    // Run sequentially — user_access_logs has 5M+ rows and parallel scans compete
    // for the same DB resources, causing all to timeout at the 90s limit.
    const membersSummary   = await this.getNewMembersSummary(role);
    const newMembers       = await this.getNewMembersTrend(days, role);
    const activeUsers      = await this.getActiveUsersTrend(days, role);
    const popularFeatures  = await this.getPopularFeatures(Math.min(days, 30), role);
    const sessionDuration  = await this.getAvgSessionDuration(Math.min(days, 30), role);

    const result = { membersSummary, newMembers, activeUsers, popularFeatures, sessionDuration, days, role };
    try { await cache.set(cacheKey, result, 3600); } catch (_) {}
    return result;
  },
});

module.exports = AdminDashboardService;
