const logger = require('../../../utils/logger');
const { isAdmin } = require('../../../utils/adminUtils');

const GROUP_ID = process.env.GROUP_ID;

/**
 * Personal Information Filter Middleware
 * Detects and filters personal information from group messages
 * Redirects users to send sensitive info via private message
 *
 * Detects:
 * - Phone numbers
 * - Email addresses
 * - Credit card numbers
 * - Social security numbers
 * - Home addresses
 * - Full names with contact info
 */

// Regex patterns for personal information
// NOTE: No global flag (/g) - we only use .test() once per pattern per message
// Global flag would cause lastIndex to persist between messages, missing detections
const PATTERNS = {
  // Phone numbers (various formats)
  phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,

  // Email addresses
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,

  // Credit card numbers (16 digits with optional spaces/dashes)
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,

  // Social security numbers (XXX-XX-XXXX)
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,

  // Home addresses (simplified - looks for street numbers and keywords)
  address: /\b\d{1,5}\s+[\w\s]{1,50}(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct)\b/i,

  // Common personal info keywords
  personalKeywords: /(my\s+)?(phone|email|address|credit\s+card|ssn|social\s+security|home\s+address|contact\s+me|call\s+me|text\s+me)/i,
};

/**
 * Check if message contains personal information
 * @param {string} text - Message text
 * @returns {Object} Detection result { detected: boolean, types: array }
 */
function detectPersonalInfo(text) {
  if (!text) {
    return { detected: false, types: [] };
  }

  const detectedTypes = [];

  // Check each pattern
  if (PATTERNS.phone.test(text)) {
    detectedTypes.push('phone number');
  }
  if (PATTERNS.email.test(text)) {
    detectedTypes.push('email address');
  }
  if (PATTERNS.creditCard.test(text)) {
    detectedTypes.push('credit card');
  }
  if (PATTERNS.ssn.test(text)) {
    detectedTypes.push('SSN');
  }
  if (PATTERNS.address.test(text)) {
    detectedTypes.push('address');
  }
  if (PATTERNS.personalKeywords.test(text)) {
    detectedTypes.push('personal contact info');
  }

  return {
    detected: detectedTypes.length > 0,
    types: detectedTypes,
  };
}

/**
 * Personal information filter middleware
 */
const personalInfoFilterMiddleware = () => async (ctx, next) => {
  try {
    // Only process text messages in groups
    if (!ctx.message?.text || ctx.chat?.type === 'private') {
      return next();
    }

    // Only process in configured group (if GROUP_ID is set)
    if (GROUP_ID && ctx.chat.id.toString() !== GROUP_ID) {
      return next();
    }

    // Skip admin messages
    if (await isAdmin(ctx)) {
      return next();
    }

    // Check for personal information
    const detection = detectPersonalInfo(ctx.message.text);

    if (detection.detected) {
      const username = ctx.from.username || ctx.from.first_name;
      const userId = ctx.from.id;
      const userLang = ctx.from.language_code || 'en';
      const isSpanish = userLang.startsWith('es');

      // Delete the message containing personal info
      try {
        await ctx.deleteMessage();
        logger.info('Deleted message with personal info', {
          userId,
          username,
          types: detection.types
        });
      } catch (error) {
        logger.error('Could not delete message with personal info:', error);
      }

      // Send warning in group (auto-delete after 60 seconds)
      let warningMessage;
      if (isSpanish) {
        warningMessage = `⚠️ @${username}, tu mensaje fue eliminado por seguridad.

🔒 **Detectamos información personal:**
${detection.types.map(t => `• ${t}`).join('\n')}

**Para tu protección:**
• Nunca compartas información personal en grupos públicos
• Usa mensajes privados para información sensible

📨 Envíame un mensaje privado: @${ctx.botInfo.username}`;
      } else {
        warningMessage = `⚠️ @${username}, your message was removed for your safety.

🔒 **We detected personal information:**
${detection.types.map(t => `• ${t}`).join('\n')}

**For your protection:**
• Never share personal information in public groups
• Use private messages for sensitive info

📨 Send me a private message: @${ctx.botInfo.username}`;
      }

      const sentMessage = await ctx.reply(warningMessage, {
        parse_mode: 'Markdown',
      });

      // Auto-delete warning after 60 seconds
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, sentMessage.message_id);
        } catch (error) {
          logger.debug('Could not delete warning message:', error.message);
        }
      }, 60000);

      // Try to send private message with detailed info
      try {
        let privateMessage;
        if (isSpanish) {
          privateMessage = `🔒 **Información Personal Detectada**

Hola ${username}, tu mensaje en **${ctx.chat.title}** fue eliminado porque contenía información personal.

**Tipos detectados:**
${detection.types.map(t => `• ${t}`).join('\n')}

**Consejos de seguridad:**
• Nunca compartas números de teléfono en grupos públicos
• No publiques direcciones de correo electrónico
• Mantén la información financiera privada
• Usa mensajes privados para información sensible

Si necesitas compartir información de contacto con alguien específico, usa mensajes directos.

¿Necesitas ayuda? Escribe /help`;
        } else {
          privateMessage = `🔒 **Personal Information Detected**

Hey ${username}, your message in **${ctx.chat.title}** was removed because it contained personal information.

**Types detected:**
${detection.types.map(t => `• ${t}`).join('\n')}

**Safety tips:**
• Never share phone numbers in public groups
• Don't post email addresses publicly
• Keep financial information private
• Use private messages for sensitive info

If you need to share contact information with someone specific, use direct messages.

Need help? Type /help`;
        }

        await ctx.telegram.sendMessage(userId, privateMessage, {
          parse_mode: 'Markdown',
        });

        logger.info('Sent personal info warning to user via DM', { userId, username });
      } catch (error) {
        if (error.response?.error_code === 403) {
          logger.debug(`Cannot send DM to user ${userId}: User has not started bot`);
        } else {
          logger.error('Error sending personal info warning via DM:', error);
        }
      }

      // Don't proceed with message processing
      return;
    }

    // No personal info detected, continue
    return next();

  } catch (error) {
    logger.error('Error in personal info filter middleware:', error);
    // Continue on error to avoid blocking legitimate messages
    return next();
  }
};

module.exports = personalInfoFilterMiddleware;
module.exports.detectPersonalInfo = detectPersonalInfo;
