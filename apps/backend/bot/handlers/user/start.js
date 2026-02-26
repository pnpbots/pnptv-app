const { getMainMenu, getLanguageMenu } = require('../../utils/menus');
const { requirePrivateChat } = require('../../utils/notifications');
const { isPrimeUser } = require('../../utils/helpers');
const userService = require('../../services/userService');
const i18n = require('../../utils/i18n');
const logger = require('../../../utils/logger');
const { showMainMenu } = require('./menu');

/**
 * Handle /start command
 */
async function handleStart(ctx) {
  try {
    const userId = ctx.from.id;
    const userData = {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    };

    // Check if command is in group chat
    const isPrivate = await requirePrivateChat(
      ctx,
      '/start',
      '' // Message will be set below
    );

    if (!isPrivate) {
      return; // Already handled redirect
    }

    // Get or create user
    const user = await userService.getOrCreateUser(userId, userData);

    // For returning users (onboarding complete), show main menu directly
    // For new users, start onboarding
    if (user.onboardingComplete) {
      // Show main menu (sales-focused for FREE, benefits for PRIME)
      await showMainMenu(ctx);
    } else {
      // Start onboarding - language selection
      await ctx.reply(
        i18n.t('select_language', 'en'),
        { reply_markup: getLanguageMenu() }
      );
    }

    logger.info(`User ${userId} started the bot`);
  } catch (error) {
    logger.error('Error in /start command:', error);
    await ctx.reply(i18n.t('error_occurred', 'en'));
  }
}

/**
 * Handle language selection callback
 */
async function handleLanguageSelection(ctx) {
  try {
    const userId = ctx.from.id;
    const language = ctx.callbackQuery.data.split('_')[1]; // 'lang_en' -> 'en'

    // Update user language
    await userService.updateUser(userId, { language });

    // Delete previous message
    await ctx.deleteMessage();

    // Show age verification
    await ctx.reply(
      i18n.t('age_verification', language),
      { reply_markup: { force_reply: true } }
    );

    // Save session state
    await ctx.saveSession({ step: 'age_verification', language });

    logger.info(`User ${userId} selected language: ${language}`);
  } catch (error) {
    logger.error('Error in language selection:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

/**
 * Handle age verification
 */
async function handleAgeVerification(ctx) {
  try {
    const userId = ctx.from.id;
    const age = parseInt(ctx.message.text);
    const language = ctx.session?.language || 'en';

    if (isNaN(age) || age < 1) {
      await ctx.reply(i18n.t('invalid_age', language));
      return;
    }

    if (age < 18) {
      await ctx.reply(i18n.t('age_too_young', language));
      await ctx.clearSession();
      return;
    }

    // Update user age
    await userService.updateUser(userId, { age });

    // Show terms acceptance
    await ctx.reply(
      i18n.t('terms_accept', language),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: language === 'es' ? '✅ Aceptar' : '✅ Accept', callback_data: 'accept_terms' }],
            [{ text: language === 'es' ? '❌ Rechazar' : '❌ Decline', callback_data: 'decline_terms' }],
          ],
        },
      }
    );

    // Update session
    await ctx.saveSession({ step: 'terms_acceptance', language });

    logger.info(`User ${userId} verified age: ${age}`);
  } catch (error) {
    logger.error('Error in age verification:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

/**
 * Handle terms acceptance
 */
async function handleTermsAcceptance(ctx) {
  try {
    const userId = ctx.from.id;
    const language = ctx.session?.language || 'en';
    const accepted = ctx.callbackQuery.data === 'accept_terms';

    if (!accepted) {
      await ctx.editMessageText(
        language === 'es'
          ? '❌ Debes aceptar los términos para continuar.'
          : '❌ You must accept the terms to continue.'
      );
      await ctx.clearSession();
      return;
    }

    // Update user
    await userService.updateUser(userId, { termsAccepted: true });

    // Delete previous message
    await ctx.deleteMessage();

    await ctx.reply(i18n.t('terms_accepted', language));

    // Ask for username
    await ctx.reply(
      i18n.t('enter_username', language),
      { reply_markup: { force_reply: true } }
    );

    // Update session
    await ctx.saveSession({ step: 'username_input', language });

    logger.info(`User ${userId} accepted terms`);
  } catch (error) {
    logger.error('Error in terms acceptance:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

/**
 * Handle username input
 */
async function handleUsernameInput(ctx) {
  try {
    const userId = ctx.from.id;
    const username = ctx.message.text.trim();
    const language = ctx.session?.language || 'en';

    // Validate username
    const { sanitizeText } = require('../../utils/validation');
    const cleanUsername = sanitizeText(username);

    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      await ctx.reply(i18n.t('invalid_username', language));
      return;
    }

    // Update user
    await userService.updateUser(userId, { username: cleanUsername });

    // Ask for bio
    await ctx.reply(
      i18n.t('enter_bio', language),
      { reply_markup: { force_reply: true } }
    );

    // Update session
    await ctx.saveSession({ step: 'bio_input', language });

    logger.info(`User ${userId} set username: ${cleanUsername}`);
  } catch (error) {
    logger.error('Error in username input:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

/**
 * Handle bio input
 */
async function handleBioInput(ctx) {
  try {
    const userId = ctx.from.id;
    const bio = ctx.message.text.trim();
    const language = ctx.session?.language || 'en';

    // Validate bio
    const { sanitizeText } = require('../../utils/validation');
    const cleanBio = sanitizeText(bio);

    if (cleanBio.length > 500) {
      await ctx.reply(i18n.t('invalid_bio', language));
      return;
    }

    // Update user
    await userService.updateUser(userId, { bio: cleanBio });

    // Ask for location
    await ctx.reply(
      i18n.t('enter_location', language),
      {
        reply_markup: {
          keyboard: [
            [{ text: language === 'es' ? '📍 Compartir Ubicación' : '📍 Share Location', request_location: true }],
            [{ text: language === 'es' ? '⏭️ Omitir' : '⏭️ Skip' }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );

    // Update session
    await ctx.saveSession({ step: 'location_input', language });

    logger.info(`User ${userId} set bio`);
  } catch (error) {
    logger.error('Error in bio input:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

/**
 * Handle location input
 */
async function handleLocationInput(ctx) {
  try {
    const userId = ctx.from.id;
    const language = ctx.session?.language || 'en';

    if (ctx.message.location) {
      // User shared location
      const { latitude, longitude } = ctx.message.location;
      await userService.updateUser(userId, {
        location: { lat: latitude, lng: longitude },
      });
    }

    // Complete onboarding
    await userService.updateUser(userId, { onboardingComplete: true });

    // Get updated user data for menu
    const user = await userService.getUser(userId);

    // Clear session
    await ctx.clearSession();

    // Show completion message and main menu
    await ctx.reply(
      i18n.t('profile_complete', language),
      {
        reply_markup: getMainMenu(language, isPrimeUser(user)),
      }
    );

    logger.info(`User ${userId} completed onboarding`);
  } catch (error) {
    logger.error('Error in location input:', error);
    await ctx.reply(i18n.t('error_occurred', ctx.session?.language || 'en'));
  }
}

module.exports = {
  handleStart,
  handleLanguageSelection,
  handleAgeVerification,
  handleTermsAcceptance,
  handleUsernameInput,
  handleBioInput,
  handleLocationInput,
};
