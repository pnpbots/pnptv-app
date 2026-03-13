const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

/**
 * Email Service - Handles sending emails from multiple domains
 * - pnptv.app for invoices/billing
 * - pnptv.app for welcome/instructions
 */
class EmailService {
  constructor() {
    this.transporters = {
      easybots: null,
      pnptv: null,
    };

    // Initialize transporters if config is available
    this.initTransporters();
  }

  /**
   * Initialize email transporters for both domains
   */
  initTransporters() {
    try {
      // EasyBots transporter (for invoices)
      if (process.env.EASYBOTS_SMTP_HOST) {
        this.transporters.easybots = nodemailer.createTransport({
          host: process.env.EASYBOTS_SMTP_HOST,
          port: parseInt(process.env.EASYBOTS_SMTP_PORT || '587'),
          secure: process.env.EASYBOTS_SMTP_SECURE === 'true', // true for 465, false for other ports
          auth: {
            user: process.env.EASYBOTS_SMTP_USER,
            pass: process.env.EASYBOTS_SMTP_PASS,
          },
        });
        logger.info('EasyBots email transporter initialized');
      } else {
        logger.warn('EasyBots SMTP not configured, invoice emails will not be sent');
      }

      // PNPtv transporter (for welcome emails)
      if (process.env.PNPTV_SMTP_HOST) {
        this.transporters.pnptv = nodemailer.createTransport({
          host: process.env.PNPTV_SMTP_HOST,
          port: parseInt(process.env.PNPTV_SMTP_PORT || '587'),
          secure: process.env.PNPTV_SMTP_SECURE === 'true',
          auth: {
            user: process.env.PNPTV_SMTP_USER,
            pass: process.env.PNPTV_SMTP_PASS,
          },
        });
        logger.info('PNPtv email transporter initialized');
      } else {
        logger.warn('PNPtv SMTP not configured, welcome emails will not be sent');
      }
    } catch (error) {
      logger.error('Error initializing email transporters:', error);
    }
  }

