const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');
const PlatformBanService = require('../../bot/services/platformBanService');
const AuthentikService = require('../../services/authentikService');
const { isAdminUser } = require('../../bot/utils/helpers');
const { enforceDefaultFollows } = require('../../bot/services/followService');
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

    // --- Phase 1: Identity Consolidation via Authentik ---
    // Ensure user has a persistent UUID (pnptv_id) in Authentik SSO
    const pnptvId = await AuthentikService.syncTelegramUser(telegramUser);
    if (!pnptvId) {
      logger.error('Failed to sync user with Authentik SSO, aborting login');
      return res.status(500).json({
        error: 'Authentication sync failed',
        message: 'No pudimos sincronizar tu cuenta con el sistema de identidad centralizado.'
      });
    }

    // Check if user exists in our database
    let userQuery = await query(
      `SELECT id, pnptv_id, telegram, username, email, subscription_status, tier, terms_accepted,
              first_name, language, photo_file_id,
              COALESCE(age_verified, false) as age_verified,
              COALESCE(onboarding_complete, false) as onboarding_complete,
              COALESCE(role, 'user') as role
       FROM users
       WHERE telegram = $1 OR pnptv_id = $2`,
      [telegramUser.id, pnptvId]
    );

    if (userQuery.rows.length === 0) {
      // User not in database - create new user record with Authentik UUID
      logger.info(`User ${telegramUser.id} / ${pnptvId} not in database, creating new user record`);

      try {
        await query(
          `INSERT INTO users (id, telegram, pnptv_id, username, first_name, language, subscription_status, terms_accepted, age_verified, role)
           VALUES ($1, $1, $2, $3, $4, $5, 'free', false, false, 'user')
           ON CONFLICT (id) DO UPDATE SET
             pnptv_id = EXCLUDED.pnptv_id,
             username = COALESCE(EXCLUDED.username, users.username),
             updated_at = NOW()`,
          [
            String(telegramUser.id),
            pnptvId,
            (telegramUser.username || '').toUpperCase(),
            telegramUser.first_name || '',
            telegramUser.language_code || 'en'
          ]
        );

        // Re-query to get the created user
        userQuery = await query(
          `SELECT id, pnptv_id, telegram, username, email, subscription_status, terms_accepted,
                  first_name, language, photo_file_id,
                  COALESCE(age_verified, false) as age_verified,
                  COALESCE(onboarding_complete, false) as onboarding_complete,
                  COALESCE(role, 'user') as role
           FROM users
           WHERE telegram = $1 OR pnptv_id = $2`,
          [telegramUser.id, pnptvId]
        );
      } catch (createError) {
        logger.error('Error creating user record:', createError);
        return res.status(500).json({
          error: 'User creation failed',
          redirect: '/auth/telegram-login'
        });
      }
    } else {
      // User exists, ensure pnptv_id is updated if missing
      const dbUser = userQuery.rows[0];
      if (!dbUser.pnptv_id || dbUser.pnptv_id !== pnptvId) {
        logger.info(`Updating pnptv_id for user ${dbUser.id} to Authentik UUID ${pnptvId}`);
        await query('UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2', [pnptvId, dbUser.id]);
        dbUser.pnptv_id = pnptvId;
      }
    }

    let user = userQuery.rows[0];

    // ── Platform ban check — block ALL banned identities at login ─────────────
    if (user.tier === 'banned') {
      logger.warn('Telegram auth: banned user attempted login', { userId: user.id });
      return res.status(403).json({
        error: 'account_banned',
        message: 'Tu cuenta ha sido suspendida permanentemente de la plataforma PNPtv.',
      });
    }

    const ban = await PlatformBanService.isBanned({
      userId:     String(user.id),
      telegramId: String(telegramUser.id),
      pnptvId:    user.pnptv_id || undefined,
      email:      user.email    || undefined,
    });

    if (ban) {
      logger.warn('Telegram auth: platform-banned user attempted login', { userId: user.id, banId: ban.id });
      return res.status(403).json({
        error: 'account_banned',
        message: 'Tu cuenta ha sido suspendida permanentemente de la plataforma PNPtv.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Check for subscription migration: if user has 'free' tier but should have 'active'
    // tier is the source of truth for access control; subscription_status tracks lifecycle
    if (user.tier === 'free' || !user.tier) {
      try {
        const subQuery = await query(
          `SELECT plan_expiry, plan_id
           FROM users
           WHERE id = $1 AND plan_expiry > NOW()`,
          [user.id]
        );

        if (subQuery.rows.length > 0 && subQuery.rows[0].plan_expiry) {
          logger.info(`Migrating active subscription for user ${user.id} (plan_expiry still valid)`);
          await query(
            `UPDATE users SET tier = 'PRIME', subscription_status = 'active' WHERE id = $1`,
            [user.id]
          );
          user.tier = 'PRIME';
          user.subscription_status = 'active';
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

    // Regenerate session to prevent session fixation attacks
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Persist last_login_method + last_login_at for MiniApp path
    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'mini_app', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});

    // Store user in session (after regeneration so old session ID is invalidated)
    req.session.user = {
      id: user.id,
      pnptvId: user.pnptv_id,
      telegramId: user.telegram,
      username: user.username,
      firstName: user.first_name || telegramUser.first_name || '',
      displayName: user.first_name || telegramUser.first_name || user.username || 'Member',
      language: user.language || 'en',
      email: user.email,
      photoUrl,
      subscriptionStatus: user.subscription_status,
      tier: user.tier || 'free',
      acceptedTerms: user.terms_accepted,
      ageVerified: user.age_verified,
      onboardingComplete: user.onboarding_complete,
      role,
      last_login_method: 'mini_app',
    };

    logger.info(`User ${user.id} authenticated successfully, terms accepted: ${user.terms_accepted}`);

    // ASYNC: Provision all services in background (don't block login)
    setImmediate(async () => {
      // 1. Matrix — DMs and hangout chat rooms
      try {
        const matrixService = require('../../bot/services/matrixService');
        await matrixService.provisionMatrixUser(user);
        logger.info(`[Auth] Matrix provisioned for user ${user.id}`);
      } catch (err) {
        logger.warn(`[Auth] Matrix provisioning failed (non-blocking): ${err.message}`);
      }

      // 2. Default follows (idempotent)
      enforceDefaultFollows(user.id).catch(() => {});
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
        tier: user.tier || 'free',
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
 * Refreshes tier/role/subscription from DB on every call so session stays current.
 */
const checkAuthStatus = async (req, res) => {
  try {
    const user = req.session?.user;

    if (!user) {
      return res.json({
        authenticated: false,
        redirect: '/auth/telegram-login'
      });
    }

    // Refresh tier, role, and subscription from DB (prevents stale session data)
    try {
      const { rows } = await query(
        'SELECT pnptv_id, tier, role, subscription_status, photo_file_id, creator_status, creator_type, age_verified, terms_accepted, date_of_birth, content_disclaimer FROM users WHERE id = $1',
        [user.id]
      );
      if (rows.length > 0) {
        const fresh = rows[0];
        if (fresh.pnptv_id) user.pnptvId = fresh.pnptv_id;
        user.tier = fresh.tier || 'free';
        user.role = fresh.role || user.role || 'user';
        user.subscriptionStatus = fresh.subscription_status || user.subscriptionStatus || 'free';
        user.creator_status = fresh.creator_status || 'none';
        user.creator_type = fresh.creator_type || null;
        user.age_verified = fresh.age_verified;
        user.ageVerified = fresh.age_verified;
        user.terms_accepted = fresh.terms_accepted;
        user.acceptedTerms = fresh.terms_accepted;
        user.date_of_birth = fresh.date_of_birth || null;
        user.contentDisclaimer = fresh.content_disclaimer || false;
        const isValidPhoto = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));
        if (isValidPhoto(fresh.photo_file_id)) {
          user.photoUrl = fresh.photo_file_id;
        }
      }
    } catch (dbErr) {
      logger.warn('checkAuthStatus: DB refresh failed, using session values', dbErr.message);
    }

    // Build auth_methods from session data (hybrid session: Telegram + ATProto may coexist)
    const authMethods = user.auth_methods || {
      telegram: !!(user.telegramId || user.telegram),
      atproto: !!user.atproto_did,
    };

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        pnptv_id: user.pnptvId || null,
        telegram_id: user.telegramId || user.telegram || user.id,
        username: user.username || '',
        first_name: user.firstName || user.first_name || user.username || '',
        display_name: user.displayName || user.firstName || user.first_name || user.username || '',
        language: user.language || 'en',
        terms_accepted: Boolean(user.acceptedTerms || user.terms_accepted),
        age_verified: Boolean(user.ageVerified || user.age_verified),
        onboarding_complete: Boolean(user.onboardingComplete),
        subscription_type: user.subscriptionStatus || user.subscription_status || 'free',
        tier: user.tier || 'free',
        role: user.role || 'user',
        photo_url: user.photoUrl || null,
        // ATProto / Bluesky identity
        atproto_did: user.atproto_did || null,
        atproto_handle: user.atproto_handle || null,
        // Creator status
        creator_status: user.creator_status || 'none',
        creator_type: user.creator_type || null,
        contentDisclaimer: user.contentDisclaimer || false,
        // Profile fields
        date_of_birth: user.date_of_birth || null,
        // Auth methods flags (used by Profile.tsx IdentityConnections)
        auth_methods: authMethods,
        // Login method tracking
        last_login_method: user.last_login_method || null,
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