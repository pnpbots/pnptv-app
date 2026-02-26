const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const EmailService = require('../../services/emailservice');
const UserModel = require('../../../models/userModel');
const PaymentModel = require('../../../models/paymentModel');
const SubscriberModel = require('../../../models/subscriberModel');
const PlanModel = require('../../../models/planModel');
const crypto = require('crypto');

/**
 * N8N Automation Controller
 * Handles n8n workflow API requests for:
 * - Payment recovery
 * - Email notifications
 * - System monitoring
 * - Health checks
 */
class N8nAutomationController {
  /**
   * Get failed payments for recovery
   */
  static async getFailedPayments(req, res) {
    try {
      const result = await query(`
        SELECT
          p.id,
          p.user_id,
          p.amount,
          p.status,
          p.created_at,
          p.reference as ref_payco,
          p.plan_id,
          u.email,
          u.first_name
        FROM payments p
        JOIN users u ON p.user_id = u.id
        WHERE p.status = 'pending'
          AND p.created_at > NOW() - INTERVAL '24 hours'
          AND p.created_at < NOW() - INTERVAL '10 minutes'
        ORDER BY p.created_at ASC
        LIMIT 50
      `);

      logger.info('N8N: Retrieved failed payments for recovery', { count: result.rows.length });

      return res.status(200).json({
        success: true,
        data: result.rows,
        count: result.rows.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('N8N: Error getting failed payments', {
        error: error.message,
        stack: error.stack
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Update payment recovery status
   */
  static async updatePaymentRecoveryStatus(req, res) {
    try {
      const { paymentId, status, result, errorMessage } = req.body;

      if (!paymentId || !status) {
        return res.status(400).json({
          success: false,
          error: 'paymentId and status required'
        });
      }

      const updateResult = await query(
        `UPDATE payments
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, paymentId]
      );

      // Log the recovery attempt
      await query(
        `INSERT INTO payment_recovery_log
         (payment_id, action, status, result, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        [paymentId, 'status_check', status, JSON.stringify(result || {}), errorMessage || null]
      );

      logger.info('N8N: Updated payment recovery status', { paymentId, status });

      return res.status(200).json({
        success: true,
        data: updateResult.rows[0],
        message: 'Payment status updated'
      });
    } catch (error) {
      logger.error('N8N: Error updating payment status', {
        error: error.message,
        paymentId: req.body.paymentId
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Log workflow execution
   */
  static async logWorkflowExecution(req, res) {
    try {
      const {
        workflowName,
        workflowId,
        status,
        executionTimeMs,
        itemsProcessed,
        itemsSuccess,
        itemsFailed,
        errorMessage,
        errorDetails
      } = req.body;

      if (!workflowName || !status) {
        return res.status(400).json({
          success: false,
          error: 'workflowName and status required'
        });
      }

      const result = await query(
        `INSERT INTO workflow_execution_logs
         (workflow_name, workflow_id, status, execution_time_ms, items_processed, items_success, items_failed, error_message, error_details, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [
          workflowName,
          workflowId || null,
          status,
          executionTimeMs || 0,
          itemsProcessed || 0,
          itemsSuccess || 0,
          itemsFailed || 0,
          errorMessage || null,
          JSON.stringify(errorDetails || {})
        ]
      );

      logger.info('N8N: Logged workflow execution', {
        workflowName,
        status,
        itemsProcessed,
        executionTimeMs
      });

      return res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Workflow execution logged'
      });
    } catch (error) {
      logger.error('N8N: Error logging workflow', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Check system health
   */
  static async checkSystemHealth(req, res) {
    try {
      const checks = {};
      const startTime = Date.now();

      // Check Database
      try {
        const dbStart = Date.now();
        await query('SELECT 1');
        checks.database = {
          status: 'healthy',
          responseTime: Date.now() - dbStart,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        checks.database = {
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }

      // Check Redis
      try {
        const { getRedis } = require('../../../config/redis');
        const redis = getRedis();
        const redisStart = Date.now();
        await redis.ping();
        checks.redis = {
          status: 'healthy',
          responseTime: Date.now() - redisStart,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        checks.redis = {
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }

      // Check Payment API (ePayco)
      checks.epayco = {
        status: process.env.EPAYCO_PUBLIC_KEY ? 'configured' : 'unconfigured',
        testMode: process.env.EPAYCO_TEST_MODE === 'true',
        timestamp: new Date().toISOString()
      };

      // Log health check
      const healthStatus = Object.values(checks).every(c =>
        c.status === 'healthy' || c.status === 'configured'
      ) ? 'healthy' : 'degraded';

      await query(
        `INSERT INTO system_health_checks
         (component, status, details)
         VALUES ($1, $2, $3)`,
        ['system', healthStatus, JSON.stringify(checks)]
      );

      const totalTime = Date.now() - startTime;

      logger.info('N8N: System health check completed', {
        overallStatus: healthStatus,
        executionTime: totalTime
      });

      return res.status(200).json({
        success: true,
        status: healthStatus,
        checks,
        executionTimeMs: totalTime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('N8N: Error checking system health', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get subscription expiry notifications to send
   */
  static async getExpiryNotifications(req, res) {
    try {
      const { daysAhead = 7 } = req.query;

      const result = await query(`
        SELECT
          s.id as subscriber_id,
          s.telegram_id,
          s.email,
          s.name as subscriber_name,
          s.plan as plan_name,
          s.updated_at as expires_at,
          s.status
        FROM subscribers s
        WHERE s.status = 'active'
        ORDER BY s.updated_at ASC
        LIMIT 100
      `);

      logger.info('N8N: Retrieved expiry notifications', {
        count: result.rows.length,
        daysAhead
      });

      return res.status(200).json({
        success: true,
        data: result.rows,
        count: result.rows.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('N8N: Error getting expiry notifications', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Log email notification
   */
  static async logEmailNotification(req, res) {
    try {
      const {
        recipientEmail,
        recipientUserId,
        notificationType,
        subject,
        status,
        errorMessage
      } = req.body;

      if (!recipientEmail || !notificationType) {
        return res.status(400).json({
          success: false,
          error: 'recipientEmail and notificationType required'
        });
      }

      const result = await query(
        `INSERT INTO email_notifications
         (recipient_email, recipient_user_id, notification_type, subject, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [recipientEmail, recipientUserId || null, notificationType, subject || null, status || 'pending', errorMessage || null]
      );

      logger.info('N8N: Logged email notification', {
        recipientEmail,
        notificationType,
        status
      });

      return res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Email notification logged'
      });
    } catch (error) {
      logger.error('N8N: Error logging email notification', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get recent error summary for admin alerts
   */
  static async getErrorSummary(req, res) {
    try {
      const { hours = 24 } = req.query;

      const result = await query(`
        SELECT
          workflow_name,
          COUNT(*) as failure_count,
          MAX(error_message) as latest_error
        FROM workflow_execution_logs
        WHERE status = 'failed'
          AND created_at > NOW() - INTERVAL '1 hour' * $1
        GROUP BY workflow_name
        ORDER BY failure_count DESC
        LIMIT 10
      `, [hours]);

      logger.info('N8N: Retrieved error summary', { hours, errorCount: result.rows.length });

      return res.status(200).json({
        success: true,
        data: result.rows,
        timeRange: `${hours} hours`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('N8N: Error getting error summary', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Send alert to admins
   */
  static async sendAdminAlert(req, res) {
    try {
      const {
        alertType,
        severity = 'info',
        title,
        message,
        details
      } = req.body;

      if (!alertType || !title) {
        return res.status(400).json({
          success: false,
          error: 'alertType and title required'
        });
      }

      const result = await query(
        `INSERT INTO admin_alerts
         (alert_type, severity, title, message, details)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [alertType, severity, title, message || null, JSON.stringify(details || {})]
      );

      // Send email to admins
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').filter(Boolean);
      if (adminIds.length > 0) {
        try {
          // Get admin emails from users table
          const adminEmails = await query(
            `SELECT email FROM users WHERE telegram_id = ANY($1)`,
            [adminIds.map(id => parseInt(id))]
          );

          for (const admin of adminEmails.rows) {
            EmailService.sendEmail({
              to: admin.email,
              subject: `[ALERT] ${severity.toUpperCase()} - ${title}`,
              html: `
                <h2>${title}</h2>
                <p><strong>Type:</strong> ${alertType}</p>
                <p><strong>Severity:</strong> ${severity}</p>
                <p><strong>Message:</strong> ${message}</p>
                <pre>${JSON.stringify(details, null, 2)}</pre>
              `
            }).catch(err => logger.error('Failed to send admin alert email', { error: err.message }));
          }
        } catch (error) {
          logger.error('Failed to send admin alerts', { error: error.message });
        }
      }

      logger.info('N8N: Admin alert sent', { alertType, severity });

      return res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Alert logged and admins notified'
      });
    } catch (error) {
      logger.error('N8N: Error sending admin alert', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get n8n dashboard metrics
   */
  static async getDashboardMetrics(req, res) {
    try {
      const result = await query(`
        SELECT
          'workflows' as metric,
          COUNT(*) as count,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          ROUND(AVG(execution_time_ms), 2) as avg_execution_time
        FROM workflow_execution_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        UNION ALL
        SELECT
          'emails' as metric,
          COUNT(*) as count,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          NULL as avg_execution_time
        FROM email_notifications
        WHERE created_at > NOW() - INTERVAL '24 hours'
        UNION ALL
        SELECT
          'payments' as metric,
          COUNT(*) as count,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          NULL as avg_execution_time
        FROM payment_recovery_log
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);

      logger.info('N8N: Retrieved dashboard metrics');

      return res.status(200).json({
        success: true,
        data: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('N8N: Error getting dashboard metrics', {
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = N8nAutomationController;
