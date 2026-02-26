const WithdrawalModel = require('../../models/withdrawalModel');
const ModelEarningsModel = require('../../models/modelEarningsModel');
const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

class WithdrawalService {
  /**
   * Minimum withdrawal amount in USD
   */
  static MIN_WITHDRAWAL_USD = 10;

  /**
   * Create withdrawal request
   */
  static async requestWithdrawal(modelId, method = 'bank_transfer') {
    try {
      // Check pending balance
      const pendingEarnings = await ModelEarningsModel.getPendingEarnings(modelId);

      if (pendingEarnings.length === 0) {
        throw new Error('No pending earnings to withdraw');
      }

      // Calculate total
      const totalUsd = pendingEarnings.reduce((sum, e) => sum + e.amountUsd, 0);
      const totalCop = pendingEarnings.reduce((sum, e) => sum + e.amountCop, 0);

      // Validate minimum amount
      if (totalUsd < this.MIN_WITHDRAWAL_USD) {
        throw new Error(
          `Minimum withdrawal is $${this.MIN_WITHDRAWAL_USD}. Current balance: $${totalUsd.toFixed(2)}`
        );
      }

      // Validate bank details for bank_transfer method
      if (method === 'bank_transfer') {
        const userResult = await query(
          `SELECT bank_account_owner, bank_account_number, bank_code
           FROM users WHERE id = $1`,
          [modelId]
        );

        const user = userResult.rows[0];
        if (
          !user ||
          !user.bank_account_owner ||
          !user.bank_account_number ||
          !user.bank_code
        ) {
          throw new Error('Bank account details not configured');
        }
      }

      // Create withdrawal request
      const withdrawal = await WithdrawalModel.createWithdrawal({
        modelId,
        amountUsd: totalUsd,
        amountCop: totalCop,
        method,
        status: 'pending',
        reason: `Auto-withdrawal of ${pendingEarnings.length} earnings records`,
      });

      logger.info('Withdrawal request created', {
        withdrawalId: withdrawal.id,
        modelId,
        amountUsd: totalUsd,
        earningsCount: pendingEarnings.length,
      });

      return {
        withdrawal,
        earningsCount: pendingEarnings.length,
      };
    } catch (error) {
      logger.error('Error requesting withdrawal:', error);
      throw error;
    }
  }

