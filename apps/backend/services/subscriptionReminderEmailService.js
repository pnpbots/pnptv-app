const logger = require('../utils/logger');
const EmailService = require('./emailService');
const PaymentHistoryService = require('./paymentHistoryService');
const MembershipCleanupService = require('../bot/services/membershipCleanupService');
const MessageTemplates = require('../bot/services/messageTemplates');
const UserModel = require('../models/userModel');

/**
 * SubscriptionReminderEmailService
 * Sends automated reminder emails based on payment history and subscription status
 * Uses last_payment_date to determine re-engagement timing
 */
class SubscriptionReminderEmailService {
  /**
   * Send renewal reminder emails to users with expiring subscriptions
   * Targets users within 7-14 days of expiry
   * @returns {Promise<Object>} Sending results
   */
  static async sendExpiryReminders() {
    try {
      logger.info('Starting subscription expiry reminder emails...');

      const results = {
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: []
      };

      // Get users with expiring subscriptions
      const users = await MembershipCleanupService.getUsersForReEngagement();

      for (const user of users) {
        try {
          if (!user.email) {
            results.skipped++;
            continue;
          }

          const daysLeft = Math.floor(user.days_until_expiry || 0);
          const lang = user.language || 'es';

          const subject = lang === 'es'
            ? `¡Tu suscripción vence en ${daysLeft} días!`
            : `Your subscription expires in ${daysLeft} days!`;

          const message = this.buildExpiryReminderEmail(user, daysLeft, lang);

          const sent = await EmailService.send({
            to: user.email,
            subject,
            html: message
          });

          if (sent) {
            results.sent++;
          } else {
            results.failed++;
          }
        } catch (error) {
          logger.warn('Error sending expiry reminder to user', {
            userId: user.id,
            error: error.message
          });
          results.failed++;
          results.errors.push({
            userId: user.id,
            error: error.message
          });
        }
      }

      logger.info('Subscription expiry reminder emails sent', results);
      return results;
    } catch (error) {
      logger.error('Error in sendExpiryReminders:', error);
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: [{ global: error.message }]
      };
    }
  }

  /**
   * Send re-engagement emails to inactive/churned users
   * Targets users who haven't paid in 30+ days
   * @returns {Promise<Object>} Sending results
   */
  static async sendReEngagementEmails() {
    try {
      logger.info('Starting re-engagement reminder emails...');

      const results = {
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: []
      };

      // Get churned users (inactive 30+ days)
      const users = await MembershipCleanupService.getInactiveChurnedUsers(30, 200);

      for (const user of users) {
        try {
          if (!user.email) {
            results.skipped++;
            continue;
          }

          const daysSince = Math.floor(user.days_since_payment || 0);
          const lang = user.language || 'es';

          const subject = lang === 'es'
            ? 'Vuelve a PRIME - Tu acceso ha expirado'
            : 'Come back to PRIME - Your access has expired';

          const message = this.buildReEngagementEmail(user, daysSince, lang);

          const sent = await EmailService.send({
            to: user.email,
            subject,
            html: message
          });

          if (sent) {
            results.sent++;
          } else {
            results.failed++;
          }
        } catch (error) {
          logger.warn('Error sending re-engagement email to user', {
            userId: user.id,
            error: error.message
          });
          results.failed++;
          results.errors.push({
            userId: user.id,
            error: error.message
          });
        }
      }

      logger.info('Re-engagement emails sent', results);
      return results;
    } catch (error) {
      logger.error('Error in sendReEngagementEmails:', error);
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        errors: [{ global: error.message }]
      };
    }
  }

  /**
   * Send payment confirmation email
   * Sent immediately after successful payment
   * @param {string} userId - User ID
   * @param {Object} payment - Payment details
   * @returns {Promise<boolean>} Success status
   */
  static async sendPaymentConfirmationEmail(userId, payment) {
    try {
      const user = await UserModel.getById(userId);

      if (!user?.email) {
        logger.warn('No email for payment confirmation', { userId });
        return false;
      }

      const lang = user.language || 'es';
      const subject = lang === 'es'
        ? 'Pago recibido - Bienvenido a PRIME'
        : 'Payment received - Welcome to PRIME';

      const message = this.buildPaymentConfirmationEmail(payment, lang);

      return await EmailService.send({ to: user.email, subject, html: message });
    } catch (error) {
      logger.error('Error sending payment confirmation email:', error);
      return false;
    }
  }

  /**
   * Build expiry reminder email HTML
   */
  static buildExpiryReminderEmail(user, daysLeft, lang) {
    if (lang === 'es') {
      return `
<h2>¡Hola ${user.username}!</h2>

<p>Tu suscripción a PRIME vence en <strong>${daysLeft} días</strong>.</p>

<p>Para no perder acceso a:</p>
<ul>
  <li>🎥 Videos exclusivos</li>
  <li>🎤 Transmisiones en vivo</li>
  <li>💬 Chat privado</li>
  <li>⭐ Contenido premium</li>
</ul>

<p><strong>Renueva ahora</strong> y continúa disfrutando de todos los beneficios PRIME.</p>

<a href="https://pnptv.app/subscribe" style="background-color: #FF00CC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Renovar Suscripción</a>

<p>Si tienes preguntas, contacta con nuestro equipo de soporte.</p>

<p>¡Gracias por ser parte de PNPtv!</p>
      `;
    } else {
      return `
<h2>Hello ${user.username}!</h2>

<p>Your PRIME subscription expires in <strong>${daysLeft} days</strong>.</p>

<p>Don't miss access to:</p>
<ul>
  <li>🎥 Exclusive videos</li>
  <li>🎤 Live streams</li>
  <li>💬 Private chat</li>
  <li>⭐ Premium content</li>
</ul>

<p><strong>Renew now</strong> to continue enjoying all PRIME benefits.</p>

<a href="https://pnptv.app/subscribe" style="background-color: #FF00CC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Renew Subscription</a>

<p>If you have questions, contact our support team.</p>

<p>Thank you for being part of PNPtv!</p>
      `;
    }
  }

  /**
   * Build re-engagement email HTML
   */
  static buildReEngagementEmail(user, daysSince, lang) {
    if (lang === 'es') {
      return `
<h2>¡Hola ${user.username}!</h2>

<p>Hace ${daysSince} días que tu suscripción a PRIME expiró.</p>

<p>Durante tu ausencia hemos añadido:</p>
<ul>
  <li>🆕 Videos nuevos y exclusivos</li>
  <li>🎯 Nuevas funciones premium</li>
  <li>🌟 Contenido especial</li>
</ul>

<p>¡Vuelve y no te pierdas nada!</p>

<a href="https://pnptv.app/subscribe" style="background-color: #FF00CC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reactivar Suscripción</a>

<p>Si tienes dudas, estamos aquí para ayudarte.</p>

<p>¡Te echamos de menos en PNPtv!</p>
      `;
    } else {
      return `
<h2>Hello ${user.username}!</h2>

<p>Your PRIME subscription expired ${daysSince} days ago.</p>

<p>While you've been away, we've added:</p>
<ul>
  <li>🆕 New exclusive videos</li>
  <li>🎯 New premium features</li>
  <li>🌟 Special content</li>
</ul>

<p>Come back and don't miss anything!</p>

<a href="https://pnptv.app/subscribe" style="background-color: #FF00CC; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reactivate Subscription</a>

<p>If you have questions, we're here to help.</p>

<p>We miss you on PNPtv!</p>
      `;
    }
  }

  /**
   * Build payment confirmation email HTML
   */
  static buildPaymentConfirmationEmail(payment, lang) {
    if (lang === 'es') {
      return `
<h2>¡Bienvenido a PRIME!</h2>

<p>Hemos recibido tu pago correctamente.</p>

<h3>Detalles de tu compra:</h3>
<ul>
  <li>Plan: ${payment.planName}</li>
  <li>Monto: ${payment.currency} ${payment.amount}</li>
  <li>Método: ${payment.paymentMethod}</li>
  <li>Fecha: ${new Date().toLocaleDateString()}</li>
</ul>

<p>Ahora tienes acceso a todo el contenido PRIME:</p>
<ul>
  <li>✓ Videos exclusivos</li>
  <li>✓ Transmisiones en vivo</li>
  <li>✓ Chat privado</li>
  <li>✓ Contenido premium</li>
</ul>

<p>Gracias por tu compra. ¡Disfruta de PRIME!</p>
      `;
    } else {
      return `
<h2>Welcome to PRIME!</h2>

<p>We've received your payment successfully.</p>

<h3>Purchase details:</h3>
<ul>
  <li>Plan: ${payment.planName}</li>
  <li>Amount: ${payment.currency} ${payment.amount}</li>
  <li>Method: ${payment.paymentMethod}</li>
  <li>Date: ${new Date().toLocaleDateString()}</li>
</ul>

<p>You now have access to all PRIME content:</p>
<ul>
  <li>✓ Exclusive videos</li>
  <li>✓ Live streams</li>
  <li>✓ Private chat</li>
  <li>✓ Premium content</li>
</ul>

<p>Thank you for your purchase. Enjoy PRIME!</p>
      `;
    }
  }
}

module.exports = SubscriptionReminderEmailService;
