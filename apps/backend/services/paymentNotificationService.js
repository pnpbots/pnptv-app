const logger = require('../utils/logger');
const UserModel = require('../models/userModel');
const PlanModel = require('../models/planModel');
const ConfirmationTokenService = require('./confirmationTokenService');
const MessageTemplates = require('./messageTemplates');
const { Telegraf } = require('telegraf');

function _getBot() {
  try {
    const { getBotInstance } = require('../bot/core/bot');
    if (typeof getBotInstance === 'function') return getBotInstance();
  } catch (_) {}
  return new Telegraf(process.env.BOT_TOKEN);
}

/**
 * Payment Notification Service
 * Sends confirmation messages to users via Telegram after successful payment
 */
class PaymentNotificationService {
  /**
   * Send payment confirmation message to user
   * @param {Object} params - Notification parameters
   * @param {Object} params.bot - Telegraf bot instance
   * @param {string} params.userId - Telegram user ID
   * @param {string} params.paymentId - Payment ID
   * @param {string} params.planId - Plan ID
   * @param {string} params.provider - Payment provider
   * @param {string} params.amount - Payment amount
   * @param {Date} params.expiryDate - Subscription expiry date
   * @returns {Promise<boolean>} Success status
   */
  // Supports two calling conventions:
  //   sendPaymentConfirmation({ bot, userId, paymentId, planId, provider, amount, expiryDate })
  //   sendPaymentConfirmation(userId, { planId, planName, amount, currency, provider, language })
  static async sendPaymentConfirmation(firstArg, secondArg) {
    let bot, userId, paymentId, planId, planNameOverride, provider, amount, expiryDate, language;
    if (secondArg !== undefined) {
      // Two-arg form: (userId, opts)
      userId = firstArg;
      ({ planId, planName: planNameOverride, amount, provider, expiryDate, language } = secondArg);
      bot = _getBot();
    } else {
      // One-arg destructured form: ({ bot, userId, ... })
      ({ bot, userId, paymentId, planId, provider, amount, expiryDate } = firstArg);
      if (!bot) bot = _getBot();
    }
    try {
      // Get user details
      const user = await UserModel.getById(userId);
      if (!user) {
        logger.warn('User not found for payment confirmation', { userId, paymentId });
        return false;
      }

      // Get plan details
      const plan = await PlanModel.getById(planId);
      if (!plan) {
        logger.warn('Plan not found for payment confirmation', { planId, paymentId });
        return false;
      }

      // Generate one-time confirmation token (confirmation_tokens.payment_id is UUID type)
      const { randomUUID } = require('crypto');
      const token = await ConfirmationTokenService.generateToken({
        paymentId: paymentId || randomUUID(),
        userId,
        planId,
        provider,
      });

      const confirmationLink = ConfirmationTokenService.getConfirmationLink(token);
      const planName = planNameOverride || plan.display_name || plan.name;
      const formattedAmount = parseFloat(amount).toFixed(2);

      // Determine language (default to Spanish if not set)
      const lang = language || user.language || 'es';

      // Build enhanced confirmation message with all important details
      let message = '';
      let confirmButtonText = '';

      if (lang === 'es') {
        message = `🎉 ¡Gracias por tu compra y por apoyar a PNPtv!\n\n`;
        message += `✅ Tu membresía ha sido activada automáticamente—sin espera, sin aprobación manual.\n\n`;

        message += `📦 *Lo que incluye tu membresía:*\n\n`;
        message += `• Hangouts – Salas de videollamadas comunitarias\n`;
        message += `• PNP Television Live – Transmisiones en vivo y grabaciones exclusivas\n\n`;

        message += `📋 *Detalles de tu compra:*\n`;
        message += `• Plan: ${planName}\n`;
        message += `• Monto: $${formattedAmount}\n`;
        message += `• Proveedor: ${this.getProviderName(provider, lang)}\n`;
        message += `• Fecha de compra: ${new Date().toLocaleDateString('es-ES')}\n`;

        if (expiryDate && !plan.is_lifetime) {
          message += `• Vence: ${expiryDate.toLocaleDateString('es-ES')}\n`;
        } else if (plan.is_lifetime) {
          message += `• Duración: Permanente ♾️\n`;
        }

        message += `\n📢 *Aviso importante*\n\n`;
        message += `Nuestro canal fue reportado recientemente y estamos volviendo a subir contenido.\n`;
        message += `Ya estamos en producción y se está lanzando nuevo contenido continuamente.\n\n`;

        message += `💰 *Política de reembolso (ventas regulares)*\n\n`;
        message += `Como la activación es automática, puedes solicitar un reembolso dentro de los 30 minutos DESPUÉS DE LA COMPRA si no estás satisfecho.\n`;
        message += `Los reembolsos aprobados pueden tardar hasta 15 días hábiles en procesarse.\n\n`;

        message += `🔐 Verifica tu compra usando el enlace seguro de abajo.\n`;
        message += `Este enlace es único y solo puede ser usado una vez.\n\n`;
        message += `¡Gracias por apoyar un proyecto independiente y impulsado por la comunidad! 🔥\n\n`;
        message += `✨ Aprende sobre todas las características de la comunidad:\n`;
        message += `https://pnptv.app/community-features`;
        confirmButtonText = '✅ Confirmar Compra';
      } else {
        message = `🎉 Thank you for your purchase and for supporting PNPtv!\n\n`;
        message += `✅ Your membership is activated automatically—no waiting, no manual approval.\n\n`;

        message += `📦 *What's included in your membership:*\n\n`;
        message += `• Hangouts – Community video call rooms\n`;
        message += `• PNP Television Live – Live streams and exclusive recordings\n\n`;

        message += `📋 *Purchase Details:*\n`;
        message += `• Plan: ${planName}\n`;
        message += `• Amount: $${formattedAmount}\n`;
        message += `• Provider: ${this.getProviderName(provider, lang)}\n`;
        message += `• Purchase Date: ${new Date().toLocaleDateString('en-US')}\n`;

        if (expiryDate && !plan.is_lifetime) {
          message += `• Expires: ${expiryDate.toLocaleDateString('en-US')}\n`;
        } else if (plan.is_lifetime) {
          message += `• Duration: Permanent ♾️\n`;
        }

        message += `\n📢 *Important notice*\n\n`;
        message += `Our channel was recently reported, and we are re-uploading content.\n`;
        message += `We are back in production, and new content is being released continuously.\n\n`;

        message += `💰 *Refund policy (Regular sales)*\n\n`;
        message += `Because activation is automatic, you may request a refund within 30 minutes AFTER PURCHASE if you are not satisfied.\n`;
        message += `Approved refunds may take up to 15 business days to be processed.\n\n`;

        message += `🔐 Verify your purchase using the secure link below.\n`;
        message += `This link is unique and can only be used once.\n\n`;
        message += `Thank you for supporting an independent, community-powered project! 🔥\n\n`;
        message += `✨ Learn about all community features:\n`;
        message += `https://pnptv.app/community-features`;
        confirmButtonText = '✅ Confirm Purchase';
      }

      // Send message with inline button
      try {
        const { Markup } = require('telegraf');

        // H6: message body uses Markdown formatting — must match parse_mode
        await bot.telegram.sendMessage(userId, message, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url(confirmButtonText, confirmationLink)],
          ]).reply_markup,
        });

        logger.info('Payment confirmation sent to user', {
          userId,
          paymentId,
          provider,
          planId,
        });

        return true;
      } catch (sendError) {
        logger.error('Error sending payment confirmation message:', {
          userId,
          paymentId,
          error: sendError.message,
        });
        // Return true anyway as the payment is still valid
        return true;
      }
    } catch (error) {
      logger.error('Error in payment confirmation notification:', {
        userId,
        paymentId,
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  /**
   * Get payment provider name for display
   * @param {string} provider - Provider code
   * @param {string} lang - Language code
   * @returns {string} Provider display name
   */
  static getProviderName(provider, lang = 'en') {
    const providers = {
      // Daimo kept for legacy receipts (in-flight + refund history)
      daimo:       { en: 'Daimo Pay (legacy)',   es: 'Daimo Pay (legacy)' },
      epayco:      { en: 'ePayco',               es: 'ePayco' },
      dash:        { en: 'Dash (BTCPay)',         es: 'Dash (BTCPay)' },
      btcpay:      { en: 'Dash (BTCPay)',         es: 'Dash (BTCPay)' },
      nowpayments: { en: 'USDC (NowPayments)',    es: 'USDC (NowPayments)' },
    };

    return providers[provider]?.[lang] || provider.toUpperCase();
  }

  /**
   * Send subscription activated message
   * @param {Object} params - Notification parameters
   * @param {Object} params.bot - Telegraf bot instance
   * @param {string} params.userId - Telegram user ID
   * @param {string} params.planName - Plan name
   * @param {Date} params.expiryDate - Subscription expiry date
   * @param {string} params.transactionId - Transaction ID (for invite link generation)
   * @returns {Promise<boolean>} Success status
   */
  static async sendSubscriptionActivated({ bot, userId, planName, expiryDate, transactionId = 'subscription' }) {
    try {
      const user = await UserModel.getById(userId);
      if (!user) {
        logger.warn('User not found for subscription activated notification', { userId });
        return false;
      }

      const lang = user.language || 'es';
      // PRIME channel migrated to webapp 2026-04-28 — no longer a Telegram group.
      const inviteLink = 'https://pnptv.app';

      // Use unified message template
      const message = MessageTemplates.buildPrimeActivationMessage({
        planName,
        amount: null, // No amount for activated messages
        expiryDate,
        transactionId,
        inviteLink,
        language: lang,
      });

      try {
        await bot.telegram.sendMessage(userId, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        });

        logger.info('Subscription activated notification sent', { userId, planName });
        return true;
      } catch (sendError) {
        logger.error('Error sending subscription activated message:', {
          userId,
          error: sendError.message,
        });
        return true; // Don't fail the overall process
      }
    } catch (error) {
      logger.error('Error in subscription activated notification:', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send admin notification for payment completion
   * @param {Object} params - Notification parameters
   * @param {Object} params.bot - Telegraf bot instance
   * @param {string} params.userId - Customer user ID
   * @param {string} params.planName - Plan name
   * @param {number} params.amount - Payment amount
   * @param {string} params.provider - Payment provider
   * @param {string} params.transactionId - Transaction ID
   * @param {string} params.customerName - Customer name
   * @param {string} params.customerEmail - Customer email
   * @returns {Promise<boolean>} Success status
   */
  static async sendAdminPaymentNotification({
    bot,
    userId,
    planName,
    amount,
    provider,
    transactionId,
    customerName,
    customerEmail,
  }) {
    try {
      // Fall back to SUPERADMIN_IDS (comma-separated) when ADMIN_ID is not set.
      const adminIds = process.env.ADMIN_ID
        ? [process.env.ADMIN_ID]
        : (process.env.SUPERADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const supportGroupId = process.env.SUPPORT_GROUP_ID;

      if (adminIds.length === 0 && !supportGroupId) {
        logger.warn('Neither ADMIN_ID/SUPERADMIN_IDS nor SUPPORT_GROUP_ID configured, skipping admin notification');
        return false;
      }

      const formattedAmount = parseFloat(amount).toFixed(2);
      const timestamp = new Date().toLocaleString('es-ES');

      // M3: Admin DM includes PII (email). Group message deliberately omits it.
      const adminMessage = [
        '💰 *NUEVA COMPRA COMPLETADA*',
        '',
        '✅ Un cliente ha completado su pago exitosamente',
        '',
        '👤 *Información del Cliente:*',
        `• Nombre: ${customerName || 'N/A'}`,
        `• Email: ${customerEmail || 'N/A'}`,
        `• ID Usuario: ${userId}`,
        '',
        '📦 *Detalles de la Compra:*',
        `• Plan: ${planName}`,
        `• Monto: $${formattedAmount} USD`,
        `• Proveedor: ${this.getProviderName(provider, 'es')}`,
        `• Transacción ID: \`${transactionId}\``,
        `• Fecha: ${timestamp}`,
        '',
        '🔑 *Acciones Disponibles:*',
        `/user_${userId} - Ver perfil del cliente`,
        `/plan_${planName} - Ver detalles del plan`,
      ].join('\n');

      // Group message: no customer email to prevent PII broadcast.
      const groupMessage = [
        '💰 *NUEVA COMPRA COMPLETADA*',
        '',
        '✅ Un cliente ha completado su pago exitosamente',
        '',
        '👤 *Información del Cliente:*',
        `• Nombre: ${customerName || 'N/A'}`,
        `• ID Usuario: ${userId}`,
        '',
        '📦 *Detalles de la Compra:*',
        `• Plan: ${planName}`,
        `• Monto: $${formattedAmount} USD`,
        `• Proveedor: ${this.getProviderName(provider, 'es')}`,
        `• Transacción ID: \`${transactionId}\``,
        `• Fecha: ${timestamp}`,
        '',
        '🔑 *Acciones Disponibles:*',
        `/user_${userId} - Ver perfil del cliente`,
        `/plan_${planName} - Ver detalles del plan`,
      ].join('\n');

      let sentToAdmin = false;
      let sentToGroup = false;

      // Send to each admin — full message including email
      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, adminMessage, {
            parse_mode: 'Markdown',
          });
          logger.info('Admin payment notification sent', { adminId, userId, planName, amount, provider });
          sentToAdmin = true;
        } catch (sendError) {
          logger.error('Error sending admin notification:', { adminId, userId, error: sendError.message });
        }
      }

      // Send to support group — redacted message without customer email
      if (supportGroupId) {
        try {
          await bot.telegram.sendMessage(supportGroupId, groupMessage, {
            parse_mode: 'Markdown',
          });

          logger.info('Support group payment notification sent', {
            supportGroupId,
            userId,
            planName,
            amount,
            provider,
          });

          sentToGroup = true;
        } catch (sendError) {
          logger.error('Error sending support group notification:', {
            supportGroupId,
            userId,
            error: sendError.message,
          });
          
          // Enhanced error handling for Telegram API issues
          if (sendError.description && sendError.description.includes('Forbidden')) {
            logger.error('❌ Bot does not have permission to send messages to support group');
            logger.error('   Please ensure the bot is an admin in the support group with post permissions');
          } else if (sendError.description && sendError.description.includes('chat not found')) {
            logger.error('❌ Support group chat not found');
            logger.error('   Please verify SUPPORT_GROUP_ID is correct');
          }
        }
      }

      return sentToAdmin || sentToGroup;
    } catch (error) {
      logger.error('Error in admin payment notification:', {
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send admin daily payment summary
   * @param {Object} params - Notification parameters
   * @param {Object} params.bot - Telegraf bot instance
   * @param {number} params.totalPayments - Total payment count
   * @param {number} params.totalAmount - Total amount collected
   * @param {Array} params.payments - Array of payment objects
   * @returns {Promise<boolean>} Success status
   */
  static async sendAdminDailySummary({ bot, totalPayments, totalAmount, payments = [] }) {
    try {
      const adminIds = process.env.ADMIN_ID
        ? [process.env.ADMIN_ID]
        : (process.env.SUPERADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (adminIds.length === 0) {
        logger.warn('ADMIN_ID/SUPERADMIN_IDS not configured, skipping daily summary');
        return false;
      }

      const date = new Date().toLocaleDateString('es-ES');

      let message = [
        '📊 *RESUMEN DIARIO DE PAGOS*',
        `Fecha: ${date}`,
        '',
        '💰 *Totales:*',
        `• Pagos completados: ${totalPayments}`,
        `• Monto total: $${totalAmount.toFixed(2)} USD`,
        '',
      ].join('\n');

      if (payments.length > 0) {
        message += '📝 *Últimos Pagos:*\n';
        payments.slice(0, 5).forEach((payment, index) => {
          message += `${index + 1}. ${payment.planName} - $${payment.amount.toFixed(2)} (${payment.provider})\n`;
        });
      }

      let sent = false;
      for (const adminId of adminIds) {
        try {
          await bot.telegram.sendMessage(adminId, message, { parse_mode: 'Markdown' });
          sent = true;
        } catch (sendError) {
          logger.error('Error sending admin daily summary:', { adminId, error: sendError.message });
        }
      }
      logger.info('Admin daily summary sent', { totalPayments, totalAmount });
      return sent;
    } catch (error) {
      logger.error('Error in admin daily summary:', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Unified delivery: email (noreply@pnptv.app) with PDF invoice, falling back to
   * Telegram DM when the user has no registered email. Called from every payment
   * webhook after a successful grant so all providers behave identically.
   *
   * @param {string} userId
   * @param {Object} opts
   * @param {string} opts.planId
   * @param {string} opts.planName
   * @param {number} opts.amount
   * @param {string} opts.transactionId
   * @param {string} opts.provider
   * @param {string} [opts.language]
   * @param {Date}   [opts.expiryDate]
   * @param {boolean}[opts.isLifetime]
   */
  static async deliverPurchaseConfirmation(userId, {
    planId, planName, amount, transactionId, provider,
    language, expiryDate = null, isLifetime = false,
  }) {
    try {
      const { query } = require('../config/postgres');
      const row = await query(
        'SELECT email, telegram, first_name, language AS lang FROM users WHERE id = $1',
        [userId]
      );
      const u = row.rows[0];
      if (!u) {
        logger.warn('[deliverPurchaseConfirmation] user not found', { userId });
        return;
      }

      const lang = language || u.lang || 'es';
      const customerName = u.first_name || userId;

      if (u.email) {
        try {
          const EmailService = require('./emailservice');
          await EmailService.sendPurchaseConfirmationEmail({
            to: u.email,
            customerName,
            planName: planName || planId,
            amount,
            transactionId,
            provider,
            language: lang,
            expiryDate,
            isLifetime,
          });
        } catch (emailErr) {
          logger.warn('[deliverPurchaseConfirmation] email failed', { userId, error: emailErr.message });
        }
      }

      // Telegram DM — always sent when available (primary channel for bot users)
      if (u.telegram) {
        try {
          await PaymentNotificationService.sendPaymentConfirmation(userId, {
            planId,
            planName,
            amount,
            provider,
            language: lang,
            expiryDate,
          });
        } catch (tgErr) {
          logger.warn('[deliverPurchaseConfirmation] telegram DM failed', { userId, error: tgErr.message });
        }
      }

      if (!u.email && !u.telegram) {
        logger.warn('[deliverPurchaseConfirmation] user has no email or telegram', { userId, planId, transactionId });
      }
    } catch (err) {
      logger.error('[deliverPurchaseConfirmation] fatal', { userId, error: err.message });
    }
  }
}

module.exports = PaymentNotificationService;