  /**
   * Send invoice email from pnptv.app
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.subject - Email subject
   * @param {Buffer} options.invoicePdf - PDF invoice buffer
   * @param {string} options.invoiceNumber - Invoice number
   * @param {string} options.customerName - Customer name
   * @param {number} options.amount - Payment amount
   * @param {string} options.planName - Plan name
   * @returns {Promise<Object>} Send result
   */
  async sendInvoiceEmail({ to, subject, invoicePdf, invoiceNumber, customerName, amount, planName }) {
    try {
      if (!this.transporters.easybots) {
        logger.warn('EasyBots transporter not configured, skipping invoice email');
        return { success: false, error: 'Transporter not configured' };
      }

      const mailOptions = {
        from: `"PNPtv Billing" <${process.env.EASYBOTS_SMTP_USER || 'hello@easybots.store'}>`,
        to,
        subject: subject || `Invoice #${invoiceNumber} - PNPtv`,
        html: this.generateInvoiceEmailHtml({
          customerName: customerName || 'Valued Customer',
          invoiceNumber,
          amount,
          planName,
        }),
        attachments: invoicePdf ? [{
          filename: `invoice-${invoiceNumber}.pdf`,
          content: invoicePdf,
          contentType: 'application/pdf',
        }] : [],
      };

      const result = await this.transporters.easybots.sendMail(mailOptions);

      logger.info('Invoice email sent successfully', {
        to,
        invoiceNumber,
        messageId: result.messageId,
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Error sending invoice email:', {
        error: error.message,
        to,
        invoiceNumber,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send welcome email from pnptv.app with access instructions
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.customerName - Customer name
   * @param {string} options.planName - Plan name
   * @param {number} options.duration - Plan duration in days
   * @param {Date} options.expiryDate - Subscription expiry date
   * @param {string} options.language - Email language (en/es)
   * @param {string} options.userUuid - User's unique ID for recovery
   * @param {string} options.username - User's username
   * @param {string} options.loginMethod - Method used to login (telegram, x, email, deep_link)
   * @returns {Promise<Object>} Send result
   */
  async sendWelcomeEmail({ 
    to, customerName, planName, duration, expiryDate, 
    language = 'es', onboardingGuidePdf = null,
    userUuid = null, username = null, loginMethod = null
  }) {
    try {
      if (!this.transporters.pnptv) {
        logger.warn('PNPtv transporter not configured, skipping welcome email');
        return { success: false, error: 'Transporter not configured' };
      }

      const isSpanish = language === 'es';
      const subject = isSpanish
        ? 'Tu Guía de Membresía PNPtv 🎬'
        : 'Your PNPtv Membership Guide 🎬';

      const attachments = [];
      if (onboardingGuidePdf) {
        attachments.push({
          filename: isSpanish ? 'Como-Usar-PNPtv.pdf' : 'How-to-Use-PNPtv.pdf',
          content: onboardingGuidePdf,
          contentType: 'application/pdf',
        });
      }

      const mailOptions = {
        from: '"PNPtv" <noreply@pnptv.app>',
        to,
        subject,
        html: this.generateWelcomeEmailHtml({
          customerName: customerName || 'Valued Customer',
          planName,
          duration,
          expiryDate,
          language,
          userUuid,
          username,
          loginMethod
        }),
        attachments,
      };

      const result = await this.transporters.pnptv.sendMail(mailOptions);

      logger.info('Welcome email sent successfully', {
        to,
        planName,
        language,
        messageId: result.messageId,
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Error sending welcome email:', {
        error: error.message,
        to,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML for invoice email
   * @private
   */
  generateInvoiceEmailHtml({ customerName, invoiceNumber, amount, planName }) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #667eea; }
    .header h1 { color: #667eea; margin: 0; }
    .content { padding: 20px 0; }
    .invoice-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .invoice-details p { margin: 8px 0; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
    .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 PNPtv</h1>
      <p>Payment Invoice</p>
    </div>

    <div class="content">
      <p>Dear ${customerName},</p>

      <p>Thank you for your payment. Please find your invoice details below:</p>

      <div class="invoice-details">
        <p><strong>Invoice Number:</strong> ${invoiceNumber}</p>
        <p><strong>Plan:</strong> ${planName || 'Subscription'}</p>
        <p><strong>Amount:</strong> $${amount?.toFixed(2) || '0.00'} USD</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <p>Your invoice is attached to this email as a PDF.</p>

      <p>If you have any questions about this invoice, please contact our support team.</p>

      <p>Best regards,<br>
      <strong>PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | billing@pnptv.app</p>
      <p>This is an automated email, please do not reply directly to this message.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate HTML for welcome email
   * @private
   */
  generateWelcomeEmailHtml({ customerName, planName, duration, expiryDate, language = 'es', userUuid, username, loginMethod }) {
    const isSpanish = language === 'es';

    const recoveryInstructionsEs = userUuid ? `
      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #FFB454;">
        <p style="margin: 0; color: #333;"><strong>🔑 Recuperación de Cuenta:</strong></p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Tu ID de recuperación único es: <strong style="font-family: monospace; font-size: 16px; color: #D4007A;">${userUuid}</strong></p>
        <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Por favor, guarda este ID en un lugar seguro. Es la <strong>única forma</strong> de recuperar el acceso a tu cuenta si pierdes tu método de inicio de sesión.</p>
      </div>
    ` : '';

    const recoveryInstructionsEn = userUuid ? `
      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #FFB454;">
        <p style="margin: 0; color: #333;"><strong>🔑 Account Recovery:</strong></p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Your unique recovery ID is: <strong style="font-family: monospace; font-size: 16px; color: #D4007A;">${userUuid}</strong></p>
        <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Please save this ID in a safe place. It is the <strong>only way</strong> to recover access to your account if you lose your login method.</p>
      </div>
    ` : '';

    const loginDetailsEs = (username || loginMethod) ? `
      <div style="background: #f0f7ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0; color: #333;"><strong>👤 Detalles de Acceso:</strong></p>
        ${username ? `<p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Usuario: <strong>@${username}</strong></p>` : ''}
        ${loginMethod ? `<p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Método de inicio: <strong>${loginMethod}</strong></p>` : ''}
      </div>
    ` : '';

    const loginDetailsEn = (username || loginMethod) ? `
      <div style="background: #f0f7ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0; color: #333;"><strong>👤 Access Details:</strong></p>
        ${username ? `<p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Username: <strong>@${username}</strong></p>` : ''}
        ${loginMethod ? `<p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Login method: <strong>${loginMethod}</strong></p>` : ''}
      </div>
    ` : '';

    if (isSpanish) {
      return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #667eea; }
    .header h1 { color: #667eea; margin: 0; font-size: 32px; }
    .welcome-badge { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .content { padding: 20px 0; }
    .plan-details { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
    .plan-details p { margin: 10px 0; }
    .instructions { background: #e8f4ff; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .instructions h3 { color: #667eea; margin-top: 0; }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin: 10px 0; }
    .button { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
    .highlight { color: #667eea; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 PNPtv</h1>
    </div>

    <div class="welcome-badge">
      <h2 style="margin: 0;">¡Bienvenido a PNPtv!</h2>
      <p style="margin: 10px 0 0 0;">Tu suscripción está activa</p>
    </div>

    <div class="content">
      <p>Hola <strong>${customerName}</strong>,</p>

      <p>¡Gracias por unirte a PNPtv! Tu pago ha sido procesado exitosamente y tu cuenta ya está activa.</p>

      ${loginDetailsEs}

      <div class="plan-details">
        <p><strong>📦 Plan:</strong> ${planName}</p>
        <p><strong>⏱️ Duración:</strong> ${duration >= 36500 ? 'Acceso de por vida' : `${duration} días`}</p>
        <p><strong>📅 Válido hasta:</strong> ${expiryDate ? new Date(expiryDate).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Permanente'}</p>
      </div>

      ${recoveryInstructionsEs}

      <div class="instructions">
        <h3>🚀 Cómo acceder a PNPtv:</h3>
        <ol>
          <li><strong>Visita</strong> <a href="https://pnptv.app/welcome" class="highlight">pnptv.app/welcome</a> para comenzar</li>
          <li><strong>Abre Telegram</strong> y busca nuestro bot: <span class="highlight">@PNPtvBot</span></li>
          <li><strong>Tu suscripción ya está activa</strong> - ¡Comienza a disfrutar del contenido!</li>
        </ol>
      </div>

      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #E69138;">
        <p style="margin: 0;"><strong>📎 Guía adjunta:</strong> Hemos adjuntado un PDF con instrucciones detalladas sobre cómo usar cada función de PNPtv. ¡Guárdalo para referencia!</p>
      </div>

      <p style="margin-top: 20px;"><strong>¿Qué puedes hacer con PNPtv?</strong></p>
      <ul>
        <li>📺 Videorama — Videos, música y podcasts exclusivos</li>
        <li>📹 Hangouts — Salas de videollamadas comunitarias</li>
        <li>🔴 PNP Live — Transmisiones en vivo</li>
        <li>💬 Social Feed — Publica, comenta y conecta</li>
        <li>📍 Nearby — Descubre miembros cercanos</li>
        <li>⭐ Canal PRIME — Contenido premium en Telegram</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://pnptv.app/welcome" class="button">🚀 Comenzar en PNPtv</a>
      </div>

      <p><strong>¿Necesitas ayuda?</strong><br>
      Nuestro equipo de soporte está disponible para ayudarte. Contáctanos en cualquier momento.</p>

      <p style="margin-top: 30px;">¡Disfruta tu experiencia PNPtv!<br>
      <strong>El Equipo de PNPtv</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | noreply@pnptv.app</p>
      <p>Este es un correo automático, por favor no respondas directamente a este mensaje.</p>
    </div>
  </div>
</body>
</html>
      `.trim();
    } else {
      // English version
      return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #667eea; }
    .header h1 { color: #667eea; margin: 0; font-size: 32px; }
    .welcome-badge { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .content { padding: 20px 0; }
    .plan-details { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
    .plan-details p { margin: 10px 0; }
    .instructions { background: #e8f4ff; padding: 20px; border-radius: 5px; margin: 20px 0; }
    .instructions h3 { color: #667eea; margin-top: 0; }
    .instructions ol { padding-left: 20px; }
    .instructions li { margin: 10px 0; }
    .button { display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
    .highlight { color: #667eea; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 PNPtv</h1>
    </div>

    <div class="welcome-badge">
      <h2 style="margin: 0;">Welcome to PNPtv!</h2>
      <p style="margin: 10px 0 0 0;">Your subscription is now active</p>
    </div>

    <div class="content">
      <p>Hello <strong>${customerName}</strong>,</p>

      <p>Thank you for joining PNPtv! Your payment has been processed successfully and your account is now active.</p>

      ${loginDetailsEn}

      <div class="plan-details">
        <p><strong>📦 Plan:</strong> ${planName}</p>
        <p><strong>⏱️ Duration:</strong> ${duration >= 36500 ? 'Lifetime access' : `${duration} days`}</p>
        <p><strong>📅 Valid until:</strong> ${expiryDate ? new Date(expiryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Permanent'}</p>
      </div>

      ${recoveryInstructionsEn}

      <div class="instructions">
        <h3>🚀 How to access PNPtv:</h3>
        <ol>
          <li><strong>Visit</strong> <a href="https://pnptv.app/welcome" class="highlight">pnptv.app/welcome</a> to get started</li>
          <li><strong>Open Telegram</strong> and search for our bot: <span class="highlight">@PNPtvBot</span></li>
          <li><strong>Your subscription is active</strong> - Start enjoying the content!</li>
        </ol>
      </div>

      <div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #E69138;">
        <p style="margin: 0;"><strong>📎 Guide attached:</strong> We've attached a PDF with detailed instructions on how to use every feature of PNPtv. Save it for reference!</p>
      </div>

      <p style="margin-top: 20px;"><strong>What can you do with PNPtv?</strong></p>
      <ul>
        <li>📺 Videorama — Exclusive videos, music, and podcasts</li>
        <li>📹 Hangouts — Community video call rooms</li>
        <li>🔴 PNP Live — Live streams</li>
        <li>💬 Social Feed — Post, comment, and connect</li>
        <li>📍 Nearby — Discover nearby members</li>
        <li>⭐ PRIME Channel — Premium Telegram content</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://pnptv.app/welcome" class="button">🚀 Get Started on PNPtv</a>
      </div>

      <p><strong>Need help?</strong><br>
      Our support team is available to help you anytime.</p>

      <p style="margin-top: 30px;">Enjoy your PNPtv experience!<br>
      <strong>The PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | noreply@pnptv.app</p>
      <p>This is an automated email, please do not reply directly to this message.</p>
    </div>
  </div>
</body>
</html>
      `.trim();
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
