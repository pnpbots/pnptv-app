const crypto = require('crypto');
const geoip = require('geoip-lite');
const PaymentModel = require('../../../models/paymentModel');
const PlanModel = require('../../../models/planModel');
const ConfirmationTokenService = require('../../../services/confirmationTokenService');
const PaymentService = require('../../../services/paymentService');
const { getEpaycoCopRate } = require('../../../services/paymentService');
const PaymentSecurityService = require('../../../services/paymentSecurityService');
const FraudDetectionService = require('../../../services/fraudDetectionService');
const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const { cache } = require('../../../config/redis');
const NotificationEmitter = require('../../../services/notificationEmitter');
const InvoiceService = require('../../../services/invoiceservice');
const EmailService = require('../../../services/emailservice');
const PaymentNotificationService = require('../../../services/paymentNotificationService');
const BusinessNotificationService = require('../../../services/businessNotificationService');
const { ensureEmailCredentials } = require('../../../services/userService');

/**
 * Maps vague ePayco tokenization error messages to user-friendly Spanish strings.
 * @param {string|null} rawMsg - raw message from ePayco API or SDK
 * @returns {string}
 */
function mapEpaycoTokenError(rawMsg) {
  const m = (rawMsg || '').toLowerCase();
  if (m.includes('validando datos') || m.includes('datos inval'))
    return 'Los datos de la tarjeta no son válidos. Verifica el número, fecha de vencimiento y CVV.';
  if (m.includes('numero') || m.includes('número') || m.includes('card number'))
    return 'Número de tarjeta inválido.';
  if (m.includes('cvv') || m.includes('cvc') || m.includes('security'))
    return 'El CVV/CVC no es válido.';
  if (m.includes('expir') || m.includes('vencimiento') || m.includes('fecha'))
    return 'La fecha de vencimiento no es válida.';
  if (m.includes('fondos') || m.includes('funds') || m.includes('insufficient'))
    return 'Fondos insuficientes. Intenta con otra tarjeta.';
  return rawMsg || 'No se pudo tokenizar la tarjeta. Verifica los datos e intenta de nuevo.';
}

/**
 * Payment Controller - Handles payment-related API endpoints
 */
class PaymentController {
  static EPAYCO_3DS_PENDING_TIMEOUT_MINUTES = Number(process.env.EPAYCO_3DS_PENDING_TIMEOUT_MINUTES || 20);

  static EPAYCO_3DS_AUTHENTICATED_PENDING_TIMEOUT_MINUTES = Number(
    process.env.EPAYCO_3DS_AUTHENTICATED_PENDING_TIMEOUT_MINUTES || 3
  );

  /**
   * Get userId from payment record for audit logging
   * @param {string} paymentId - Payment ID
   * @returns {Promise<string|null>} User ID or null if not found
   */
  static async getUserIdFromPayment(paymentId) {
    try {
      if (!paymentId) return null;
      const payment = await PaymentModel.getById(paymentId);
      return payment?.userId || payment?.user_id || null;
    } catch (error) {
      logger.error('Failed to get userId from payment', {
        paymentId,
        error: error.message
      });
      return null;
    }
  }

  static isInternalPaymentReference(value) {
    if (!value) return false;
    const ref = String(value).trim();
    return /^PAY-/i.test(ref) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  }

  /**
   * Resolve ePayco reference from different persisted fields.
   * Some flows store it in `reference` / `transactionId` instead of `epayco_ref`.
   */
  static resolveEpaycoRef(payment) {
    if (!payment) return null;
    const candidates = [
      payment.metadata?.epayco_ref,
      payment.epayco_ref,
      payment.epaycoRef,
      payment.metadata?.reference,
      payment.transactionId,
      payment.transaction_id,
      payment.reference,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const value = String(candidate).trim();
      if (!value) continue;
      if (PaymentController.isInternalPaymentReference(value)) continue;
      return value;
    }

    return null;
  }

  static async resolveEpaycoRefFromDb(paymentId) {
    try {
      if (!paymentId) return null;
      const result = await query(
        `SELECT reference, transaction_id, metadata
         FROM payments
         WHERE id = $1::uuid`,
        [paymentId]
      );
      const row = result?.rows?.[0];
      if (!row) return null;

      const metadata = row.metadata || {};
      const candidates = [
        metadata.epayco_ref,
        metadata.reference,
        row.reference,
        row.transaction_id,
      ];

      for (const candidate of candidates) {
        if (!candidate) continue;
        const value = String(candidate).trim();
        if (!value) continue;
        if (PaymentController.isInternalPaymentReference(value)) continue;
        return value;
      }
      return null;
    } catch (error) {
      logger.error('Error resolving ePayco reference from DB', {
        error: error.message,
        paymentId,
      });
      return null;
    }
  }

