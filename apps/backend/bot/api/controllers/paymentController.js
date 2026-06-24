const PaymentModel = require('../../../models/paymentModel');
const PlanModel = require('../../../models/planModel');
const ConfirmationTokenService = require('../../../services/confirmationTokenService');
const logger = require('../../../utils/logger');

/**
 * Payment Controller - Handles payment-related API endpoints
 */
class PaymentController {
  /**
   * Verify and consume payment confirmation token
   * GET /api/confirm-payment/:token
   */
  static async confirmPaymentToken(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Confirmation token is required',
        });
      }

      // Verify the token
      const tokenData = await ConfirmationTokenService.verifyToken(token);

      if (!tokenData) {
        logger.warn('Invalid or expired confirmation token used', { tokenPrefix: token.substring(0, 8) + '...' });
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired confirmation link. Please use a valid link from your payment receipt.',
        });
      }

      // Consume the token (mark as used)
      const consumed = await ConfirmationTokenService.consumeToken(token);

      if (!consumed) {
        logger.warn('Failed to consume confirmation token', { tokenPrefix: token.substring(0, 8) + '...' });
        return res.status(400).json({
          success: false,
          error: 'This confirmation link has already been used.',
        });
      }

      // Get plan details (always present); payment row is optional (nullable FK)
      const plan = await PlanModel.getById(tokenData.plan_id);

      if (!plan) {
        logger.error('Plan not found after token verification', {
          planId: tokenData.plan_id,
        });
        return res.status(404).json({
          success: false,
          error: 'Plan information not found.',
        });
      }

      const payment = tokenData.payment_id ? await PaymentModel.getById(tokenData.payment_id) : null;

      logger.info('Payment confirmation token verified', {
        paymentId: tokenData.payment_id,
        userId: tokenData.user_id,
        provider: tokenData.provider,
      });

      res.json({
        success: true,
        message: 'Payment confirmed successfully',
        payment: payment
          ? { id: payment.id, status: payment.status, amount: payment.amount, provider: tokenData.provider }
          : { provider: tokenData.provider },
        plan: {
          id: plan.id,
          name: plan.display_name || plan.name,
          description: plan.description,
        },
      });
    } catch (error) {
      logger.error('Error confirming payment token:', {
        error: error.message,
        stack: error.stack,
        token: req.params.token?.substring(0, 8) + '...',
      });

      res.status(500).json({
        success: false,
        error: 'Error processing confirmation. Please try again or contact support.',
      });
    }
  }
}

module.exports = PaymentController;
