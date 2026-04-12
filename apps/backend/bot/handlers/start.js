const { Markup } = require('telegraf');
const { t } = require('../../utils/i18n');
const UserService = require('../../services/userService');
const logger = require('../../utils/logger');
const { showAgeVerification, showMainMenu } = require('../helpers/onboardingHelpers');
const { handlePromoDeepLink } = require('./promo/promoHandler');

/**
 * Check if user is admin
 * @param {number} userId - User ID
 * @returns {boolean} Is admin
 */
function isAdmin(userId) {
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => parseInt(id.trim(), 10));
  return adminIds.includes(userId);
}

/**
 * Check if age verification has expired
 * @param {Date|null} expiresAt - Expiration date
 * @returns {boolean} Has expired
 */
function hasAgeVerificationExpired(expiresAt) {
  if (!expiresAt) return true;
  const now = new Date();
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return now > expiry;
}

/**
 * Handle /start command
 * @param {Context} ctx - Telegraf context
 */
async function handleStart(ctx) {
  try {
    const userId = ctx.from.id.toString();
    const lang = ctx.session?.language || ctx.from.language_code || 'en';

    logger.info(`[Start] User ${userId} triggered /start command`);

    // Check for group redirect payload
    const startPayload = ctx.message?.text?.split(' ')[1];
    if (startPayload === 'group_redirect') {
      logger.info(`[Start] User ${userId} redirected from group`);
      return await handleGroupRedirect(ctx);
    }

    // Check for promo deep link: /start promo_CODE
    if (startPayload && startPayload.startsWith('promo_')) {
      const promoCode = startPayload.replace('promo_', '');
      logger.info(`[Start] User ${userId} accessing promo: ${promoCode}`);
      return await handlePromoDeepLink(ctx, promoCode);
    }

    ctx.session = ctx.session || {};

    if (startPayload === 'age_verified') {
      ctx.session.ageVerified = true;
      ctx.session.onboardingStep = 'terms';
      await ctx.saveSession();
      const confirmation = lang === 'es'
        ? '✅ Verificamos tu edad. Continúa con los siguientes pasos (términos y privacidad).'
        : '✅ Age verified! Continue with the following steps (terms & privacy).';
      await ctx.reply(confirmation);
    }

    const userData = await UserService.getUser(userId);
    if (!userData) {
      logger.info(`[Start] New user ${userId} - starting onboarding`);
      return await startFreshOnboarding(ctx);
    }

    // Optional: Force fresh onboarding for admins during testing
    if (isAdmin(ctx.from.id) && process.env.ADMIN_FRESH_ONBOARDING === 'true') {
      logger.info(`[Start] Admin ${userId} - forcing fresh onboarding`);
      return await startFreshOnboarding(ctx);
    }

    // Check if age verification has expired
    if (hasAgeVerificationExpired(userData.ageVerificationExpiresAt)) {
      logger.info(`[Start] User ${userId} - age verification expired, re-verification required`);
      return await handleAgeReverification(ctx, userData);
    }

    // Check if onboarding is complete
    if (userData.onboardingComplete) {
      logger.info(`[Start] Returning user ${userId} - showing main menu`);

      try {
        await UserService.updateUser(userId, { lastActive: new Date() });
      } catch (updateError) {
        logger.warn('Failed to update lastActive:', updateError);
      }

      const greeting = lang === 'es'
        ? `¡Hola de nuevo, ${userData.firstName || 'Usuario'}! 👋`
        : `Welcome back, ${userData.firstName || 'User'}! 👋`;

      await ctx.reply(greeting);
      return await showMainMenu(ctx);
    }

    logger.info(`[Start] User ${userId} - resuming incomplete onboarding`);
    return await resumeOnboarding(ctx, userData);
  } catch (error) {
    logger.error('Error in handleStart:', error);
    await ctx.reply(t('error', ctx.session?.language || 'en'));
  }
}

/**
 * Start fresh onboarding for new user
 * @param {Context} ctx - Telegraf context
 */
