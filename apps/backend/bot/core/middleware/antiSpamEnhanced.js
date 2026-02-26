const { RateLimiterRedis } = require('rate-limiter-flexible');
const { getRedis } = require('../../../config/redis');
const logger = require('../../../utils/logger');
const { t } = require('../../../utils/i18n');
const UserModel = require('../../../models/userModel');

/**
 * Enhanced Anti-Spam Middleware
 * Progressive warnings, user education, and smart detection
 */

// Rate limiter for message frequency
const messageLimiter = new RateLimiterRedis({
  storeClient: getRedis(),
  keyPrefix: 'spam:msg',
  points: 5, // 5 messages
  duration: 10, // per 10 seconds
  blockDuration: 60, // block for 60 seconds
});

// Rate limiter for identical messages (flood detection)
const floodLimiter = new RateLimiterRedis({
  storeClient: getRedis(),
  keyPrefix: 'spam:flood',
  points: 3, // 3 identical messages
  duration: 30, // per 30 seconds
  blockDuration: 120, // block for 120 seconds
});

// Track user warnings
const warningTracker = new Map();

/**
 * Enhanced Anti-Spam Middleware
 */
function antiSpamEnhanced() {
  return async (ctx, next) => {
    try {
      // Only apply in groups to avoid affecting private chats
      if (ctx.chat?.type === 'private') {
        return next();
      }

      const userId = ctx.from?.id;
      const username = ctx.from?.username || ctx.from?.first_name || 'User';
      const messageText = ctx.message?.text || ctx.message?.caption || '';
      const lang = ctx.session?.language || 'es';

      if (!userId) {
        return next();
      }

      // Check 1: Message frequency limit
      try {
        const msgResult = await messageLimiter.consume(userId);
        
        if (msgResult.remainingPoints <= 0) {
          // User is spamming - send warning or mute
          const retryAfterSecs = Math.ceil(msgResult.msBeforeNext / 1000);
          
          // Check warning count
          const warningCount = warningTracker.get(userId) || 0;
          
          if (warningCount < 2) {
            // Send warning
            const warningMessage = t('pnpLatinoAntiSpamWarning', lang)
              .replace('{count}', 5)
              .replace('{time}', 10);
            
            await ctx.reply(warningMessage, {
              parse_mode: 'Markdown',
              reply_to_message_id: ctx.message.message_id
            });
            
            warningTracker.set(userId, warningCount + 1);
            
            logger.info('Anti-spam warning sent', {
              userId,
              username,
              warningCount: warningCount + 1,
              retryAfterSecs
            });
            
            // Let the message through but with warning
            return next();
          } else {
            // Mute user
            try {
              await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
                can_send_messages: false,
                until_date: Math.floor(Date.now() / 1000) + 60 * 5 // 5 minutes
              });
              
              const muteMessage = t('pnpLatinoSpamMuted', lang)
                .replace('{duration}', 5)
                .replace('{count}', 5)
                .replace('{time}', 10);
              
              await ctx.reply(muteMessage, {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
              });
              
              logger.warn('User muted for spam', {
                userId,
                username,
                chatId: ctx.chat.id,
                duration: '5 minutes'
              });
              
              // Delete the spam message
              try {
                await ctx.deleteMessage();
              } catch (deleteError) {
                logger.debug('Could not delete spam message:', deleteError.message);
              }
              
              return; // Don't process the message
            } catch (muteError) {
              logger.error('Could not mute user:', muteError.message);
              await ctx.reply('⚠️ *Advertencia:* Por favor reduce la velocidad de tus mensajes para evitar ser silenciado.', {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
              });
              return next();
            }
          }
        }
      } catch (rateLimitError) {
        logger.error('Rate limit error:', rateLimitError.message);
      }

      // Check 2: Flood detection (identical messages)
      try {
        const floodKey = `${userId}:${messageText.substring(0, 50)}`; // Use first 50 chars as key
        const floodResult = await floodLimiter.consume(floodKey);
        
        if (floodResult.remainingPoints <= 0) {
          // Flood detected - delete message and warn
          await ctx.reply('⚠️ *Flood detectado:* Por favor no envíes el mismo mensaje repetidamente.', {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
          });
          
          try {
            await ctx.deleteMessage();
          } catch (deleteError) {
            logger.debug('Could not delete flood message:', deleteError.message);
          }
          
          logger.info('Flood message deleted', {
            userId,
            username,
            chatId: ctx.chat.id
          });
          
          return; // Don't process the message
        }
      } catch (floodError) {
        logger.error('Flood detection error:', floodError.message);
      }

      // Check 3: New user education
      try {
        const user = await UserModel.getById(userId);
        
        if (user && !user.hasSeenTutorial) {
          // Send welcome tutorial after first few messages
          const messageCount = await getRedis().get(`user:${userId}:messageCount`) || 0;
          
          if (messageCount < 3) {
            await getRedis().incr(`user:${userId}:messageCount`);
            
            if (messageCount === 2) {
              // Send welcome tutorial
              const tutorialMessage = t('pnpLatinoWelcomeTutorial', lang);
              
              await ctx.reply(tutorialMessage, {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
              });
              
              // Mark tutorial as seen
              await UserModel.update(userId, { hasSeenTutorial: true });
              
              logger.info('Welcome tutorial sent', {
                userId,
                username
              });
            }
          }
        }
      } catch (tutorialError) {
        logger.error('Tutorial error:', tutorialError.message);
      }

      // Check 4: URL spam detection
      const urlPattern = /https?:\/\/[^\s]+/gi;
      const urlCount = (messageText.match(urlPattern) || []).length;
      
      if (urlCount > 2) {
        // Too many URLs - likely spam
        await ctx.reply('⚠️ *Advertencia:* Demasiados enlaces en un solo mensaje. Por favor envía un enlace a la vez.', {
          parse_mode: 'Markdown',
          reply_to_message_id: ctx.message.message_id
        });
        
        try {
          await ctx.deleteMessage();
        } catch (deleteError) {
          logger.debug('Could not delete URL spam message:', deleteError.message);
        }
        
        logger.info('URL spam detected and deleted', {
          userId,
          username,
          urlCount
        });
        
        return; // Don't process the message
      }

      // Check 5: Command spam detection
      if (messageText.startsWith('/') && messageText !== '/menu' && messageText !== '/start') {
        const commandSpamKey = `cmd:${userId}`;
        const commandSpamLimiter = new RateLimiterRedis({
          storeClient: getRedis(),
          keyPrefix: commandSpamKey,
          points: 3, // 3 commands
          duration: 30, // per 30 seconds
        });
        
        try {
          const cmdResult = await commandSpamLimiter.consume(commandSpamKey);
          
          if (cmdResult.remainingPoints <= 0) {
            await ctx.reply('⚠️ *Advertencia:* Demasiados comandos seguidos. Por favor usa /menu y navega desde allí.', {
              parse_mode: 'Markdown',
              reply_to_message_id: ctx.message.message_id
            });
            
            return; // Don't process the command
          }
        } catch (cmdError) {
          logger.error('Command spam detection error:', cmdError.message);
        }
      }

      // All checks passed - process the message
      return next();
      
    } catch (error) {
      logger.error('Error in anti-spam middleware:', error);
      // Continue to next middleware even if this fails
      return next();
    }
  };
}

