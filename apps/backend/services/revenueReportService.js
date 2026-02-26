const logger = require('../utils/logger');
const { query } = require('../config/postgres');

/**
 * RevenueReportService
 * Comprehensive revenue analysis and reporting
 * Generates detailed reports by date range, payment method, product, etc.
 */
class RevenueReportService {
  /**
   * Get revenue report for a date range
   * @param {Date} startDate - Report start date
   * @param {Date} endDate - Report end date
   * @param {string} groupBy - 'day', 'week', 'month', or 'method'
   * @returns {Promise<Object>} Revenue report
   */
  static async getRevenueReport(startDate, endDate, groupBy = 'day') {
    try {
      if (!startDate || !endDate) {
        throw new Error('Start and end dates are required');
      }

      let groupClause = "DATE_TRUNC('day', payment_date)::DATE";
      let orderClause = 'payment_date DESC';

      if (groupBy === 'week') {
        groupClause = "DATE_TRUNC('week', payment_date)::DATE";
      } else if (groupBy === 'month') {
        groupClause = "DATE_TRUNC('month', payment_date)::DATE";
      } else if (groupBy === 'method') {
        groupClause = 'payment_method';
        orderClause = 'total_revenue DESC NULLS LAST';
      }

      const result = await query(`
        SELECT
          ${groupClause === 'payment_method' ? 'payment_method as period' : groupClause + ' as period'},
          COUNT(*) as transaction_count,
          COUNT(DISTINCT user_id) as unique_payers,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_transaction,
          MIN(amount) as min_transaction,
          MAX(amount) as max_transaction,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date <= $2
        GROUP BY ${groupClause}
        ORDER BY ${orderClause}
      `, [startDate, endDate]);

      const totals = await query(`
        SELECT
          COUNT(*) as total_transactions,
          COUNT(DISTINCT user_id) as total_unique_payers,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_transaction,
          MIN(amount) as min_transaction,
          MAX(amount) as max_transaction,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date <= $2
      `, [startDate, endDate]);

      return {
        period: {
          start: startDate,
          end: endDate,
        },
        groupedBy: groupBy,
        data: result.rows,
        totals: totals.rows[0],
      };
    } catch (error) {
      logger.error('Error generating revenue report:', error);
      return null;
    }
  }

  /**
   * Get revenue by payment method
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Revenue by method
   */
  static async getRevenueByMethod(startDate, endDate) {
    try {
      const result = await query(`
        SELECT
          payment_method,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_transaction,
          MIN(amount) as min_transaction,
          MAX(amount) as max_transaction,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          ROUND(100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as success_rate
        FROM payment_history
        WHERE payment_date >= $1
          AND payment_date <= $2
        GROUP BY payment_method
        ORDER BY total_revenue DESC NULLS LAST
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting revenue by method:', error);
      return [];
    }
  }

  /**
   * Get revenue by product/plan
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Revenue by product
   */
  static async getRevenueByProduct(startDate, endDate) {
    try {
      const result = await query(`
        SELECT
          product,
          plan_name,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT user_id) as unique_buyers,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_price,
          MIN(amount) as min_price,
          MAX(amount) as max_price
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date <= $2
        GROUP BY product, plan_name
        ORDER BY total_revenue DESC NULLS LAST
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting revenue by product:', error);
      return [];
    }
  }

  /**
   * Get month-over-month comparison
   * @returns {Promise<Object>} MoM comparison
   */
  static async getMonthOverMonthComparison() {
    try {
      const today = new Date();
      const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

      const currentMonthData = await query(`
        SELECT
          SUM(amount) as revenue,
          COUNT(*) as transactions,
          COUNT(DISTINCT user_id) as unique_payers,
          AVG(amount) as avg_transaction
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date < $2
      `, [currentMonth, new Date()]);

      const prevMonthData = await query(`
        SELECT
          SUM(amount) as revenue,
          COUNT(*) as transactions,
          COUNT(DISTINCT user_id) as unique_payers,
          AVG(amount) as avg_transaction
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date < $2
      `, [previousMonth, prevMonthEnd]);

      const current = currentMonthData.rows[0];
      const previous = prevMonthData.rows[0];

      return {
        currentMonth: {
          month: currentMonth.toISOString().substring(0, 7),
          data: current,
        },
        previousMonth: {
          month: previousMonth.toISOString().substring(0, 7),
          data: previous,
        },
        growth: {
          revenue_percent: previous.revenue ? ((current.revenue - previous.revenue) / previous.revenue * 100).toFixed(2) : 0,
          transaction_percent: previous.transactions ? ((current.transactions - previous.transactions) / previous.transactions * 100).toFixed(2) : 0,
          payer_percent: previous.unique_payers ? ((current.unique_payers - previous.unique_payers) / previous.unique_payers * 100).toFixed(2) : 0,
        },
      };
    } catch (error) {
      logger.error('Error calculating MoM comparison:', error);
      return null;
    }
  }