async function startFreshOnboarding(ctx) {
  const lang = 'en'; // Default to English for initial language selection

  // Initialize session
  ctx.session = {
    language: null,
    onboardingStep: 'language',
    onboardingComplete: false,
    ageVerified: false,
    termsAccepted: false,
    privacyAccepted: false,
    awaitingEmail: false,
    temp: {}, // Initialize temp object for handlers
  };

  await ctx.reply(
    t('welcome', lang) + '\n\nPlease select your language / Por favor selecciona tu idioma:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🇺🇸 English', 'language_en'),
        Markup.button.callback('🇪🇸 Español', 'language_es'),
      ],
    ])
  );
}

/**
 * Handle age re-verification for returning users
 * @param {Context} ctx - Telegraf context
 * @param {Object} userData - User data from Firestore
 */
async function handleAgeReverification(ctx, userData) {
  const lang = userData.language || 'en';

  // Initialize session with existing data
  ctx.session = {
    language: lang,
    onboardingStep: 'ageVerification',
    onboardingComplete: userData.onboardingComplete || false,
    ageVerified: false, // Will be set to true after re-verification
    termsAccepted: userData.termsAccepted || false,
    privacyAccepted: userData.privacyAccepted || false,
    email: userData.email || null,
    awaitingEmail: false,
    temp: {}, // Initialize temp object for handlers
  };

  // Show age re-verification message
  await ctx.reply(t('ageVerificationReminder', lang));

  // Show age verification step
  await showAgeVerification(ctx);
}

/**
 * Resume incomplete onboarding
 * @param {Context} ctx - Telegraf context
 * @param {Object} userData - User data from Firestore
 */
async function resumeOnboarding(ctx, userData) {
  const lang = userData.language || 'en';

  // Initialize session with existing progress
  ctx.session = {
    language: lang,
    onboardingStep: userData.onboardingStep || 'language',
    onboardingComplete: false,
    ageVerified: userData.ageVerified || false,
    ageVerifiedAt: userData.ageVerifiedAt || null,
    ageVerificationExpiresAt: userData.ageVerificationExpiresAt || null,
    termsAccepted: userData.termsAccepted || false,
    privacyAccepted: userData.privacyAccepted || false,
    email: userData.email || null,
    awaitingEmail: false,
    temp: {}, // Initialize temp object for handlers
  };

  logger.info(`[Start] Resuming onboarding at step: ${ctx.session.onboardingStep}`);

  // Resume from the last incomplete step
  const { showTerms, showPrivacyPolicy, showEmailPrompt } = require('../helpers/onboardingHelpers');

  if (!ctx.session.ageVerified) {
    await showAgeVerification(ctx);
  } else if (!ctx.session.termsAccepted) {
    await showTerms(ctx);
  } else if (!ctx.session.privacyAccepted) {
    await showPrivacyPolicy(ctx);
  } else {
    // If all steps are complete but onboardingComplete is false, complete it now
    const { completeOnboarding } = require('../helpers/onboardingHelpers');
    await completeOnboarding(ctx);
  }
}

/**
 * Handle group redirect (user clicked "Start" from group)
 * @param {Context} ctx - Telegraf context
 */
async function handleGroupRedirect(ctx) {
  const lang = ctx.session?.language || ctx.from.language_code || 'en';

  const message = lang === 'es'
    ? '👋 ¡Hola! Has sido redirigido desde el grupo.\n\n' +
      'Ahora puedes usar el bot en este chat privado.\n\n' +
      '📋 Usa /menu para navegar todas las funciones disponibles.\n\n' +
      '⚠️ **Recuerda:** El grupo NO es para servicio al cliente. ' +
      'Las violaciones repetidas resultarán en sanciones.'
    : '👋 Hello! You\'ve been redirected from the group.\n\n' +
      'You can now use the bot in this private chat.\n\n' +
      '📋 Use /menu to navigate all available features.\n\n' +
      '⚠️ **Remember:** The group is NOT for customer service. ' +
      'Repeated violations will result in penalties.';

  await ctx.reply(
    message,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 ' + (lang === 'es' ? 'Ver Comandos' : 'View Commands'), 'show_commands')],
      [Markup.button.callback('👤 ' + (lang === 'es' ? 'Mi Perfil' : 'My Profile'), 'show_my_profile')],
    ])
  );
}

module.exports = handleStart;
