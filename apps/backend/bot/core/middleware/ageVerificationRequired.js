const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');
const UserModel = require('../../../models/userModel');

/**
 * Middleware to enforce age verification for specific features
 * Features requiring age verification:
 * - Nearby Members (show_nearby)
 * - Profile (show_profile)
 * - Members Area (show_members_area)
 * - Subscription Plans (show_subscription_plans)
 * - Video Calls (show_jitsi, etc.)
 */

const FEATURES_REQUIRING_AGE_VERIFICATION = [
  'show_nearby_unified',
  'show_profile',
  'show_members_area',
  'show_subscription_plans',
  'show_jitsi',
  'show_video_rooms',
  'show_members_area',
  'video_call_start',
  'join_video_room',
];

/**
 * Check if user is age verified
 * @param {Object} ctx - Telegraf context
 * @returns {Promise<boolean>} True if age verified, false otherwise
 */
async function isAgeVerified(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!userId) return false;

    // Check session first (faster)
    if (ctx.session?.ageVerified) {
      return true;
    }

    // Check database
    const user = await UserModel.getById(userId);
    if (!user) {
      return false;
    }

    // Cache in session for this request
    ctx.session.ageVerified = user.ageVerified === true;
    return ctx.session.ageVerified;
  } catch (error) {
    logger.error('Error checking age verification status:', error);
    return false;
  }
}

/**
 * Send age verification required message
 * @param {Object} ctx - Telegraf context
 */
async function sendAgeVerificationRequired(ctx) {
  const lang = getLanguage(ctx);

  const message = lang === 'es'
    ? `🔒 **Verificación de Edad Requerida**

Para acceder a esta función, necesitamos verificar que eres mayor de 18 años.

Esta es una medida de seguridad para proteger a nuestra comunidad.

¿Cómo deseas verificar tu edad?`
    : `🔒 **Age Verification Required**

To access this feature, we need to verify that you are over 18 years old.

This is a safety measure to protect our community.

How would you like to verify your age?`;

  const { Markup } = require('telegraf');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(
      lang === 'es' ? '📸 Verificar con Foto' : '📸 Verify with Photo',
      'age_verify_photo'
    )],
    [Markup.button.callback(
      lang === 'es' ? '✅ Confirmación Manual' : '✅ Manual Confirmation',
      'age_verify_manual'
    )],
  ]);

  try {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  } catch (error) {
    logger.error('Error sending age verification required message:', error);
  }
}

/**
 * Middleware to enforce age verification for specific actions
 * @param {Telegraf} bot - Bot instance
 */
function setupAgeVerificationMiddleware(bot) {
  // Apply to action handlers
  FEATURES_REQUIRING_AGE_VERIFICATION.forEach(action => {
    bot.action(action, async (ctx, next) => {
      try {
        const verified = await isAgeVerified(ctx);

        if (!verified) {
          logger.info(`Age verification required for action: ${action}, user: ${ctx.from?.id}`);
          await sendAgeVerificationRequired(ctx);
          return; // Don't proceed to next handler
        }

        // User is verified, proceed to next handler
        return next();
      } catch (error) {
        logger.error(`Error in age verification middleware for action ${action}:`, error);
        return next(); // Continue anyway if there's an error
      }
    });
  });
}

/**
 * Update age verification status in session and database
 * @param {Object} ctx - Telegraf context
 * @param {boolean} verified - Verification status
 */
async function updateAgeVerificationStatus(ctx, verified = true, method = 'ai_photo') {
  try {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Update session
    ctx.session.ageVerified = verified;
    await ctx.saveSession();

    // Update database via UserModel if method exists
    if (UserModel.updateAgeVerification) {
      await UserModel.updateAgeVerification(userId, { verified, method });
    }

    logger.info(`Age verification status updated for user ${userId}:`, { verified, method });
  } catch (error) {
    logger.error('Error updating age verification status:', error);
  }
}

module.exports = {
  isAgeVerified,
  sendAgeVerificationRequired,
  setupAgeVerificationMiddleware,
  updateAgeVerificationStatus,
  FEATURES_REQUIRING_AGE_VERIFICATION,
};
