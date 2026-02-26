const logger = require('../../utils/logger');
const ChatCleanupService = require('./chatCleanupService');
const { t } = require('../../utils/i18n');
const MessageRateLimiter = require('./messageRateLimiter');

/**
 * Proactive Reminder Service
 * Handles scheduled rule reminders, educational content, and prevention tips
 */
class ProactiveReminderService {
  /**
   * Rule reminder messages (rotating)
   */
  static RULE_REMINDERS = {
    en: [
      '📋 **Group Rules Reminder**\n\n' +
      '🔗 No external links allowed\n' +
      '📤 No forwarded messages\n' +
      '🤝 Respect all members\n' +
      '💬 Keep discussions supportive\n\n' +
      'Use /rules for full guidelines.',

      '⚠️ **Important Notice**\n\n' +
      'This group has strict content policies:\n' +
      '✅ Adult discussions allowed (legal content)\n' +
      '✅ Personal experiences welcome\n' +
      '❌ CSAM strictly prohibited\n' +
      '❌ Illegal content forbidden\n\n' +
      'Stay safe and respectful!',

      '🔒 **Security Reminder**\n\n' +
      'For your safety:\n' +
      '🚫 Never share personal information\n' +
      '🚫 Avoid clicking suspicious links\n' +
      '🚫 Report any concerning behavior\n' +
      '💙 Your privacy matters to us!',
    ],
    es: [
      '📋 **Recordatorio de Reglas**\n\n' +
      '🔗 No se permiten enlaces externos\n' +
      '📤 No mensajes reenviados\n' +
      '🤝 Respeta a todos los miembros\n' +
      '💬 Mantén las discusiones positivas\n\n' +
      'Usa /rules para ver todas las reglas.',

      '⚠️ **Aviso Importante**\n\n' +
      'Este grupo tiene políticas estrictas:\n' +
      '✅ Discusiones adultas permitidas\n' +
      '✅ Experiencias personales bienvenidas\n' +
      '❌ CSAM estrictamente prohibido\n' +
      '❌ Contenido ilegal prohibido\n\n' +
      '¡Mantente seguro y respetuoso!',

      '🔒 **Recordatorio de Seguridad**\n\n' +
      'Para tu seguridad:\n' +
      '🚫 Nunca compartas información personal\n' +
      '🚫 Evita hacer clic en enlaces sospechosos\n' +
      '🚫 Reporta cualquier comportamiento preocupante\n' +
      '💙 Tu privacidad es importante para nosotros!',
    ],
  };

  /**
   * Prevention tips (rotating)
   */
  static PREVENTION_TIPS = {
    en: [
      '💡 **Harm Reduction Tip**\n\n' +
      'Always test your substances before use. ' +
      'Start with small amounts and go slow. ' +
      'Your safety comes first!',

      '🩺 **Health Reminder**\n\n' +
      'Regular STI testing is important for sexual health. ' +
      'Many clinics offer free or low-cost testing. ' +
      'Know your status, protect yourself and others!',

      '🧠 **Mental Health Tip**\n\n' +
      'If you\'re feeling overwhelmed, take a break. ' +
      'Reach out to friends or use /support for resources. ' +
      'You\'re not alone in this journey!',

      '💙 **Consent Reminder**\n\n' +
      'Consent is ongoing and can be withdrawn at any time. ' +
      'Respect boundaries and communicate openly. ' +
      'Healthy relationships are built on mutual respect!',
    ],
    es: [
      '💡 **Consejo de Reducción de Daños**\n\n' +
      'Siempre prueba tus sustancias antes de usarlas. ' +
      'Empieza con cantidades pequeñas y ve despacio. ' +
      '¡Tu seguridad es lo primero!',

      '🩺 **Recordatorio de Salud**\n\n' +
      'Las pruebas regulares de ETS son importantes. ' +
      'Muchas clínicas ofrecen pruebas gratuitas o económicas. ' +
      '¡Conoce tu estado y protégete!',

      '🧠 **Consejo de Salud Mental**\n\n' +
      'Si te sientes abrumado, toma un descanso. ' +
      'Habla con amigos o usa /support para recursos. ' +
      '¡No estás solo en este viaje!',

      '💙 **Recordatorio de Consentimiento**\n\n' +
      'El consentimiento es continuo y puede retirarse. ' +
      'Respeta los límites y comunícate abiertamente. ' +
      '¡Las relaciones saludables se basan en el respeto mutuo!',
    ],
  };

