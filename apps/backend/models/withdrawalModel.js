const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const TABLE_WITHDRAWALS = 'withdrawals';
const TABLE_AUDIT_LOG = 'withdrawal_audit_log';

class WithdrawalModel {
  /**
   * Format withdrawal row
   */
  static _formatWithdrawal(row) {
    if (!row) return null;
    return {
      id: row.id,
      modelId: row.model_id,
      amountUsd: parseFloat(row.amount_usd),
      amountCop: parseFloat(row.amount_cop),
      method: row.method,
      status: row.status,
      reason: row.reason,
      responseCode: row.response_code,
      responseMessage: row.response_message,
      transactionId: row.transaction_id,
      externalReference: row.external_reference,
      requestedAt: row.requested_at,
      approvedAt: row.approved_at,
      processedAt: row.processed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create withdrawal request
   */
  static async createWithdrawal(withdrawalData) {
    try {
      const id = uuidv4();
      const timestamp = new Date();

      await query('BEGIN');

      try {
        // Create withdrawal record
        const result = await query(
          `INSERT INTO ${TABLE_WITHDRAWALS} (id, model_id, amount_usd, amount_cop, method, status, reason, requested_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            id,
            withdrawalData.modelId,
            withdrawalData.amountUsd,
            withdrawalData.amountCop,
            withdrawalData.method,
            withdrawalData.status || 'pending',
            withdrawalData.reason || null,
            timestamp,
            timestamp,
            timestamp,
          ]
        );

        // Log the creation
        await query(
          `INSERT INTO ${TABLE_AUDIT_LOG} (id, withdrawal_id, action, new_status, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            uuidv4(),
            id,
            'created',
            withdrawalData.status || 'pending',
            timestamp,
          ]
        );

        await query('COMMIT');

        logger.info('Withdrawal created', {
          id,
          modelId: withdrawalData.modelId,
          amountUsd: withdrawalData.amountUsd,
        });

        return this._formatWithdrawal(result.rows[0]);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error creating withdrawal:', error);
      throw error;
    }
  }

  /**
   * Get withdrawal by ID
   */
  static async getWithdrawalById(withdrawalId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_WITHDRAWALS} WHERE id = $1`,
        [withdrawalId]
      );

      return this._formatWithdrawal(result.rows[0]);
    } catch (error) {
      logger.error('Error getting withdrawal by id:', error);
      throw error;
    }
  }

  /**
   * Get all withdrawals for model
   */
  static async getWithdrawalsByModel(modelId, status = null) {
    try {
      let query_str = `SELECT * FROM ${TABLE_WITHDRAWALS} WHERE model_id = $1`;
      const values = [modelId];

      if (status) {
        query_str += ` AND status = $2`;
        values.push(status);
      }

      query_str += ` ORDER BY requested_at DESC`;

      const result = await query(query_str, values);

      return result.rows.map(row => this._formatWithdrawal(row));
    } catch (error) {
      logger.error('Error getting withdrawals by model:', error);
      throw error;
    }
  }

  /**
   * Update withdrawal status
   */
  static async updateWithdrawalStatus(withdrawalId, newStatus, details = {}) {
    try {
      const timestamp = new Date();

      await query('BEGIN');

      try {
        // Get current withdrawal for old status
        const currentResult = await query(
          `SELECT status FROM ${TABLE_WITHDRAWALS} WHERE id = $1`,
          [withdrawalId]
        );

        const oldStatus = currentResult.rows[0]?.status;

        // Update withdrawal
        const updateQuery = {
          'approved': `status = $2, approved_at = $3`,
          'processing': `status = $2, approved_at = COALESCE(approved_at, NOW())`,
          'completed': `status = $2, processed_at = $3, approved_at = COALESCE(approved_at, NOW())`,
          'failed': `status = $2, approved_at = COALESCE(approved_at, NOW())`,
          'cancelled': `status = $2`,
        };

        const updateClause = updateQuery[newStatus] || `status = $2`;

        const result = await query(
          `UPDATE ${TABLE_WITHDRAWALS}
           SET ${updateClause}, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          newStatus === 'completed' ? [withdrawalId, newStatus, timestamp] : [withdrawalId, newStatus]
        );

        // Update with additional details if provided
        if (Object.keys(details).length > 0) {
          const detailUpdates = [];
          const detailValues = [withdrawalId];
          let paramIndex = 2;

          Object.entries(details).forEach(([key, value]) => {
            const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            detailUpdates.push(`${column} = $${paramIndex}`);
            detailValues.push(value);
            paramIndex++;
          });

          if (detailUpdates.length > 0) {
            await query(
              `UPDATE ${TABLE_WITHDRAWALS}
               SET ${detailUpdates.join(', ')}, updated_at = NOW()
               WHERE id = $1`,
              detailValues
            );
          }
        }

        // Log the status change
        await query(
          `INSERT INTO ${TABLE_AUDIT_LOG} (id, withdrawal_id, action, old_status, new_status, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uuidv4(),
            withdrawalId,
            'status_updated',
            oldStatus,
            newStatus,
            details.reason || null,
            timestamp,
          ]
        );

        await query('COMMIT');

        logger.info('Withdrawal status updated', {
          withdrawalId,
          oldStatus,
          newStatus,
        });

        return this._formatWithdrawal(result.rows[0]);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    } catch (error) {
      logger.error('Error updating withdrawal status:', error);
      throw error;
    }
  }

  /**
   * Get all pending withdrawals
   */
  static async getPendingWithdrawals(limit = 50) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_WITHDRAWALS}
         WHERE status = 'pending'
         ORDER BY requested_at ASC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map(row => this._formatWithdrawal(row));
    } catch (error) {
      logger.error('Error getting pending withdrawals:', error);
      throw error;
    }
  }

  /**
   * Get withdrawal audit log
   */
  static async getAuditLog(withdrawalId) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE_AUDIT_LOG}
         WHERE withdrawal_id = $1
         ORDER BY created_at ASC`,
        [withdrawalId]
      );

      return result.rows.map(row => ({
        id: row.id,
        withdrawalId: row.withdrawal_id,
        action: row.action,
        oldStatus: row.old_status,
        newStatus: row.new_status,
        adminId: row.admin_id,
        notes: row.notes,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error('Error getting audit log:', error);
      throw error;
    }
  }

  /**
   * Add audit log entry
   */
  static async addAuditLogEntry(withdrawalId, action, adminId = null, notes = null) {
    try {
      await query(
        `INSERT INTO ${TABLE_AUDIT_LOG} (id, withdrawal_id, action, admin_id, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          withdrawalId,
          action,
          adminId || null,
          notes || null,
          new Date(),
        ]
      );

      logger.info('Audit log entry added', {
        withdrawalId,
        action,
      });
    } catch (error) {
      logger.error('Error adding audit log entry:', error);
      throw error;
    }
  }

  /**
   * Get withdrawal statistics
   */
  static async getWithdrawalStats(modelId) {
    try {
      const result = await query(
        `SELECT
           COUNT(*) as total_withdrawals,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
           COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
           SUM(CASE WHEN status = 'completed' THEN amount_usd ELSE 0 END) as total_completed_usd,
           SUM(CASE WHEN status = 'pending' THEN amount_usd ELSE 0 END) as total_pending_usd,
           SUM(CASE WHEN status = 'completed' THEN amount_cop ELSE 0 END) as total_completed_cop,
           SUM(CASE WHEN status = 'pending' THEN amount_cop ELSE 0 END) as total_pending_cop
         FROM ${TABLE_WITHDRAWALS}
         WHERE model_id = $1`,
        [modelId]
      );

      const row = result.rows[0];
      return {
        totalWithdrawals: parseInt(row.total_withdrawals) || 0,
        completedCount: parseInt(row.completed_count) || 0,
        pendingCount: parseInt(row.pending_count) || 0,
        failedCount: parseInt(row.failed_count) || 0,
        totalCompletedUsd: parseFloat(row.total_completed_usd) || 0,
        totalPendingUsd: parseFloat(row.total_pending_usd) || 0,
        totalCompletedCop: parseFloat(row.total_completed_cop) || 0,
        totalPendingCop: parseFloat(row.total_pending_cop) || 0,
      };
    } catch (error) {
      logger.error('Error getting withdrawal stats:', error);
      throw error;
    }
  }

  /**
   * Mark withdrawal as processing
   */
  static async markAsProcessing(withdrawalId) {
    return this.updateWithdrawalStatus(withdrawalId, 'processing');
  }

  /**
   * Mark withdrawal as completed
   */
  static async markAsCompleted(withdrawalId, transactionId, externalReference = null) {
    return this.updateWithdrawalStatus(withdrawalId, 'completed', {
      transactionId,
      externalReference,
    });
  }

  /**
   * Mark withdrawal as failed
   */
  static async markAsFailed(withdrawalId, reason = null, responseMessage = null) {
    return this.updateWithdrawalStatus(withdrawalId, 'failed', {
      reason,
      responseMessage,
    });
  }
}

module.exports = WithdrawalModel;