  /**
   * Approve withdrawal (admin action)
   */
  static async approveWithdrawal(withdrawalId, adminId = null) {
    try {
      const withdrawal = await WithdrawalModel.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        throw new Error('Withdrawal not found');
      }

      if (withdrawal.status !== 'pending') {
        throw new Error(`Cannot approve withdrawal with status: ${withdrawal.status}`);
      }

      const approved = await WithdrawalModel.updateWithdrawalStatus(
        withdrawalId,
        'approved',
        { reason: 'Approved by admin' }
      );

      await WithdrawalModel.addAuditLogEntry(
        withdrawalId,
        'approved_by_admin',
        adminId
      );

      logger.info('Withdrawal approved', {
        withdrawalId,
        modelId: withdrawal.modelId,
        adminId,
      });

      return approved;
    } catch (error) {
      logger.error('Error approving withdrawal:', error);
      throw error;
    }
  }

  /**
   * Process approved withdrawal (payment processor integration)
   */
  static async processWithdrawal(withdrawalId) {
    try {
      const withdrawal = await WithdrawalModel.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        throw new Error('Withdrawal not found');
      }

      if (withdrawal.status !== 'approved') {
        throw new Error(`Cannot process withdrawal with status: ${withdrawal.status}`);
      }

      // Mark as processing
      await WithdrawalModel.updateWithdrawalStatus(withdrawalId, 'processing');

      // TODO: Integrate with payment processor (ePayco, Daimo, bank transfer)
      // This is a placeholder - actual implementation depends on method
      const result = await this._executeWithdrawal(withdrawal);

      if (result.success) {
        const completed = await WithdrawalModel.markAsCompleted(
          withdrawalId,
          result.transactionId,
          result.externalReference
        );

        // Mark associated earnings as paid
        const pendingEarnings = await ModelEarningsModel.getPendingEarnings(
          withdrawal.modelId
        );
        const earningsIds = pendingEarnings.map(e => e.id);
        if (earningsIds.length > 0) {
          await ModelEarningsModel.markEarningsAsPaid(withdrawal.modelId, earningsIds);
        }

        logger.info('Withdrawal processed successfully', {
          withdrawalId,
          modelId: withdrawal.modelId,
          transactionId: result.transactionId,
        });

        return completed;
      } else {
        const failed = await WithdrawalModel.markAsFailed(
          withdrawalId,
          'Payment processing failed',
          result.error
        );

        logger.error('Withdrawal processing failed', {
          withdrawalId,
          error: result.error,
        });

        return failed;
      }
    } catch (error) {
      logger.error('Error processing withdrawal:', error);
      await WithdrawalModel.markAsFailed(
        withdrawalId,
        'Processing error',
        error.message
      );
      throw error;
    }
  }

  /**
   * Execute actual withdrawal (placeholder for payment processors)
   */
  static async _executeWithdrawal(withdrawal) {
    try {
      // Get user bank details
      const userResult = await query(
        `SELECT bank_account_owner, bank_account_number, bank_code, email
         FROM users WHERE id = $1`,
        [withdrawal.modelId]
      );

      const user = userResult.rows[0];
      if (!user) {
        throw new Error('User not found');
      }

      // TODO: Implement actual payment processor calls
      // For now, return mock success
      if (withdrawal.method === 'bank_transfer') {
        return {
          success: true,
          transactionId: `TXN-${Date.now()}`,
          externalReference: `BANK-${withdrawal.modelId}-${Date.now()}`,
        };
      }

      if (withdrawal.method === 'paypal') {
        return {
          success: true,
          transactionId: `PPL-${Date.now()}`,
          externalReference: `PAYPAL-${user.email}`,
        };
      }

      return {
        success: false,
        error: 'Unsupported withdrawal method',
      };
    } catch (error) {
      logger.error('Error executing withdrawal:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Reject withdrawal
   */
  static async rejectWithdrawal(withdrawalId, reason, adminId = null) {
    try {
      const withdrawal = await WithdrawalModel.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        throw new Error('Withdrawal not found');
      }

      const rejected = await WithdrawalModel.updateWithdrawalStatus(
        withdrawalId,
        'cancelled',
        { reason }
      );

      await WithdrawalModel.addAuditLogEntry(
        withdrawalId,
        'rejected',
        adminId,
        reason
      );

      logger.info('Withdrawal rejected', {
        withdrawalId,
        modelId: withdrawal.modelId,
        reason,
      });

      return rejected;
    } catch (error) {
      logger.error('Error rejecting withdrawal:', error);
      throw error;
    }
  }

  /**
   * Get withdrawal history for model
   */
  static async getWithdrawalHistory(modelId, status = null) {
    try {
      return await WithdrawalModel.getWithdrawalsByModel(modelId, status);
    } catch (error) {
      logger.error('Error getting withdrawal history:', error);
      throw error;
    }
  }

  /**
   * Process scheduled withdrawals (admin action)
   */
  static async processPendingWithdrawals() {
    try {
      const pendingWithdrawals = await WithdrawalModel.getPendingWithdrawals(50);

      logger.info('Processing pending withdrawals', {
        count: pendingWithdrawals.length,
      });

      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
      };

      for (const withdrawal of pendingWithdrawals) {
        try {
          // Auto-approve pending withdrawals older than 1 hour
          const createdAt = new Date(withdrawal.requestedAt);
          const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

          if (hoursSince >= 1) {
            const approved = await this.approveWithdrawal(withdrawal.id, null);
            if (approved) {
              const processed = await this.processWithdrawal(withdrawal.id);
              results.processed++;
              if (processed.status === 'completed') {
                results.successful++;
              } else {
                results.failed++;
              }
            }
          }
        } catch (error) {
          logger.error('Error processing withdrawal', {
            withdrawalId: withdrawal.id,
            error: error.message,
          });
          results.failed++;
        }
      }

      logger.info('Withdrawal processing batch complete', results);
      return results;
    } catch (error) {
      logger.error('Error in scheduled withdrawal processing:', error);
      throw error;
    }
  }

  /**
   * Get withdrawal statistics for model
   */
  static async getWithdrawalStats(modelId) {
    try {
      return await WithdrawalModel.getWithdrawalStats(modelId);
    } catch (error) {
      logger.error('Error getting withdrawal stats:', error);
      throw error;
    }
  }

  /**
   * Cancel pending withdrawal
   */
  static async cancelWithdrawal(withdrawalId, reason) {
    try {
      const withdrawal = await WithdrawalModel.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        throw new Error('Withdrawal not found');
      }

      if (!['pending', 'approved'].includes(withdrawal.status)) {
        throw new Error(`Cannot cancel withdrawal with status: ${withdrawal.status}`);
      }

      const cancelled = await WithdrawalModel.updateWithdrawalStatus(
        withdrawalId,
        'cancelled',
        { reason }
      );

      logger.info('Withdrawal cancelled', {
        withdrawalId,
        modelId: withdrawal.modelId,
        reason,
      });

      return cancelled;
    } catch (error) {
      logger.error('Error cancelling withdrawal:', error);
      throw error;
    }
  }

  /**
   * Get audit log for withdrawal
   */
  static async getWithdrawalAuditLog(withdrawalId) {
    try {
      return await WithdrawalModel.getAuditLog(withdrawalId);
    } catch (error) {
      logger.error('Error getting withdrawal audit log:', error);
      throw error;
    }
  }
}

module.exports = WithdrawalService;