  /**
   * Get top spenders
   * @param {number} limit - Number of top spenders to return
   * @param {Date} startDate - Start date (optional)
   * @param {Date} endDate - End date (optional)
   * @returns {Promise<Array>} Top spenders
   */
  static async getTopSpenders(limit = 10, startDate = null, endDate = null) {
    try {
      let dateClause = '';
      const params = [];

      if (startDate && endDate) {
        dateClause = 'AND payment_date >= $1 AND payment_date <= $2';
        params.push(startDate, endDate);
      }

      const result = await query(`
        SELECT
          user_id,
          COUNT(*) as transaction_count,
          SUM(amount) as total_spent,
          AVG(amount) as avg_transaction,
          MAX(payment_date) as last_payment_date,
          MIN(payment_date) as first_payment_date,
          STRING_AGG(DISTINCT payment_method, ', ') as payment_methods
        FROM payment_history
        WHERE status = 'completed' ${dateClause}
        GROUP BY user_id
        ORDER BY total_spent DESC
        LIMIT $${params.length + 1}
      `, [...params, limit]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting top spenders:', error);
      return [];
    }
  }

  /**
   * Get revenue by currency
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Revenue by currency
   */
  static async getRevenueByGurrency(startDate, endDate) {
    try {
      const result = await query(`
        SELECT
          currency,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT user_id) as unique_payers,
          SUM(amount) as total_amount,
          AVG(amount) as avg_amount,
          MIN(amount) as min_amount,
          MAX(amount) as max_amount
        FROM payment_history
        WHERE status = 'completed'
          AND payment_date >= $1
          AND payment_date <= $2
        GROUP BY currency
        ORDER BY total_amount DESC NULLS LAST
      `, [startDate, endDate]);

      return result.rows;
    } catch (error) {
      logger.error('Error getting revenue by currency:', error);
      return [];
    }
  }

  /**
   * Get customer lifetime value statistics
   * @returns {Promise<Object>} CLV statistics
   */
  static async getCustomerLifetimeValueStats() {
    try {
      const result = await query(`
        SELECT
          COUNT(DISTINCT user_id) as unique_customers,
          AVG(total_spent) as avg_clv,
          MIN(total_spent) as min_clv,
          MAX(total_spent) as max_clv,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_spent) as median_clv,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_spent) as p75_clv,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_spent) as p90_clv
        FROM (
          SELECT
            user_id,
            SUM(amount) as total_spent
          FROM payment_history
          WHERE status = 'completed'
          GROUP BY user_id
        ) user_spending
      `);

      return result.rows[0];
    } catch (error) {
      logger.error('Error calculating CLV stats:', error);
      return null;
    }
  }

  /**
   * Get payment method performance
   * @returns {Promise<Array>} Payment method performance metrics
   */
  static async getPaymentMethodPerformance() {
    try {
      const result = await query(`
        SELECT
          payment_method,
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          ROUND(100.0 * COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*), 2) as success_rate,
          AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_successful_amount,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN user_id END) as unique_successful_users,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN status = 'completed' THEN user_id END) / COUNT(DISTINCT user_id), 2) as user_adoption_rate
        FROM payment_history
        GROUP BY payment_method
        ORDER BY successful DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error('Error getting payment method performance:', error);
      return [];
    }
  }

  /**
   * Generate comprehensive revenue report for export
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Comprehensive report
   */
  static async generateComprehensiveReport(startDate, endDate) {
    try {
      const [
        dailyReport,
        methodReport,
        productReport,
        momComparison,
        topSpenders,
        currencyReport,
        clvStats,
        methodPerformance
      ] = await Promise.all([
        this.getRevenueReport(startDate, endDate, 'day'),
        this.getRevenueByMethod(startDate, endDate),
        this.getRevenueByProduct(startDate, endDate),
        this.getMonthOverMonthComparison(),
        this.getTopSpenders(20, startDate, endDate),
        this.getRevenueByGurrency(startDate, endDate),
        this.getCustomerLifetimeValueStats(),
        this.getPaymentMethodPerformance(),
      ]);

      return {
        reportPeriod: {
          start: startDate,
          end: endDate,
          generatedAt: new Date(),
        },
        summary: {
          totalRevenue: dailyReport?.totals?.total_revenue || 0,
          totalTransactions: dailyReport?.totals?.total_transactions || 0,
          uniquePayers: dailyReport?.totals?.total_unique_payers || 0,
          avgTransaction: dailyReport?.totals?.avg_transaction || 0,
        },
        byDay: dailyReport?.data || [],
        byMethod: methodReport || [],
        byProduct: productReport || [],
        byGurrency: currencyReport || [],
        monthOverMonth: momComparison,
        topSpenders: topSpenders || [],
        clvStatistics: clvStats,
        methodPerformance: methodPerformance || [],
      };
    } catch (error) {
      logger.error('Error generating comprehensive report:', error);
      return null;
    }
  }

  /**
   * Generate CSV export string
   * @param {Array} data - Data array
   * @param {Array} headers - Column headers
   * @returns {string} CSV formatted string
   */
  static generateCSV(data, headers) {
    if (!data || data.length === 0) return '';

    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => {
      return headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  /**
   * Format revenue report as text for Telegram
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<string>} Formatted report
   */
  static async formatReportForTelegram(startDate, endDate) {
    try {
      const report = await this.getRevenueReport(startDate, endDate, 'method');
      if (!report) return 'Error generating report';

      const t = report.totals;
      const methods = report.data;

      let text = `
📊 *Revenue Report*
_${startDate.toDateString()} to ${endDate.toDateString()}_

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *TOTAL REVENUE*
• Amount: $${(t.total_revenue || 0).toFixed(2)}
• Transactions: ${t.total_transactions || 0}
• Unique Payers: ${t.total_unique_payers || 0}
• Avg Transaction: $${(t.avg_transaction || 0).toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *BY PAYMENT METHOD*
${methods.slice(0, 5).map(m => `• ${m.period}: $${m.total_revenue?.toFixed(2) || '0'} (${m.transaction_count} txn)`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

      return text;
    } catch (error) {
      logger.error('Error formatting report for Telegram:', error);
      return 'Error generating report';
    }
  }
}

module.exports = RevenueReportService;
