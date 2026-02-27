const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const PDSProvisioningService = require('../../bot/services/PDSProvisioningService');
const { isAdminUser } = require('../../bot/utils/helpers');
const crypto = require('crypto');

/**
 * Validate Telegram WebApp initData HMAC signature
 * @param {string} initData - The initData string from Telegram WebApp
 * @param {string} botToken - The bot token
 * @returns {{valid: boolean, data: object}} - Validation result and parsed data
 */
function validateTelegramWebAppData(initData, botToken) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    // Create data-check-string
    const dataCheckArr = [];
    for (const [key, value] of urlParams.entries()) {
      dataCheckArr.push(`${key}=${value}`);
    }
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    // Calculate HMAC
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, data: null };
    }

    // Parse user data
    const userJson = urlParams.get('user');
    if (!userJson) {
      return { valid: false, data: null };
    }

    const userData = JSON.parse(userJson);
    const authDate = parseInt(urlParams.get('auth_date') || '0', 10);

    // Check if data is not too old (24 hours)
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return { valid: false, data: null };
    }

    return { valid: true, data: userData };
  } catch (error) {
    logger.error('Telegram WebApp validation error:', error);
    return { valid: false, data: null };
  }
}

/**
 * Handle Telegram authentication callback
 */
const handleTelegramAuth = async (req, res) => {
  try {
    const { initData } = req.body;

    if (!initData) {
      logger.warn('Telegram auth: No initData received');
      return res.status(400).json({
        error: 'Invalid request',
        redirect: '/auth/telegram-login'
      });
    }

    // Validate Telegram WebApp data
    const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.error('Telegram auth: Bot token not configured (BOT_TOKEN env var missing)');
      return res.status(500).json({
        error: 'Authentication service misconfigured'
      });
    }

    const validation = validateTelegramWebAppData(initData, botToken);
    if (!validation.valid) {
      logger.warn('Telegram auth: Invalid initData signature');
      return res.status(401).json({
        error: 'Invalid authentication data',
        redirect: '/auth/telegram-login'
      });
    }

    const telegramUser = validation.data;
    logger.info(`Telegram auth attempt for user: ${telegramUser.id} (${telegramUser.username || 'no username'})`);

    // Check if user exists in our database
    let userQuery = await query(
      `SELECT id, telegram, username, email, subscription_status, terms_accepted,
              first_name, language, photo_file_id,
              COALESCE(age_verified, false) as age_verified,
              COALESCE(onboarding_complete, false) as onboarding_complete,
              COALESCE(role, 'user') as role
       FROM users
       WHERE telegram = $1`,
      [telegramUser.id]
    );

    if (userQuery.rows.length === 0) {
      // User not in database - check if they need to be created with migrated subscription
      logger.info(`User ${telegramUser.id} not in database, creating new user record`);

      try {
        // Create user with default 'free' status (will be auto-upgraded if they have active subscription)
        await query(
          `INSERT INTO users (telegram, username, first_name, language, subscription_status, terms_accepted, age_verified, role)
           VALUES ($1, $2, $3, $4, 'free', false, false, 'user')
           ON CONFLICT (telegram) DO NOTHING`,
          [
            telegramUser.id,
            telegramUser.username || '',
            telegramUser.first_name || '',
            telegramUser.language_code || 'en'
          ]
        );

        // Re-query to get the created user
        userQuery = await query(
          `SELECT id, telegram, username, email, subscription_status, terms_accepted,
                  first_name, language, photo_file_id,
                  COALESCE(age_verified, false) as age_verified,
                  COALESCE(onboarding_complete, false) as onboarding_complete,
                  COALESCE(role, 'user') as role
           FROM users
           WHERE telegram = $1`,
          [telegramUser.id]
        );

        if (userQuery.rows.length === 0) {
          logger.error(`Failed to create user ${telegramUser.id}`);
          return res.status(500).json({
            error: 'User creation failed',
            redirect: '/auth/telegram-login'
          });
        }
      } catch (createError) {
        logger.error('Error creating user:', createError);
        return res.status(500).json({
          error: 'User creation failed',
          redirect: '/auth/telegram-login'
        });
      }
    }

    let user = userQuery.rows[0];

    // Check for subscription migration: if user has 'free' status but should have 'active' from bot usage
    // This happens when users first used the bot, then access the webapp
    if (user.subscription_status === 'free') {
      try {
        // Check if user has an active subscription in subscription_history
        const subQuery = await query(
          `SELECT status, expires_at
           FROM subscription_history
           WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at DESC
           LIMIT 1`,
          [user.id]
        );

        if (subQuery.rows.length > 0) {
          const sub = subQuery.rows[0];
          const now = new Date();
          const expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;

          // Only migrate if subscription is still active (not expired)
          if (!expiresAt || expiresAt > now) {
            logger.info(`Migrating active subscription for user ${user.telegram}`);
            await query(
              `UPDATE users SET subscription_status = 'active' WHERE id = $1`,
              [user.id]
            );
            user.subscription_status = 'active'; // Update local object
          }
        }
      } catch (migrationError) {
        logger.warn('Subscription migration check failed (non-blocking):', migrationError);
        // Continue with login even if migration fails
      }
    }

    // Determine role: DB role or env-based admin override
    let role = user.role;
    if (role === 'user' && isAdminUser(user.telegram)) {
      role = 'admin';
    }

    // Only use photo_file_id if it's a valid web URL (not a Telegram file ID)
    const isValidPhoto = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
    const photoUrl = isValidPhoto(user.photo_file_id) ? user.photo_file_id : null;

    // Store user in session
    req.session.user = {
      id: user.id,
      telegramId: user.telegram,
      username: user.username,
      firstName: user.first_name || telegramUser.first_name || '',
      displayName: user.first_name || telegramUser.first_name || user.username || '',
      language: user.language || 'en',
      email: user.email,
      photoUrl,
      subscriptionStatus: user.subscription_status,
      acceptedTerms: user.terms_accepted,
      ageVerified: user.age_verified,
      onboardingComplete: user.onboarding_complete,
      role
    };

    logger.info(`User ${user.id} authenticated successfully, terms accepted: ${user.terms_accepted}`);

    // ASYNC: Provision PDS in background (don't block login)
    // This runs independently without awaiting
    setImmediate(async () => {
      try {
        const pdsResult = await PDSProvisioningService.createOrLinkPDS(user);
        logger.info(`[Auth] PDS provisioning completed for user ${user.id}:`, {
          success: pdsResult.success,
          status: pdsResult.status
        });

        // Optionally store PDS info in session for frontend
        if (pdsResult.success) {
          req.session.user.pds = {
            pnptv_uuid: pdsResult.pnptv_uuid,
            pds_handle: pdsResult.pds_handle,
            pds_did: pdsResult.pds_did,
            status: pdsResult.status
          };
          req.session.save();
        }
      } catch (pdsError) {
        logger.warn(`[Auth] PDS provisioning failed (non-blocking):`, pdsError.message);
        // Continue - login succeeds even if PDS provisioning fails
      }
    });

    // Return success with full user data matching auth-status format
    res.json({
      success: true,
      user: {
        id: user.id,
        telegram_id: user.telegram,
        username: user.username || '',
        first_name: user.first_name || telegramUser.first_name || '',
        display_name: user.first_name || telegramUser.first_name || user.username || '',
        language: user.language || 'en',
        terms_accepted: Boolean(user.terms_accepted),
        age_verified: Boolean(user.age_verified),
        onboarding_complete: Boolean(user.onboarding_complete),
        subscription_type: user.subscription_status || 'free',
        role,
        photo_url: photoUrl,
      },
      termsAccepted: user.terms_accepted
    });

  } catch (error) {
    logger.error('Telegram auth error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      redirect: '/auth/telegram-login'
    });
  }
};

