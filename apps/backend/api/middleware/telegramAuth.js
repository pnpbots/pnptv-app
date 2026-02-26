const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Telegram Authentication Middleware
 * Verifies user is logged in via Telegram and checks their subscription status
 */
const telegramAuth = async (req, res, next) => {
  try {
    // Check if user is authenticated via Telegram Web Login
    const telegramUser = req.session?.telegramUser;
    
    if (!telegramUser) {
      logger.warn('Unauthorized access attempt - no Telegram user in session');
      return res.status(401).json({
        error: 'Unauthorized',
        redirect: '/auth/telegram-login'
      });
    }
    
    // Check if user exists in our database
    const userQuery = await query(
      'SELECT id, telegram, username, subscription_status, tier, accepted_terms FROM users WHERE telegram = $1',
      [telegramUser.id]
    );

    if (userQuery.rows.length === 0) {
      // User not in our database - redirect to onboarding
      logger.info(`User ${telegramUser.id} not in database, redirecting to onboarding`);
      return res.status(403).json({
        error: 'User not registered',
        redirect: '/auth/not-registered',
        telegramUser: {
          id: telegramUser.id,
          username: telegramUser.username,
          first_name: telegramUser.first_name
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
      acceptedTerms: user.accepted_terms
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