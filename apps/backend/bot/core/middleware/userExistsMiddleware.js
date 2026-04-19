const UserModel = require('../../../models/userModel');
const { cache } = require('../../../config/redis');
const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

/**
 * Middleware to check if user exists in database
 * Forces onboarding for users not in the database
 */
const userExistsMiddleware = () => async (ctx, next) => {
  // Skip for certain update types that don't require user check
  if (!ctx.from?.id) {
    return next();
  }

  // Skip for webhook endpoints and certain callbacks
  const skipPatterns = [
    /^webhook/,
    /^epayco/,
    /^daimo/,
  ];

  const callbackData = ctx.callbackQuery?.data || '';
  const shouldSkip = skipPatterns.some(pattern => pattern.test(callbackData));

  if (shouldSkip) {
    return next();
  }

  const userId = ctx.from.id.toString();
  const recentCreateKey = `user:recent_create:${userId}`;

  try {
    const recentlyCreated = await cache.get(recentCreateKey);
    if (recentlyCreated) {
      return next();
    }
    // Check if user exists in database. getById matches when the row's `id`
    // is the bare Telegram numeric id (bot-created users). For webapp users
    // who signed up first and linked Telegram later, the `id` is a UUID and
    // the Telegram id lives in the `telegram` column — fall back to that
    // lookup so we don't try to INSERT a row that violates the
    // idx_users_telegram_unique constraint.
    let user = await UserModel.getById(userId);
    if (!user) {
      user = await UserModel.getByTelegram(userId);
      if (user) {
        // Found via telegram column — short-circuit createOrUpdate. Treat as
        // an existing user; the username sync block below will run.
        await cache.set(recentCreateKey, true, 60);
      }
    }

    if (!user) {
      // User not in database - mark for onboarding
      logger.info('User not in database, marking for onboarding', {
        userId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      });

      // Set session flag to force onboarding
      if (ctx.session) {
        ctx.session.forceOnboarding = true;
        ctx.session.userNotInDb = true;
      }

      // Create basic user record to prevent repeated checks
      try {
        await UserModel.createOrUpdate({
          id: userId,
          username: ctx.from.username || null,
          firstName: ctx.from.first_name || null,
          lastName: ctx.from.last_name || null,
          language: ctx.from.language_code || 'es',
          onboardingComplete: false,
          ageVerified: false,
          termsAccepted: false,
          privacyAccepted: false,
        });
        await cache.set(recentCreateKey, true, 60);
        logger.info('Created basic user record for onboarding', { userId });
      } catch (createError) {
        logger.error('Error creating user record:', createError);
      }
    } else {
      // User exists — sync username and first_name from Telegram if changed
      const tgUsername = ctx.from.username || null;
      const tgFirstName = ctx.from.first_name || null;
      if (tgUsername !== user.username || (tgFirstName && tgFirstName !== user.first_name)) {
        query(
          `UPDATE users SET username = $1, first_name = COALESCE($2, first_name), updated_at = NOW() WHERE id = $3`,
          [tgUsername, tgFirstName, userId]
        ).catch(err => logger.warn('Username sync failed (non-blocking)', { userId, error: err.message }));
      }

      if (!user.onboardingComplete) {
        // User exists but hasn't completed onboarding
        if (ctx.session) {
          ctx.session.forceOnboarding = true;
        }
      }
    }

    return next();
  } catch (error) {
    logger.error('Error in userExistsMiddleware:', error);
    // Don't block on errors, continue with normal flow
    return next();
  }
};

module.exports = { userExistsMiddleware };
