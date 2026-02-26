const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const PermissionService = require('../../services/permissionService');
const GROUP_ID = process.env.GROUP_ID;

/**
 * Middleware to remind users to use bot in private chat when using commands in groups
 * Exceptions: /menu (has its own group behavior), /start, /help
 */
const groupCommandReminder = () => {
  return async (ctx, next) => {
    try {
      // Only process if this is a command in a group/supergroup
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      const isCommand = ctx.message?.text?.startsWith('/');

      if (!isGroup || !isCommand) {
        return next();
      }

      // In the configured community group, all /commands are unified to show the /menu in-group
      // (handled by groupCommandRestrictionMiddleware), so skip the private-chat reminder here.
      const chatIdStr = ctx.chat?.id?.toString();
      if (GROUP_ID && chatIdStr === GROUP_ID) {
        return next();
      }

      // Extract command name (without parameters)
      const commandText = ctx.message.text.split(' ')[0].toLowerCase();
      const command = commandText.split('@')[0].replace('/', '');

      // Allow /admin in groups for admins
      if (command === 'admin') {
        const isAdmin = await PermissionService.isAdmin(ctx.from?.id);
        if (isAdmin) return next();
      }

      // Exceptions - these commands can work in groups
      const allowedCommands = ['menu', 'start', 'help'];
      if (allowedCommands.includes(command)) {
        return next();
      }

      // Show reminder message
      const lang = ctx.session?.language || 'en';
      const botUsername = ctx.botInfo?.username || 'pnplatinotv_bot';
      const firstName = ctx.from?.first_name || 'User';

      const messageEs = `👋 Hola ${firstName}!\n\n` +
        `🔒 Para usar el comando ${commandText} y todas las funciones de PNPtv!, ` +
        `debes abrir el chat privado con el bot.\n\n` +
        `Esto es para proteger tu privacidad y cumplir con las políticas anti-spam de la comunidad.\n\n` +
        `👇 Haz clic en el botón de abajo para ir al bot:`;

      const messageEn = `👋 Hi ${firstName}!\n\n` +
        `🔒 To use the command ${commandText} and all PNPtv! features, ` +
        `you need to open a private chat with the bot.\n\n` +
        `This is to protect your privacy and comply with our community anti-spam policies.\n\n` +
        `👇 Click the button below to go to the bot:`;

      const message = lang === 'es' ? messageEs : messageEn;
      const buttonText = lang === 'es' ? '💬 Abrir Chat con PNPtv!' : '💬 Open PNPtv! Chat';

      await ctx.reply(
        message,
        {
          parse_mode: 'Markdown',
          reply_to_message_id: ctx.message.message_id,
          ...Markup.inlineKeyboard([
            [Markup.button.url(buttonText, `https://t.me/${botUsername}?start=from_group`)],
          ]),
        },
      );

      logger.info('Group command reminder sent', {
        command,
        groupId: ctx.chat.id,
        userId: ctx.from.id,
      });

      // Don't execute the command in the group
      // Return without calling next() to stop command execution
      return;
    } catch (error) {
      logger.error('Error in group command reminder middleware:', error);
      // Continue to next middleware even if this fails
      return next();
    }
  };
};

module.exports = groupCommandReminder;
