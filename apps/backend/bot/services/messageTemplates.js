const logger = require('../../utils/logger');
const sanitize = require('../../utils/sanitizer');

/**
 * Message Templates Service
 * Centralized message formatting for consistent user communications
 */
class MessageTemplates {
  /**
   * Build enhanced payment confirmation message with all important details
   * Used for ePayco and Daimo payment confirmations
   *
   * @param {Object} params - Message parameters
   * @param {string} params.planName - Plan display name (e.g., "PRIME Monthly")
   * @param {number} params.amount - Payment amount (can be null for manual activations)
   * @param {Date|null} params.expiryDate - Subscription expiry date (null for lifetime)
   * @param {string} params.transactionId - Transaction/activation/code ID
   * @param {string} params.inviteLink - Prime channel invite link
   * @param {string} params.language - Language code ('es' for Spanish, 'en' for English)
   * @param {string} params.provider - Payment provider ('epayco' or 'daimo')
   * @returns {string} Formatted message ready for Telegram
   */
  static buildEnhancedPaymentConfirmation({
    planName,
    amount,
    expiryDate,
    transactionId,
    inviteLink,
    language = 'es',
    provider = 'epayco',
  }) {
    try {
      // Format expiry date
      let expiryStr = '';
      if (expiryDate) {
        expiryStr = expiryDate.toLocaleDateString(
          language === 'es' ? 'es-ES' : 'en-US',
          {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }
        );
      } else {
        expiryStr = language === 'es' ? 'Permanente ♾️' : 'Permanent ♾️';
      }

      // Format amount (handle null for manual activations)
      let amountLine = '';
      if (amount !== null && amount !== undefined) {
        amountLine = `• ${language === 'es' ? 'Monto' : 'Amount'}: $${parseFloat(amount).toFixed(2)} USD\n`;
      }

      // Get provider display name
      const providerDisplayName = this.getProviderDisplayName(provider, language);
      const safePlanName = sanitize.telegramMarkdown(planName);
      const safeExpiryStr = sanitize.telegramMarkdown(expiryStr);
      const safeProviderDisplayName = sanitize.telegramMarkdown(providerDisplayName);

      // Build enhanced message based on language
      if (language === 'es') {
        return [
          '🎉 *¡Gracias por tu compra y por apoyar a PNPtv!*',
          '',
          '✅ *Tu membresía ha sido activada automáticamente—sin espera, sin aprobación manual.*',
          '',
          '📦 *Lo que incluye tu membresía:*',
          '',
          '• Videorama – Listas de reproducción de videos, música y podcasts',
          '• Hangouts – Salas de videollamadas comunitarias',
          '• PNP Television Live – Transmisiones en vivo y grabaciones exclusivas',
          '',
          '📋 *Detalles de tu compra:*',
          `• Plan: ${safePlanName}`,
          amountLine.trim(),
          `• Proveedor: ${safeProviderDisplayName}`,
          `• Fecha de compra: ${new Date().toLocaleDateString('es-ES')}`,
          `• Válido hasta: ${safeExpiryStr}`,
          `• ID de Transacción: ${transactionId}`,
          '',
          '📢 *Aviso importante*',
          '',
          'Nuestro canal fue reportado recientemente y estamos volviendo a subir contenido.',
          'Ya estamos en producción y se está lanzando nuevo contenido continuamente.',
          '',
          '💰 *Política de reembolso (ventas regulares)*',
          '',
          'Como la activación es automática, puedes solicitar un reembolso dentro de los 30 minutos DESPUÉS DE LA COMPRA si no estás satisfecho.',
          'Los reembolsos aprobados pueden tardar hasta 15 días hábiles en procesarse.',
          '',
          '🌟 *¡Bienvenido a PRIME!*',
          '',
          '👉 Accede al canal exclusivo aquí:',
          `[🔗 Ingresar a PRIME](${inviteLink})`,
          '',
          '💎 Disfruta de todo el contenido premium y beneficios exclusivos.',
          '',
          '📚 *¿Cómo usar PNPtv?*',
          '👉 Guía completa: https://pnptv.app/welcome',
          '',
          '📱 Usa /menu para ver todas las funciones disponibles.',
          '',
          '¡Gracias por apoyar un proyecto independiente y impulsado por la comunidad! 🔥',
        ]
          .filter((line) => line !== '') // Remove empty lines from amount if not included
          .join('\n');
      } else {
        return [
          '🎉 *Thank you for your purchase and for supporting PNPtv!*',
          '',
          '✅ *Your membership is activated automatically—no waiting, no manual approval.*',
          '',
          '📦 *What\'s included in your membership:*',
          '',
          '• Videorama – Video, music, and podcast playlists',
          '• Hangouts – Community video call rooms',
          '• PNP Television Live – Live streams and exclusive recordings',
          '',
          '📋 *Purchase Details:*',
          `• Plan: ${safePlanName}`,
          amountLine.trim(),
          `• Provider: ${safeProviderDisplayName}`,
          `• Purchase Date: ${new Date().toLocaleDateString('en-US')}`,
          `• Valid until: ${safeExpiryStr}`,
          `• Transaction ID: ${transactionId}`,
          '',
          '📢 *Important notice*',
          '',
          'Our channel was recently reported, and we are re-uploading content.',
          'We are back in production, and new content is being released continuously.',
          '',
          '💰 *Refund policy (Regular sales)*',
          '',
          'Because activation is automatic, you may request a refund within 30 minutes AFTER PURCHASE if you are not satisfied.',
          'Approved refunds may take up to 15 business days to be processed.',
          '',
          '🌟 *Welcome to PRIME!*',
          '',
          '👉 Access the exclusive channel here:',
          `[🔗 Join PRIME](${inviteLink})`,
          '',
          '💎 Enjoy all premium content and exclusive benefits.',
          '',
          '📚 *How to use PNPtv?*',
          '👉 Complete guide: https://pnptv.app/welcome',
          '',
          '📱 Use /menu to see all available features.',
          '',
          'Thank you for supporting an independent, community-powered project! 🔥',
        ]
          .filter((line) => line !== '') // Remove empty lines from amount if not included
          .join('\n');
      }
    } catch (error) {
      logger.error('Error building enhanced payment confirmation message:', error);
      throw error;
    }
  }

