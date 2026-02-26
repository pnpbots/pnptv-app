const UserModel = require('../../models/userModel');
const logger = require('../../utils/logger');

/**
 * Onboarding Reminder Service
 * Sends private reminders to users with incomplete onboarding
 * NEVER sends to groups - only direct messages to users
 */
class OnboardingReminderService {
  /**
   * Initialize the service with bot instance
   * @param {Telegraf} bot - Bot instance
   */
  static initialize(bot) {
    this.bot = bot;
    logger.info('Onboarding reminder service initialized');
  }

  /**
   * Send reminders to users with incomplete onboarding
   * @returns {Promise<number>} Number of reminders sent
   */
  static async sendIncompleteOnboardingReminders() {
    try {
      if (!this.bot) {
        logger.error('Bot instance not initialized. Call initialize(bot) first.');
        return 0;
      }

      logger.info('Processing incomplete onboarding reminders...');

      // Get users with incomplete onboarding
      const users = await UserModel.getIncompleteOnboarding();

      logger.info(`Found ${users.length} users with incomplete onboarding`);

      let sentCount = 0;

      for (const user of users) {
        try {
          const success = await this.sendReminderToUser(user);
          if (success) {
            sentCount++;
          }

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`Error sending onboarding reminder to user ${user.id}:`, error);
        }
      }

      logger.info(`Sent ${sentCount} out of ${users.length} onboarding reminders`);
      return sentCount;
    } catch (error) {
      logger.error('Error in sendIncompleteOnboardingReminders:', error);
      return 0;
    }
  }

  /**
   * Send reminder to individual user via private message
   * @param {Object} user - User object
   * @returns {Promise<boolean>} Success status
   */
  static async sendReminderToUser(user) {
    try {
      const userId = user.id;
      const userLang = user.language || 'en';
      const isSpanish = userLang.startsWith('es');
      const username = user.username ? `@${user.username}` : user.firstName || 'Friend';

      let message;

      if (isSpanish) {
        message = `👋 **¡Hola ${username}!**

Notamos que aún no has completado tu incorporación en **PNPtv**.

⏭️ **¿Por qué completar tu perfil?**

✨ Desbloquea la experiencia completa:
• Acceso al grupo comunitario
• Miembros Cercanos para conectar
• Videos exclusivos y contenido en vivo
• Biblioteca de música y podcasts
• Mucho más...

📋 **Completa tu incorporación ahora:**
Toma solo 2 minutos. Escribe /start para comenzar.

¿Preguntas? Responde a este mensaje. ¡Estamos aquí para ayudar!`;
      } else {
        message = `👋 **Hey ${username}!**

We noticed you haven't completed your onboarding with **PNPtv** yet.

⏭️ **Why complete your profile?**

✨ Unlock the full experience:
• Access to the community group
• Nearby Members to connect
• Exclusive videos and live content
• Music and podcasts library
• And so much more...

📋 **Complete your onboarding now:**
Takes just 2 minutes. Type /start to get going.

Questions? Reply to this message. We're here to help!`;
      }

      // Send private message to user (NEVER to group)
      await this.bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
      });

      logger.info(`Sent onboarding reminder to user ${userId}`, {
        username: user.username,
        language: userLang
      });
      return true;
    } catch (error) {
      // If we can't send (user blocked bot, etc), log but don't throw
      if (error.response?.error_code === 403) {
        logger.debug(`Cannot send reminder to user ${user.id}: User blocked bot`);
      } else if (error.response?.error_code === 400) {
        logger.debug(`Cannot send reminder to user ${user.id}: Chat not found`);
      } else {
        logger.error(`Error sending reminder to user ${user.id}:`, error);
      }
      return false;
    }
  }
}

module.exports = OnboardingReminderService;
