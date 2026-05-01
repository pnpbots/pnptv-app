const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const { Pool } = require('pg');

const MembershipCleanupService = require('./membershipCleanupService');

// Normalize all amounts to USD — COP payments are stored in COP and need conversion
const AMOUNT_USD = `CASE WHEN currency = 'COP' THEN amount / 4250.0 ELSE amount END`;
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
      const [
        paymentStats,
        revenueStats,
        membershipStats,
        churnAnalysis,
        topPaymentMethods,
        recentPayments,
        identityStats,
      ] = await Promise.all([
        this.getPaymentOverview(),
        this.getRevenueOverview(),
        this.getMembershipOverview(),
        MembershipCleanupService.getChurnAnalysis(),
        this.getTopPaymentMethods(),
        this.getRecentTransactions(),
        this.getIdentityOverview(),
      ]);

      return {
        timestamp: new Date(),
        payments: paymentStats,
        revenue: revenueStats,
        membership: membershipStats,
        churn: churnAnalysis,
        topMethods: topPaymentMethods,
        recentTransactions: recentPayments.slice(0, 10),
        identity: identityStats,
      };
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
          COUNT(DISTINCT user_id) as unique_payers,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          SUM(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE 0 END) as total_revenue,
          AVG(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE NULL END) as avg_transaction,
          MIN(created_at) as first_payment,
          MAX(created_at) as last_payment
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
      const result = await query(`
        SELECT
          subscription_status,
          COUNT(*) as count,
          COUNT(CASE WHEN plan_expiry > NOW() THEN 1 END) as with_valid_expiry,
          COUNT(CASE WHEN plan_id LIKE '%lifetime%' THEN 1 END) as lifetime_users,
          COUNT(CASE WHEN last_payment_date > NOW() - INTERVAL '30 days' THEN 1 END) as paid_last_30d,
          COUNT(CASE WHEN last_payment_date > NOW() - INTERVAL '90 days' THEN 1 END) as paid_last_90d
        FROM users
        WHERE is_active = true
        GROUP BY subscription_status
        ORDER BY count DESC
      `);

      const totalResult = await query(`
        SELECT
          COUNT(*) as total_active_users,
          COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_subscribers,
          COUNT(CASE WHEN subscription_status IN ('churned', 'expired') THEN 1 END) as churned_users,
          COUNT(CASE WHEN subscription_status = 'free' THEN 1 END) as free_users,
          COUNT(CASE WHEN last_payment_date IS NOT NULL THEN 1 END) as users_with_payments,
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
   * Get top payment methods by volume and revenue
   * @returns {Promise<Object>} Top methods stats
   */
  static async getTopPaymentMethods() {
    try {
      const result = await query(`
        SELECT
          payment_method,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE 0 END) as total_revenue,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          ROUND(100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*), 2) as success_rate,
          AVG(CASE WHEN status = 'completed' THEN ${AMOUNT_USD} ELSE NULL END) as avg_successful_transaction
        FROM payments
        GROUP BY payment_method
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
               ph.status, ph.payment_method, ph.created_at as payment_date, ph.currency,
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
          WHERE pnptv_id ~* '^[0-9a-f-]{36}$'
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
   * Get conversion metrics
   * Shows how many users convert from free to paid
   * @returns {Promise<Object>} Conversion data
   */
  static async getConversionMetrics() {
    try {
      const result = await query(`
        SELECT
          COUNT(DISTINCT u.id) as total_users,
          COUNT(DISTINCT CASE WHEN u.last_payment_date IS NOT NULL THEN u.id END) as payers,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN u.last_payment_date IS NOT NULL THEN u.id END) / COUNT(DISTINCT u.id), 2) as conversion_rate,
          COUNT(DISTINCT CASE WHEN u.subscription_status = 'active' THEN u.id END) as active_subscribers,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN u.subscription_status = 'active' THEN u.id END) / COUNT(DISTINCT u.id), 2) as active_rate
        FROM users u
        WHERE u.is_active = true AND u.created_at > NOW() - INTERVAL '90 days'
      `);

      return result.rows[0];
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

module.exports = AdminDashboardService;
