const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const sanitizeHtml = require('sanitize-html');

/**
 * Email Service
 * Handles all email operations including magic link authentication
 */
class EmailService {
    constructor() {
        this.transporter = null;
        this.initialized = false;
    }

    /**
     * Get the from address (lazy loaded to ensure env is ready)
     */
    get from() {
        return process.env.EMAIL_FROM || 'noreply@pnptv.app';
    }

    /**
     * Ensure transporter is initialized (lazy initialization)
     */
    ensureInitialized() {
        if (this.initialized) return;
        this.initialized = true;
        this.initializeTransporter();
    }

    /**
     * Initialize email transporter based on environment config
     */
    initializeTransporter() {
        // Check if email is configured
        if (!process.env.SMTP_HOST && !process.env.SENDGRID_API_KEY) {
            logger.warn('Email service not configured. Emails will be logged instead of sent.');
            return;
        }

        try {
            if (process.env.SENDGRID_API_KEY) {
                // SendGrid configuration
                this.transporter = nodemailer.createTransport({
                    host: 'smtp.sendgrid.net',
                    port: 587,
                    secure: false,
                    auth: {
                        user: 'apikey',
                        pass: process.env.SENDGRID_API_KEY
                    }
                });
                logger.info('Email service initialized with SendGrid');
            } else if (process.env.SMTP_HOST) {
                // Generic SMTP configuration
                this.transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT, 10) || 587,
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASSWORD
                    }
                });
                logger.info('Email service initialized with SMTP');
            }
        } catch (error) {
            logger.error('Error initializing email transporter:', error);
        }
    }

    /**
     * Validate email address to prevent nodemailer parsing vulnerabilities
     * Rejects quoted local-parts that could cause misrouting (CVE-style attack)
     * @param {string} email - Email address to validate
     * @returns {boolean} True if safe, false if potentially malicious
     */
    isEmailSafe(email) {
        if (!email || typeof email !== 'string') {
            return false;
        }

        // Reject emails with quoted local-parts containing @ (parsing vulnerability)
        // Pattern: "anything@something"@domain
        if (/^"[^"]*@[^"]*"@/.test(email)) {
            return false;
        }

        // Basic email format validation
        const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return basicEmailRegex.test(email);
    }

    /**
     * Send an email
     * @param {Object} options - Email options
     * @returns {Promise<Object>} Send result
     */
    async send(options) {
        const {
            to,
            subject,
            html,
            text,
            from = this.from,
            bcc,
            attachments = []
        } = options;

        try {
            // Ensure transporter is initialized (lazy init for env loading)
            this.ensureInitialized();

            // Validate email address to prevent misrouting attacks
            if (!this.isEmailSafe(to)) {
                logger.error('Invalid or potentially malicious email address rejected:', { to });
                throw new Error('Invalid email address format');
            }
            // If no transporter, log email instead
            if (!this.transporter) {
                logger.info('Email would be sent (no transporter configured):', {
                    to,
                    subject,
                    from,
                    attachments: attachments.length
                });
                return { success: true, messageId: 'logged', mode: 'logging' };
            }

            const mailOptions = {
                from,
                to,
                ...(bcc ? { bcc } : {}),
                subject,
                html,
                text: text || this.stripHtml(html),
                attachments: attachments
            };

            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Email sent successfully:', {
                to,
                subject,
                messageId: info.messageId,
                attachments: attachments.length
            });

            return {
                success: true,
                messageId: info.messageId,
                mode: 'sent'
            };
        } catch (error) {
            logger.error('Error sending email:', {
                to,
                subject,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Send welcome email to new user
     * @param {Object} data - Welcome email data
     * @returns {Promise<Object>} Send result
     */
    async sendWelcomeEmail(data) {
        const {
            email,
            userName = 'New User',
            attachments = [],
            userLanguage = 'en'
        } = data;

        const html = this.getWelcomeEmailTemplate({
            userName,
            language: userLanguage
        });

        return await this.send({
            to: email,
            subject: userLanguage === 'es' ? '🎉 ¡Bienvenido a PNP TV Bot!' : '🎉 Welcome to PNP TV Bot!',
            html,
            attachments: attachments
        });
    }

    /**
     * Send broadcast email to user
     * @param {Object} data - Broadcast data
     * @returns {Promise<Object>} Send result
     */
    async sendBroadcastEmail(data) {
        const {
            email,
            userName = 'PNP Latino Member',
            messageEn,
            messageEs,
            userLanguage = 'en',
            mediaUrl = null,
            buttons = [],
            subjectEn = null,
            subjectEs = null,
            preheaderEn = null,
            preheaderEs = null
        } = data;

        const message = userLanguage === 'es' ? messageEs : messageEn;
        const subject = userLanguage === 'es'
            ? (subjectEs || 'PNP Latino Update! Noticias de PNP Latino')
            : (subjectEn || 'PNP Latino Update! Noticias de PNP Latino');
        const preheader = userLanguage === 'es' ? preheaderEs : preheaderEn;
        const html = this.getBroadcastEmailTemplate({
            userName,
            message,
            mediaUrl,
            buttons,
            language: userLanguage,
            preheader
        });

        return await this.send({
            to: email,
            subject,
            html,
            from: 'noreply@pnptv.app'
        });
    }

    /**
     * Send broadcast emails to multiple users
     * @param {Array} users - Array of user objects with email
     * @param {Object} broadcastData - Broadcast content
     * @returns {Promise<Object>} Results summary
     */
    async sendBroadcastEmails(users, broadcastData) {
        const { messageEn, messageEs, mediaUrl, buttons, subjectEn, subjectEs, preheaderEn, preheaderEs } = broadcastData;

        let sent = 0;
        let failed = 0;
        const errors = [];

        for (const user of users) {
            if (!user.email || !this.isEmailSafe(user.email)) {
                continue; // Skip users without valid email
            }

            try {
                await this.sendBroadcastEmail({
                    email: user.email,
                    userName: user.first_name || user.username || 'PNP Latino Member',
                    messageEn,
                    messageEs,
                    userLanguage: user.language || 'en',
                    mediaUrl,
                    buttons,
                    subjectEn,
                    subjectEs,
                    preheaderEn,
                    preheaderEs
                });
                sent++;

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                failed++;
                errors.push({ email: user.email, error: error.message });
            }
        }

        return { sent, failed, errors };
    }

    /**
     * Send reactivation email
     * @param {Object} data - Reactivation email data
     * @returns {Promise<Object>} Send result
     */
    async sendReactivationEmail(data) {
        const { email, userName = 'PNP Latino Member', lifetimeDealLink, telegramLink, userLanguage = 'en' } = data;

        const subject = userLanguage === 'es' ? '🔥 PNP Latino TV Está de Vuelta 🔥' : '🔥 PNP Latino TV IS BACK 🔥';
        const html = this.getReactivationEmailTemplate({ lifetimeDealLink, telegramLink, language: userLanguage });

        return await this.send({
            to: email,
            subject: subject,
            html,
            from: 'noreply@pnptv.app'
        });
    }

    /**
     * Send recording ready notification
     * @param {Object} data - Recording data
     * @returns {Promise<Object>} Send result
     */
    async sendRecordingReady(data) {
        const {
            email,
            roomTitle,
            recordingUrl,
            downloadUrl,
            duration,
            fileSize
        } = data;

        const html = this.getRecordingReadyTemplate({
            roomTitle,
            recordingUrl,
            downloadUrl,
            fileSize,
            duration
        });

        return await this.send({
            to: email,
            subject: `📹 Your Recording is Ready - ${roomTitle}`,
            html
        });
    }

    /**
     * Get broadcast email template
     * @param {Object} data - Template data
     * @returns {string} HTML template
     */
    getBroadcastEmailTemplate(data) {
        const { userName, message, mediaUrl, buttons, language, preheader } = data;

        const isSpanish = language === 'es';
        const greeting = isSpanish ? `¡Hola ${userName}!` : `Hey ${userName}!`;
        const footerText = isSpanish
            ? 'Recibiste este correo porque eres miembro de PNP Latino TV.'
            : 'You received this email because you are a member of PNP Latino TV.';
        const unsubText = isSpanish
            ? 'Para dejar de recibir estos correos, actualiza tus preferencias en el bot.'
            : 'To stop receiving these emails, update your preferences in the bot.';

        // Build button HTML
        let buttonsHtml = '';
        if (buttons && buttons.length > 0) {
            const buttonItems = buttons.map(btn => {
                const buttonObj = typeof btn === 'string' ? JSON.parse(btn) : btn;
                if (buttonObj.type === 'url' && buttonObj.target) {
                    return `<a href="${buttonObj.target}" class="button">${buttonObj.text}</a>`;
                }
                return '';
            }).filter(b => b).join('\n');

            if (buttonItems) {
                buttonsHtml = `<div style="text-align: center; margin: 25px 0;">${buttonItems}</div>`;
            }
        }

        // Media HTML
        const mediaHtml = mediaUrl
            ? `<div style="text-align: center; margin: 20px 0;"><img src="${mediaUrl}" alt="PNP Latino" style="max-width: 100%; border-radius: 10px;"></div>`
            : '';

        // Convert message line breaks to HTML
        const formattedMessage = message
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        const preheaderText = preheader
            ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;">${preheader}</span>`
            : '';

        return `
<!DOCTYPE html>
<html lang="${isSpanish ? 'es' : 'en'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #1a1a2e;
        }
        .container {
            background: linear-gradient(135deg, #16213e 0%, #1a1a2e 100%);
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            color: #ffffff;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            background: linear-gradient(90deg, #e94560, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .greeting {
            font-size: 22px;
            margin-bottom: 20px;
            color: #ff6b6b;
        }
        .content {
            font-size: 16px;
            line-height: 1.8;
            color: #e0e0e0;
        }
        .button {
            display: inline-block;
            background: linear-gradient(90deg, #e94560, #ff6b6b);
            color: white !important;
            padding: 14px 35px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            margin: 10px 5px;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(233, 69, 96, 0.4);
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #888;
            font-size: 12px;
        }
        .social-links {
            margin: 15px 0;
        }
        .social-links a {
            color: #e94560;
            text-decoration: none;
            margin: 0 10px;
        }
    </style>
</head>
<body>
    ${preheaderText}
    <div class="container">
        <div class="header">
            <div class="logo">🔥 PNP Latino TV</div>
        </div>

        <h1 class="greeting">${greeting}</h1>

        ${mediaHtml}

        <div class="content">
            ${formattedMessage}
        </div>

        ${buttonsHtml}

        <div style="text-align: center; margin-top: 30px;">
            <a href="https://t.me/pnplatinotv_bot" class="button">💬 Open Bot</a>
        </div>

        <div class="footer">
            <div class="social-links">
                <a href="https://t.me/pnplatinotv_bot">Telegram</a>
            </div>
            <p>${footerText}</p>
            <p>${unsubText}</p>
            <p>© ${new Date().getFullYear()} PNP Latino TV. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Get welcome email template
     * @param {Object} data - Template data
     * @returns {string} HTML template
     */
    getWelcomeEmailTemplate(data) {
        const { userName, language = 'en' } = data;
        const isSpanish = language === 'es';

        const welcomeTitle = isSpanish ? '¡Bienvenido a PNP TV Bot!' : 'Welcome to PNP TV Bot!';
        const greeting = isSpanish ? `¡Hola ${userName},` : `Hello ${userName},`;
        const welcomeMessage = isSpanish 
            ? '¡Estamos encantados de darte la bienvenida a la comunidad de PNP TV! Prepárate para una experiencia emocionante y atractiva con nuestro bot y canal de Telegram.'
            : 'We\'re thrilled to welcome you to the PNP TV community! Get ready for an exciting and engaging experience with our Telegram bot and channel.';
        
        const whatIsPNP = isSpanish ? '¿Qué es PNP TV?' : 'What is PNP TV?';
        const communityDesc = isSpanish 
            ? 'PNP TV es una comunidad vibrante donde puedes:'
            : 'PNP TV is a vibrant community where you can:';
        
        const communityBenefits = isSpanish ? [
            'Conectar con personas afines',
            'Disfrutar de contenido exclusivo y transmisiones en vivo',
            'Participar en eventos interactivos',
            'Acceder a funciones premium a través de nuestro bot'
        ] : [
            'Connect with like-minded individuals',
            'Enjoy exclusive content and live streams',
            'Participate in interactive events',
            'Access premium features through our bot'
        ];
        
        const botFeaturesDesc = isSpanish 
            ? 'Nuestro bot mejora tu experiencia proporcionando:'
            : 'Our bot enhances your experience by providing:';
        
        const botFeatures = isSpanish ? [
            'Notificaciones personalizadas',
            'Acceso fácil a contenido exclusivo',
            'Características y juegos interactivos',
            'Comunicación segura y privada'
        ] : [
            'Personalized notifications',
            'Easy access to exclusive content',
            'Interactive features and games',
            'Secure and private communication'
        ];
        
        const getStarted = isSpanish 
            ? 'Para comenzar y obtener más información sobre lo que ofrecemos, visita nuestra página de inicio:'
            : 'To get started and learn more about what we offer, visit our landing page:';
        
        const buttonText = isSpanish ? 'Visitar Página de Inicio de PNP TV' : 'Visit PNP TV Landing Page';
        
        const excitedMessage = isSpanish 
            ? '¡Estamos emocionados de que te unas a nuestra comunidad y esperamos brindarte una experiencia increíble!'
            : 'We\'re excited to have you join our community and look forward to providing you with an amazing experience!';
        
        const regards = isSpanish ? 'Atentamente,' : 'Best regards,';
        const teamName = isSpanish ? 'El Equipo de PNP TV' : 'The PNP TV Team';
        
        const footerText = isSpanish 
            ? 'Si tienes alguna pregunta, no dudes en ponerte en contacto con nuestro equipo de soporte.'
            : 'If you have any questions, please don\'t hesitate to contact our support team.';

        return `
<!DOCTYPE html>
<html lang="${isSpanish ? 'es' : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>${welcomeTitle}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #ffffff;
            background-color: #0b0b0f; /* Dark background */
        }
        .container {
            background-color: #1a1a2e; /* Slightly lighter dark background for content */
            border-radius: 15px;
            box-shadow: 0 8px 25px rgba(0, 229, 255, 0.2); /* Neon blue shadow */
            padding: 20px;
            margin: 20px auto; /* Center on page */
            max-width: 600px;
            border: 1px solid #ff00cc; /* Fuchsia border */
        }
        .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 2px solid #00e5ff; /* Neon blue divider */
            margin-bottom: 20px;
        }
        h1 {
            color: #ff00cc; /* Fuchsia */
            font-size: 32px;
            margin-bottom: 5px;
            text-shadow: 0 0 10px rgba(255, 0, 204, 0.7); /* Neon glow */
        }
        h2 {
            color: #00e5ff; /* Neon Blue */
            font-size: 24px;
            margin-top: 0;
            text-shadow: 0 0 8px rgba(0, 229, 255, 0.7); /* Neon glow */
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            color: #dddddd;
            margin-bottom: 15px;
        }
        ul {
            list-style: none;
            padding: 0;
            margin-bottom: 15px;
        }
        li {
            margin-bottom: 8px;
            padding-left: 20px;
            position: relative;
            color: #dddddd;
        }
        li::before {
            content: '✨'; /* Sparkle bullet */
            position: absolute;
            left: 0;
            color: #00e5ff;
        }
        .button-primary {
            display: inline-block;
            background-color: #ff00cc; /* Fuchsia */
            color: #ffffff !important;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 50px; /* Pill shape */
            font-weight: bold;
            font-size: 18px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(255, 0, 204, 0.4);
            border: none;
        }
        .button-primary:hover {
            background-color: #e600b8; /* Darker fuchsia on hover */
            box-shadow: 0 6px 20px rgba(255, 0, 204, 0.6);
            transform: translateY(-2px);
        }
        .hot-content-banner {
            background: linear-gradient(45deg, #ff1744, #f50057);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            text-align: center;
            font-weight: bold;
            font-size: 18px;
            box-shadow: 0 4px 8px rgba(244, 67, 54, 0.3);
            border: 2px solid #ffebee;
        }
        .hot-content-text {
            color: #ffeb3b;
            font-style: italic;
            margin-top: 8px;
        }
        .attachment-note {
            background-color: #16213e; /* Dark blue for note */
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
            font-style: italic;
            color: #00e5ff;
            border: 1px solid #00e5ff;
        }
        .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #777;
            text-align: center;
            border-top: 1px solid rgba(255,255,255,0.1);
            padding-top: 15px;
        }
        .highlight {
            color: #00e5ff; /* Highlight words with neon blue */
            font-weight: bold;
        }
    </style>
</head>
<body>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0f;">
        <tr>
            <td align="center">
                <table class="container" width="600" cellpadding="20" cellspacing="0">
                    <tr>
                        <td class="header">
                            <h1>${welcomeTitle}</h1>
                            <h2>${isSpanish ? '¡Tu comunidad te espera!' : 'Your Community Awaits!'}</h2>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <p>${greeting}</p>
                            <p>${welcomeMessage}</p>
                            
                            <div class="hot-content-banner">
                                🔥 HOT PNP ADULT CONTENT 🔥
                                <div class="hot-content-text">
                                    ${isSpanish 
                                        ? '¡El corazón de nuestra comunidad es el contenido adulto PNP caliente creado por Santino y Lex!' 
                                        : 'The core of our community is the HOT PNP adult content created by Santino and Lex!'}
                                </div>
                                <div style="margin-top: 8px; font-size: 14px;">
                                    🎬 Clouds & Slamming - 100% REAL 🎬
                                </div>
                            </div>
                            
                            <h2>${whatIsPNP}</h2>
                            <p>${communityDesc}</p>
                            <ul>
                                ${communityBenefits.map(benefit => `<li>${benefit}</li>`).join('')}
                            </ul>
                            
                            <h2>${botFeaturesDesc}</h2>
                            <ul>
                                ${botFeatures.map(feature => `<li>${feature}</li>`).join('')}
                            </ul>
                            
                            <div class="attachment-note">
                                ${isSpanish 
                                    ? '📎 ¡Hemos incluido algunos documentos útiles como archivos adjuntos para ayudarte a comenzar!' 
                                    : '📎 We\'ve included some helpful documents as attachments to help you get started!'}
                            </div>
                            
                            <p>${getStarted}</p>
                            
                            <div style="text-align: center; margin-top: 20px;">
                                <a href="https://pnptv.app/landing.html" class="button-primary">${buttonText}</a>
                            </div>
                            
                            <p style="text-align: center; margin-top: 30px;">${excitedMessage}</p>
                            
                            <p>${regards}<br>
                            ${teamName}</p>
                        </td>
                    </tr>
                    <tr>
                        <td class="footer">
                            <p>© ${new Date().getFullYear()} PNP TV. All rights reserved.</p>
                            <p>${footerText}</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }

    /**
     * Get recording ready template
     * @param {Object} data - Template data
     * @returns {string} HTML template
     */
    getRecordingReadyTemplate(data) {
        const { roomTitle, recordingUrl, downloadUrl, duration, fileSize } = data;

        const fileSizeMB = fileSize ? (fileSize / 1024 / 1024).toFixed(2) : 'N/A';
        const durationMin = duration ? Math.floor(duration / 60) : 'N/A';

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .button {
            display: inline-block;
            background: #2D8CFF;
            color: white !important;
            padding: 15px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            margin: 10px 5px;
        }
        .info-box {
            background: #f9f9f9;
            padding: 15px;
            border-left: 4px solid #2D8CFF;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 style="color: #2D8CFF;">📹 Your Recording is Ready!</h1>

        <p>The recording for <strong>${roomTitle}</strong> has been processed and is ready to view.</p>

        <div class="info-box">
            <p><strong>Duration:</strong> ${durationMin} minutes</p>
            <p><strong>File Size:</strong> ${fileSizeMB} MB</p>
        </div>

        <div style="text-align: center;">
            <a href="${recordingUrl}" class="button">▶️ Watch</a>
            ${downloadUrl ? `<a href="${downloadUrl}" class="button">⬇️ Download</a>` : ''}
        </div>

        <p style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
            <strong>PNP.tv</strong> - Premium Zoom Meetings
        </p>
    </div>
</body>
</html>
        `;
    }

    /**
     * Send invoice email to user
     * @param {Object} data - Invoice email data
     * @returns {Promise<Object>} Send result
     */
    async sendInvoiceEmail(data) {
        const {
            email,
            userName = 'Customer',
            invoiceNumber,
            orderDate,
            items = [], // Array of { description, quantity, unitPrice, total }
            subtotal,
            tax = 0,
            total,
            currency = 'USD',
            paymentMethod,
            storeName = 'Easy Bots Store',
            storeAddress = 'Bucaramanga, Colombia',
            contactEmail = 'support@easybots.store'
        } = data;

        const html = this._getInvoiceEmailTemplate({
            userName,
            invoiceNumber,
            orderDate,
            items,
            subtotal,
            tax,
            total,
            currency,
            paymentMethod,
            storeName,
            storeAddress,
            contactEmail
        });

        return await this.send({
            to: email,
            subject: `Invoice #${invoiceNumber} from ${storeName}`,
            html,
            from: 'noreply@pnptv.app' // Explicitly setting the 'from' address
        });
    }

    /**
     * Get invoice email template
     * @param {Object} data - Template data
     * @returns {string} HTML template
     */
    _getInvoiceEmailTemplate(data) {
        const {
            userName,
            invoiceNumber,
            orderDate,
            items,
            subtotal,
            tax,
            total,
            currency,
            paymentMethod,
            storeName,
            storeAddress,
            contactEmail
        } = data;

        const formatDate = (dateString) => {
            const options = { year: 'numeric', month: 'long', day: 'numeric' };
            return new Date(dateString).toLocaleDateString('en-US', options);
        };

        const formatCurrency = (amount, currencyCode = 'USD') => {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
            }).format(amount);
        };

        const itemsHtml = items.map(item => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; color: #dddddd;">${item.description}</td>
                <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">${item.quantity}</td>
                <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">${formatCurrency(item.unitPrice, currency)}</td>
                <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">${formatCurrency(item.total, currency)}</td>
            </tr>
        `).join('');

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Invoice #${invoiceNumber} from ${storeName}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #ffffff;
            background-color: #0b0b0f; /* Dark background */
        }
        .container {
            background-color: #1a1a2e; /* Slightly lighter dark background for content */
            border-radius: 15px;
            box-shadow: 0 8px 25px rgba(0, 229, 255, 0.2); /* Neon blue shadow */
            padding: 30px;
            margin: 20px auto; /* Center on page */
            max-width: 600px;
            border: 1px solid #ff00cc; /* Fuchsia border */
        }
        .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 2px solid #00e5ff; /* Neon blue divider */
            margin-bottom: 30px;
        }
        h1 {
            color: #ff00cc; /* Fuchsia */
            font-size: 32px;
            margin-bottom: 5px;
            text-shadow: 0 0 10px rgba(255, 0, 204, 0.7); /* Neon glow */
        }
        h2 {
            color: #00e5ff; /* Neon Blue */
            font-size: 24px;
            margin-top: 0;
            text-shadow: 0 0 8px rgba(0, 229, 255, 0.7); /* Neon glow */
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            color: #dddddd;
            margin-bottom: 10px;
        }
        .invoice-details, .summary-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        .invoice-details th, .invoice-details td, .summary-table th, .summary-table td {
            padding: 10px;
            border: 1px solid #3a3a4a;
            text-align: left;
            color: #dddddd;
        }
        .invoice-details th, .summary-table th {
            background-color: #0d0d12;
            color: #00e5ff;
        }
        .summary-table td {
            text-align: right;
        }
        .total-row {
            background-color: #ff00cc; /* Fuchsia for total */
            color: #ffffff;
            font-weight: bold;
        }
        .total-row td {
            color: #ffffff !important;
            border-top: 2px solid #00e5ff;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #888;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0f;">
        <tr>
            <td align="center">
                <table class="container" width="600" cellpadding="20" cellspacing="0">
                    <tr>
                        <td class="header">
                            <h1>Invoice from ${storeName}</h1>
                            <h2>#${invoiceNumber}</h2>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <p>Dear ${userName},</p>
                            <p>Thank you for your recent purchase from ${storeName}. Here are the details of your order:</p>

                            <table class="invoice-details">
                                <tr>
                                    <th>Invoice Number:</th>
                                    <td>${invoiceNumber}</td>
                                </tr>
                                <tr>
                                    <th>Order Date:</th>
                                    <td>${formatDate(orderDate)}</td>
                                </tr>
                                <tr>
                                    <th>Payment Method:</th>
                                    <td>${paymentMethod}</td>
                                </tr>
                            </table>

                            <table class="summary-table">
                                <thead>
                                    <tr>
                                        <th style="text-align: left;">Description</th>
                                        <th style="text-align: right;">Qty</th>
                                        <th style="text-align: right;">Unit Price</th>
                                        <th style="text-align: right;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsHtml}
                                    <tr>
                                        <td colspan="3" style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">Subtotal</td>
                                        <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">${formatCurrency(subtotal, currency)}</td>
                                    </tr>
                                    <tr>
                                        <td colspan="3" style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">Tax</td>
                                        <td style="padding: 8px; border-bottom: 1px solid #3a3a4a; text-align: right; color: #dddddd;">${formatCurrency(tax, currency)}</td>
                                    </tr>
                                    <tr class="total-row">
                                        <td colspan="3" style="padding: 8px; text-align: right;">Total Due</td>
                                        <td style="padding: 8px; text-align: right;">${formatCurrency(total, currency)}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <p style="text-align: center; margin-top: 30px;">
                                If you have any questions about this invoice, please contact us at <a href="mailto:${contactEmail}" style="color: #00e5ff; text-decoration: none;">${contactEmail}</a>.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td class="footer">
                            <p>${storeName} | ${storeAddress}</p>
                            <p>© ${new Date().getFullYear()} ${storeName}. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }

    /**
     * Get reactivation email template
     * @param {Object} data - Template data
     * @returns {string} HTML template
     */
    getReactivationEmailTemplate(data) {
        const { lifetimeDealLink = "https://pnptv.app/lifetime100", telegramLink = "https://t.me/pnplatinotv_bot", language = 'es' } = data;

        const spanishTemplate = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>PNP Latino TV Está de Vuelta</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #ffffff;
      background-color: #0b0b0f; /* Dark background */
    }
    .container {
      background-color: #1a1a2e; /* Slightly lighter dark background for content */
      border-radius: 15px;
      box-shadow: 0 8px 25px rgba(0, 229, 255, 0.2); /* Neon blue shadow */
      padding: 20px;
      margin: 20px auto; /* Center on page */
      max-width: 600px;
      border: 1px solid #00e5ff; /* Neon blue border */
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #ff00cc; /* Fuchsia divider */
      margin-bottom: 20px;
    }
    h1 {
      color: #ff00cc; /* Fuchsia */
      font-size: 32px;
      margin-bottom: 5px;
      text-shadow: 0 0 10px rgba(255, 0, 204, 0.7); /* Neon glow */
    }
    h2 {
      color: #00e5ff; /* Neon Blue */
      font-size: 24px;
      margin-top: 0;
      text-shadow: 0 0 8px rgba(0, 229, 255, 0.7); /* Neon glow */
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #dddddd;
      margin-bottom: 15px;
    }
    .button-primary {
      display: inline-block;
      background-color: #ff00cc; /* Fuchsia */
      color: #ffffff !important;
      padding: 15px 30px;
      text-decoration: none;
      border-radius: 50px; /* Pill shape */
      font-weight: bold;
      font-size: 18px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(255, 0, 204, 0.4);
      border: none;
    }
    .button-primary:hover {
      background-color: #e600b8; /* Darker fuchsia on hover */
      box-shadow: 0 6px 20px rgba(255, 0, 204, 0.6);
      transform: translateY(-2px);
    }
    .button-secondary {
      color: #00e5ff !important; /* Neon Blue */
      font-size: 16px;
      text-decoration: none;
      font-weight: bold;
      transition: color 0.3s ease;
    }
    .button-secondary:hover {
      color: #00b8cc !important; /* Darker neon blue on hover */
    }
    .footer-text {
      font-size: 13px;
      color: #666666;
      margin-top: 20px;
    }
    .highlight {
      color: #00e5ff; /* Highlight words with neon blue */
      font-weight: bold;
    }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0f;">
    <tr>
      <td align="center">
        <table class="container" width="600" cellpadding="20" cellspacing="0">
          
          <tr>
            <td class="header">
              <h1>🔥 PNP LATINO TV ESTÁ DE VUELTA 🔥</h1>
              <h2>Más Caliente Que Nunca</h2>
            </td>
          </tr>

          <tr>
            <td>
              <p>
                <span class="highlight">PNP Latino TV</span> está de vuelta — <span class="highlight">más 🔥 que nunca</span>.
              </p>
              <p>
                Después de cada intento de cierre, nos levantamos más fuertes, trayéndote el contenido que amas y un bot de nueva generación construido para mantener a nuestra comunidad más unida que nunca.
              </p>
              <p>
                Disfruta de tus videos favoritos, explora nuevas experiencias como Nearby, Hangouts, Videorama y PNP Live, y reconecta con un espacio donde la <span class="highlight">libertad, la conexión y el placer</span> se encuentran.
              </p>
              <p style="text-align: center; font-style: italic; font-size: 18px; color: #ff00cc;">
                Tu espacio. Tu gente. Tu momento.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top: 0;">
              <a href="${lifetimeDealLink}" class="button-primary">
                🔥 Lifetime Hot Deal
              </a>
            </td>
          </tr>

          <tr>
            <td align="center">
              <p style="margin-bottom: 0;">Suscríbete ahora y vuelve a encender el 🔥.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top: 10px;">
              <a href="${telegramLink}" class="button-secondary">
                Suscríbete al canal y únete a la comunidad
              </a>
            </td>
          </tr>

          <tr>
            <td align="center" class="footer-text">
              PNP Latino TV — Comunidad • Conexión • Placer
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        const englishTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PNP Latino TV Is Back</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #ffffff;
      background-color: #0b0b0f; /* Dark background */
    }
    .container {
      background-color: #1a1a2e; /* Slightly lighter dark background for content */
      border-radius: 15px;
      box-shadow: 0 8px 25px rgba(0, 229, 255, 0.2); /* Neon blue shadow */
      padding: 20px;
      margin: 20px auto; /* Center on page */
      max-width: 600px;
      border: 1px solid #00e5ff; /* Neon blue border */
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #ff00cc; /* Fuchsia divider */
      margin-bottom: 20px;
    }
    h1 {
      color: #ff00cc; /* Fuchsia */
      font-size: 32px;
      margin-bottom: 5px;
      text-shadow: 0 0 10px rgba(255, 0, 204, 0.7); /* Neon glow */
    }
    h2 {
      color: #00e5ff; /* Neon Blue */
      font-size: 24px;
      margin-top: 0;
      text-shadow: 0 0 8px rgba(0, 229, 255, 0.7); /* Neon glow */
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #dddddd;
      margin-bottom: 15px;
    }
    .button-primary {
      display: inline-block;
      background-color: #ff00cc; /* Fuchsia */
      color: #ffffff !important;
      padding: 15px 30px;
      text-decoration: none;
      border-radius: 50px; /* Pill shape */
      font-weight: bold;
      font-size: 18px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 15px rgba(255, 0, 204, 0.4);
      border: none;
    }
    .button-primary:hover {
      background-color: #e600b8; /* Darker fuchsia on hover */
      box-shadow: 0 6px 20px rgba(255, 0, 204, 0.6);
      transform: translateY(-2px);
    }
    .button-secondary {
      color: #00e5ff !important; /* Neon Blue */
      font-size: 16px;
      text-decoration: none;
      font-weight: bold;
      transition: color 0.3s ease;
    }
    .button-secondary:hover {
      color: #00b8cc !important; /* Darker neon blue on hover */
    }
    .footer-text {
      font-size: 13px;
      color: #666666;
      margin-top: 20px;
    }
    .highlight {
      color: #00e5ff; /* Highlight words with neon blue */
      font-weight: bold;
    }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0b0f;">
    <tr>
      <td align="center">
        <table class="container" width="600" cellpadding="20" cellspacing="0">
          
          <tr>
            <td class="header">
              <h1>🔥 PNP Latino TV IS BACK 🔥</h1>
              <h2>Hotter Than Ever</h2>
            </td>
          </tr>

          <tr>
            <td>
              <p>
                <span class="highlight">PNP Latino TV</span> is back — <span class="highlight">hotter than ever</span>.
              </p>
              <p>
                After every shutdown attempt, we rise stronger, bringing you the content you love and a new generation bot built to keep our community closer than ever.
              </p>
              <p>
                Enjoy your favorite videos, explore new experiences like Nearby, Hangouts, Videorama, and PNP Live, and reconnect with a space where <span class="highlight">freedom, connection, and pleasure</span> meet.
              </p>
              <p style="text-align: center; font-style: italic; font-size: 18px; color: #ff00cc;">
                Your space. Your people. Your moment.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top: 0;">
              <a href="${lifetimeDealLink}" class="button-primary">
                🔥 Lifetime Hot Deal
              </a>
            </td>
          </tr>

          <tr>
            <td align="center">
              <p style="margin-bottom: 0;">Subscribe now and turn the heat back on. 🔥</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top: 10px;">
              <a href="${telegramLink}" class="button-secondary">
                Join the community & subscribe to our channel
              </a>
            </td>
          </tr>

          <tr>
            <td align="center" class="footer-text">
              PNP Latino TV — Community • Connection • Pleasure
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        return language === 'es' ? spanishTemplate : englishTemplate;
    }

    /**
     * Strip HTML tags from string
     * @param {string} html - HTML string
     * @returns {string} Plain text
     */
    stripHtml(html) {
        // Use sanitize-html to remove all tags and attributes
        return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
    }

    /**
     * Verify email transporter connection
     * @returns {Promise<boolean>} Connection status
     */
    async verifyConnection() {
        this.ensureInitialized();
        if (!this.transporter) {
            return false;
        }

        try {
            await this.transporter.verify();
            logger.info('Email transporter verified successfully');
            return true;
        } catch (error) {
            logger.error('Email transporter verification failed:', error);
            return false;
        }
    }
}


module.exports = new EmailService();
