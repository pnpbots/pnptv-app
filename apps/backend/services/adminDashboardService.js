const logger = require('../utils/logger');
const { query } = require('../config/postgres');
const PaymentHistoryService = require('./paymentHistoryService');
const MembershipCleanupService = require('../bot/services/membershipCleanupService');

/**
 * AdminDashboardService
 * Provides comprehensive dashboard statistics for admin monitoring
 * Includes payments, revenue, churn, and subscription metrics
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
        recentPayments
      ] = await Promise.all([
        this.getPaymentOverview(),
        this.getRevenueOverview(),
        this.getMembershipOverview(),
        MembershipCleanupService.getChurnAnalysis(),
        this.getTopPaymentMethods(),
        PaymentHistoryService.getByMethod('epayco', 10)
      ]);

      return {
        timestamp: new Date(),
        payments: paymentStats,
        revenue: revenueStats,
        membership: membershipStats,
        churn: churnAnalysis,
        topMethods: topPaymentMethods,
        recentTransactions: recentPayments.slice(0, 10),
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
          SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue,
          AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_transaction,
          MIN(payment_date) as first_payment,
          MAX(payment_date) as last_payment
        FROM payment_history
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
          DATE_TRUNC('day', payment_date)::DATE as payment_day,
          COUNT(*) as transactions,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(amount) as daily_revenue,
          AVG(amount) as avg_transaction
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', payment_date)
        ORDER BY payment_day DESC
      `);

      const totalResult = await query(`
        SELECT
          SUM(amount) as monthly_revenue,
          COUNT(*) as monthly_transactions,
          COUNT(DISTINCT user_id) as monthly_unique_payers
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= NOW() - INTERVAL '30 days'
      `);

      return {
        daily: result.rows,
        monthly: totalResult.rows[0],
        period: '30 days',
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
          SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          ROUND(100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*), 2) as success_rate,
          AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_successful_transaction
        FROM payment_history
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
          DATE_TRUNC('day', payment_date)::DATE as payment_day,
          payment_method,
          COUNT(*) as transaction_count,
          SUM(amount) as daily_revenue
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= NOW() - INTERVAL '30 days'
        GROUP BY DATE_TRUNC('day', payment_date), payment_method
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
          last_payment_method,
          COUNT(DISTINCT user_id) as users,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_payment,
          SUM(amount) / COUNT(DISTINCT user_id) as clv,
          MAX(payment_date) - MIN(payment_date) as customer_lifespan_days
        FROM payment_history
        WHERE status = 'completed'
        GROUP BY last_payment_method
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