/**
 * Handle terms acceptance
 */
const handleAcceptTerms = async (req, res) => {
  try {
    const user = req.session?.user;
    
    if (!user) {
      logger.warn('Terms acceptance: No user in session');
      return res.status(401).json({ 
        error: 'Unauthorized', 
        redirect: '/auth/telegram-login'
      });
    }
    
    // Update user's terms acceptance in database
    await query(
      'UPDATE users SET terms_accepted = TRUE WHERE id = $1',
      [user.id]
    );
    
    // Update session
    req.session.user.acceptedTerms = true;
    
    logger.info(`User ${user.id} accepted terms and conditions`);
    
    // Get the original URL from localStorage (will be handled by frontend)
    res.json({ success: true });
    
  } catch (error) {
    logger.error('Error accepting terms:', error);
    res.status(500).json({ error: 'Failed to accept terms' });
  }
};

/**
 * Check authentication status
 */
const checkAuthStatus = (req, res) => {
  try {
    const user = req.session?.user;
    
    if (!user) {
      return res.json({
        authenticated: false,
        redirect: '/auth/telegram-login'
      });
    }
    
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        telegram_id: user.telegramId || user.id,
        username: user.username || '',
        first_name: user.firstName || user.username || '',
        display_name: user.displayName || user.username || '',
        language: user.language || 'en',
        terms_accepted: Boolean(user.acceptedTerms),
        age_verified: Boolean(user.ageVerified),
        onboarding_complete: Boolean(user.onboardingComplete),
        subscription_type: user.subscriptionStatus || 'free',
        role: user.role || 'user',
        photo_url: user.photoUrl || null,
      }
    });
    
  } catch (error) {
    logger.error('Auth status check error:', error);
    res.status(500).json({ error: 'Failed to check auth status' });
  }
};

module.exports = {
  handleTelegramAuth,
  handleAcceptTerms,
  checkAuthStatus
};