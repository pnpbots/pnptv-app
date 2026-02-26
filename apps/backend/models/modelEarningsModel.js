const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE_EARNINGS = 'model_earnings';
const TABLE_STREAMS = 'live_streams';
const TABLE_CONTENT_PURCHASES = 'content_purchases';

class ModelEarningsModel {
  /**
   * Format earnings row
   */
  static _formatEarnings(row) {
    if (!row) return null;
    return {
      id: row.id,
      modelId: row.model_id,
      earningsType: row.earnings_type,
      sourceId: row.source_id,
      sourceType: row.source_type,
      amountUsd: parseFloat(row.amount_usd),
      amountCop: parseFloat(row.amount_cop),
      platformFeeUsd: parseFloat(row.platform_fee_usd) || 0,
      status: row.status,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Record subscription earnings
   */
  static async recordSubscriptionEarnings(modelId, amountUsd, amountCop, revenueSplitPercentage = 80) {
    try {
      const id = uuidv4();
      const timestamp = new Date();
      const platformFeeUsd = amountUsd * ((100 - revenueSplitPercentage) / 100);
      const modelAmountUsd = amountUsd * (revenueSplitPercentage / 100);
      const modelAmountCop = amountCop * (revenueSplitPercentage / 100);

      await query('BEGIN');

      try {
        // Record earnings
        const result = await query(
          `INSERT INTO ${TABLE_EARNINGS} (id, model_id, earnings_type, source_id, source_type, amount_usd, amount_cop, platform_fee_usd, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            modelId,
            'subscription',
            null,
            'subscriber_payment',
            modelAmountUsd,
            modelAmountCop,
            platformFeeUsd,
            'pending',
            timestamp,
            timestamp,
          ]
        );

        // Update user earnings balance (if exists)
        await query(
          `UPDATE users
           SET updated_at = NOW()
           WHERE id = $1`,
          [modelId]
        );

        await query('COMMIT');

        logger.info('Subscription earnings recorded', {
          id,
          modelId,
          amountUsd: modelAmountUsd,
        });

        return this._formatEarnings(result.rows[0]);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error recording subscription earnings:', error);
      throw error;
    }
  }

  /**
   * Record content sale earnings
   */
  static async recordContentEarnings(purchaseId, modelId, amountUsd, amountCop, revenueSplitPercentage = 80) {
    try {
      const id = uuidv4();
      const timestamp = new Date();
      const platformFeeUsd = amountUsd * ((100 - revenueSplitPercentage) / 100);
      const modelAmountUsd = amountUsd * (revenueSplitPercentage / 100);
      const modelAmountCop = amountCop * (revenueSplitPercentage / 100);

      await query('BEGIN');

      try {
        // Record earnings
        const result = await query(
          `INSERT INTO ${TABLE_EARNINGS} (id, model_id, earnings_type, source_id, source_type, amount_usd, amount_cop, platform_fee_usd, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            modelId,
            'content_sale',
            purchaseId,
            'content_purchase',
            modelAmountUsd,
            modelAmountCop,
            platformFeeUsd,
            'pending',
            timestamp,
            timestamp,
          ]
        );

        await query('COMMIT');

        logger.info('Content earnings recorded', {
          id,
          modelId,
          purchaseId,
          amountUsd: modelAmountUsd,
        });

        return this._formatEarnings(result.rows[0]);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error recording content earnings:', error);
      throw error;
    }
  }

  /**
   * Get model earnings by period
   */
  static async getEarningsByPeriod(modelId, startDate, endDate) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_EARNINGS}
         WHERE model_id = $1
           AND created_at >= $2
           AND created_at <= $3
         ORDER BY created_at DESC`,
        [modelId, startDate, endDate]
      );

      return result.rows.map(row => this._formatEarnings(row));
    } catch (error) {
      logger.error('Error getting earnings by period:', error);
      throw error;
    }
  }

  /**
   * Get earnings summary for model
   */
  static async getEarningsSummary(modelId) {
    try {
      const result = await query(
        `SELECT
           COUNT(*) as total_records,
           COUNT(DISTINCT earnings_type) as earnings_types,
           SUM(CASE WHEN status = 'pending' THEN amount_usd ELSE 0 END) as pending_usd,
           SUM(CASE WHEN status = 'paid' THEN amount_usd ELSE 0 END) as paid_usd,
           SUM(CASE WHEN status = 'pending' THEN amount_cop ELSE 0 END) as pending_cop,
           SUM(CASE WHEN status = 'paid' THEN amount_cop ELSE 0 END) as paid_cop,
           SUM(platform_fee_usd) as total_platform_fees_usd,
           SUM(amount_usd) as total_earnings_usd,
           SUM(amount_cop) as total_earnings_cop
         FROM ${TABLE_EARNINGS}
         WHERE model_id = $1`,
        [modelId]
      );

      const row = result.rows[0];
      return {
        totalRecords: parseInt(row.total_records) || 0,
        earningsTypes: parseInt(row.earnings_types) || 0,
        pendingUsd: parseFloat(row.pending_usd) || 0,
        paidUsd: parseFloat(row.paid_usd) || 0,
        pendingCop: parseFloat(row.pending_cop) || 0,
        paidCop: parseFloat(row.paid_cop) || 0,
        totalPlatformFeesUsd: parseFloat(row.total_platform_fees_usd) || 0,
        totalEarningsUsd: parseFloat(row.total_earnings_usd) || 0,
        totalEarningsCop: parseFloat(row.total_earnings_cop) || 0,
      };
    } catch (error) {
      logger.error('Error getting earnings summary:', error);
      throw error;
    }
  }

  /**
   * Get earnings by type
   */
  static async getEarningsByType(modelId, earningsType) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_EARNINGS}
         WHERE model_id = $1 AND earnings_type = $2
         ORDER BY created_at DESC`,
        [modelId, earningsType]
      );

      return result.rows.map(row => this._formatEarnings(row));
    } catch (error) {
      logger.error('Error getting earnings by type:', error);
      throw error;
    }
  }

  /**
   * Update earnings status
   */
  static async updateEarningsStatus(earningsId, newStatus) {
    try {
      const result = await query(
        `UPDATE ${TABLE_EARNINGS}
         SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [earningsId, newStatus]
      );

      logger.info('Earnings status updated', {
        earningsId,
        newStatus,
      });

      return this._formatEarnings(result.rows[0]);
    } catch (error) {
      logger.error('Error updating earnings status:', error);
      throw error;
    }
  }

  /**
   * Mark earnings as paid (for withdrawal processing)
   */
  static async markEarningsAsPaid(modelId, earningsIds) {
    try {
      const result = await query(
        `UPDATE ${TABLE_EARNINGS}
         SET status = 'paid', updated_at = NOW()
         WHERE model_id = $1 AND id = ANY($2::uuid[])
         RETURNING id`,
        [modelId, earningsIds]
      );

      logger.info('Earnings marked as paid', {
        modelId,
        count: result.rows.length,
      });

      return result.rows.map(row => row.id);
    } catch (error) {
      logger.error('Error marking earnings as paid:', error);
      throw error;
    }
  }

  /**
   * Get pending earnings available for withdrawal
   */
  static async getPendingEarnings(modelId) {
    try {
      const result = await query(
        `SELECT
           id,
           amount_usd,
           amount_cop,
           earnings_type,
           source_type,
           created_at
         FROM ${TABLE_EARNINGS}
         WHERE model_id = $1
           AND status = 'pending'
         ORDER BY created_at ASC`,
        [modelId]
      );

      return result.rows.map(row => ({
        id: row.id,
        amountUsd: parseFloat(row.amount_usd),
        amountCop: parseFloat(row.amount_cop),
        earningsType: row.earnings_type,
        sourceType: row.source_type,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error('Error getting pending earnings:', error);
      throw error;
    }
  }

  /**
   * Get monthly earnings breakdown
   */
  static async getMonthlyBreakdown(modelId, year, month) {
    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const result = await query(
        `SELECT
           earnings_type,
           COUNT(*) as count,
           SUM(amount_usd) as total_usd,
           SUM(amount_cop) as total_cop,
           SUM(platform_fee_usd) as platform_fees_usd
         FROM ${TABLE_EARNINGS}
         WHERE model_id = $1
           AND created_at >= $2
           AND created_at <= $3
         GROUP BY earnings_type
         ORDER BY earnings_type`,
        [modelId, startDate, endDate]
      );

      return result.rows.map(row => ({
        earningsType: row.earnings_type,
        count: parseInt(row.count),
        totalUsd: parseFloat(row.total_usd) || 0,
        totalCop: parseFloat(row.total_cop) || 0,
        platformFeesUsd: parseFloat(row.platform_fees_usd) || 0,
      }));
    } catch (error) {
      logger.error('Error getting monthly breakdown:', error);
      throw error;
    }
  }
}

module.exports = ModelEarningsModel;
