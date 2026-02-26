const { requirePrivateChat } = require('../../utils/notifications');
const userService = require('../../services/userService');
const i18n = require('../../utils/i18n');
const logger = require('../../../utils/logger');
const supportRoutingService = require('../../services/supportRoutingService');

/**
 * Handle support command
 */
async function handleSupport(ctx) {
  try {
    const userId = ctx.from.id;
    const user = await userService.getUser(userId);
    const language = user?.language || 'en';

    // Check if command is in group chat
    const isPrivate = await requirePrivateChat(
      ctx,
      'Support',
      i18n.t('support', language)
    );

    if (!isPrivate) {
      return;
    }

    const supportMessage = language === 'es'
      ? `💬 *Crear Ticket de Soporte*\n\nPor favor, describe tu problema o pregunta. Un agente de soporte te responderá lo antes posible.`
      : `💬 *Create Support Ticket*\n\nPlease describe your issue or question. A support agent will reply as soon as possible.`;

    await ctx.reply(supportMessage, {
      parse_mode: 'Markdown',
    });

    // Set a flag in the session to indicate the user is providing support details
    ctx.session.awaitingSupportMessage = true;

    logger.info(`User ${userId} initiated support ticket creation`);
  } catch (error) {
    logger.error('Error in support command:', error);
    await ctx.reply(i18n.t('error_occurred', 'en'));
  }
}

module.exports = {
  handleSupport,
};
