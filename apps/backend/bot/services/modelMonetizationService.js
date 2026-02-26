const PaidContentModel = require('../../models/paidContentModel');
const ModelEarningsModel = require('../../models/modelEarningsModel');
const SubscriptionModel = require('../../models/subscriptionModel');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

class ModelMonetizationService {
  /**
   * Process content sale and record earnings
   */
  static async processContentSale(purchaseId, paymentId, revenueSplitPercentage = 80) {
    try {
      const purchase = await PaidContentModel.getPurchaseById(purchaseId);
      if (!purchase) {
        throw new Error('Purchase not found');
      }

      // Record earnings for model
      const earnings = await ModelEarningsModel.recordContentEarnings(
        purchaseId,
        purchase.creatorId,
        purchase.amountUsd,
        purchase.amountCop,
        revenueSplitPercentage
      );

      logger.info('Content sale processed', {
        purchaseId,
        creatorId: purchase.creatorId,
        earningsId: earnings.id,
      });

      return earnings;
    } catch (error) {
      logger.error('Error processing content sale:', error);
      throw error;
    }
  }

  /**
   * Process subscription payment and record model earnings
   */
  static async processSubscriptionEarnings(
    userId,
    planId,
    amountUsd,
    amountCop
  ) {
    try {
      const plan = await SubscriptionModel.getPlanById(planId);
      if (!plan) {
        throw new Error('Plan not found');
      }

      // If plan is for models, record earnings
      if (plan.role === 'model') {
        const earnings = await ModelEarningsModel.recordSubscriptionEarnings(
          userId,
          amountUsd,
          amountCop,
          plan.revenueSplitPercentage
        );

        logger.info('Model subscription earnings recorded', {
          userId,
          planId,
          earningsId: earnings.id,
        });

        return earnings;
      }

      return null;
    } catch (error) {
      logger.error('Error processing subscription earnings:', error);
      throw error;
    }
  }

  /**
   * Get model dashboard statistics
   */
  static async getModelDashboardStats(modelId) {
    try {
      // Get earnings summary
      const earningsSummary = await ModelEarningsModel.getEarningsSummary(modelId);

      // Get paid content stats
      const contentList = await PaidContentModel.getContentByCreator(modelId);
      const contentStats = {
        totalItems: contentList.length,
        totalViews: contentList.reduce((sum, c) => sum + (c.viewCount || 0), 0),
        totalPurchases: contentList.reduce((sum, c) => sum + (c.purchaseCount || 0), 0),
      };

      // Get streaming stats (if available)
      const streamResult = await query(
        `SELECT
           COUNT(DISTINCT id) as total_streams,
           SUM(CASE WHEN is_live = TRUE THEN 1 ELSE 0 END) as active_streams,
           SUM(viewer_count) as total_viewers,
           COUNT(DISTINCT started_at::date) as streaming_days
         FROM live_streams
         WHERE creator_id = $1`,
        [modelId]
      );

      const streamStats = {
        totalStreams: parseInt(streamResult.rows[0].total_streams) || 0,
        activeStreams: parseInt(streamResult.rows[0].active_streams) || 0,
        totalViewers: parseInt(streamResult.rows[0].total_viewers) || 0,
        streamingDays: parseInt(streamResult.rows[0].streaming_days) || 0,
      };

      // Get subscriber count
      const subscriberResult = await query(
        `SELECT COUNT(*) as count FROM user_subscriptions
         WHERE status = 'active' AND expires_at > NOW()`
      );

      return {
        earnings: earningsSummary,
        content: contentStats,
        streaming: streamStats,
        subscribers: parseInt(subscriberResult.rows[0].count) || 0,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting model dashboard stats:', error);
      throw error;
    }
  }

  /**
   * Get content performance analytics
   */
  static async getContentAnalytics(contentId) {
    try {
      const content = await PaidContentModel.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Get purchase history
      const purchaseResult = await query(
        `SELECT
           DATE(purchased_at) as date,
           COUNT(*) as purchases,
           SUM(amount_usd) as revenue_usd,
           SUM(amount_cop) as revenue_cop
         FROM content_purchases
         WHERE content_id = $1 AND status = 'completed'
         GROUP BY DATE(purchased_at)
         ORDER BY date DESC`,
        [contentId]
      );

      return {
        content: {
          id: content.id,
          title: content.title,
          priceUsd: content.priceUsd,
          priceCop: content.priceCop,
          viewCount: content.viewCount,
          purchaseCount: content.purchaseCount,
        },
        dailyStats: purchaseResult.rows.map(row => ({
          date: row.date,
          purchases: parseInt(row.purchases),
          revenueUsd: parseFloat(row.revenue_usd) || 0,
          revenueCop: parseFloat(row.revenue_cop) || 0,
        })),
      };
    } catch (error) {
      logger.error('Error getting content analytics:', error);
      throw error;
    }
  }

  /**
   * Calculate total available for withdrawal
   */
  static async calculateWithdrawableAmount(modelId) {
    try {
      const pendingEarnings = await ModelEarningsModel.getPendingEarnings(modelId);

      const total = pendingEarnings.reduce(
        (sum, earning) => ({
          usd: sum.usd + earning.amountUsd,
          cop: sum.cop + earning.amountCop,
        }),
        { usd: 0, cop: 0 }
      );

      return {
        totalUsd: parseFloat(total.usd.toFixed(2)),
        totalCop: parseInt(total.cop),
        itemCount: pendingEarnings.length,
        earnings: pendingEarnings,
      };
    } catch (error) {
      logger.error('Error calculating withdrawable amount:', error);
      throw error;
    }
  }

  /**
   * Get top performing content
   */
  static async getTopContent(modelId, limit = 10) {
    try {
      const result = await query(
        `SELECT id, title, price_usd, purchase_count, view_count,
                ROUND((purchase_count::numeric / NULLIF(view_count, 0) * 100)::numeric, 2) as conversion_rate
         FROM paid_content
         WHERE creator_id = $1 AND is_active = TRUE
         ORDER BY purchase_count DESC, conversion_rate DESC
         LIMIT $2`,
        [modelId, limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        priceUsd: parseFloat(row.price_usd),
        purchaseCount: row.purchase_count,
        viewCount: row.view_count,
        conversionRate: parseFloat(row.conversion_rate) || 0,
      }));
    } catch (error) {
      logger.error('Error getting top content:', error);
      throw error;
    }
  }