  /**
   * Get payment provider display name
   * @param {string} provider - Provider code
   * @param {string} language - Language code
   * @returns {string} Provider display name
   */
  static getProviderDisplayName(provider, language = 'es') {
    const providers = {
      daimo: { en: 'Daimo Pay', es: 'Daimo Pay' },
      epayco: { en: 'ePayco', es: 'ePayco' },
      meru: { en: 'Meru', es: 'Meru' },
    };

    return providers[provider]?.[language] || provider.toUpperCase();
  }

  /**
   * Build lifetime100 promo activation message
   * Special format for lifetime100 promo subscriptions
   *
   * @param {string} language - Language code ('es' or 'en')
   * @returns {string} Formatted lifetime100 promo message
   */
  static buildLifetime100PromoMessage(language = 'es') {
    if (language === 'es') {
      return [
        '🎉 *¡Gracias por comprar el Lifetime100 promo y por apoyar este proyecto independiente impulsado por la comunidad.*',
        '',
        'Tu apoyo nos ayuda a seguir creando, grabando y construyendo PNPtv.',
        '',
        '📋 *Lo que incluye tu acceso Lifetime100:*',
        '',
        '• *Videorama* – Listas de reproducción curadas de videos, música y podcasts (también puedes crear las tuyas propias)',
        '',
        '• *Hangouts* – Salas de video públicas y privadas para conectar en tiempo real',
        '',
        '• *PNP Television Live* – Shows en vivo, sesiones especiales y grabaciones exclusivas',
        '',
        '📢 *Aviso importante*',
        '',
        'Nuestro canal fue reportado nuevamente, así que estamos volviendo a subir algunos contenidos de video.',
        'La buena noticia: hemos vuelto a la producción y nuevo contenido ya se está grabando y lanzando progresivamente.',
        '',
        '💰 *Política de reembolso (Lifetime100)*',
        '',
        'Para Lifetime100, puedes solicitar un reembolso dentro de los 30 minutos DESPUÉS de que tu membresía sea ACTIVADA si no estás satisfecho.',
        'Los reembolsos aprobados pueden tardar hasta 15 días hábiles en procesarse.',
        '',
        '🙏 *Gracias por confiar y apoyar PNPtv.* 💎🔥',
      ].join('\n');
    } else {
      return [
        '🎉 *Thank you for purchasing the Lifetime100 promo and for supporting this independent community-driven project.*',
        '',
        'Your support helps us keep creating, recording, and building PNPtv.',
        '',
        '📋 *What’s included in your Lifetime100 access:*',
        '',
        '• *Videorama* – Curated video, music, and podcast playlists (you can also create your own)',
        '',
        '• *Hangouts* – Public and private video rooms to connect in real time',
        '',
        '• *PNP Television Live* – Live shows, special sessions, and exclusive recordings',
        '',
        '📢 *Important notice*',
        '',
        'Our channel was reported again, so we are re-uploading some video content.',
        'The good news: we are back in production, and new content is already being recorded and released progressively.',
        '',
        '💰 *Refund policy (Lifetime100)*',
        '',
        'For Lifetime100, you may request a refund within 30 minutes AFTER your membership is ACTIVATED if you are not satisfied.',
        'Approved refunds may take up to 15 business days to be processed.',
        '',
        '🙏 *Thank you for trusting and supporting PNPtv.* 💎🔥',
      ].join('\n');
    }
  }

