const { getEpaycoClient } = require('../../../config/epayco');
const SubscriberModel = require('../../../models/subscriberModel');
const PlanModel = require('../../../models/planModel');
const UserModel = require('../../../models/userModel');
const CurrencyConverter = require('../../../utils/currencyConverter');
const logger = require('../../../utils/logger');
const PaymentService = require('../../services/paymentService');

/**
 * Subscription Controller - Handles ePayco subscription operations
 */
class SubscriptionController {
  /**
   * Get subscription plans with USD and COP prices
   * GET /api/subscription/plans
   */
  static async getPlans(req, res) {
    try {
      const plans = await PlanModel.getPublicPlans();

      // Add currency conversion for each plan
      const plansWithPrices = await Promise.all(
        plans.map(async (plan) => {
          const prices = await CurrencyConverter.getDisplayAmounts(plan.price, plan.currency);
          return {
            ...plan,
            priceUSD: prices.usd,
            priceCOP: prices.cop,
            exchangeRate: prices.rate,
          };
        }),
      );

      res.json({
        success: true,
        plans: plansWithPrices,
      });
    } catch (error) {
      logger.error('Error getting subscription plans:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get subscription plans',
      });
    }
  }

  /**
   * Create or get ePayco plan
   * POST /api/subscription/create-plan
   */
  static async createEpaycoPlan(req, res) {
    try {
      const { planId } = req.body;

      if (!planId) {
        return res.status(400).json({
          success: false,
          error: 'planId is required',
        });
      }

      // Get plan details from database
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        return res.status(404).json({
          success: false,
          error: 'Plan not found',
        });
      }

      // Convert price to COP if in USD
      let amountCOP = plan.price;
      if (plan.currency === 'USD') {
        amountCOP = await CurrencyConverter.usdToCop(plan.price);
      }

      const epayco = getEpaycoClient();

      // Create plan in ePayco
      const planInfo = {
        id_plan: `pnptv_${planId}`,
        name: plan.name,
        description: plan.description || `PNPtv ${plan.name} Plan`,
        amount: amountCOP,
        currency: 'cop',
        interval: 'month',
        interval_count: 1,
        trial_days: plan.trialDays || 0,
      };

      const epaycoResponse = await epayco.plans.create(planInfo);

      logger.info('ePayco plan created', { planId, epaycoPlanId: planInfo.id_plan });

      res.json({
        success: true,
        plan: epaycoResponse,
      });
    } catch (error) {
      logger.error('Error creating ePayco plan:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create plan',
      });
    }
  }

  /**
   * Create subscription checkout session
   * POST /api/subscription/create-checkout
   */
  static async createCheckout(req, res) {
    try {
      const {
        email, name, telegramId, planId, docNumber, docType = 'CC',
      } = req.body;

      // Sanitize and validate email
      const sanitizedEmail = (typeof email === 'string' ? email : '').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!sanitizedEmail || !name || !planId) {
        return res.status(400).json({
          success: false,
          error: 'email, name, and planId are required',
        });
      }

      if (!emailRegex.test(sanitizedEmail)) {
        return res.status(400).json({
          success: false,
          error: 'El formato del email no es válido.',
        });
      }

      // Get plan details
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        return res.status(404).json({
          success: false,
          error: 'Plan not found',
        });
      }

      // Convert price to COP
      let amountCOP = plan.price;
      let amountUSD = plan.price;
      if (plan.currency === 'USD') {
        amountCOP = await CurrencyConverter.usdToCop(plan.price);
      } else {
        amountUSD = await CurrencyConverter.copToUsd(plan.price);
      }

      const invoice = `INV-${Date.now()}`;
      const currencyCode = 'COP';
      const amountCOPString = String(amountCOP);
      const epaycoSignature = PaymentService.generateEpaycoCheckoutSignature({
        invoice,
        amount: amountCOPString,
        currencyCode,
      });

      // Create checkout data for frontend
      const baseUrl = process.env.BOT_WEBHOOK_DOMAIN || 'http://localhost:3000';
      if (process.env.NODE_ENV === 'production' && baseUrl.includes('localhost')) {
        return res.status(500).json({
          success: false,
          error: 'BOT_WEBHOOK_DOMAIN must be set to a public HTTPS domain in production.',
        });
      }

      if (process.env.NODE_ENV === 'production') {
        const missing = [];
        if (!process.env.EPAYCO_P_KEY && !process.env.EPAYCO_PRIVATE_KEY) missing.push('EPAYCO_P_KEY');
        if (!process.env.EPAYCO_P_CUST_ID && !process.env.EPAYCO_PUBLIC_KEY) missing.push('EPAYCO_P_CUST_ID');
        if (!process.env.EPAYCO_PUBLIC_KEY) missing.push('EPAYCO_PUBLIC_KEY');
        if (missing.length > 0) {
          return res.status(500).json({
            success: false,
            error: `Missing required ePayco configuration: ${missing.join(', ')}`,
          });
        }
      }

      if (!epaycoSignature) {
        return res.status(500).json({
          success: false,
          error: 'Unable to generate ePayco signature. Check ePayco configuration.',
        });
      }
      const checkoutData = {
        planId,
        planName: plan.name,
        description: `PNPtv ${plan.name} - ${plan.duration || 30} days`,
        amountUSD,
        amountCOP,
        currencyCode,
        invoice,
        epaycoSignature,
        email: sanitizedEmail,
        name,
        telegramId,
        docNumber: docNumber || '0000000',
        docType,
        publicKey: process.env.EPAYCO_PUBLIC_KEY,
        test: process.env.EPAYCO_TEST_MODE === 'true',
        confirmationUrl: `${baseUrl}/api/subscription/epayco/confirmation`,
        responseUrl: `${baseUrl}/api/subscription/payment-response`,
      };

      logger.info('Checkout session created', {
        email: sanitizedEmail,
        telegramId,
        planId,
        amountCOP,
        amountUSD,
      });

      res.json({
        success: true,
        checkout: checkoutData,
      });
    } catch (error) {
      logger.error('Error creating checkout session:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create checkout session',
      });
    }
  }

  /**
   * Handle ePayco confirmation webhook
   * POST /api/subscription/epayco/confirmation
   */
  static async handleEpaycoConfirmation(req, res) {
    try {
      logger.info('ePayco confirmation received', { body: req.body });

      const {
        x_ref_payco,
        x_transaction_id,
        x_transaction_state,
        x_amount,
        x_currency_code,
        x_signature,
        x_extra1, // email
        x_extra2, // telegramId
        x_extra3, // planId
      } = req.body;

      let signatureValid = false;
      try {
        signatureValid = PaymentService.verifyEpaycoSignature(req.body);
      } catch (error) {
        logger.error('ePayco signature verification error', {
          error: error.message,
          transactionId: x_ref_payco,
          signaturePresent: Boolean(x_signature),
        });
        return res.status(500).send('Signature verification error');
      }

      if (!signatureValid) {
        logger.error('Invalid ePayco signature', {
          transactionId: x_ref_payco,
          signaturePresent: Boolean(x_signature),
        });
        return res.status(400).send('Invalid signature');
      }

      if (x_transaction_state === 'Aceptada' || x_transaction_state === 'Aprobada') {
        // Payment successful
        const email = x_extra1;
        const telegramId = x_extra2;
        const planId = x_extra3;

        // Check if subscriber already exists
        let subscriber = await SubscriberModel.getByEmail(email);

        if (subscriber) {
          // Update existing subscriber
          await SubscriberModel.updateStatus(email, 'active', {
            lastPaymentAt: new Date(),
            subscriptionId: x_ref_payco,
          });
        } else {
          // Create new subscriber
          subscriber = await SubscriberModel.create({
            email,
            name: req.body.x_customer_name || 'Unknown',
            telegramId,
            plan: planId,
            subscriptionId: x_ref_payco,
            provider: 'epayco',
          });
        }

        // Update user subscription if telegramId is provided
        if (telegramId) {
          const plan = await PlanModel.getById(planId);
          if (plan) {
            const expiryDate = new Date();
            const durationDays = plan.duration_days || plan.duration || 30;
            expiryDate.setDate(expiryDate.getDate() + durationDays);

            await UserModel.updateSubscription(telegramId, {
              status: 'active',
              planId,
              expiry: expiryDate,
            });

            logger.info('User subscription activated', {
              telegramId,
              planId,
              expiryDate,
            });

            // Send PRIME confirmation with invite link
            const planName = plan.name || planId;
            await PaymentService.sendPrimeConfirmation(telegramId, planName, expiryDate, 'subscription-controller');
          }
        }

        logger.info('Subscription activated successfully', {
          email,
          telegramId,
          planId,
          transactionId: x_ref_payco,
        });
      } else if (x_transaction_state === 'Rechazada' || x_transaction_state === 'Fallida') {
        logger.warn('Payment rejected', {
          email: x_extra1,
          transactionId: x_ref_payco,
        });
      }

      // Always return 200 to ePayco
      res.status(200).send('OK');
    } catch (error) {
      logger.error('Error processing ePayco confirmation:', error);
      // Still return 200 to prevent retries
      res.status(200).send('OK');
    }
  }

  /**
   * Handle payment response page
   * GET /api/subscription/payment-response
   */
  static async handlePaymentResponse(req, res) {
    try {
      const { ref_payco, estado } = req.query;

      logger.info('Payment response page accessed', { ref_payco, estado });

      // Return a simple HTML page with the result
      const isSuccess = estado === 'Aceptada' || estado === 'Aprobada';

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isSuccess ? 'Payment Successful' : 'Payment Failed'} - PNPtv</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 500px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    .success { color: #4CAF50; }
    .error { color: #f44336; }
    h1 {
      color: #333;
      margin-bottom: 10px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
    .ref {
      background: #f5f5f5;
      padding: 10px;
      border-radius: 5px;
      margin-top: 20px;
      font-family: monospace;
      font-size: 12px;
      color: #333;
    }
    .button {
      display: inline-block;
      margin-top: 20px;
      padding: 12px 30px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      transition: background 0.3s;
    }
    .button:hover {
      background: #5568d3;
    }
  </style>
</head>
<body>
  <div class="container">
    ${isSuccess ? `
      <div class="icon success">✓</div>
      <h1>Payment Successful!</h1>
      <p>Thank you for subscribing to PNPtv. Your subscription is now active.</p>
      <p>You can now access all premium content and features.</p>
    ` : `
      <div class="icon error">✗</div>
      <h1>Payment Failed</h1>
      <p>We couldn't process your payment. Please try again or contact support.</p>
    `}
    ${ref_payco ? `<div class="ref">Reference: ${ref_payco}</div>` : ''}
    <a href="/" class="button">Return to PNPtv</a>
  </div>
  <script>
    // Close window after 5 seconds if opened as popup
    if (window.opener) {
      setTimeout(() => {
        window.close();
      }, 5000);
    }
  </script>
</body>
</html>
      `;

      res.send(html);
    } catch (error) {
      logger.error('Error handling payment response:', error);
      res.status(500).send('Error processing payment response');
    }
  }

  /**
   * Get subscriber information
   * GET /api/subscription/subscriber/:identifier
   */
  static async getSubscriber(req, res) {
    try {
      const { identifier } = req.params;
      const { type = 'email' } = req.query;

      let subscriber;

      if (type === 'telegram') {
        subscriber = await SubscriberModel.getByTelegramId(identifier);
      } else {
        subscriber = await SubscriberModel.getByEmail(identifier);
      }

      if (!subscriber) {
        return res.status(404).json({
          success: false,
          error: 'Subscriber not found',
        });
      }

      res.json({
        success: true,
        subscriber,
      });
    } catch (error) {
      logger.error('Error getting subscriber:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get subscriber',
      });
    }
  }

  /**
   * Get subscription statistics
   * GET /api/subscription/stats
   */
  static async getStatistics(req, res) {
    try {
      const stats = await SubscriberModel.getStatistics();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      logger.error('Error getting subscription statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get statistics',
      });
    }
  }
}

module.exports = SubscriptionController;