  /**
   * Get revenue trends (last 30 days)
   */
  static async getRevenueTrends(modelId) {
    try {
      const result = await query(
        `SELECT
           DATE(created_at) as date,
           COUNT(*) as transaction_count,
           SUM(amount_usd) as revenue_usd,
           SUM(amount_cop) as revenue_cop
         FROM model_earnings
         WHERE model_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [modelId]
      );

      return result.rows.map(row => ({
        date: row.date,
        transactionCount: parseInt(row.transaction_count),
        revenueUsd: parseFloat(row.revenue_usd) || 0,
        revenueCop: parseFloat(row.revenue_cop) || 0,
      }));
    } catch (error) {
      logger.error('Error getting revenue trends:', error);
      throw error;
    }
  }

  /**
   * Validate model can upload content (based on plan limits)
   */
  static async validateContentUploadLimit(modelId) {
    try {
      const subscription = await SubscriptionModel.getActiveSubscription(modelId);

      if (!subscription) {
        return {
          allowed: false,
          reason: 'No active subscription',
        };
      }

      if (!subscription.max_content_uploads) {
        return {
          allowed: true,
          reason: 'Unlimited uploads',
        };
      }

      // Count current uploads this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const result = await query(
        `SELECT COUNT(*) as count FROM paid_content
         WHERE creator_id = $1 AND created_at >= $2`,
        [modelId, monthStart]
      );

      const uploadCount = parseInt(result.rows[0].count) || 0;
      const limit = subscription.max_content_uploads;
      const allowed = uploadCount < limit;

      return {
        allowed,
        currentCount: uploadCount,
        limit,
        remaining: Math.max(0, limit - uploadCount),
        reason: allowed ? 'Within limit' : 'Upload limit exceeded for this month',
      };
    } catch (error) {
      logger.error('Error validating content upload limit:', error);
      throw error;
    }
  }

  /**
   * Get earnings by type (subscription, content, etc.)
   */
  static async getEarningsByType(modelId) {
    try {
      const result = await query(
        `SELECT
           earnings_type,
           COUNT(*) as count,
           SUM(amount_usd) as total_usd,
           SUM(amount_cop) as total_cop,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
           COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count
         FROM model_earnings
         WHERE model_id = $1
         GROUP BY earnings_type
         ORDER BY total_usd DESC`,
        [modelId]
      );

      return result.rows.map(row => ({
        type: row.earnings_type,
        count: parseInt(row.count),
        totalUsd: parseFloat(row.total_usd) || 0,
        totalCop: parseFloat(row.total_cop) || 0,
        pendingCount: parseInt(row.pending_count) || 0,
        paidCount: parseInt(row.paid_count) || 0,
      }));
    } catch (error) {
      logger.error('Error getting earnings by type:', error);
      throw error;
    }
  }
}

module.exports = ModelMonetizationService;
