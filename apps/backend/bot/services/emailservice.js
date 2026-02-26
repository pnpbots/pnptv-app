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
        from: `"PNPtv Billing" <${process.env.PNPTV_FROM_EMAIL || 'billing@pnptv.app'}>`,
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
   * @returns {Promise<Object>} Send result
   */
  async sendWelcomeEmail({ to, customerName, planName, duration, expiryDate, language = 'es' }) {
    try {
      if (!this.transporters.pnptv) {
        logger.warn('PNPtv transporter not configured, skipping welcome email');
        return { success: false, error: 'Transporter not configured' };
      }

      const isSpanish = language === 'es';
      const subject = isSpanish
        ? '¡Bienvenido a PNPtv! 🎬 Tu acceso está listo'
        : 'Welcome to PNPtv! 🎬 Your access is ready';

      const mailOptions = {
        from: `"PNPtv" <${process.env.PNPTV_FROM_EMAIL || 'welcome@pnptv.app'}>`,
        to,
        subject,
        html: this.generateWelcomeEmailHtml({
          customerName: customerName || 'Valued Customer',
          planName,
          duration,
          expiryDate,
          language,
        }),
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
  generateWelcomeEmailHtml({ customerName, planName, duration, expiryDate, language = 'es' }) {
    const isSpanish = language === 'es';

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

      <div class="plan-details">
        <p><strong>📦 Plan:</strong> ${planName}</p>
        <p><strong>⏱️ Duración:</strong> ${duration >= 36500 ? 'Acceso de por vida' : `${duration} días`}</p>
        <p><strong>📅 Válido hasta:</strong> ${expiryDate ? new Date(expiryDate).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Permanente'}</p>
      </div>

      <div class="instructions">
        <h3>🚀 Cómo acceder a PNPtv:</h3>
        <ol>
          <li><strong>Abre Telegram</strong> y busca nuestro bot: <span class="highlight">@PNPtvBot</span></li>
          <li><strong>Inicia el bot</strong> con el comando <code>/start</code></li>
          <li><strong>Tu suscripción ya está activa</strong> - ¡Comienza a disfrutar del contenido!</li>
          <li>Usa el comando <code>/help</code> para ver todas las funciones disponibles</li>
        </ol>
      </div>

      <p style="margin-top: 30px;"><strong>¿Qué puedes hacer con PNPtv?</strong></p>
      <ul>
        <li>📺 Ver contenido exclusivo en streaming</li>

        <li>💬 Participar en la comunidad</li>
        <li>📱 Acceso 24/7 desde cualquier dispositivo</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://t.me/PNPtvBot" class="button">🚀 Ir al Bot de Telegram</a>
      </div>

      <p><strong>¿Necesitas ayuda?</strong><br>
      Nuestro equipo de soporte está disponible para ayudarte. Contáctanos en cualquier momento.</p>

      <p style="margin-top: 30px;">¡Disfruta tu experiencia PNPtv!<br>
      <strong>El Equipo de PNPtv</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | welcome@pnptv.app</p>
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

      <div class="plan-details">
        <p><strong>📦 Plan:</strong> ${planName}</p>
        <p><strong>⏱️ Duration:</strong> ${duration >= 36500 ? 'Lifetime access' : `${duration} days`}</p>
        <p><strong>📅 Valid until:</strong> ${expiryDate ? new Date(expiryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Permanent'}</p>
      </div>

      <div class="instructions">
        <h3>🚀 How to access PNPtv:</h3>
        <ol>
          <li><strong>Open Telegram</strong> and search for our bot: <span class="highlight">@PNPtvBot</span></li>
          <li><strong>Start the bot</strong> with the <code>/start</code> command</li>
          <li><strong>Your subscription is active</strong> - Start enjoying the content!</li>
          <li>Use the <code>/help</code> command to see all available features</li>
        </ol>
      </div>

      <p style="margin-top: 30px;"><strong>What can you do with PNPtv?</strong></p>
      <ul>
        <li>📺 Watch exclusive streaming content</li>

        <li>💬 Join the community</li>
        <li>📱 24/7 access from any device</li>
      </ul>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://t.me/PNPtvBot" class="button">🚀 Go to Telegram Bot</a>
      </div>

      <p><strong>Need help?</strong><br>
      Our support team is available to help you anytime.</p>

      <p style="margin-top: 30px;">Enjoy your PNPtv experience!<br>
      <strong>The PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | welcome@pnptv.app</p>
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
