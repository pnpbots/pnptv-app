const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Telegram Authentication Middleware
 * Verifies user is logged in via Telegram and checks their subscription status
 */
const telegramAuth = async (req, res, next) => {
  try {
    // Check if user is authenticated. The session is written by handleTelegramAuth
    // under req.session.user (new unified session schema).
    const sessionUser = req.session?.user;

    if (!sessionUser) {
      logger.warn('Unauthorized access attempt - no user in session');
      return res.status(401).json({
        error: 'Unauthorized',
        redirect: '/auth/telegram-login'
      });
    }

    // Resolve the lookup key: prefer telegramId stored in session, fall back to id
    const lookupKey = String(sessionUser.telegramId || sessionUser.id || '');

    // Check if user exists in our database (search both telegram column and id column)
    const userQuery = await query(
      `SELECT id, telegram, username, subscription_status, tier, terms_accepted
       FROM users
       WHERE telegram = $1 OR id = $1
       ORDER BY CASE WHEN telegram = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [lookupKey]
    );

    if (userQuery.rows.length === 0) {
      // User not in our database - redirect to onboarding
      logger.info(`User ${lookupKey} not in database, redirecting to onboarding`);
      return res.status(403).json({
        error: 'User not registered',
        redirect: '/auth/not-registered',
        telegramUser: {
          id: sessionUser.telegramId || sessionUser.id,
          username: sessionUser.username,
          first_name: sessionUser.firstName
        }
      });
    }

    const user = userQuery.rows[0];

    // Attach user to request
    req.user = {
      id: user.id,
      telegramId: user.telegram,
      username: user.username,
      tier: user.tier || 'free',
      subscriptionStatus: user.subscription_status,
      acceptedTerms: user.terms_accepted
    };
    
    next();
  } catch (error) {
    logger.error('Telegram auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const checkTermsAccepted = (req, res, next) => {
  if (req.user?.acceptedTerms) {
    return next();
  }
  
  res.status(403).json({
    error: 'Terms not accepted',
    redirect: '/auth/terms'
  });
};

const requirePrime = (req, res, next) => {
  if (req.user?.tier === 'prime') {
    return next();
  }

  res.status(403).json({
    error: 'Prime membership required',
    redirect: '/auth/upgrade-required'
  });
};

module.exports = {
  telegramAuth,
  checkTermsAccepted,
  requirePrime
};