  /**
   * Build lifetime pass activation message
   * Special format for lifetime/permanent subscriptions
   *
   * @param {string} language - Language code ('es' or 'en')
   * @returns {string} Formatted lifetime pass message
   */
  static buildLifetimePassMessage(language = 'es') {
    if (language === 'es') {
      return [
        '🎉 *¡Felicidades! Tu Lifetime Pass ha sido activado con éxito.*',
        '',
        '✅ Tu membresía es ahora PERMANENTE',
        '✅ Acceso ilimitado a todo el contenido',
        '✅ Sin fechas de expiración',
        '✅ Todas las funciones premium desbloqueadas',
        '',
        '🔥 *Disfruta de:*',
        '• Videos HD/4K completos',
        '• Contenido exclusivo PNP',
        '• Función "Quién está cerca"',
        '• Soporte prioritario 24/7',
        '• Actualizaciones futuras gratis',
        '',
        '📚 *¿Cómo usar PNPtv?*',
        '👉 Guía completa: https://pnptv.app/welcome',
        '',
        '📱 Usa /menu para ver todas las funciones disponibles.',
        '',
        '¡Bienvenido a la comunidad PNPtv! 🎊',
      ].join('\n');
    } else {
      return [
        '🎉 *Congratulations! Your Lifetime Pass has been successfully activated.*',
        '',
        '✅ Your membership is now PERMANENT',
        '✅ Unlimited access to all content',
        '✅ No expiration dates',
        '✅ All premium features unlocked',
        '',
        '🔥 *Enjoy:*',
        '• Full HD/4K videos',
        '• Exclusive PNP content',
        '• "Who\'s Nearby" feature',
        '• Priority 24/7 support',
        '• Free future updates',
        '',
        '📚 *How to use PNPtv?*',
        '👉 Complete guide: https://pnptv.app/welcome',
        '',
        '📱 Use /menu to see all available features.',
        '',
        'Welcome to the PNPtv community! 🎊',
      ].join('\n');
    }
  }

  /**
   * Get formatted expiry date string
   * @param {Date|null} expiryDate - Date to format
   * @param {string} language - Language code
   * @returns {string} Formatted date or "Permanent" text
   */
  static getFormattedExpiryDate(expiryDate, language = 'es') {
    if (!expiryDate) {
      return language === 'es' ? 'Permanente ♾️' : 'Permanent ♾️';
    }

    return expiryDate.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Validate message parameters
   * @param {Object} params - Parameters to validate
   * @returns {boolean} True if valid
   * @throws {Error} If validation fails
   */
  static validateParams(params) {
    const { planName, transactionId, inviteLink, language } = params;

    if (!planName || typeof planName !== 'string') {
      throw new Error('planName is required and must be a string');
    }

    if (!transactionId || typeof transactionId !== 'string') {
      throw new Error('transactionId is required and must be a string');
    }

    if (!inviteLink || typeof inviteLink !== 'string') {
      throw new Error('inviteLink is required and must be a string');
    }

    if (!language || !['es', 'en'].includes(language)) {
      throw new Error('language must be "es" or "en"');
    }

    return true;
  }
}

module.exports = MessageTemplates;
