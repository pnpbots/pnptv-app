const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

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
          pool: true,
          maxConnections: 2,
          rateDelta: 1000,
          rateLimit: 3,
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
          pool: true,
          maxConnections: 2,
          rateDelta: 1000,
          rateLimit: 3,
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
        from: process.env.PNPTV_FROM_EMAIL || '"PNPtv" <hello@pnptv.app>',
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
   * Unified purchase confirmation email — sent from hello@pnptv.app for every
   * completed payment regardless of provider. Generates a PDF invoice inline.
   */
  async sendPurchaseConfirmationEmail({
    to, customerName, planName, amount, currency = 'USD',
    transactionId, provider = 'payment', language = 'es',
    expiryDate = null, isLifetime = false,
  }) {
    try {
      if (!this.transporters.pnptv) {
        logger.warn('[PurchaseConfirmation] pnptv transporter not configured, skipping');
        return { success: false, error: 'Transporter not configured' };
      }
      if (!to) {
        return { success: false, error: 'No recipient email' };
      }

      const InvoiceService = require('./invoiceservice');
      let invoicePdf = null;
      try {
        const inv = await InvoiceService.generateInvoice({
          invoiceNumber: transactionId || `PNP-${Date.now()}`,
          customerName: customerName || 'Valued Customer',
          planName,
          amount,
          currency,
          provider,
          transactionId,
          purchaseDate: new Date(),
          expiryDate: isLifetime ? null : expiryDate,
          language,
        });
        invoicePdf = inv.buffer;
      } catch (pdfErr) {
        logger.warn('[PurchaseConfirmation] PDF generation failed, sending without attachment', { error: pdfErr.message });
      }

      const isEs = language === 'es';
      const subject = isEs
        ? `Confirmación de compra — PNPtv #${transactionId || ''}`
        : `Purchase confirmation — PNPtv #${transactionId || ''}`;

      const expiryLine = isLifetime
        ? (isEs ? '<p><strong>Duración:</strong> Permanente ♾️</p>' : '<p><strong>Duration:</strong> Permanent ♾️</p>')
        : expiryDate
          ? (isEs
              ? `<p><strong>Vence:</strong> ${new Date(expiryDate).toLocaleDateString('es-ES')}</p>`
              : `<p><strong>Expires:</strong> ${new Date(expiryDate).toLocaleDateString('en-US')}</p>`)
          : '';

      const html = isEs ? `
<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
  .wrap{max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
  .hdr{background:#1C1C1E;padding:24px 30px;text-align:center}
  .hdr h1{color:#fff;margin:0;font-size:26px}.hdr span{color:#D4007A}
  .body{padding:30px}
  .box{background:#f8f9fa;border-left:4px solid #D4007A;padding:16px 20px;border-radius:4px;margin:20px 0}
  .box p{margin:6px 0}
  .btn{display:inline-block;margin:20px 0;padding:12px 28px;background:#D4007A;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold}
  .ftr{text-align:center;padding:20px;color:#888;font-size:12px;border-top:1px solid #eee}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>PNPtv<span>!</span></h1></div>
  <div class="body">
    <p>Hola <strong>${customerName || 'amig@'}</strong>,</p>
    <p>¡Gracias por tu compra! Tu membresía está <strong>activa ahora mismo</strong>.</p>
    <div class="box">
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Monto:</strong> $${parseFloat(amount || 0).toFixed(2)} ${currency}</p>
      <p><strong>Referencia:</strong> ${transactionId || '—'}</p>
      <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES')}</p>
      ${expiryLine}
    </div>
    <p>Accede a tu cuenta en <a href="https://pnptv.app">pnptv.app</a></p>
    <a class="btn" href="https://pnptv.app">Ir a PNPtv</a>
    <p>Si tienes preguntas, escríbenos a <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>
  </div>
  <div class="ftr"><p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p></div>
</div>
</body></html>` : `
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}
  .wrap{max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
  .hdr{background:#1C1C1E;padding:24px 30px;text-align:center}
  .hdr h1{color:#fff;margin:0;font-size:26px}.hdr span{color:#D4007A}
  .body{padding:30px}
  .box{background:#f8f9fa;border-left:4px solid #D4007A;padding:16px 20px;border-radius:4px;margin:20px 0}
  .box p{margin:6px 0}
  .btn{display:inline-block;margin:20px 0;padding:12px 28px;background:#D4007A;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold}
  .ftr{text-align:center;padding:20px;color:#888;font-size:12px;border-top:1px solid #eee}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>PNPtv<span>!</span></h1></div>
  <div class="body">
    <p>Hi <strong>${customerName || 'there'}</strong>,</p>
    <p>Thank you for your purchase! Your membership is <strong>active right now</strong>.</p>
    <div class="box">
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Amount:</strong> $${parseFloat(amount || 0).toFixed(2)} ${currency}</p>
      <p><strong>Reference:</strong> ${transactionId || '—'}</p>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-US')}</p>
      ${expiryLine}
    </div>
    <p>Access your account at <a href="https://pnptv.app">pnptv.app</a></p>
    <a class="btn" href="https://pnptv.app">Go to PNPtv</a>
    <p>Questions? Email us at <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>
  </div>
  <div class="ftr"><p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p></div>
</div>
</body></html>`;

      const attachments = invoicePdf ? [{
        filename: `pnptv-invoice-${transactionId || Date.now()}.pdf`,
        content: invoicePdf,
        contentType: 'application/pdf',
      }] : [];

      const result = await this.transporters.pnptv.sendMail({
        from: process.env.PNPTV_FROM_EMAIL || '"PNPtv" <hello@pnptv.app>',
        to,
        subject,
        html,
        attachments,
      });

      logger.info('[PurchaseConfirmation] Email sent', { to, transactionId, messageId: result.messageId });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('[PurchaseConfirmation] Email failed', { to, transactionId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send SSO credentials email when a new Authentik account is provisioned.
   * @param {Object} options
   * @param {string} options.to - Recipient email
   * @param {string} options.customerName - Display name
   * @param {string} options.username - Authentik username
   * @param {string} options.password - Generated password
   * @param {string} options.loginUrl - Login URL (e.g., https://pnptv.app)
   * @param {string} [options.language='es'] - Email language (en/es)
   * @returns {Promise<Object>}
   */
  async sendCredentialsEmail({ to, customerName, username, password, loginUrl, language = 'es' }) {
    try {
      if (!this.transporters.pnptv) {
        logger.warn('PNPtv transporter not configured, skipping credentials email');
        return { success: false, error: 'Transporter not configured' };
      }

      const isSpanish = language === 'es';
      const subject = isSpanish
        ? 'Tus credenciales de acceso a PNPtv'
        : 'Your PNPtv Access Credentials';

      const mailOptions = {
        from: process.env.PNPTV_FROM_EMAIL || '"PNPtv" <hello@pnptv.app>',
        to,
        subject,
        html: this.generateCredentialsEmailHtml({ customerName, username, password, loginUrl, language }),
      };

      const result = await this.transporters.pnptv.sendMail(mailOptions);

      logger.info('Credentials email sent successfully', {
        to,
        username,
        messageId: result.messageId,
      });

      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Error sending credentials email:', { error: error.message, to });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate HTML for SSO credentials email
   * @private
   */
  generateCredentialsEmailHtml({ customerName, username, password, loginUrl, language = 'es' }) {
    const isSpanish = language === 'es';

    const title = isSpanish ? 'Tus Credenciales PNPtv' : 'Your PNPtv Credentials';
    const greeting = isSpanish ? `Hola <strong>${customerName}</strong>,` : `Hello <strong>${customerName}</strong>,`;
    const intro = isSpanish
      ? 'Tu cuenta SSO de PNPtv ha sido creada automáticamente. Con estas credenciales puedes acceder a <strong>todos los servicios</strong> de la plataforma con un solo inicio de sesión:'
      : 'Your PNPtv SSO account has been created automatically. With these credentials you can access <strong>all platform services</strong> with a single login:';
    const userLabel = isSpanish ? 'Usuario' : 'Username';
    const passLabel = isSpanish ? 'Contraseña' : 'Password';
    const servicesTitle = isSpanish ? 'Servicios incluidos:' : 'Services included:';
    const btnText = isSpanish ? 'Iniciar Sesión en PNPtv' : 'Log in to PNPtv';
    const securityNote = isSpanish
      ? 'Guarda estas credenciales en un lugar seguro. Puedes cambiar tu contraseña después de iniciar sesión en'
      : 'Save these credentials in a safe place. You can change your password after logging in at';
    const footer = isSpanish
      ? 'Este es un correo automático, por favor no respondas directamente.'
      : 'For help or questions, contact <a href="mailto:support@pnptv.app">support@pnptv.app</a>.';

    return `
<!DOCTYPE html>
<html lang="${isSpanish ? 'es' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #667eea; }
    .header h1 { color: #667eea; margin: 0; font-size: 28px; }
    .credentials-box { background: #1a1a2e; color: #fff; padding: 25px; border-radius: 8px; margin: 25px 0; font-family: monospace; }
    .credentials-box .label { color: #aaa; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
    .credentials-box .value { font-size: 18px; font-weight: bold; color: #D4007A; margin-bottom: 15px; letter-spacing: 1px; }
    .services-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0; }
    .service-badge { background: #f0f0ff; color: #667eea; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; }
    .button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; }
    .security-note { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #FFB454; font-size: 13px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PNPtv</h1>
      <p style="color: #666; margin: 8px 0 0;">${title}</p>
    </div>

    <div style="padding: 20px 0;">
      <p>${greeting}</p>
      <p>${intro}</p>

      <div class="credentials-box">
        <div class="label">${userLabel}</div>
        <div class="value">${username}</div>
        <div class="label">${passLabel}</div>
        <div class="value">${password}</div>
      </div>

      <p><strong>${servicesTitle}</strong></p>
      <div class="services-grid">
        <span class="service-badge">PNPtv App</span>
        <span class="service-badge">Matrix Chat</span>
        <span class="service-badge">PNP Live</span>
        <span class="service-badge">Hangouts</span>
        <span class="service-badge">Radio</span>
        <span class="service-badge">Booking</span>
        <span class="service-badge">CMS</span>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginUrl}" class="button">${btnText}</a>
      </div>

      <div class="security-note">
        <p style="margin: 0;">${securityNote} <a href="https://auth.pnptv.app" style="color: #667eea;">auth.pnptv.app</a></p>
      </div>
    </div>

    <div class="footer">
      <p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p>
      <p>${footer}</p>
    </div>
  </div>
</body>
</html>
    `.trim();
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

      <p>Questions about this invoice? Contact us at <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>

      <p>Best regards,<br>
      <strong>PNPtv Team</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv | billing@pnptv.app</p>
      <p>For help or questions, contact <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>
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
      <p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p>
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
      <p>PNPtv! &middot; <a href="mailto:support@pnptv.app" style="color:inherit;">support@pnptv.app</a></p>
      <p>For help or questions, contact <a href="mailto:support@pnptv.app">support@pnptv.app</a>.</p>
    </div>
  </div>
</body>
</html>
      `.trim();
    }
  }

  /**
   * Send the combined Founder Lifetime email: Meru code + login credentials + Recovery ID.
   * Bilingual (en/es). Includes 1-hour expiry warning, Pay button, and Activate button.
   * @param {Object} opts
   * @param {string} opts.to - Recipient email address
   * @param {string} [opts.language='es'] - 'en' or 'es'
   * @param {string} opts.meruCode - The reserved Meru code (displayed prominently)
   * @param {string} opts.meruUrl - Full Meru payment link URL
   * @param {string} opts.loginEmail - The user's login email
   * @param {string} opts.loginPassword - Plaintext password (new accounts only)
   * @param {string} opts.recoveryId - User UUID for account recovery
   * @param {string} opts.activationUrl - Deep-link back to /lifetime100/activate?code=...
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendFounderLifetimeEmail({ to, language = 'es', meruCode, meruUrl, loginEmail, loginPassword, recoveryId, activationUrl }) {
    try {
      if (!this.transporters.pnptv) {
        logger.warn('PNPtv transporter not configured, skipping founder email');
        return { success: false, error: 'Transporter not configured' };
      }
      const isEs = language === 'es';
      const subject = isEs
        ? 'Tu Código de Activación PNPtv Founder — Válido 1 Hora'
        : 'Your PNPtv Founder Activation Code — Valid 1 Hour';

      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const safeCode = esc(meruCode);
      const safeMeruUrl = esc(meruUrl);
      const safeActivation = esc(activationUrl);
      const safeEmail = esc(loginEmail);
      const safePassword = esc(loginPassword);
      const safeRecovery = esc(recoveryId);

      const html = isEs ? `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;background:#120d14;color:#F5F5F7;border-radius:16px;">
  <h2 style="color:#FFB454;margin:0 0 6px;font-size:22px;">¡Bienvenido, Founder! 🚀</h2>
  <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Gracias por apoyarnos mientras terminamos PNPtv. Aquí está tu código de activación de por vida:</p>
  <div style="background:rgba(255,180,84,0.10);border:2px dashed #FFB454;border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.1em;color:#FFB454;text-transform:uppercase;font-weight:700;">Tu código Founder</p>
    <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;font-weight:900;letter-spacing:2px;color:#fff;">${safeCode}</p>
    <p style="margin:10px 0 0;font-size:12px;color:#ff3377;font-weight:700;">⏱ Válido solo por 1 hora</p>
  </div>
  <ol style="font-size:14px;line-height:1.7;padding-left:20px;margin:18px 0;">
    <li><strong>Paga $100 en Meru</strong> usando el botón abajo.</li>
    <li><strong>Regresa y activa</strong> con el código arriba.</li>
    <li>¡Listo! Miembro de por vida + 2 meses PRIME.</li>
  </ol>
  <div style="text-align:center;margin:22px 0;">
    <a href="${safeMeruUrl}" style="display:inline-block;padding:14px 28px;background:#ff3377;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;margin:4px;">💳 Pagar $100 en Meru</a>
    <br/>
    <a href="${safeActivation}" style="display:inline-block;padding:14px 28px;background:#FFB454;color:#120d14;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;margin:4px;">✓ Ya pagué — Activar</a>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:24px;padding-top:18px;">
    <p style="margin:0 0 10px;font-size:13px;color:#A1A1A6;font-weight:700;">Tus credenciales de acceso:</p>
    <table style="width:100%;font-size:13px;">
      <tr><td style="padding:3px 0;color:#A1A1A6;">Email:</td><td style="padding:3px 0;font-weight:700;">${safeEmail}</td></tr>
      <tr><td style="padding:3px 0;color:#A1A1A6;">Contraseña:</td><td style="padding:3px 0;font-family:monospace;font-weight:700;">${safePassword}</td></tr>
    </table>
    <div style="margin-top:12px;padding:10px;background:rgba(255,180,84,0.08);border-left:3px solid #FFB454;border-radius:4px;">
      <p style="margin:0;font-size:11px;color:#FFB454;font-weight:700;">🔑 ID de Recuperación</p>
      <p style="margin:4px 0 0;font-family:monospace;font-size:13px;">${safeRecovery}</p>
    </div>
  </div>
  <p style="font-size:11px;color:#8E8E93;margin-top:20px;line-height:1.5;">Si tu código expira antes de completar el pago, solicita uno nuevo en pnptv.app/lifetime100. Precio especial para ayudarnos a terminar la app — algunas funciones aún están en desarrollo.</p>
</div>`
        : `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;background:#120d14;color:#F5F5F7;border-radius:16px;">
  <h2 style="color:#FFB454;margin:0 0 6px;font-size:22px;">Welcome, Founder! 🚀</h2>
  <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Thanks for backing us while we finish building PNPtv. Here's your lifetime activation code:</p>
  <div style="background:rgba(255,180,84,0.10);border:2px dashed #FFB454;border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.1em;color:#FFB454;text-transform:uppercase;font-weight:700;">Your Founder Code</p>
    <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;font-weight:900;letter-spacing:2px;color:#fff;">${safeCode}</p>
    <p style="margin:10px 0 0;font-size:12px;color:#ff3377;font-weight:700;">⏱ Valid for 1 hour only</p>
  </div>
  <ol style="font-size:14px;line-height:1.7;padding-left:20px;margin:18px 0;">
    <li><strong>Pay $100 on Meru</strong> using the button below.</li>
    <li><strong>Return and activate</strong> with the code above.</li>
    <li>Done! Lifetime member + 2 months PRIME.</li>
  </ol>
  <div style="text-align:center;margin:22px 0;">
    <a href="${safeMeruUrl}" style="display:inline-block;padding:14px 28px;background:#ff3377;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;margin:4px;">💳 Pay $100 on Meru</a>
    <br/>
    <a href="${safeActivation}" style="display:inline-block;padding:14px 28px;background:#FFB454;color:#120d14;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;margin:4px;">✓ Already paid — Activate</a>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:24px;padding-top:18px;">
    <p style="margin:0 0 10px;font-size:13px;color:#A1A1A6;font-weight:700;">Your login credentials:</p>
    <table style="width:100%;font-size:13px;">
      <tr><td style="padding:3px 0;color:#A1A1A6;">Email:</td><td style="padding:3px 0;font-weight:700;">${safeEmail}</td></tr>
      <tr><td style="padding:3px 0;color:#A1A1A6;">Password:</td><td style="padding:3px 0;font-family:monospace;font-weight:700;">${safePassword}</td></tr>
    </table>
    <div style="margin-top:12px;padding:10px;background:rgba(255,180,84,0.08);border-left:3px solid #FFB454;border-radius:4px;">
      <p style="margin:0;font-size:11px;color:#FFB454;font-weight:700;">🔑 Recovery ID</p>
      <p style="margin:4px 0 0;font-family:monospace;font-size:13px;">${safeRecovery}</p>
    </div>
  </div>
  <p style="font-size:11px;color:#8E8E93;margin-top:20px;line-height:1.5;">If your code expires before you complete payment, request a new one at pnptv.app/lifetime100. Special fundraising price to help us finish building — some features are still in development.</p>
</div>`;

      const result = await this.transporters.pnptv.sendMail({
        from: process.env.PNPTV_FROM_EMAIL || '"PNPtv Founder" <hello@pnptv.app>',
        to,
        subject,
        html,
      });
      logger.info('Founder lifetime email sent', { to, meruCode, messageId: result.messageId });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('sendFounderLifetimeEmail error:', { error: error.message, to });
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
