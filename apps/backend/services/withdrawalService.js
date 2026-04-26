const WithdrawalModel = require('../models/withdrawalModel');
const ModelEarningsModel = require('../models/modelEarningsModel');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const emailService = require('./emailService');

class WithdrawalService {
  /**
   * Minimum withdrawal amount in USD
   */
  static MIN_WITHDRAWAL_USD = 10;

  /**
   * Create withdrawal request
   * @param {string} modelId
   * @param {string} method - 'bank_transfer' | 'daimo' | other
   * @param {Object} paymentDetails - optional extra details e.g. { daimo_address }
   */
  static async requestWithdrawal(modelId, method = 'bank_transfer', paymentDetails = {}) {
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

      // For dash method, require a Dash wallet address (X... or 7... base58check, 34 chars).
      // We accept the legacy 'daimo' method name as an alias during cutover but treat
      // it as Dash so any in-flight UI request that still says 'daimo' doesn't break.
      const isCrypto = method === 'dash' || method === 'daimo';
      const cryptoAddress = paymentDetails.dash_address || paymentDetails.daimo_address || null;
      if (isCrypto) {
        method = 'dash';
        if (!cryptoAddress) {
          throw new Error('Dash wallet address is required for crypto withdrawals');
        }
        if (!/^[X7][1-9A-HJ-NP-Za-km-z]{33}$/.test(cryptoAddress)) {
          throw new Error('Invalid Dash address format. Dash mainnet addresses start with X (or 7 for P2SH) and are 34 characters long.');
        }
      }

      // Fetch user email for notifications
      const userResult = await query(
        `SELECT email, payout_method FROM users WHERE id = $1`,
        [modelId]
      );
      const user = userResult.rows[0];

      // Build reason string that embeds payment details so _executeWithdrawal can read them
      let reason = `Auto-withdrawal of ${pendingEarnings.length} earnings records`;
      if (isCrypto && cryptoAddress) {
        reason += ` | dash_address:${cryptoAddress}`;
      }

      // Create withdrawal request
      const withdrawal = await WithdrawalModel.createWithdrawal({
        modelId,
        amountUsd: totalUsd,
        amountCop: totalCop,
        method,
        status: 'pending',
        reason,
      });

      logger.info('Withdrawal request created', {
        withdrawalId: withdrawal.id,
        modelId,
        amountUsd: totalUsd,
        earningsCount: pendingEarnings.length,
      });

      // Send email notifications (non-blocking — failures must not abort the request)
      const adminEmail = 'support@pnptv.app';
      const creatorEmail = user?.email;

      const adminHtml = `
        <h2>New Withdrawal Request — PNPtv</h2>
        <p>A creator has requested a payout. Please review and process manually.</p>
        <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
          <tr><td><strong>Withdrawal ID</strong></td><td>${emailService.escapeHtml(withdrawal.id)}</td></tr>
          <tr><td><strong>Creator ID</strong></td><td>${emailService.escapeHtml(String(modelId))}</td></tr>
          <tr><td><strong>Creator Email</strong></td><td>${emailService.escapeHtml(creatorEmail || 'N/A')}</td></tr>
          <tr><td><strong>Amount (USD)</strong></td><td>$${totalUsd.toFixed(2)}</td></tr>
          <tr><td><strong>Earnings Count</strong></td><td>${pendingEarnings.length}</td></tr>
          <tr><td><strong>Method</strong></td><td>${emailService.escapeHtml(method)}</td></tr>
          ${isCrypto && cryptoAddress ? `<tr><td><strong>Dash Address</strong></td><td>${emailService.escapeHtml(cryptoAddress)}</td></tr>` : ''}
          <tr><td><strong>Requested At</strong></td><td>${new Date().toISOString()}</td></tr>
        </table>
        <p style="margin-top:16px;color:#888;">Log into the PNPtv admin panel to approve or reject this request.</p>
      `;

      emailService.send({
        to: adminEmail,
        subject: `[PNPtv] New Withdrawal Request — $${totalUsd.toFixed(2)} (${method})`,
        html: adminHtml,
      }).catch(err => logger.error('Failed to send admin withdrawal request email:', err));

      if (creatorEmail && emailService.isEmailSafe(creatorEmail)) {
        const creatorHtml = `
          <h2>Your withdrawal request was received — PNPtv</h2>
          <p>Hi! We've received your payout request. Our team will review and process it shortly.</p>
          <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
            <tr><td><strong>Amount</strong></td><td>$${totalUsd.toFixed(2)} USD</td></tr>
            <tr><td><strong>Method</strong></td><td>${emailService.escapeHtml(method.replace('_', ' '))}</td></tr>
            <tr><td><strong>Status</strong></td><td>Pending Review</td></tr>
            <tr><td><strong>Reference</strong></td><td>${emailService.escapeHtml(withdrawal.id)}</td></tr>
          </table>
          <p style="margin-top:16px;">You'll receive another email once your payout has been processed. If you have questions, reply to this email or contact support@pnptv.app.</p>
          <p style="color:#888;font-size:12px;">PNPtv — pnptv.app</p>
        `;

        emailService.send({
          to: creatorEmail,
          subject: `[PNPtv] Payout request received — $${totalUsd.toFixed(2)}`,
          html: creatorHtml,
        }).catch(err => logger.error('Failed to send creator withdrawal confirmation email:', err));
      }

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
   * Execute actual withdrawal — sends admin alert email for manual processing.
   * All methods (bank_transfer, daimo, paypal, etc.) are processed manually by admin.
   * The admin is notified via email with all payout details; the creator is also notified.
   */
  static async _executeWithdrawal(withdrawal) {
    try {
      const userResult = await query(
        `SELECT email, payout_method FROM users WHERE id = $1`,
        [withdrawal.modelId]
      );

      const user = userResult.rows[0];
      if (!user) {
        throw new Error('User not found for withdrawal');
      }

      const adminEmail = 'support@pnptv.app';
      const creatorEmail = user.email;
      const method = withdrawal.method || 'bank_transfer';
      const amountUsd = parseFloat(withdrawal.amountUsd || 0).toFixed(2);
      const withdrawalId = withdrawal.id;
      const now = new Date().toISOString();

      // Extract crypto address embedded in reason field (set during requestWithdrawal).
      // Accept the legacy 'daimo_address:...' marker so any in-flight withdrawal request
      // created before this cutover still surfaces its address to the admin email.
      let cryptoAddress = null;
      if ((method === 'dash' || method === 'daimo') && withdrawal.reason) {
        const m = withdrawal.reason.match(/(?:dash_address|daimo_address):([^\s|]+)/);
        if (m) cryptoAddress = m[1];
      }

      // Build admin notification email
      const methodLabel = method === 'bank_transfer' ? 'Bank Transfer'
        : method === 'dash'   ? 'Dash (BTCPay)'
        : method === 'daimo'  ? 'Daimo USDC (LEGACY — drain only)'
        : method === 'paypal' ? 'PayPal'
        : method.replace(/_/g, ' ');

      const daimoRow = cryptoAddress
        ? `<tr><td style="padding:6px;color:#555;"><strong>Dash Address</strong></td><td style="padding:6px;">${emailService.escapeHtml(cryptoAddress)}</td></tr>`
        : '';

      const adminHtml = `
        <div style="font-family:sans-serif;font-size:14px;color:#222;max-width:600px;">
          <h2 style="color:#D4007A;">PNPtv — Creator Payout Processing Required</h2>
          <p>A withdrawal has been approved and is ready for manual processing. Please action this payment and then mark it as completed in the admin panel.</p>
          <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:16px 0;">
            <tr style="background:#f5f5f5;">
              <td style="padding:6px;color:#555;"><strong>Withdrawal ID</strong></td>
              <td style="padding:6px;">${emailService.escapeHtml(withdrawalId)}</td>
            </tr>
            <tr>
              <td style="padding:6px;color:#555;"><strong>Creator ID</strong></td>
              <td style="padding:6px;">${emailService.escapeHtml(String(withdrawal.modelId))}</td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:6px;color:#555;"><strong>Creator Email</strong></td>
              <td style="padding:6px;">${emailService.escapeHtml(creatorEmail || 'N/A')}</td>
            </tr>
            <tr>
              <td style="padding:6px;color:#555;"><strong>Amount (USD)</strong></td>
              <td style="padding:6px;font-weight:bold;color:#D4007A;">$${amountUsd}</td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:6px;color:#555;"><strong>Payment Method</strong></td>
              <td style="padding:6px;">${emailService.escapeHtml(methodLabel)}</td>
            </tr>
            ${daimoRow}
            <tr>
              <td style="padding:6px;color:#555;"><strong>Processing Time</strong></td>
              <td style="padding:6px;">${now}</td>
            </tr>
          </table>
          <p style="color:#888;font-size:12px;">
            After completing the transfer, update the withdrawal status to <strong>completed</strong> in the admin panel and enter the transaction reference.<br>
            Withdrawal ID: <code>${emailService.escapeHtml(withdrawalId)}</code>
          </p>
        </div>
      `;

      try {
        await emailService.send({
          to: adminEmail,
          subject: `[PNPtv] ACTION REQUIRED: Process payout $${amountUsd} via ${methodLabel} — ID ${withdrawalId}`,
          html: adminHtml,
        });
        logger.info('Admin withdrawal processing email sent', { withdrawalId, method });
      } catch (emailErr) {
        logger.error('Failed to send admin withdrawal processing email:', emailErr);
        // Do not fail the withdrawal — log and continue
      }

      // Notify creator that their payout is being processed
      if (creatorEmail && emailService.isEmailSafe(creatorEmail)) {
        const creatorHtml = `
          <div style="font-family:sans-serif;font-size:14px;color:#222;max-width:600px;">
            <h2 style="color:#D4007A;">Your PNPtv payout is being processed</h2>
            <p>Great news! Your withdrawal request has been approved and our team is now processing your payment.</p>
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:16px 0;">
              <tr style="background:#f5f5f5;">
                <td style="padding:6px;color:#555;"><strong>Amount</strong></td>
                <td style="padding:6px;font-weight:bold;">$${amountUsd} USD</td>
              </tr>
              <tr>
                <td style="padding:6px;color:#555;"><strong>Method</strong></td>
                <td style="padding:6px;">${emailService.escapeHtml(methodLabel)}</td>
              </tr>
              <tr style="background:#f5f5f5;">
                <td style="padding:6px;color:#555;"><strong>Reference</strong></td>
                <td style="padding:6px;"><code>${emailService.escapeHtml(withdrawalId)}</code></td>
              </tr>
            </table>
            <p>Payouts are typically completed within 1–3 business days. You'll receive a confirmation email once the funds have been sent.</p>
            <p style="color:#888;font-size:12px;">Questions? Reply to this email or reach us at support@pnptv.app</p>
          </div>
        `;

        emailService.send({
          to: creatorEmail,
          subject: `[PNPtv] Your payout of $${amountUsd} is being processed`,
          html: creatorHtml,
        }).catch(err => logger.error('Failed to send creator processing email:', err));
      }

      // Generate a PENDING transaction ID — admin will update with real transaction ID
      const transactionId = `PENDING-${withdrawalId.substring(0, 8).toUpperCase()}-${Date.now()}`;
      const externalReference = `awaiting-manual-processing:${method}`;

      return {
        success: true,
        transactionId,
        externalReference,
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
   * Process pending withdrawals — surveys the queue and reports counts.
   * SECURITY: Auto-approval was previously triggered after 1 hour with no admin
   * action; that behavior was removed because `_executeWithdrawal` mints a fake
   * `PENDING-<id>` transaction reference and flips status to `completed`,
   * making the row irrecoverable. Approval must now be an explicit admin action
   * via `approveWithdrawal`. This function is read-only and returns counts.
   */
  static async processPendingWithdrawals() {
    try {
      const pendingWithdrawals = await WithdrawalModel.getPendingWithdrawals(50);

      logger.info('Pending withdrawals queue surveyed (no auto-approval)', {
        count: pendingWithdrawals.length,
      });

      return {
        processed: 0,
        successful: 0,
        failed: 0,
        pendingCount: pendingWithdrawals.length,
        message: 'Auto-approval disabled — withdrawals require explicit admin approval',
      };
    } catch (error) {
      logger.error('Error surveying pending withdrawals:', error);
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