/**
 * Send tutorial to new users
 */
async function sendNewUserTutorial(ctx, userId, lang = 'es') {
  try {
    const tutorialSteps = [
      t('pnpLatinoTutorialStep1', lang),
      t('pnpLatinoTutorialStep2', lang),
      t('pnpLatinoTutorialStep3', lang)
    ];
    
    for (const step of tutorialSteps) {
      await ctx.reply(step, {
        parse_mode: 'Markdown'
      });
      
      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Send group rules
    const rulesMessage = t('pnpLatinoGroupRules', lang);
    await ctx.reply(rulesMessage, {
      parse_mode: 'Markdown'
    });
    
    await UserModel.update(userId, { hasSeenTutorial: true });
    
    logger.info('Complete tutorial sent to new user', {
      userId,
      language: lang
    });
    
  } catch (error) {
    logger.error('Error sending tutorial:', error);
  }
}

/**
 * Reset warning count for a user
 */
async function resetSpamWarnings(userId) {
  warningTracker.delete(userId);
  
  try {
    await messageLimiter.delete(userId);
    await floodLimiter.delete(userId);
    logger.info('Spam warnings reset for user', { userId });
  } catch (error) {
    logger.error('Error resetting spam warnings:', error);
  }
}

module.exports = {
  antiSpamEnhanced,
  sendNewUserTutorial,
  resetSpamWarnings
};
