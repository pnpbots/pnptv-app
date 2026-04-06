const VisaCybersourceService = require('../../services/visaCybersourceService');
const logger = require('../../utils/logger');

/**
 * Visa Cybersource Webhook Controller
 * Handles incoming webhook notifications from Visa Cybersource
 */
class VisaCybersourceWebhookController {
  /**
   * Handle Visa Cybersource webhook POST request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async handleWebhook(req, res) {
    try {
      const { body, headers } = req;
      // v-c-signature is the canonical Cybersource webhook header name.
      // x-signature is kept as a fallback for legacy/test environments.
      const signature = headers['v-c-signature'] || headers['x-signature'];

      if (!signature) {
        logger.warn('Visa Cybersource webhook: Missing signature header');
        return res.status(400).json({
          success: false,
          error: 'Missing signature header',
        });
      }

      // Process the webhook — pass rawBody so HMAC is computed against the exact bytes
      // received, not a re-serialized JSON string (key ordering / whitespace differ).
      const rawBody = req.rawBody || null;
      const result = await VisaCybersourceService.handleWebhook(body, signature, rawBody);

      if (result.success) {
        logger.info('Visa Cybersource webhook processed successfully', {
          eventType: body.eventType,
          subscriptionId: body.data?.subscriptionId,
        });
        return res.status(200).json({
          success: true,
          message: 'Webhook processed successfully',
        });
      } else {
        logger.error('Visa Cybersource webhook processing failed', {
          error: result.error,
          eventType: body.eventType,
        });
        return res.status(400).json({
          success: false,
          error: result.error || 'Webhook processing failed',
        });
      }
    } catch (error) {
      logger.error('Visa Cybersource webhook error:', {
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }

  /**
   * Health check endpoint for Visa Cybersource webhook
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async healthCheck(req, res) {
    try {
      // Check if Visa Cybersource is configured
      const config = require('../../config/payment.config').visaCybersource;

      if (!config.merchantId || !config.apiKey) {
        return res.status(500).json({
          success: false,
          error: 'Visa Cybersource not configured',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Visa Cybersource webhook is healthy',
        supportedPlans: config.supportedPlans,
        recurringPayment: config.recurringPayment,
      });
    } catch (error) {
      logger.error('Visa Cybersource health check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Health check failed',
      });
    }
  }
}

module.exports = VisaCybersourceWebhookController;