  /**
   * Get payment information for checkout page
   * GET /api/payment/:paymentId
   */
  static async getPaymentInfo(req, res) {
    try {
      const { paymentId } = req.params;

      if (!paymentId) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required',
        });
      }

      // Get payment from database
      const payment = await PaymentModel.getById(paymentId);

      if (!payment) {
        logger.warn('Payment not found', { paymentId });
        return res.status(404).json({
          success: false,
          error: 'Pago no encontrado. Por favor, genera un nuevo enlace desde el bot.',
        });
      }

      // Ownership check — only enforce when a session exists.
      // The UUID itself is the capability (128-bit random); users arriving via
      // a direct link from Telegram or pay.codigosdemujeres.com have no session.
      const sessionUserId = String(req.session?.user?.id || req.session?.userId || '');
      if (sessionUserId) {
        const paymentOwner = String(payment.userId || payment.user_id || '');
        if (sessionUserId !== paymentOwner) {
          logger.warn('getPaymentInfo ownership check failed', { paymentId, sessionUserId, paymentOwner });
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      // Check if payment is still pending
      if (payment.status !== 'pending') {
        logger.warn('Payment already processed', { paymentId, status: payment.status });
        return res.status(400).json({
          success: false,
          error: payment.status === 'completed'
            ? 'Este pago ya fue completado.'
            : 'Este pago ya fue procesado.',
        });
      }

      // Get plan information (handle both camelCase and snake_case from payment)
      const planId = payment.planId || payment.plan_id;
      const paymentType = payment.metadata?.type;

      // Token purchases do not have a plan — handle them separately
      if (paymentType === 'token_purchase') {
        const tokenAmount = payment.metadata?.tokensAmount || 0;
        const paymentAmountUsd = parseFloat(payment.amount) || payment.metadata?.usdAmount || 0;
        // PNPtv displays prices in USD to international users but settles via ePayco's
        // Colombian acquiring network in COP. The rate is fetched daily from a public
        // FX API (see services/paymentService.js getEpaycoCopRate). Do not hardcode a fallback — fail closed instead.
        let copRate;
        try {
          copRate = await getEpaycoCopRate();
        } catch (fxErr) {
          logger.error('[ePayco FX] Rate unavailable for token purchase checkout', { error: fxErr.message, paymentId });
          return res.status(503).json({
            success: false,
            error: 'FX rate unavailable, please retry in a few minutes',
            code: 'FX_RATE_UNAVAILABLE',
          });
        }
        const priceInCOP = Math.round(paymentAmountUsd * copRate);
        const amountCOPString = String(priceInCOP);
        const currencyCode = 'COP';
        const actualPaymentId = payment.id || payment.paymentId;
        const paymentRef = `TOK-${actualPaymentId.substring(0, 8).toUpperCase()}`;
        const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
        const epaycoWebhookDomain = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://pnptv.app';
        const provider = payment.provider || 'epayco';
        const userId = payment.userId || payment.user_id;

        const tokenPaymentData = {
          paymentId: actualPaymentId,
          paymentRef,
          userId,
          // Must be 'token_purchase' (not null) so ePayco sends x_extra2='token_purchase'
          // back in the webhook, allowing the webhook handler to credit tokens correctly.
          planId: 'token_purchase',
          provider,
          status: payment.status,
          amountUSD: Number(paymentAmountUsd),
          amountCOP: priceInCOP,
          currencyCode,
          isPromo: false,
          originalPrice: null,
          discountAmount: null,
          promoCode: null,
          plan: {
            id: payment.metadata?.packageId || 'tokens',
            sku: 'TOKENS',
            name: `${tokenAmount} PNP Tokens`,
            description: `${tokenAmount} PNP Tokens — $${paymentAmountUsd} USD`,
            icon: '🪙',
            duration: null,
            features: [`${tokenAmount} tokens added to your wallet`, 'Use for tips and live streams'],
          },
        };

        if (provider === 'epayco') {
          tokenPaymentData.epaycoPublicKey = process.env.EPAYCO_PUBLIC_KEY;
          tokenPaymentData.testMode = process.env.EPAYCO_TEST_MODE === 'true';
          tokenPaymentData.confirmationUrl = `${epaycoWebhookDomain}/api/webhooks/epayco`;
          tokenPaymentData.responseUrl = `${webhookDomain}/api/payment-response`;
          tokenPaymentData.epaycoSignature = PaymentService.generateEpaycoCheckoutSignature({
            invoice: paymentRef,
            amount: amountCOPString,
            currencyCode,
          });
          // Persist expected webhook values for strict amount/currency validation
          try {
            if (
              payment.metadata?.expected_epayco_amount !== amountCOPString
              || payment.metadata?.expected_epayco_currency !== currencyCode
            ) {
              await PaymentModel.updateStatus(actualPaymentId, payment.status, {
                expected_epayco_amount: amountCOPString,
                expected_epayco_currency: currencyCode,
              });
            }
          } catch (metaError) {
            logger.error('Failed to persist expected ePayco webhook amount/currency for token purchase (non-critical)', {
              paymentId: actualPaymentId,
              error: metaError.message,
            });
          }
          if (!tokenPaymentData.epaycoSignature) {
            return res.status(500).json({ success: false, error: 'Error de configuración del pago.' });
          }
        }

        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
        const geo = geoip.lookup(clientIp);
        tokenPaymentData.showDocFields = geo?.country === 'CO';

        logger.info('Token purchase payment info retrieved', { paymentId, userId, tokenAmount });
        return res.json({ success: true, payment: tokenPaymentData });
      }

      // Call package purchases — plan_id is null, metadata.type = 'call_package'
      if (paymentType === 'call_package') {
        const pkgRes = await query('SELECT * FROM call_packages WHERE id = $1', [payment.metadata?.packageId]);
        const pkg = pkgRes.rows[0];
        if (!pkg) {
          logger.error('Call package not found for payment', { paymentId, packageId: payment.metadata?.packageId });
          return res.status(404).json({ success: false, error: 'Call package not found.' });
        }

        let copRate;
        try {
          copRate = await getEpaycoCopRate();
        } catch (fxErr) {
          logger.error('[ePayco FX] Rate unavailable for call package checkout', { error: fxErr.message, paymentId });
          return res.status(503).json({
            success: false,
            error: 'FX rate unavailable, please retry in a few minutes',
            code: 'FX_RATE_UNAVAILABLE',
          });
        }

        const paymentAmountUsd = parseFloat(payment.amount);
        const priceInCOP = Math.round(paymentAmountUsd * copRate);
        const amountCOPString = String(priceInCOP);
        const currencyCode = 'COP';
        const actualPaymentId = payment.id;
        // Use CALL- prefix so ePayco bill field is unique vs subscription PAY- refs
        const paymentRef = `CALL-${actualPaymentId.substring(0, 8).toUpperCase()}`;
        const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
        const epaycoWebhookDomain = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://pnptv.app';
        const provider = payment.provider || 'epayco';
        const userId = payment.userId || payment.user_id;

        const callPaymentData = {
          paymentId: actualPaymentId,
          paymentRef,
          userId,
          // Must be 'call_package' (not null) so ePayco sends x_extra2='call_package'
          // back in the webhook, routing the completion to onCallPaymentSuccess.
          planId: 'call_package',
          provider,
          status: payment.status,
          amountUSD: paymentAmountUsd,
          amountCOP: priceInCOP,
          currencyCode,
          isPromo: false,
          originalPrice: null,
          discountAmount: null,
          promoCode: null,
          plan: {
            id: `call_package_${pkg.id}`,
            sku: pkg.sku,
            name: `${pkg.duration_minutes}-min Private Call`,
            description: `${pkg.duration_minutes}-min private video call — PNPtv`,
            icon: '📞',
            duration: null,
            features: [`${pkg.duration_minutes}-min private video call`],
          },
        };

        if (provider === 'epayco') {
          callPaymentData.epaycoPublicKey = process.env.EPAYCO_PUBLIC_KEY;
          callPaymentData.testMode = process.env.EPAYCO_TEST_MODE === 'true';
          callPaymentData.confirmationUrl = `${epaycoWebhookDomain}/api/webhooks/epayco`;
          callPaymentData.responseUrl = `${webhookDomain}/api/payment-response`;
          callPaymentData.epaycoSignature = PaymentService.generateEpaycoCheckoutSignature({
            invoice: paymentRef,
            amount: amountCOPString,
            currencyCode,
          });
          try {
            if (
              payment.metadata?.expected_epayco_amount !== amountCOPString
              || payment.metadata?.expected_epayco_currency !== currencyCode
            ) {
              await PaymentModel.updateStatus(actualPaymentId, payment.status, {
                expected_epayco_amount: amountCOPString,
                expected_epayco_currency: currencyCode,
              });
            }
          } catch (metaError) {
            logger.error('Failed to persist expected ePayco webhook amount/currency for call package (non-critical)', {
              paymentId: actualPaymentId,
              error: metaError.message,
            });
          }
          if (!callPaymentData.epaycoSignature) {
            return res.status(500).json({ success: false, error: 'Error de configuración del pago.' });
          }
        }

        const clientIpCall = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
        const geoCall = geoip.lookup(clientIpCall);
        callPaymentData.showDocFields = geoCall?.country === 'CO';

        logger.info('Call package payment info retrieved', { paymentId, userId, packageId: pkg.id, duration: pkg.duration_minutes });
        return res.json({ success: true, payment: callPaymentData });
      }

      const plan = await PlanModel.getById(planId);

      if (!plan) {
        logger.error('Plan not found for payment', { paymentId, planId: payment.planId });
        return res.status(404).json({
          success: false,
          error: 'Plan no encontrado.',
        });
      }

      // Use payment amount if available (for promos), otherwise use plan price
      const paymentAmount = payment.amount || parseFloat(plan.price);
      const isPromo = payment.metadata?.promoId ? true : false;

      // PNPtv displays prices in USD to international users but settles via ePayco's
      // Colombian acquiring network in COP. The rate is fetched daily from a public
      // FX API (see services/paymentService.js getEpaycoCopRate). Do not hardcode a fallback — fail closed instead.
      let copRate;
      try {
        copRate = await getEpaycoCopRate();
      } catch (fxErr) {
        logger.error('[ePayco FX] Rate unavailable for plan payment checkout', { error: fxErr.message, paymentId });
        return res.status(503).json({
          success: false,
          error: 'FX rate unavailable, please retry in a few minutes',
          code: 'FX_RATE_UNAVAILABLE',
        });
      }
      const priceInCOP = Math.round(paymentAmount * copRate);
      const amountCOPString = String(priceInCOP);
      const currencyCode = 'COP';

      // Create payment reference
      const actualPaymentId = payment.id || payment.paymentId;
      if (!actualPaymentId) {
        logger.error('Payment ID is missing from payment object', { payment });
        return res.status(500).json({
          success: false,
          error: 'Error de configuración del pago. Por favor, genera un nuevo enlace desde el bot.',
        });
      }
      const paymentRef = `PAY-${actualPaymentId.substring(0, 8).toUpperCase()}`;

      // Prepare response data
      const webhookDomain = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';
      const epaycoWebhookDomain = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://pnptv.app';
      const provider = payment.provider || 'epayco';

      // Handle both camelCase and snake_case from payment
      const userId = payment.userId || payment.user_id;

      // Build response based on provider type
      const basePaymentData = {
        paymentId: payment.id,
        paymentRef,
        userId,
        planId,
        provider,
        status: payment.status,
        amountUSD: Number(paymentAmount),
        amountCOP: priceInCOP,
        currencyCode,
        isPromo,
        originalPrice: isPromo ? parseFloat(plan.price) : null,
        discountAmount: isPromo ? (parseFloat(plan.price) - paymentAmount) : null,
        promoCode: payment.metadata?.promoCode || null,
        plan: {
          id: plan.id,
          sku: plan.sku || '030PASS',
          name: plan.display_name || plan.name,
          description: isPromo
            ? `Promo ${payment.metadata?.promoCode || ''} - ${plan.display_name || plan.name}`
            : `${plan.display_name || plan.name} Subscription`,
          icon: plan.icon || '💎',
          duration: plan.duration_days || plan.duration || 30,
          features: plan.features || [],
        },
      };

      // Persist expected webhook values for strict amount/currency validation.
      try {
        const expectedAmount = amountCOPString;
        const expectedCurrency = currencyCode;
        if (
          payment.metadata?.expected_epayco_amount !== expectedAmount
          || payment.metadata?.expected_epayco_currency !== expectedCurrency
        ) {
          await PaymentModel.updateStatus(payment.id, payment.status, {
            expected_epayco_amount: expectedAmount,
            expected_epayco_currency: expectedCurrency,
          });
        }
      } catch (metaError) {
        logger.error('Failed to persist expected ePayco webhook amount/currency (non-critical)', {
          paymentId: payment.id,
          error: metaError.message,
        });
      }

      // Add provider-specific data
      if (provider === 'epayco') {
        basePaymentData.epaycoPublicKey = process.env.EPAYCO_PUBLIC_KEY;
        basePaymentData.testMode = process.env.EPAYCO_TEST_MODE === 'true';
        // Confirmation URL: ePayco server sends webhook callbacks here
        const confirmationPath = '/api/webhooks/epayco';
        basePaymentData.confirmationUrl = `${epaycoWebhookDomain}${confirmationPath}`;
        // Response URL: User's browser redirects here after payment
        basePaymentData.responseUrl = `${webhookDomain}/api/payment-response`;
        basePaymentData.epaycoSignature = PaymentService.generateEpaycoCheckoutSignature({
          invoice: paymentRef,
          amount: amountCOPString,
          currencyCode,
        });
        if (!basePaymentData.epaycoSignature) {
          logger.error('Missing ePayco signature for payment', {
            paymentId: payment.id,
            paymentRef,
          });
          return res.status(500).json({
            success: false,
            error: 'Error de configuración del pago. Por favor, genera un nuevo enlace desde el bot.',
          });
        }
      }

      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const geo = geoip.lookup(clientIp);
      basePaymentData.showDocFields = geo?.country === 'CO';

      const responseData = {
        success: true,
        payment: basePaymentData,
      };

      logger.info('Payment info retrieved', {
        paymentId,
        planId: plan.id,
        userId,
      });

      res.json(responseData);
    } catch (error) {
      logger.error('Error getting payment info:', {
        error: error.message,
        stack: error.stack,
        paymentId: req.params.paymentId,
      });

      res.status(500).json({
        success: false,
        error: 'Error al cargar la información del pago. Por favor, intenta nuevamente.',
      });
    }
  }

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

      // Get payment and plan details for display
      const payment = await PaymentModel.getById(tokenData.payment_id);
      const plan = await PlanModel.getById(tokenData.plan_id);

      if (!payment || !plan) {
        logger.error('Payment or plan not found after token verification', {
          paymentId: tokenData.payment_id,
          planId: tokenData.plan_id,
        });
        return res.status(404).json({
          success: false,
          error: 'Payment or plan information not found.',
        });
      }

      logger.info('Payment confirmation token verified', {
        paymentId: tokenData.payment_id,
        userId: tokenData.user_id,
        provider: tokenData.provider,
      });

      res.json({
        success: true,
        message: 'Payment confirmed successfully',
        payment: {
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          provider: tokenData.provider,
        },
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

  /**
   * Get payment status (for polling after ePayco checkout)
   * GET /api/payment/:paymentId/status
   */
  static async getPaymentStatus(req, res) {
    try {
      const { paymentId } = req.params;

      if (!paymentId) {
        return res.status(400).json({ success: false, error: 'Payment ID is required' });
      }

      // Prevent browser/proxy caching during polling
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const payment = await PaymentModel.getById(paymentId);

      if (!payment) {
        return res.status(404).json({ success: false, error: 'Payment not found' });
      }

      // C1 — Ownership enforcement
      // When a session exists, the requesting user must own this payment.
      // The 3DS browser redirect page has no session — for that unauthenticated path we
      // return a status-only response (no plan details, no recovery trigger).
      const sessionUserId = req.session?.user?.id || req.session?.userId || null;
      const paymentOwner = String(payment.userId || payment.user_id || '');
      if (sessionUserId) {
        if (String(sessionUserId) !== paymentOwner) {
          logger.warn('Payment status ownership check failed', {
            paymentId,
            sessionUserId,
            paymentOwner,
          });
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      } else {
        // No session — unauthenticated 3DS browser page. Return status only; no plan
        // details, no recovery trigger, no sensitive metadata.
        const safeStatus = ['pending', 'completed', 'failed', 'refunded'].includes(payment.status)
          ? payment.status
          : 'pending';
        return res.json({ success: true, status: safeStatus });
      }

      const refPayco = PaymentController.resolveEpaycoRef(payment)
        || await PaymentController.resolveEpaycoRefFromDb(paymentId);

      logger.info('Polling payment status with recovery', {
        paymentId,
        currentStatus: payment.status,
        refPayco,
      });

      // If payment is not pending, return current status with plan details
      if (payment.status !== 'pending') {
        const response = {
          success: true,
          status: payment.status,
          message: `Payment is ${payment.status}`,
        };

        // Include ePayco error code for failed payments so the UI can show actionable messages
        if (payment.status === 'failed') {
          const meta = payment.metadata || {};
          response.epaycoError = meta.error || null;
          response.epaycoDeclineCode = meta.decline_code || null;
        }

        // Include plan details for completed payments (used by confirmation page)
        if (payment.status === 'completed') {
          const meta = payment.metadata || {};
          if (meta.type === 'call_package') {
            // Provide a post-payment redirect to the booking confirmation page
            const bookingId = meta.bookingId || meta.booking_id || null;
            response.message = 'Your call credit has been granted!';
            response.redirectUrl = bookingId ? `/booking/${encodeURIComponent(String(bookingId))}/confirm?epayco=success` : null;
          } else if (payment.planId) {
            try {
              const plan = await PlanModel.getById(payment.planId);
              if (plan) {
                const durationDays = plan.duration_days || plan.duration || 30;
                response.planName = plan.display_name || plan.name;
                response.amount = payment.amount;
                response.currency = payment.currency || 'USD';
                response.durationDays = durationDays;
                response.transactionId = payment.reference || payment.transactionId;
              }
            } catch (planErr) {
              logger.warn('Could not fetch plan details for payment status', { error: planErr.message });
            }
          }
        }

        return res.json(response);
      }

      // Payment is pending — ePayco flow — check if it's stuck or waiting for webhook
      if (!refPayco) {
        return res.json({
          success: true,
          status: 'pending',
          stuck: true,
          message: 'Payment pending but no ePayco reference found - unable to check status',
        });
      }

      // Check status at ePayco
      const statusCheck = await PaymentService.checkEpaycoTransactionStatus(refPayco);

      if (!statusCheck.success) {
        return res.json({
          success: true, // Return success so polling continues
          status: 'pending',
          error: statusCheck.error,
          message: 'Could not check payment status at ePayco, will retry.',
        });
      }

      // If payment is actually approved at ePayco, it needs recovery
      if (statusCheck.currentStatus === 'Aceptada' || statusCheck.currentStatus === 'Aprobada') {
        logger.warn('STUCK PAYMENT DETECTED (via polling): Payment approved at ePayco but stuck in pending locally', {
          paymentId,
          refPayco,
          currentStatus: statusCheck.currentStatus,
        });

        // Attempt recovery — pass callerUserId for ownership assertion.
        const callerUserId = req.session?.user?.id || req.session?.userId || null;
        await PaymentService.recoverStuckPendingPayment(paymentId, refPayco, callerUserId);

        return res.json({
          success: true,
          status: 'processing_recovery',
          message: 'Payment is stuck - recovery in progress. Status will update shortly.',
        });
      }

      const terminalStates = ['Rechazada', 'Fallida', 'Abandonada', 'Cancelada', 'Reversada'];
      if (terminalStates.includes(statusCheck.currentStatus)) {
        const newStatus = statusCheck.currentStatus === 'Reversada' ? 'refunded' : 'failed';
        await PaymentModel.updateStatus(paymentId, newStatus, {
          epayco_ref: refPayco,
          epayco_estado: statusCheck.currentStatus,
          error: statusCheck.message || `Payment ${statusCheck.currentStatus.toLowerCase()} at ePayco`,
          recovered_via_status_check: true,
        });

        return res.json({
          success: true,
          status: newStatus,
          message: statusCheck.message || `Payment ${newStatus} at ePayco`,
        });
      }

      // Payment is still pending at ePayco. Check for 3DS timeout.
      const createdAt = payment.createdAt || payment.created_at;
      const createdAtMs = createdAt ? new Date(createdAt).getTime() : null;
      const ageMs = Number.isFinite(createdAtMs) ? (Date.now() - createdAtMs) : null;
      const ageMinutes = ageMs !== null ? ageMs / (60 * 1000) : null;
      const metadata = payment.metadata || {};
      const isLikelyThreeDSFlow = Boolean(
        metadata.three_ds_requested || metadata.bank_url_available === false
      );
      const authenticatedAtRaw = metadata?.three_ds_authentication?.authenticated_at;
      const authenticatedAtMs = authenticatedAtRaw ? new Date(authenticatedAtRaw).getTime() : null;
      const hasAuthenticatedAt = Number.isFinite(authenticatedAtMs);
      const ageSinceAuthenticatedMs = hasAuthenticatedAt ? (Date.now() - authenticatedAtMs) : null;
      const ageSinceAuthenticatedMinutes = ageSinceAuthenticatedMs !== null
        ? ageSinceAuthenticatedMs / (60 * 1000)
        : null;
      const pendingTimeoutMinutes = hasAuthenticatedAt
        ? PaymentController.EPAYCO_3DS_AUTHENTICATED_PENDING_TIMEOUT_MINUTES
        : PaymentController.EPAYCO_3DS_PENDING_TIMEOUT_MINUTES;
      const timeoutAgeMinutes = hasAuthenticatedAt ? ageSinceAuthenticatedMinutes : ageMinutes;

      if (
        statusCheck.currentStatus === 'Pendiente'
        && isLikelyThreeDSFlow
        && timeoutAgeMinutes !== null
        && timeoutAgeMinutes >= pendingTimeoutMinutes
      ) {
        await PaymentModel.updateStatus(paymentId, 'failed', {
          epayco_ref: refPayco,
          epayco_estado: statusCheck.currentStatus,
          abandoned_3ds: true,
          timeout_recovered_via_status_check: true,
          timeout_window_minutes: pendingTimeoutMinutes,
          three_ds_authenticated_at: hasAuthenticatedAt ? authenticatedAtRaw : null,
          error: `3DS timeout after ${Math.floor(timeoutAgeMinutes)} minutes without final confirmation`,
        });

        logger.warn('3DS payment timed out in pending state; marking as failed (via polling)', {
          paymentId,
          refPayco,
          ageMinutes: Math.floor(timeoutAgeMinutes),
          pendingTimeoutMinutes,
          hasAuthenticatedAt,
        });

        return res.json({
          success: true,
          status: 'failed',
          message: '3DS no se completó a tiempo. Intenta nuevamente.',
        });
      }

      // Payment is still genuinely pending at ePayco
      return res.json({
        success: true,
        status: 'pending',
        message: 'Awaiting completion of 3DS authentication or webhook.',
      });
    } catch (error) {
      logger.error('Error getting payment status:', {
        error: error.message,
        paymentId: req.params.paymentId,
      });
      res.status(500).json({ success: false, error: 'Error checking payment status' });
    }
  }

  /**
   * Process a tokenized charge (card form → token → customer → charge)
   * POST /api/payment/tokenized-charge
   */
  static async processTokenizedCharge(req, res) {
    try {
      const {
        paymentId,
        tokenCard,
        cardNumber: rawCardNumber,
        expYear: rawExpYear,
        expMonth: rawExpMonth,
        cvc: rawCvc,
        name,
        lastName,
        email,
        docType,
        docNumber,
        city,
        address,
        phone,
        dues,
        browserInfo,
      } = req.body;

      const hasToken = typeof tokenCard === 'string' && tokenCard.trim().length >= 8;
      const hasRawCardData = Boolean(rawCardNumber && rawExpYear && rawExpMonth && rawCvc);

      // Sanitize and validate email before sending to ePayco
      const sanitizedEmail = (typeof email === 'string' ? email : '').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      // Accept either a pre-tokenized card OR raw card data for server-side tokenization.
      // Raw card data is acceptable under PCI SAQ A-EP when transmitted over HTTPS and
      // immediately discarded after tokenization (see server-side tokenization block below).
      if (!paymentId || (!hasToken && !hasRawCardData) || !name || !sanitizedEmail || !docType || !docNumber) {
        return res.status(400).json({
          success: false,
          error: 'Faltan campos requeridos. Debes enviar paymentId, datos de tarjeta y datos de titular.',
        });
      }

      if (!emailRegex.test(sanitizedEmail)) {
        return res.status(400).json({
          success: false,
          error: 'El formato del email no es válido.',
        });
      }

      // Get client IP and user agent for security checks
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.connection?.remoteAddress
        || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || '';
      const acceptHeader = req.headers.accept || '*/*';

      // Security: Rate limiting per user (fallback to paymentId when user is unknown)
      let rateLimitKey = paymentId;
      try {
        const paymentForRateLimit = await PaymentModel.getById(paymentId);
        const paymentUserId = paymentForRateLimit?.userId || paymentForRateLimit?.user_id;
        if (paymentUserId) {
          rateLimitKey = paymentUserId;
        }
      } catch (err) {
        logger.error('Rate limit identity lookup failed (non-critical)', { error: err.message, paymentId });
      }

      try {
        const rateLimit = await PaymentSecurityService.checkPaymentRateLimit(rateLimitKey);
        if (!rateLimit.allowed) {
          return res.status(429).json({
            success: false,
            error: 'Demasiados intentos de pago. Por favor, espera antes de intentar nuevamente.',
          });
        }
      } catch (err) {
        logger.error('Rate limit check failed (non-critical)', { error: err.message });
      }

      // Security: PCI compliance check
      try {
        const pciCheck = PaymentSecurityService.validatePCICompliance(req.body);
        if (!pciCheck.compliant) {
          return res.status(400).json({
            success: false,
            error: 'Datos de pago no válidos.',
          });
        }
      } catch (err) {
        logger.error('PCI compliance check failed (non-critical)', { error: err.message });
      }

      // Security: Payment timeout check
      try {
        const timeout = await PaymentSecurityService.checkPaymentTimeout(paymentId);
        if (timeout.expired) {
          return res.status(400).json({
            success: false,
            error: 'El tiempo para completar este pago ha expirado. Por favor, genera un nuevo enlace desde el bot.',
          });
        }
      } catch (err) {
        logger.error('Payment timeout check failed (non-critical)', { error: err.message });
      }

      // Ownership check: enforce only when a session is present.
      // The payment UUID (128-bit random) is the capability; requests from
      // pay.codigosdemujeres.com carry no pnptv.app session cookie.
      const paymentForOwnership = await PaymentModel.getById(paymentId);
      if (!paymentForOwnership) {
        return res.status(404).json({ success: false, error: 'Payment not found' });
      }
      const paymentOwnerForCharge = String(paymentForOwnership.user_id || paymentForOwnership.userId || '');
      const sessionUserIdForCharge = String(req.session?.user?.id || req.user?.id || '');
      if (sessionUserIdForCharge && sessionUserIdForCharge !== paymentOwnerForCharge) {
        logger.warn('processTokenizedCharge ownership check failed', {
          paymentId, sessionUserId: sessionUserIdForCharge, paymentOwner: paymentOwnerForCharge,
        });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      // Get userId for audit logging
      const userId = paymentOwnerForCharge;

      // Fraud detection — runs in shadow mode by default. Set
      // FRAUD_DETECTION_ENFORCE=true to actually block flagged charges.
      // All failures are swallowed so a fraud-service outage never breaks payments.
      try {
        const fraudEnforce = process.env.FRAUD_DETECTION_ENFORCE === 'true';
        const paymentAmount = parseFloat(paymentForOwnership.amount) || 0;
        const [velocity, amountAnomaly, duplicate] = await Promise.all([
          FraudDetectionService.checkVelocityAbuse(userId),
          FraudDetectionService.checkAmountAnomaly(userId, paymentAmount),
          FraudDetectionService.checkDuplicateTransaction(userId, paymentAmount),
        ]);
        const namedChecks = [
          { name: 'Velocity Abuse', ...velocity },
          { name: 'Amount Anomaly', ...amountAnomaly },
          { name: 'Duplicate Transaction', ...duplicate },
        ];
        const flagged = namedChecks.filter((c) => c.flagged);
        if (flagged.length) {
          logger.warn('Fraud checks flagged transaction', {
            paymentId,
            userId,
            enforce: fraudEnforce,
            flagged: flagged.map((c) => ({ name: c.name, reason: c.reason })),
          });
          if (fraudEnforce) {
            FraudDetectionService.storeFraudFlags(
              userId,
              { userId, amount: paymentAmount, email: sanitizedEmail, phone: phone || null, cardLastFour: null },
              flagged,
            ).catch(() => {});
            return res.status(402).json({
              success: false,
              error: 'Tu pago requiere revisión adicional. Contacta soporte si el problema persiste.',
              code: 'FRAUD_REVIEW',
            });
          }
        }
      } catch (fraudErr) {
        logger.error('Fraud check failed (non-critical)', {
          error: fraudErr.message,
          paymentId,
        });
      }

      // Security: Audit trail - charge attempted. Never log raw card data.
      PaymentSecurityService.logPaymentEvent({
        paymentId,
        userId,
        eventType: 'charge_attempted',
        provider: 'epayco',
        amount: null,
        status: 'pending',
        ipAddress: clientIp,
        userAgent,
        details: {
          tokenSource: hasToken ? 'frontend_sdk' : 'server_side',
          tokenCardPrefix: hasToken ? (tokenCard.substring(0, 8) + '...') : null,
          browserInfo: browserInfo && typeof browserInfo === 'object'
            ? {
                language: browserInfo.language,
                colorDepth: browserInfo.colorDepth,
                screenWidth: browserInfo.screenWidth,
                screenHeight: browserInfo.screenHeight,
                timezoneOffset: browserInfo.timezoneOffset,
              }
            : null,
        },
      }).catch(() => {});

      // Resolve card token. Prefer the pre-tokenized token from the frontend SDK;
      // fall back to server-side tokenization via the ePayco Node SDK.
      let resolvedToken = hasToken ? tokenCard.trim() : null;
      if (!resolvedToken && hasRawCardData) {
        try {
          const { getEpaycoClient } = require('../../../config/epayco');
          const epaycoClient = getEpaycoClient();
          const normalizedYear = String(rawExpYear).length === 2 ? ('20' + String(rawExpYear)) : String(rawExpYear);
          const creditInfo = {
            'card[number]': String(rawCardNumber).replace(/\s/g, ''),
            'card[exp_year]': normalizedYear,
            'card[exp_month]': String(rawExpMonth),
            'card[cvc]': String(rawCvc),
            hasCvv: true,
          };
          logger.info('Server-side card tokenization started', { paymentId });
          const tokenResult = await epaycoClient.token.create(creditInfo);
          // ePayco Node SDK returns various shapes; accept all of them.
          if (tokenResult?.id) {
            resolvedToken = tokenResult.id;
          } else if (tokenResult?.data?.id) {
            resolvedToken = tokenResult.data.id;
          } else if (tokenResult?.token) {
            resolvedToken = tokenResult.token;
          }
          if (!resolvedToken) {
            const epaycoMsg = tokenResult?.message || tokenResult?.data?.description || null;
            logger.error('Server-side tokenization returned unexpected shape', {
              paymentId,
              keys: Object.keys(tokenResult || {}),
              epaycoStatus: tokenResult?.status,
              epaycoMessage: epaycoMsg,
            });
            return res.status(400).json({
              success: false,
              error: mapEpaycoTokenError(epaycoMsg),
            });
          }
          logger.info('Server-side card tokenization succeeded', {
            paymentId,
            tokenPrefix: resolvedToken.substring(0, 8) + '...',
          });
        } catch (tokenError) {
          logger.error('Server-side card tokenization failed', {
            paymentId,
            error: tokenError.message,
          });
          return res.status(400).json({
            success: false,
            error: mapEpaycoTokenError(tokenError.message),
          });
        } finally {
          // Scrub raw card data from the request body so downstream code and any
          // error handlers cannot accidentally log it.
          try {
            if (req.body) {
              delete req.body.cardNumber;
              delete req.body.expYear;
              delete req.body.expMonth;
              delete req.body.cvc;
            }
          } catch (_) { /* no-op */ }
        }
      }

      // For non-Colombian users the doc fields are hidden and the frontend sends the
      // generic fallback '1000000000'. Replace it with a deterministic per-user value
      // so each user has their own ePayco rate-limit bucket instead of all sharing one.
      const GENERIC_DOC_FALLBACK = '1000000000';
      const effectiveDocNumber = String(docNumber) === GENERIC_DOC_FALLBACK
        ? String(100000000 + (parseInt(crypto.createHash('md5').update(userId).digest('hex').slice(0, 8), 16) % 899999999))
        : String(docNumber);

      const chargeParams = {
        paymentId,
        customer: {
          name,
          last_name: lastName || name,
          email: sanitizedEmail,
          doc_type: docType,
          doc_number: effectiveDocNumber,
          city: city || 'Bogota',
          address: address || 'N/A',
          phone: phone || '0000000000',
          cell_phone: phone || '0000000000',
        },
        dues: String(dues || '1'),
        ip: clientIp,
        userAgent,
        acceptHeader,
        browserInfo: browserInfo && typeof browserInfo === 'object' ? browserInfo : null,
        tokenCard: resolvedToken,
      };

      const result = await PaymentService.processTokenizedCharge(chargeParams);

      if (result.success) {
        // Security: Audit trail - charge completed
        PaymentSecurityService.logPaymentEvent({
          paymentId,
          userId,
          eventType: 'charge_completed',
          provider: 'epayco',
          amount: null,
          status: 'completed',
          ipAddress: clientIp,
          userAgent,
          details: { transactionId: result.transactionId },
        }).catch(() => {});

        res.json(result);

        // Provision email credentials out-of-band. Isolated from the HTTP response:
        // a throw here (missing service, SMTP failure, anything) can never corrupt the
        // already-sent response. This replaces the fragile res.json wrapper that
        // caused TOKENIZED_CHARGE_ERROR on 2026-04-21.
        try {
          const sessionUser = req.session?.user;
          if (sessionUser && sanitizedEmail) {
            const credUserId = String(sessionUser.telegramId || sessionUser.telegram_id || sessionUser.id);
            const language = sessionUser.language || 'es';
            Promise.resolve()
              .then(() => ensureEmailCredentials(credUserId, sanitizedEmail, language))
              .then(() => { req.session.user = { ...req.session.user, email: sanitizedEmail }; })
              .catch((err) => logger.warn('ensureEmailCredentials after tokenized-charge (non-critical)', {
                userId: credUserId, error: err?.message,
              }));
          }
        } catch (credErr) {
          logger.warn('ensureEmailCredentials setup failed (non-critical)', { error: credErr?.message });
        }
      } else {
        if (result.status === 'rejected') {
          return res.status(402).json(result);
        }
        if (result.status === 'processing') {
          return res.status(409).json(result);
        }
        res.status(400).json(result);
      }
    } catch (error) {
      logger.error('Error in tokenized charge endpoint:', {
        error: error.message,
        stack: error.stack,
        paymentId: req.body?.paymentId,
      });

      // Security: Log payment error
      const errorUserId = await PaymentController.getUserIdFromPayment(req.body?.paymentId).catch(() => null);
      PaymentSecurityService.logPaymentError({
        paymentId: req.body?.paymentId,
        userId: errorUserId,
        provider: 'epayco',
        errorCode: 'TOKENIZED_CHARGE_ERROR',
        errorMessage: error.message,
        stackTrace: error.stack,
      }).catch(() => {});

      // Payment-error watchdog: DM admin when the same error_message fires 3+ times
      // in an hour. Added after the 2026-04-21 ensureEmailCredentials incident, which
      // silently failed 4 times before anyone noticed. Redis-counter based so it adds
      // no scheduler overhead and alerts within seconds of the threshold crossing.
      (async () => {
        try {
          const crypto = require('crypto');
          const adminId = process.env.ADMIN_ID?.trim();
          if (!adminId || !error?.message) return;
          const hash = crypto.createHash('md5').update(error.message).digest('hex').slice(0, 10);
          const key = `pnpapp:payerr:${hash}`;
          const count = await cache.incr(key, 3600);
          if (count === 3) {
            const botModule = require('../../core/bot');
            const bot = botModule?.bot || botModule;
            const msg = `🚨 ePayco alert: 3× "${error.message.slice(0, 140)}" in the last hour. Check payment_errors + recent paymentId ${req.body?.paymentId || 'n/a'}.`;
            await bot.telegram.sendMessage(adminId, msg).catch(() => {});
          }
        } catch (_) { /* watchdog must never impact the response */ }
      })();

      res.status(500).json({
        success: false,
        error: 'Error interno al procesar el pago. Intenta nuevamente.',
      });
    }
  }
  /**
   * Verify 2FA OTP for large payments
   * POST /api/payment/verify-2fa
   */
  static async verify2FA(req, res) {
    try {
      const { paymentId, otp } = req.body;

      if (!paymentId || !otp) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID and OTP are required.',
        });
      }

      // Ownership check — enforce when session is present; UUID is capability otherwise.
      const paymentForOtp = await PaymentModel.getById(paymentId).catch(() => null);
      if (!paymentForOtp) {
        return res.status(404).json({ success: false, error: 'Payment not found' });
      }
      const paymentOwnerOtp = String(paymentForOtp.user_id || paymentForOtp.userId || '');
      const sessionUserIdOtp = String(req.session?.user?.id || req.user?.id || '');
      if (sessionUserIdOtp && sessionUserIdOtp !== paymentOwnerOtp) {
        logger.warn('verify2FA ownership check failed', { paymentId, sessionUserId: sessionUserIdOtp, paymentOwner: paymentOwnerOtp });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const { cache } = require('../../../config/redis');
      const key = `payment:2fa:${paymentId}`;
      // HIGH-02: Persistent attempts counter survives OTP key expiry (which would
      // otherwise let an attacker re-request a fresh OTP and reset attempts).
      const persistentLockKey = `payment:2fa:lock:${paymentId}`;
      const data = await cache.get(key);
      const persistentAttempts = parseInt(await cache.get(persistentLockKey)) || 0;

      if (persistentAttempts >= 9) {
        // 9 = 3 attempts × 3 OTP requests; lock for the full 30-min TTL.
        return res.status(429).json({
          success: false,
          error: 'Demasiados intentos en esta sesión de pago. Reinicia el pago en 30 minutos.',
        });
      }

      if (!data) {
        return res.status(400).json({
          success: false,
          error: 'Código expirado o no encontrado. Intenta iniciar el pago nuevamente.',
        });
      }

      // Check max attempts
      if (data.attempts >= 3) {
        await cache.del(key);
        return res.status(400).json({
          success: false,
          error: 'Demasiados intentos fallidos. Intenta iniciar el pago nuevamente.',
        });
      }

      if (data.otp !== otp) {
        data.attempts = (data.attempts || 0) + 1;
        await cache.set(key, data, 300);
        await cache.set(persistentLockKey, String(persistentAttempts + 1), 1800);
        return res.status(400).json({
          success: false,
          error: 'Código incorrecto. Intentos restantes: ' + (3 - data.attempts),
        });
      }

      // OTP valid - mark as verified (10-minute window to complete payment)
      await cache.set(`payment:2fa:verified:${paymentId}`, true, 600);
      await cache.del(key);
      await cache.del(persistentLockKey);

      logger.info('2FA verification successful', { paymentId, userId: sessionUserIdOtp });

      res.json({
        success: true,
        message: 'Verificación exitosa.',
      });
    } catch (error) {
      logger.error('Error in 2FA verification:', {
        error: error.message,
        paymentId: req.body?.paymentId,
      });

      res.status(500).json({
        success: false,
        error: 'Error al verificar el código.',
      });
    }
  }



  /**
   * Manually trigger webhook replay for stuck payment
   * POST /api/payment/:paymentId/retry-webhook
   */
  static async retryPaymentWebhook(req, res) {
    try {
      const { paymentId } = req.params;

      if (!paymentId) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID is required',
        });
      }

      const payment = await PaymentModel.getById(paymentId);

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      const refPayco = PaymentController.resolveEpaycoRef(payment)
        || await PaymentController.resolveEpaycoRefFromDb(paymentId);

      if (payment.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: `Payment is ${payment.status}, not pending`,
        });
      }

      if (!refPayco) {
        return res.status(400).json({
          success: false,
          error: 'No ePayco reference found for this payment',
        });
      }

      logger.warn('Manual webhook retry initiated', {
        paymentId,
        refPayco,
      });

      // Check if payment is actually approved at ePayco
      const statusCheck = await PaymentService.checkEpaycoTransactionStatus(refPayco);

      if (!statusCheck.success) {
        return res.status(400).json({
          success: false,
          error: 'Could not verify payment at ePayco',
          details: statusCheck.error,
        });
      }

      if (statusCheck.currentStatus !== 'Aceptada' && statusCheck.currentStatus !== 'Aprobada') {
        return res.status(400).json({
          success: false,
          error: `Payment status at ePayco is ${statusCheck.currentStatus}, not approved`,
          message: 'Cannot retry webhook for non-approved payment',
        });
      }

      // Payment is approved at ePayco but stuck pending locally — trigger recovery
      logger.warn('Payment approved at ePayco but stuck pending locally - triggering recovery', {
        paymentId,
        refPayco,
        action: 'AUTO_RECOVERY',
      });

      // Actually call the recovery to process the stuck payment
      const recoveryResult = await PaymentService.recoverStuckPendingPayment(paymentId, refPayco, null);

      return res.json({
        success: true,
        message: 'Payment recovery triggered',
        action: 'AUTO_RECOVERED',
        paymentId,
        refPayco,
        recoveryResult,
      });
    } catch (error) {
      logger.error('Error retrying payment webhook', {
        error: error.message,
        paymentId: req.params?.paymentId,
      });

      res.status(500).json({
        success: false,
        error: 'Error retrying webhook. Check server logs.',
      });
    }
  }

  /**
   * Complete Cardinal Commerce 3DS 2.0 authentication
   * POST /api/payment/complete-3ds-2
   */
  static async complete3DS2Authentication(req, res) {
    try {
      const { paymentId, threeDSecure } = req.body;

      if (!paymentId || !threeDSecure) {
        return res.status(400).json({
          success: false,
          error: 'Payment ID and 3DS 2.0 data are required',
        });
      }

      // CRIT-04: Only trust signals the client cannot forge. `validationData` is
      // produced by ePayco's validateThreeds.min.js after the issuer challenge
      // completes; `challengeCompleted` is set by the same SDK on frictionless
      // flows. The previous `authenticated === true` shortcut let a client POST
      // its own truthy flag and pass this gate — the ePayco status API was the
      // real backstop, but accepting client assertions made auditing harder.
      const has3DSValidationResult = Boolean(
        threeDSecure
        && typeof threeDSecure === 'object'
        && (
          (threeDSecure.validationData && typeof threeDSecure.validationData === 'object')
          || threeDSecure.challengeCompleted === true
        )
      );

      // Do not mark 3DS as authenticated when there is no definitive challenge result.
      if (!has3DSValidationResult) {
        logger.warn('3DS completion called without validation result; keeping payment pending', {
          paymentId,
          provider: threeDSecure?.provider,
          referenceId: threeDSecure?.referenceId,
          keys: Object.keys(threeDSecure || {}),
        });
        return res.status(202).json({
          success: true,
          status: 'pending',
          message: 'Awaiting definitive 3DS validation result',
        });
      }

      logger.info('3DS 2.0 authentication completion initiated', {
        paymentId,
        referenceId: threeDSecure.referenceId,
      });

      // Get payment from database
      const payment = await PaymentModel.getById(paymentId);

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found',
        });
      }

      // Ownership check — enforce when session is present; UUID is capability otherwise.
      const sessionUserId3ds = String(req.session?.user?.id || req.user?.id || '');
      const paymentOwner3ds = String(payment.user_id || payment.userId || '');
      if (sessionUserId3ds && sessionUserId3ds !== paymentOwner3ds) {
        logger.warn('complete3DS2Authentication ownership check failed', { paymentId, sessionUserId: sessionUserId3ds, paymentOwner: paymentOwner3ds });
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const refPayco = PaymentController.resolveEpaycoRef(payment)
        || await PaymentController.resolveEpaycoRefFromDb(paymentId);

      if (payment.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: `Payment is ${payment.status}, not pending`,
        });
      }

      // Calculate 3DS authentication latency for monitoring
      const createdAt = payment.createdAt || payment.created_at;
      const threeDSLatencyMs = createdAt ? (Date.now() - new Date(createdAt).getTime()) : null;

      // Store 3DS 2.0 authentication data in payment metadata
      await PaymentModel.updateStatus(paymentId, 'pending', {
        three_ds_authentication: {
          version: threeDSecure.version,
          provider: threeDSecure.provider,
          referenceId: threeDSecure.referenceId,
          authenticated_at: new Date().toISOString(),
          latency_ms: threeDSLatencyMs,
          // Store CAVV/ECI if provided by the 3DS challenge
          cavv: threeDSecure.validationData?.cavv || null,
          eci: threeDSecure.validationData?.eci || null,
          xid: threeDSecure.validationData?.xid || null,
        },
      });

      logger.info('3DS 2.0 authentication data stored', {
        paymentId,
        referenceId: threeDSecure.referenceId,
        latencyMs: threeDSLatencyMs,
        version: threeDSecure.version,
      });

      // Check payment status with ePayco to see if it's been approved after 3DS
      const statusCheck = await PaymentService.checkEpaycoTransactionStatus(refPayco);

      if (!statusCheck.success) {
        logger.warn('Could not verify payment status at ePayco', {
          paymentId,
          refPayco,
        });
        // Return pending - let client poll
        return res.json({
          success: true,
          status: 'pending',
          message: 'Payment status being verified',
        });
      }

      const currentStatus = statusCheck.currentStatus;

      if (currentStatus === 'Aceptada' || currentStatus === 'Aprobada') {
        // Payment is approved at ePayco
        logger.info('Payment approved at ePayco after 3DS 2.0 authentication', {
          paymentId,
          refPayco,
          currentStatus,
        });

        // Distributed lock to prevent race condition between 3DS completion and webhook
        const activationLockKey = `subscription_activation:${paymentId}`;
        const activationLockAcquired = await cache.acquireLock(activationLockKey, 60);
        if (!activationLockAcquired) {
          logger.info('3DS2: subscription activation already in progress (likely webhook)', { paymentId });
          return res.json({ success: true, status: 'processing', message: 'Payment is being finalized.' });
        }

        try {
        // Re-read payment to check if webhook already processed it (race condition guard)
        const freshPayment = await PaymentModel.getById(paymentId);
        if (freshPayment && freshPayment.status === 'completed') {
          logger.info('3DS2: payment already completed by webhook, skipping activation', { paymentId });
          await cache.releaseLock(activationLockKey);
          return res.json({ success: true, message: 'Payment already processed' });
        }

        // Activate subscription first, then mark completed to avoid polling race conditions.
        const userId = payment.user_id || payment.userId;
        const planId = payment.plan_id || payment.planId;
        const plan = await PlanModel.getById(planId);

        if (!plan) {
          await cache.releaseLock(activationLockKey).catch(() => {});
          logger.error('3DS2: plan not found — entitlements NOT granted', { paymentId, planId, userId });
          return res.status(422).json({
            success: false,
            error: 'Plan not found — subscription could not be activated. Please contact support.',
            code: 'PLAN_NOT_FOUND',
          });
        }

        if (userId && plan) {
          const durationDays = plan.duration_days || plan.duration || 30;
          // Extend from current expiry if active (don't lose remaining days on renewal)
          const UserModel = require('../../../models/userModel');
          const userForExpiry = await UserModel.getById(userId);
          const currentExpiry = userForExpiry?.subscription?.expiry || userForExpiry?.subscription_expiry;
          const expiryDate = (currentExpiry && new Date(currentExpiry) > new Date())
            ? new Date(new Date(currentExpiry).getTime() + durationDays * 86400000)
            : new Date(Date.now() + durationDays * 86400000);

          await UserModel.updateSubscription(userId, {
            status: 'active',
            planId,
            expiry: expiryDate,
          });

          // C-02: Grant entitlements after 3DS2 completion — was missing entirely.
          // PaymentService is imported at the top of this file.
          // Pass payment metadata so scoped add-ons (channel-access,
          // creator-subscription, hangout-access) land with the correct scope.
          let threeDS2GrantResult;
          try {
            threeDS2GrantResult = await PaymentService.grantEntitlementsForPlan(
              userId,
              planId,
              'epayco_3ds2',
              payment?.metadata || null,
              paymentId || null,
            );
          } catch (entitlementErr) {
            logger.error('grantEntitlementsForPlan threw during 3DS2 completion', {
              error: entitlementErr.message, userId, planId, paymentId,
            });
            // Mark completed so recovery doesn't replay on a user who already has subscription access
            await PaymentModel.updateStatus(paymentId, 'completed', {
              transaction_id: refPayco || payment.transactionId,
              reference: refPayco || payment.reference,
              epayco_ref: refPayco,
              payment_method: 'tokenized_card',
              three_ds_authenticated: true,
              entitlement_grant_failed: true,
              webhook_processed_at: new Date().toISOString(),
            }).catch((e) => logger.error('3DS2: failed to mark completed after entitlement error', { error: e.message, paymentId }));
            return res.status(500).json({
              success: false,
              error: 'Subscription activated but entitlement grant failed — please contact support',
              code: 'ENTITLEMENT_GRANT_FAILED',
            });
          }
          const is3DS2PaidPlan = plan && (parseFloat(plan.price) > 0);
          if (is3DS2PaidPlan && threeDS2GrantResult && threeDS2GrantResult.granted === 0) {
            logger.error('grantEntitlementsForPlan returned 0 grants after 3DS2 completion', {
              userId, planId, paymentId, threeDS2GrantResult,
            });
            // Same: mark completed to prevent replay
            await PaymentModel.updateStatus(paymentId, 'completed', {
              transaction_id: refPayco || payment.transactionId,
              reference: refPayco || payment.reference,
              epayco_ref: refPayco,
              payment_method: 'tokenized_card',
              three_ds_authenticated: true,
              entitlement_grant_failed: true,
              entitlement_grant_count: 0,
              webhook_processed_at: new Date().toISOString(),
            }).catch((e) => logger.error('3DS2: failed to mark completed after zero-grant error', { error: e.message, paymentId }));
            return res.status(500).json({
              success: false,
              error: 'Subscription activated but no entitlements were granted — please contact support',
              code: 'ENTITLEMENT_GRANT_FAILED',
            });
          }

          logger.info('Subscription activated after 3DS 2.0 authentication', {
            userId,
            planId,
            expiryDate,
            paymentId,
          });

          // CRIT-01: Mark payment completed BEFORE the notification chain.
          // The notification chain (Telegram DM + 2× emails + bot DMs) can run
          // longer than the 60s activation lock TTL. If it crashed before the
          // updateStatus call (which used to be at the end of this branch), a
          // late-arriving webhook would find the payment still 'pending' and
          // re-grant entitlements. Mirrors processEpaycoWebhook flow ordering.
          await PaymentModel.updateStatus(paymentId, 'completed', {
            transaction_id: refPayco || payment.transactionId,
            reference: refPayco || payment.reference,
            epayco_ref: refPayco,
            payment_method: 'tokenized_card',
            three_ds_authenticated: true,
            webhook_processed_at: new Date().toISOString(),
          });

          NotificationEmitter.emit({
            type: 'payment', category: 'commerce', priority: 'high',
            targetUserId: userId,
            entityType: 'payment', entityId: paymentId,
            message: `Your ${plan.name || 'PRIME'} subscription is now active!`,
            metadata: { planId, expiryDate: expiryDate.toISOString() },
          });

          // Send all post-payment notifications (same as webhook path)
          const userLang3ds = userForExpiry?.language || 'es';

          // Telegram DM
          try {
            await PaymentService.sendPaymentConfirmationNotification({
              userId,
              plan,
              transactionId: refPayco,
              amount: payment.amount ? parseFloat(payment.amount) : parseFloat(plan.price),
              expiryDate,
              language: userLang3ds,
              provider: 'epayco',
            });
          } catch (dmErr) {
            logger.warn('3DS2: Telegram DM failed (non-critical)', { error: dmErr.message, paymentId });
          }

          // Admin notification
          try {
            const { getBotInstance } = require('../../core/bot');
            const bot = getBotInstance();
            await PaymentNotificationService.sendAdminPaymentNotification({
              bot,
              userId,
              planName: plan.display_name || plan.name,
              amount: payment.amount ? parseFloat(payment.amount) : parseFloat(plan.price),
              provider: 'ePayco (3DS2)',
              transactionId: refPayco,
              customerName: userForExpiry?.first_name || 'Unknown',
              customerEmail: payment.metadata?.customer_email || userForExpiry?.email || 'N/A',
            });
          } catch (adminErr) {
            logger.warn('3DS2: admin notification failed (non-critical)', { error: adminErr.message, paymentId });
          }

          // Business channel notification
          try {
            await BusinessNotificationService.notifyPayment({
              userId,
              planName: plan.display_name || plan.name,
              amount: payment.amount ? parseFloat(payment.amount) : parseFloat(plan.price),
              provider: 'ePayco (3DS2)',
              transactionId: refPayco,
              customerName: userForExpiry?.first_name || 'Unknown',
            });
          } catch (bizErr) {
            logger.warn('3DS2: business notification failed (non-critical)', { error: bizErr.message, paymentId });
          }

          // Invoice PDF + email
          const customerEmail3ds = payment.metadata?.customer_email || userForExpiry?.email;
          if (customerEmail3ds) {
            try {
              const invoiceAmount = payment.amount ? parseFloat(payment.amount) : parseFloat(plan.price);
              const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
                invoiceNumber: refPayco || paymentId.substring(0, 8),
                customerName: userForExpiry?.first_name || 'Valued Customer',
                planName: plan.display_name || plan.name,
                amount: invoiceAmount,
                currency: 'USD',
                provider: 'epayco',
                transactionId: refPayco,
                purchaseDate: new Date(),
                expiryDate,
                language: userLang3ds,
              });

              await EmailService.sendInvoiceEmail({
                to: customerEmail3ds,
                customerName: userForExpiry?.first_name || 'Valued Customer',
                invoiceNumber: refPayco || paymentId.substring(0, 8),
                amount: invoiceAmount,
                planName: plan.display_name || plan.name,
                invoicePdf,
              });
            } catch (invoiceErr) {
              logger.warn('3DS2: invoice email failed (non-critical)', { error: invoiceErr.message, paymentId });
            }

            // Welcome email
            try {
              await EmailService.sendWelcomeEmail({
                to: customerEmail3ds,
                customerName: userForExpiry?.first_name || 'Valued Customer',
                planName: plan.display_name || plan.name,
                duration: plan.duration,
                expiryDate,
                language: userLang3ds,
                userUuid: userForExpiry?.id || userId,
                username: userForExpiry?.username,
                loginMethod: userForExpiry?.last_login_method,
              });
            } catch (welcomeErr) {
              logger.warn('3DS2: welcome email failed (non-critical)', { error: welcomeErr.message, paymentId });
            }
          }
        }

        // Payment was already marked 'completed' before the notification chain (CRIT-01).
        // Lock release happens in the surrounding finally block.
        return res.json({
          success: true,
          status: 'authenticated',
          message: 'Payment authenticated and approved',
          paymentId,
        });
        } finally {
          // Ensure lock is released even if activation throws
          await cache.releaseLock(activationLockKey).catch(() => {});
        }
      } else if (
        currentStatus === 'Rechazada'
        || currentStatus === 'Fallida'
        || currentStatus === 'Abandonada'
        || currentStatus === 'Cancelada'
      ) {
        await PaymentModel.updateStatus(paymentId, 'failed', {
          epayco_ref: refPayco,
          epayco_estado: currentStatus,
          error: `Payment ${currentStatus.toLowerCase()} after 3DS authentication`,
          three_ds_authenticated: true,
        });

        return res.json({
          success: true,
          status: 'failed',
          message: `Payment ${currentStatus.toLowerCase()} at ePayco`,
          paymentId,
        });
      } else if (currentStatus === 'Reversada') {
        await PaymentModel.updateStatus(paymentId, 'refunded', {
          epayco_ref: refPayco,
          epayco_estado: currentStatus,
          error: 'Payment reversed/refunded after 3DS authentication',
          three_ds_authenticated: true,
        });

        return res.json({
          success: true,
          status: 'refunded',
          message: 'Payment reversed/refunded at ePayco',
          paymentId,
        });
      } else {
        // Payment still pending at ePayco
        logger.info('Payment still pending at ePayco after 3DS 2.0 authentication', {
          paymentId,
          refPayco: payment.epayco_ref,
          currentStatus,
        });

        return res.json({
          success: true,
          status: 'pending',
          message: 'Payment pending 3DS verification completion',
          paymentId,
        });
      }
    } catch (error) {
      logger.error('Error completing 3DS 2.0 authentication', {
        error: error.message,
        paymentId: req.body?.paymentId,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Error processing 3DS 2.0 authentication',
      });
    }
  }
}

module.exports = PaymentController;