  /**
   * Educational content (rotating)
   */
  static EDUCATIONAL_CONTENT = {
    en: [
      '📚 **Did You Know?**\n\n' +
      'Chem sex refers to using drugs before or during sex. ' +
      'Common substances include meth, GHB, and mephedrone. ' +
      'Understanding the risks can help you make informed choices.',

      '🩹 **Safety First**\n\n' +
      'If you choose to engage in chem sex:\n' +
      '• Use protection to prevent STIs\n' +
      '• Stay hydrated and take breaks\n' +
      '• Have a trusted friend check on you\n' +
      '• Know the signs of overdose',

      '💬 **Support Available**\n\n' +
      'You don\'t have to face challenges alone. ' +
      'Our community is here to listen and support you. ' +
      'Share your experiences, ask questions, and find strength in our collective journey!',
    ],
    es: [
      '📚 **¿Sabías que?**\n\n' +
      'El chem sex se refiere al uso de drogas antes o durante el sexo. ' +
      'Sustancias comunes incluyen metanfetamina, GHB y mefedrona. ' +
      'Entender los riesgos puede ayudarte a tomar decisiones informadas.',

      '🩹 **Seguridad Primero**\n\n' +
      'Si decides participar en chem sex:\n' +
      '• Usa protección para prevenir ETS\n' +
      '• Mantente hidratado y toma descansos\n' +
      '• Que un amigo de confianza te revise\n' +
      '• Conoce las señales de sobredosis',

      '💬 **Apoyo Disponible**\n\n' +
      'No tienes que enfrentar los desafíos solo. ' +
      'Nuestra comunidad está aquí para escucharte y apoyarte. ' +
      '¡Comparte tus experiencias, haz preguntas y encuentra fuerza en nuestro viaje colectivo!',
    ],
  };

  /**
   * Active reminder intervals by chat
   * Key: chatId
   * Value: { ruleInterval, tipInterval, contentInterval }
   */
  static activeReminders = new Map();

  /**
   * Start proactive reminders for a chat
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {string} language - Language code (en/es)
   */
  static startReminders(telegram, chatId, language = 'en') {
    // Stop existing reminders first
    this.stopReminders(chatId);

    if (!this.RULE_REMINDERS[language] || !this.PREVENTION_TIPS[language] || !this.EDUCATIONAL_CONTENT[language]) {
      language = 'en'; // Fallback to English
    }

    const reminders = {
      ruleInterval: setInterval(async () => {
        await this.sendRuleReminder(telegram, chatId, language);
      }, 8 * 60 * 60 * 1000), // Every 8 hours (reduced frequency due to rate limiting)

      tipInterval: setInterval(async () => {
        await this.sendPreventionTip(telegram, chatId, language);
      }, 16 * 60 * 60 * 1000), // Every 16 hours (reduced frequency due to rate limiting)

      contentInterval: setInterval(async () => {
        await this.sendEducationalContent(telegram, chatId, language);
      }, 24 * 60 * 60 * 1000), // Every 24 hours (kept as is)
    };

    this.activeReminders.set(chatId, reminders);

    logger.info('Proactive reminders started', {
      chatId,
      language,
      intervals: Object.keys(reminders).length,
    });

    // Send initial reminder after a short delay (staggered to avoid race condition)
    // Only send ONE initial message to conserve rate limit
    setTimeout(async () => {
      try {
        await this.sendRuleReminder(telegram, chatId, language);
      } catch (error) {
        logger.error('Error sending initial rule reminder:', error.message);
      }
    }, 5000); // 5 second delay
  }

  /**
   * Stop proactive reminders for a chat
   * @param {number|string} chatId - Chat ID
   */
  static stopReminders(chatId) {
    const reminders = this.activeReminders.get(chatId);

    if (reminders) {
      Object.values(reminders).forEach((interval) => {
        clearInterval(interval);
      });

      this.activeReminders.delete(chatId);
      logger.info('Proactive reminders stopped', { chatId });
    }
  }

  /**
   * Send a rule reminder
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {string} language - Language code
   */
  static async sendRuleReminder(telegram, chatId, language) {
    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send rule reminder. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      const messages = this.RULE_REMINDERS[language] || this.RULE_REMINDERS.en;
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];

