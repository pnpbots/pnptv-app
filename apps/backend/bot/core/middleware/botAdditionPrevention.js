const logger = require('../../../utils/logger');
const ModerationService = require('../../services/moderationService');

/**
 * Bot Addition Prevention Middleware
 * Prevents non-admin users from adding bots to groups
 */
function botAdditionPreventionMiddleware() {
  return async (ctx, next) => {
    try {
      // Check if this is a new chat member event
      if (ctx.message?.new_chat_members) {
        const groupId = ctx.chat?.id;
        const userId = ctx.from?.id;
        
        if (!groupId || !userId) {
          return next();
        }

        // Check each new member
        for (const newMember of ctx.message.new_chat_members) {
          if (newMember.is_bot) {
            const botUsername = newMember.username || '';
            
            // Check if user is admin (admins can add any bot)
            let isAdmin = false;
            try {
              const chatMember = await ctx.telegram.getChatMember(groupId, userId);
              isAdmin = ['creator', 'administrator'].includes(chatMember.status);
            } catch (error) {
              logger.error('Error checking admin status for bot addition:', error);
            }

            // If user is admin, allow any bot addition
            if (isAdmin) {
              logger.info(`Admin ${userId} added bot @${botUsername} to group ${groupId}`);
              continue; // Skip to next member
            }

            // Check if this bot addition is authorized (for non-admins)
            const { isUnauthorized, reason } = ModerationService.checkBotAddition(
              userId, 
              groupId.toString(), 
              botUsername
            );

            if (isUnauthorized) {
              // Remove the unauthorized bot
              try {
                await ctx.telegram.banChatMember(groupId, newMember.id);
                
                // Notify the user
                const warningMessage = `⚠️ **Bot Addition Blocked**\n\n` +
                  `Only admins can add bots to this group. ` +
                  `Your attempt to add @${botUsername} has been blocked.`;
                
                await ctx.reply(warningMessage, { parse_mode: 'Markdown' });
                
                // Log the incident
                logger.warn(`Unauthorized bot addition attempt: User ${userId} tried to add bot @${botUsername} to group ${groupId}`);
                
                // Add warning to user
                await ModerationService.addWarning(
                  userId, 
                  groupId.toString(), 
                  'unauthorized_bot_addition',
                  `Attempted to add bot @${botUsername}`
                );
                
              } catch (error) {
                logger.error('Error removing unauthorized bot:', error);
                await ctx.reply('⚠️ An error occurred while processing bot addition.');
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error in bot addition prevention middleware:', error);
    }

    // Continue with normal processing
    return next();
  };
}

module.exports = botAdditionPreventionMiddleware;