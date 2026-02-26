const PaidContentModel = require('../../../models/paidContentModel');
const ModelEarningsModel = require('../../../models/modelEarningsModel');
const WithdrawalModel = require('../../../models/withdrawalModel');
const ModelMonetizationService = require('../../services/modelMonetizationService');
const WithdrawalService = require('../../services/withdrawalService');
const SubscriptionService = require('../../services/subscriptionService');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

/**
 * Model Controller
 * Handles model-specific operations: content, earnings, payouts
 */
class ModelController {
  /**
   * Get model dashboard
   */
  static async getDashboard(req, res) {
    try {
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const stats = await ModelMonetizationService.getModelDashboardStats(modelId);

      res.json({
        success: true,
        data: {
          stats,
        },
      });
    } catch (error) {
      logger.error('Error in getDashboard:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch dashboard',
        },
      });
    }
  }

  /**
   * Upload paid content
   */
  static async uploadContent(req, res) {
    try {
      const modelId = req.user?.id;
      const { title, description, contentType, contentUrl, thumbnailUrl, priceUsd, priceCop, isExclusive } = req.body;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      // Validate input
      if (!title || !contentType || !contentUrl || !priceUsd) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Title, content type, URL, and price are required',
          },
        });
      }

      // Check upload limits
      const limitCheck = await ModelMonetizationService.validateContentUploadLimit(modelId);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: limitCheck.reason,
          },
        });
      }

      // Create content
      const content = await PaidContentModel.createContent({
        creatorId: modelId,
        title,
        description,
        contentType,
        contentUrl,
        thumbnailUrl,
        priceUsd: parseFloat(priceUsd),
        priceCop: parseInt(priceCop) || 0,
        isExclusive: isExclusive || false,
      });

      logger.info('Content uploaded', {
        contentId: content.id,
        modelId,
        title,
      });

      res.status(201).json({
        success: true,
        data: {
          content,
        },
      });
    } catch (error) {
      logger.error('Error in uploadContent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload content',
        },
      });
    }
  }

  /**
   * Get model's content
   */
  static async getMyContent(req, res) {
    try {
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const content = await PaidContentModel.getContentByCreator(modelId);

      res.json({
        success: true,
        data: {
          content,
          count: content.length,
        },
      });
    } catch (error) {
      logger.error('Error in getMyContent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch content',
        },
      });
    }
  }

  /**
   * Delete content
   */
  static async deleteContent(req, res) {
    try {
      const modelId = req.user?.id;
      const { contentId } = req.params;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      // Verify ownership
      const content = await PaidContentModel.getContentById(contentId);
      if (!content || content.creatorId !== modelId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to delete this content',
          },
        });
      }

      // Mark as inactive
      const updated = await PaidContentModel.updateContent(contentId, { isActive: false });

      logger.info('Content deleted', {
        contentId,
        modelId,
      });

      res.json({
        success: true,
        data: {
          content: updated,
          message: 'Content deleted successfully',
        },
      });
    } catch (error) {
      logger.error('Error in deleteContent:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete content',
        },
      });
    }
  }

  /**
   * Get model earnings
   */
  static async getEarnings(req, res) {
    try {
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const summary = await ModelEarningsModel.getEarningsSummary(modelId);
      const byType = await ModelMonetizationService.getEarningsByType(modelId);
      const trends = await ModelMonetizationService.getRevenueTrends(modelId);

      res.json({
        success: true,
        data: {
          summary,
          byType,
          trends,
        },
      });
    } catch (error) {
      logger.error('Error in getEarnings:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch earnings',
        },
      });
    }
  }

  /**
   * Request withdrawal
   */
  static async requestWithdrawal(req, res) {
    try {
      const modelId = req.user?.id;
      const { method = 'bank_transfer' } = req.body;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const result = await WithdrawalService.requestWithdrawal(modelId, method);

      logger.info('Withdrawal requested', {
        withdrawalId: result.withdrawal.id,
        modelId,
        amount: result.withdrawal.amountUsd,
      });

      res.status(201).json({
        success: true,
        data: {
          withdrawal: result.withdrawal,
          earningsCount: result.earningsCount,
        },
      });
    } catch (error) {
      logger.error('Error in requestWithdrawal:', error);
      res.status(400).json({
        success: false,
        error: {
          code: 'WITHDRAWAL_ERROR',
          message: error.message || 'Failed to request withdrawal',
        },
      });
    }
  }

  /**
   * Get withdrawal history
   */
  static async getWithdrawalHistory(req, res) {
    try {
      const modelId = req.user?.id;
      const { status } = req.query;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const withdrawals = await WithdrawalService.getWithdrawalHistory(modelId, status);
      const stats = await WithdrawalService.getWithdrawalStats(modelId);

      res.json({
        success: true,
        data: {
          withdrawals,
          stats,
          count: withdrawals.length,
        },
      });
    } catch (error) {
      logger.error('Error in getWithdrawalHistory:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch withdrawal history',
        },
      });
    }
  }

  /**
   * Get available withdrawal amount
   */
  static async getWithdrawableAmount(req, res) {
    try {
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const withdrawable = await ModelMonetizationService.calculateWithdrawableAmount(modelId);

      res.json({
        success: true,
        data: {
          withdrawable,
        },
      });
    } catch (error) {
      logger.error('Error in getWithdrawableAmount:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to calculate withdrawable amount',
        },
      });
    }
  }

  /**
   * Check streaming limits
   */
  static async checkStreamingLimits(req, res) {
    try {
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const limits = await SubscriptionService.checkStreamingLimits(modelId);

      res.json({
        success: true,
        data: {
          limits,
        },
      });
    } catch (error) {
      logger.error('Error in checkStreamingLimits:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check streaming limits',
        },
      });
    }
  }

  /**
   * Update model profile
   */
  static async updateProfile(req, res) {
    try {
      const modelId = req.user?.id;
      const { bio, avatarUrl, bankAccountOwner, bankAccountNumber, bankCode } = req.body;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const updateData = {};
      if (bio) updateData.model_bio = bio;
      if (avatarUrl) updateData.model_avatar_url = avatarUrl;
      if (bankAccountOwner) updateData.bank_account_owner = bankAccountOwner;
      if (bankAccountNumber) updateData.bank_account_number = bankAccountNumber;
      if (bankCode) updateData.bank_code = bankCode;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'No fields to update',
          },
        });
      }

      updateData.updated_at = new Date();

      const setClauses = Object.keys(updateData)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');

      const values = [modelId, ...Object.values(updateData)];

      await query(
        `UPDATE users SET ${setClauses} WHERE id = $1`,
        values
      );

      logger.info('Model profile updated', { modelId });

      res.json({
        success: true,
        data: {
          message: 'Profile updated successfully',
        },
      });
    } catch (error) {
      logger.error('Error in updateProfile:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update profile',
        },
      });
    }
  }

  /**
   * Get content analytics
   */
  static async getContentAnalytics(req, res) {
    try {
      const { contentId } = req.params;
      const modelId = req.user?.id;

      if (!modelId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      // Verify ownership
      const content = await PaidContentModel.getContentById(contentId);
      if (!content || content.creatorId !== modelId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to view this content analytics',
          },
        });
      }

      const analytics = await ModelMonetizationService.getContentAnalytics(contentId);

      res.json({
        success: true,
        data: {
          analytics,
        },
      });
    } catch (error) {
      logger.error('Error in getContentAnalytics:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch analytics',
        },
      });
    }
  }
}

module.exports = ModelController;