      const message = await telegram.sendMessage(chatId, randomMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      // Auto-delete after 5 minutes
      ChatCleanupService.scheduleDelete(
        telegram,
        chatId,
        message.message_id,
        'system',
        ChatCleanupService.CLEANUP_DELAY
      );

      logger.debug('Rule reminder sent', { chatId, messageId: message.message_id });
    } catch (error) {
      logger.error('Error sending rule reminder:', {
        chatId,
        error: error.message,
      });
    }
  }

  /**
   * Send a prevention tip
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {string} language - Language code
   */
  static async sendPreventionTip(telegram, chatId, language) {
    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send prevention tip. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      const tips = this.PREVENTION_TIPS[language] || this.PREVENTION_TIPS.en;
      const randomTip = tips[Math.floor(Math.random() * tips.length)];

      const message = await telegram.sendMessage(chatId, randomTip, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      // Auto-delete after 5 minutes
      ChatCleanupService.scheduleDelete(
        telegram,
        chatId,
        message.message_id,
        'system',
        ChatCleanupService.CLEANUP_DELAY
      );

      logger.debug('Prevention tip sent', { chatId, messageId: message.message_id });
    } catch (error) {
      logger.error('Error sending prevention tip:', {
        chatId,
        error: error.message,
      });
    }
  }

  /**
   * Send educational content
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {string} language - Language code
   */
  static async sendEducationalContent(telegram, chatId, language) {
    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send educational content. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      const content = this.EDUCATIONAL_CONTENT[language] || this.EDUCATIONAL_CONTENT.en;
      const randomContent = content[Math.floor(Math.random() * content.length)];

      const message = await telegram.sendMessage(chatId, randomContent, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      // Auto-delete after 5 minutes
      ChatCleanupService.scheduleDelete(
        telegram,
        chatId,
        message.message_id,
        'system',
        ChatCleanupService.CLEANUP_DELAY
      );

      logger.debug('Educational content sent', { chatId, messageId: message.message_id });
    } catch (error) {
      logger.error('Error sending educational content:', {
        chatId,
        error: error.message,
      });
    }
  }

  /**
   * Send immediate support reminder
   * @param {Object} telegram - Telegram bot instance
   * @param {number|string} chatId - Chat ID
   * @param {string} language - Language code
   */
  static async sendSupportReminder(telegram, chatId, language) {
    try {
      // Atomic check and record to prevent race conditions
      const rateLimitCheck = await MessageRateLimiter.checkAndRecordMessage(6);
      if (!rateLimitCheck.canSend) {
        logger.info(`Rate limit reached - cannot send support reminder. Messages today: ${rateLimitCheck.messagesSentToday}/6`);
        return;
      }

      const supportMessage = language === 'es'
        ? '💙 **Recordatorio de Apoyo**\n\nSi necesitas ayuda inmediata, usa /support para acceder a recursos de crisis, líneas de ayuda y centros de pruebas. ¡No estás solo!'
        : '💙 **Support Reminder**\n\nIf you need immediate help, use /support to access crisis resources, hotlines, and testing centers. You\'re not alone!';

      const message = await telegram.sendMessage(chatId, supportMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      // Auto-delete after 5 minutes
      ChatCleanupService.scheduleDelete(
        telegram,
        chatId,
        message.message_id,
        'system',
        ChatCleanupService.CLEANUP_DELAY
      );

      logger.debug('Support reminder sent', { chatId, messageId: message.message_id });
    } catch (error) {
      logger.error('Error sending support reminder:', {
        chatId,
        error: error.message,
      });
    }
  }

  /**
   * Get statistics about active reminders
   * @returns {Object} Statistics
   */
  static getStats() {
    return {
      activeChats: this.activeReminders.size,
      ruleReminders: this.RULE_REMINDERS.en.length,
      preventionTips: this.PREVENTION_TIPS.en.length,
      educationalContent: this.EDUCATIONAL_CONTENT.en.length,
    };
  }

  /**
   * Clear all active reminders
   */
  static clearAll() {
    const count = this.activeReminders.size;
    
    for (const [chatId, reminders] of this.activeReminders.entries()) {
      Object.values(reminders).forEach((interval) => {
        clearInterval(interval);
      });
    }

    this.activeReminders.clear();
    logger.info(`Cleared all proactive reminders for ${count} chats`);
  }
}

module.exports = ProactiveReminderService;