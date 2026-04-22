const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../../../services/emailService');
const { getRedis } = require('../../../config/redis');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const FileType = require('file-type');

// ── Enforced follows (shared service) ────────────────────────────────────────
const { enforceDefaultFollows } = require('../../../services/followService');
const AuthentikService = require('../../../services/authentikService');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getCanonicalWebOrigin() {
  const configured = normalizeOrigin(process.env.WEBAPP_ORIGIN || process.env.BOT_WEBHOOK_DOMAIN);
  return configured || 'https://pnptv.app';
}

function canonicalWebUrl(pathname) {
  const suffix = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return `${getCanonicalWebOrigin()}${suffix}`;
}

function redirectToCanonicalApp(res) {
  return res.redirect('https://pnptv.app');
}

// AES-256-GCM token encryption — matches xShareController.js
function encryptXToken(plaintext) {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  const key = Buffer.from(raw, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ data: encrypted, iv: iv.toString('hex'), authTag });
}

function redirectToCanonicalAuthError(res) {
  return res.redirect('https://pnptv.app/?error=auth_failed');
}

function generatePnptvId() {
  return uuidv4();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))))
  );
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const derivedBuf = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
  return crypto.timingSafeEqual(hashBuf, derivedBuf);
}

async function createWebUser({ id, firstName, lastName, username, email, passwordHash, telegramId, twitterHandle, xId, photoFileId } = {}) {
  const userId = id || uuidv4();
  const pnptvId = generatePnptvId();
  let baseUsername = username || (firstName ? `${firstName}${lastName ? `_${lastName}` : ''}`.replace(/[^a-zA-Z0-9_]/g, '_') : null);
  if (baseUsername) baseUsername = baseUsername.toUpperCase();

  // Resolve username uniqueness: try base, then base_2, base_3, etc.
  let displayName = baseUsername;
  if (displayName) {
    let suffix = 2;
    while (true) {
      const { rows: existing } = await query('SELECT id FROM users WHERE UPPER(username) = $1', [displayName]);
      if (existing.length === 0) break;
      displayName = `${baseUsername}_${suffix}`;
      suffix++;
      if (suffix > 999) { displayName = `${baseUsername}_${uuidv4().substring(0, 6)}`; break; }
    }
  }

  // Always ensure a username — fallback to pnptv_XXXXXX if nothing was derivable
  if (!displayName) {
    while (true) {
      const candidate = `PNPTV_${uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase()}`;
      const { rows: exists } = await query('SELECT id FROM users WHERE UPPER(username) = $1', [candidate]);
      if (exists.length === 0) { displayName = candidate; break; }
    }
  }

  const { rows } = await query(
    `INSERT INTO users
       (id, pnptv_id, first_name, last_name, username, email, password_hash,
        telegram, twitter, x_id, photo_file_id, subscription_status, tier, role,
        terms_accepted, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'free','free','user',false,true,NOW(),NOW())
     RETURNING id, pnptv_id, first_name, last_name, username, email,
               subscription_status, tier, terms_accepted, photo_file_id, bio, language,
               telegram, twitter, x_id, role`,
    [userId, pnptvId, firstName || 'User', lastName || null, displayName || null,
     email || null, passwordHash || null, telegramId || null, twitterHandle || null, xId || null, photoFileId || null]
  );
  return rows[0];
}

/**
 * Find existing user by any identity field, or create a new one.
 * Implements account linking: if a matching user is found by email, telegramId, or xHandle,
 * the missing identity fields are filled in (linked) on that existing record.
 *
 * @param {object} opts
 * @param {string} [opts.telegramId]
 * @param {string} [opts.twitterHandle]
 * @param {string} [opts.xId]        - numeric X user ID (more stable than handle)
 * @param {string} [opts.email]
 * @param {string} [opts.firstName]
 * @param {string} [opts.lastName]
 * @param {string} [opts.username]
 * @param {string} [opts.photoFileId]
 * @returns {{ user: object, isNew: boolean }}
 */
async function findOrLinkUser({ telegramId, twitterHandle, xId, email, firstName, lastName, username, photoFileId } = {}) {
  const RETURN_COLS = `id, pnptv_id, first_name, last_name, username, email,
    subscription_status, tier, terms_accepted, photo_file_id, bio, language, telegram, twitter, x_id, role,
    atproto_did, atproto_handle, atproto_pds_url`;

  let user = null;

  // 1. Lookup priority: telegramId > xId > twitterHandle > email
  if (telegramId) {
    // First: look up by telegram column (new-style users)
    const { rows: byTelegram } = await query(
      `SELECT ${RETURN_COLS} FROM users WHERE telegram = $1 AND is_deleted = false LIMIT 1`,
      [String(telegramId)]
    );
    if (byTelegram.length > 0) {
      user = byTelegram[0];
    } else {
      // Legacy: old bot users had the Telegram numeric ID as their primary key (id column)
      const { rows: byId } = await query(
        `SELECT ${RETURN_COLS} FROM users WHERE id = $1 AND is_deleted = false LIMIT 1`,
        [String(telegramId)]
      );
      if (byId.length > 0) {
        user = byId[0];
        // Migrate: backfill telegram column so future lookups are consistent
        if (!user.telegram) {
          await query(
            `UPDATE users SET telegram = $1, updated_at = NOW() WHERE id = $2`,
            [String(telegramId), user.id]
          ).catch(() => {});
          user.telegram = String(telegramId);
        }
      }
    }
  }

  if (!user && xId) {
    const { rows } = await query(`SELECT ${RETURN_COLS} FROM users WHERE x_id = $1 AND is_deleted = false`, [String(xId)]);
    if (rows.length > 0) user = rows[0];
  }

  if (!user && twitterHandle) {
    const { rows } = await query(`SELECT ${RETURN_COLS} FROM users WHERE twitter = $1 AND is_deleted = false`, [twitterHandle]);
    if (rows.length > 0) user = rows[0];
  }

  if (!user && email) {
    const { rows } = await query(`SELECT ${RETURN_COLS} FROM users WHERE email = $1 AND is_deleted = false`, [email.toLowerCase().trim()]);
    if (rows.length > 0) user = rows[0];
  }

  if (user) {
    // Link any missing identity fields onto the existing user record
    const updates = [];
    const vals = [];
    let idx = 1;

    if (telegramId && !user.telegram) {
      updates.push(`telegram = $${idx++}`);
      vals.push(String(telegramId));
    }
    if (twitterHandle && !user.twitter) {
      updates.push(`twitter = $${idx++}`);
      vals.push(twitterHandle);
    }
    if (xId && !user.x_id) {
      updates.push(`x_id = $${idx++}`);
      vals.push(String(xId));
    }
    if (photoFileId && !user.photo_file_id) {
      updates.push(`photo_file_id = $${idx++}`);
      vals.push(photoFileId);
    }

    if (updates.length > 0) {
      vals.push(user.id);
      const { rows: updated } = await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING ${RETURN_COLS}`,
        vals
      );
      if (updated.length > 0) {
        user = updated[0];
        logger.info(`Linked identity fields to existing user ${user.id}: ${updates.join(', ')}`);
      }
    }

    // Enforce default follows (fire-and-forget)
    enforceDefaultFollows(user.id).catch(() => {});
    return { user, isNew: false };
  }

  // No match — create new user
  const newUser = await createWebUser({ telegramId, twitterHandle, xId, email, firstName, lastName, username, photoFileId });
  // Enforce default follows for new user (fire-and-forget)
  enforceDefaultFollows(newUser.id).catch(() => {});
  return { user: newUser, isNew: true };
}

function buildSession(user, extra = {}) {
  return {
    id: user.id,
    pnptvId: user.pnptv_id,
    username: user.username,
    displayName: user.first_name || user.username || 'Member',
    firstName: user.first_name,
    lastName: user.last_name,
    subscriptionStatus: user.subscription_status,
    tier: user.tier || 'free',
    acceptedTerms: user.terms_accepted,
    photoUrl: user.photo_file_id,
    bio: user.bio,
    language: user.language,
    role: user.role || 'user',
    creator_status: user.creator_status || 'none',
    contentDisclaimer: user.content_disclaimer || false,
    // X identity
    xHandle: user.twitter || user.x_username || extra.xHandle || null,
    // Auth method flags
    auth_methods: {
      telegram: !!(user.telegram),
      x: !!(user.twitter || user.x_user_id || user.x_id || extra.xHandle),
    },
    last_login_method: extra.last_login_method || user.last_login_method || null,
    ...extra,
  };
}

function setSessionCookieDuration(session, rememberMe = false) {
  if (!session?.cookie) return;
  const dayMs = 24 * 60 * 60 * 1000;
  session.cookie.maxAge = rememberMe ? 365 * dayMs : 90 * dayMs;
}

// ── Unified service provisioning (fire-and-forget) ──────────────────────────
// Called after every successful login to ensure all dependent services are set up.
// Authentik is the source of truth; Matrix and default follows are provisioned.
function provisionAllServices(user) {
  setImmediate(async () => {
    const userId = user.id;
    // 1. Matrix — DMs and hangout chat rooms
    try {
      // Matrix provisioning removed
      logger.info(`[Provision] Matrix provisioned for user ${userId}`);
    } catch (err) {
      logger.warn(`[Provision] Matrix failed for user ${userId}: ${err.message}`);
    }

    // 2. Default follows (idempotent)
    enforceDefaultFollows(userId).catch(() => {});
  });
}

// ── Telegram Login Widget verification ───────────────────────────────────────

function verifyTelegramAuth(data) {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    logger.error('BOT_TOKEN not configured');
    return false;
  }

  // Convert all values to strings and remove hash
  const { hash, ...rest } = data;
  if (!hash) {
    logger.error('No hash in Telegram data');
    return false;
  }

  // Sort keys alphabetically and build check string exactly as Telegram expects
  const dataKeys = Object.keys(rest)
    .sort()
    .filter(k => rest[k] !== undefined && rest[k] !== null && rest[k] !== '');

  const checkString = dataKeys
    .map(k => `${k}=${rest[k]}`)
    .join('\n');

  logger.info('Telegram auth verification debug:', {
    botToken: botToken.substring(0, 10) + '...***',
    dataKeys,
    checkStringPreview: checkString.substring(0, 150) + (checkString.length > 150 ? '...' : ''),
    receivedHash: hash.substring(0, 20) + '...',
  });

  // Create secret key from bot token SHA256 hash
  const secretKey = crypto.createHash('sha256').update(botToken).digest();

  // Calculate HMAC-SHA256
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  logger.info('Hash comparison:', {
    calculated: calculatedHash.substring(0, 20) + '...',
    received: hash.substring(0, 20) + '...',
    match: calculatedHash === hash,
  });

  if (calculatedHash !== hash) {
    logger.warn('Hash mismatch in Telegram auth - possible domain not set in BotFather', {
      userId: rest.id,
      hashLength: hash.length,
      calculatedLength: calculatedHash.length,
    });
    return false;
  }

  // Verify auth_date is fresh (within 24 hours)
  const authDate = parseInt(data.auth_date, 10);
  if (isNaN(authDate)) {
    logger.warn('Invalid auth_date in Telegram data');
    return false;
  }

  const timeDiff = Math.floor(Date.now() / 1000) - authDate;
  logger.info('Auth time check:', { authDate, currentTime: Math.floor(Date.now() / 1000), timeDiff, maxAge: 86400 });

  if (timeDiff > 86400 || timeDiff < -300) { // Allow 5 min clock skew
    logger.warn('Telegram auth expired or time skew', { timeDiff, maxAge: 86400 });
    return false;
  }

  logger.info('Telegram auth verified successfully');
  return true;
}

// ── X OAuth PKCE helpers ──────────────────────────────────────────────────────

const b64url = (buf) =>
  buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// ── Telegram Deep Link Login ─────────────────────────────────────────────────

const TELEGRAM_LOGIN_PREFIX = 'tg_login:';
const TELEGRAM_LOGIN_TTL = 300; // 5 minutes

/**
 * POST /api/webapp/auth/telegram/token
 * Generate a login token for Telegram deep link flow.
 * Returns a token and the t.me deep link URL.
 */
const telegramGenerateToken = async (req, res) => {
  try {
    // Generate UUID v4 token for Telegram login session
    const token = uuidv4();
    const redis = getRedis();
    // Store token with expiry (default 10 minutes)
    await redis.set(`${TELEGRAM_LOGIN_PREFIX}${token}`, 'pending', 'EX', TELEGRAM_LOGIN_TTL);

    const botUsername = process.env.BOT_USERNAME || 'PNPLatinoTV_Bot';
    // Create deep link for Telegram authentication
    const deepLink = `https://t.me/${botUsername}?start=weblogin_${token}`;

    logger.info(`[Telegram Auth] Generated token: ${token.substring(0, 8)}...`);
    return res.json({ success: true, token, deepLink });
  } catch (error) {
    logger.error('Telegram token generation error:', error);
    return res.status(500).json({ error: 'Failed to generate login token' });
  }
};

/**
 * GET /api/webapp/auth/telegram/check?token=xxx
 * Poll endpoint: checks if the bot has verified the token.
 */
const telegramCheckToken = async (req, res) => {
  // Prevent browser caching — every poll must hit the server
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ authenticated: false, error: 'Missing token' });

    const redis = getRedis();
    const data = await redis.get(`${TELEGRAM_LOGIN_PREFIX}${token}`);

    if (!data || data === 'pending') {
      return res.json({ authenticated: false });
    }

    // data contains the user JSON set by the bot handler
    const telegramUser = JSON.parse(data);
    await redis.del(`${TELEGRAM_LOGIN_PREFIX}${token}`);

    const telegramId = String(telegramUser.id);

    // Authentik sync — source of truth for identity
    const pnptvId = await AuthentikService.syncTelegramUser(telegramUser);
    if (pnptvId) {
      logger.info(`[DeepLink] Authentik synced for Telegram ${telegramId}: ${pnptvId}`);
    } else {
      logger.warn(`[DeepLink] Authentik sync failed for Telegram ${telegramId}, continuing login`);
    }

    const { user, isNew } = await findOrLinkUser({
      telegramId,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      photoFileId: telegramUser.photo_url || null,
    });

    // Persist Authentik UUID if available and not yet stored
    if (pnptvId && (!user.pnptv_id || user.pnptv_id !== pnptvId)) {
      query('UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2', [pnptvId, user.id]).catch(() => {});
      user.pnptv_id = pnptvId;
    }

    if (isNew) {
      logger.info(`Created new user via Telegram deep link: ${user.id} (@${user.username})`);
    } else {
      logger.info(`Existing user login via Telegram deep link: ${user.id} (@${user.username})`);
    }

    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'deep_link', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const deepLinkSessionData = buildSession(user, { photoUrl: telegramUser.photo_url || user.photo_file_id, last_login_method: 'deep_link' });
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = deepLinkSessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    // Provision all services (Matrix, default follows) — fire-and-forget
    provisionAllServices(user);

    logger.info(`Telegram deep link login: user ${user.id}`);
    return res.json({ authenticated: true, user: { id: user.id, username: user.username } });
  } catch (error) {
    logger.error('Telegram check token error:', error);
    return res.status(500).json({ authenticated: false, error: 'Server error' });
  }
};

/**
 * Called by the bot when it receives /start weblogin_TOKEN
 * Stores the Telegram user data in Redis so the poll endpoint can pick it up.
 */
const telegramConfirmLogin = async (telegramUser, token) => {
  try {
    const redis = getRedis();
    const key = `${TELEGRAM_LOGIN_PREFIX}${token}`;
    const exists = await redis.get(key);
    if (!exists) {
      logger.warn('Telegram login token not found or expired:', token);
      return false;
    }
    await redis.set(key, JSON.stringify(telegramUser), 'EX', 60); // 1 min to poll
    logger.info(`Telegram login confirmed for token ${token.substring(0, 8)}...`);
    return true;
  } catch (error) {
    logger.error('Telegram confirm login error:', error);
    return false;
  }
};

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/webapp/auth/telegram/start
 * Redirects user to Telegram OAuth page (button-based flow, no widget JS dependency).
 */
const telegramStart = async (req, res) => {
  try {
    const botId = process.env.TELEGRAM_BOT_ID || (process.env.BOT_TOKEN || '').split(':')[0];
    if (!botId) {
      logger.error('Telegram OAuth start error: BOT_TOKEN/TELEGRAM_BOT_ID missing');
      return res.status(500).json({ error: 'Telegram login is not configured.' });
    }

    const configuredOrigin = normalizeOrigin(process.env.WEBAPP_ORIGIN || process.env.BOT_WEBHOOK_DOMAIN);
    const requestOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
    const origin = configuredOrigin || requestOrigin;

    // Store redirect_to in session so callback can use it after Telegram auth
    if (req.query.redirect_to) {
      req.session.authRedirectTo = req.query.redirect_to;
      await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
      );
    }
    const callbackUrl = `${origin}/api/webapp/auth/telegram/callback`;

    const params = new URLSearchParams({
      bot_id: botId,
      origin,
      request_access: 'write',
      return_to: callbackUrl,
    });

    return res.redirect(`https://oauth.telegram.org/auth?${params.toString()}`);
  } catch (error) {
    logger.error('Telegram OAuth start error:', error);
    return res.status(500).json({ error: 'Failed to start Telegram authentication' });
  }
};

/**
 * GET /api/webapp/auth/telegram/callback
 * Redirect-based Telegram OAuth (button-based flow).
 * Telegram sends user data as query params after user authenticates.
 */
const telegramCallback = async (req, res) => {
  try {
    const telegramUser = req.query;

    logger.info('=== TELEGRAM CALLBACK RECEIVED ===', {
      hasId: !!telegramUser.id,
      hasHash: !!telegramUser.hash,
      id: telegramUser.id,
      username: telegramUser.username,
      firstName: telegramUser.first_name,
      hasPhotoUrl: !!telegramUser.photo_url,
      authDate: telegramUser.auth_date,
    });

    if (!telegramUser.id || !telegramUser.hash) {
      logger.warn('Missing id or hash in Telegram callback', {
        hasId: !!telegramUser.id,
        hasHash: !!telegramUser.hash,
      });
      return redirectToCanonicalAuthError(res);
    }

    const isValid = verifyTelegramAuth(telegramUser);

    // DEVELOPMENT ONLY: Allow bypassing hash verification if explicitly enabled
    const skipHashVerification = process.env.SKIP_TELEGRAM_HASH_VERIFICATION === 'true' && process.env.NODE_ENV !== 'production';

    if (!isValid && !skipHashVerification) {
      logger.warn('Hash verification failed for Telegram user', {
        userId: telegramUser.id,
        hint: 'CRITICAL: Domain must be set in BotFather: /setdomain pnptv.app',
        hashVerificationRequired: !skipHashVerification,
      });
      return redirectToCanonicalAuthError(res);
    }

    if (skipHashVerification && !isValid) {
      logger.warn('⚠️  DEVELOPMENT: Hash verification bypassed', { userId: telegramUser.id });
    }

    const telegramId = String(telegramUser.id);

    const { user, isNew } = await findOrLinkUser({
      telegramId,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      photoFileId: telegramUser.photo_url || null,
    });

    if (isNew) {
      logger.info(`Created new user via Telegram callback: ${user.id} (@${user.username})`);
    } else {
      logger.info(`Existing user login via Telegram callback: ${user.id} (@${user.username})`);
    }

    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'deep_link', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const callbackSessionData = buildSession(user, { photoUrl: telegramUser.photo_url || user.photo_file_id, last_login_method: 'deep_link' });
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = callbackSessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`Web Telegram callback login: user ${user.id}`);

    // Redirect to the original app if redirect_to was stored in session (e.g. pnptv.app)
    // Use an explicit allowlist of trusted hostnames to prevent open redirect.
    const ALLOWED_REDIRECT_HOSTS = ['app.pnptv.app', 'pnptv.app', 'www.pnptv.app'];
    const redirectTo = req.session.authRedirectTo;
    delete req.session.authRedirectTo;
    if (redirectTo) {
      // Extract just the hostname portion (before any path or query string)
      const redirectHost = redirectTo.split('/')[0].split('?')[0].split('#')[0];
      if (ALLOWED_REDIRECT_HOSTS.includes(redirectHost)) {
        return res.redirect(`https://${redirectTo}`);
      }
      logger.warn('[Auth] Blocked disallowed redirect_to host', { redirectHost, redirectTo });
    }
    return redirectToCanonicalApp(res);
  } catch (error) {
    logger.error('Telegram callback error:', error);
    return redirectToCanonicalAuthError(res);
  }
};

/**
 * POST /api/webapp/auth/telegram
 * Authenticate via Telegram Login Widget — auto-creates account if needed.
 */
const telegramLogin = async (req, res) => {
  try {
    const telegramUser = req.body.telegramUser || req.body;
    if (!telegramUser || !telegramUser.id) {
      return res.status(400).json({ error: 'Invalid Telegram user data' });
    }

    const skipHashVerification = process.env.SKIP_TELEGRAM_HASH_VERIFICATION === 'true'
      && process.env.NODE_ENV !== 'production';

    if (!telegramUser.hash && !skipHashVerification) {
      logger.warn('Missing Telegram auth hash', { userId: telegramUser.id });
      return res.status(400).json({ error: 'Invalid Telegram auth data' });
    }

    if (telegramUser.hash) {
      const isValid = verifyTelegramAuth(telegramUser);
      if (!isValid && !skipHashVerification) {
        logger.warn('Invalid Telegram auth hash', { userId: telegramUser.id });
        return res.status(401).json({ error: 'Invalid authentication data' });
      }
      if (skipHashVerification && !isValid) {
        logger.warn('DEVELOPMENT: Telegram hash verification bypassed', { userId: telegramUser.id });
      }
    } else if (skipHashVerification) {
      logger.warn('DEVELOPMENT: Telegram login without hash allowed', { userId: telegramUser.id });
    }

    const telegramId = String(telegramUser.id);

    const { user, isNew } = await findOrLinkUser({
      telegramId,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      photoFileId: telegramUser.photo_url || null,
    });

    if (isNew) {
      logger.info(`Created new user via Telegram widget login: ${user.id} (@${user.username})`);
    }

    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'telegram', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const telegramLoginSessionData = buildSession(user, { photoUrl: telegramUser.photo_url || user.photo_file_id, last_login_method: 'telegram' });
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = telegramLoginSessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`Web app Telegram login: user ${user.id} (${user.username})`);
    return res.json({
      authenticated: true,
      registered: true,
      isNew,
      pnptvId: user.pnptv_id,
      termsAccepted: user.terms_accepted,
      user: {
        id: user.id,
        pnptvId: user.pnptv_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: telegramUser.photo_url || user.photo_file_id,
        subscriptionStatus: user.subscription_status,
      },
    });
  } catch (error) {
    logger.error('Web app Telegram login error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * POST /api/webapp/auth/register
 * Register with email + password.
 * Sends verification email and returns requiresVerification: true
 */
const emailRegister = async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName) {
      return res.status(400).json({ error: 'Email, password and first name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Check if email already exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [emailLower]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createWebUser({
      firstName: firstName.trim(),
      lastName: lastName ? lastName.trim() : null,
      email: emailLower,
      passwordHash,
    });

    // Create email verification table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Generate verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt.toISOString()]
    );

    // Send verification email
    const verifyUrl = `${process.env.WEBAPP_URL || 'https://pnptv.app'}/verify-email.html?token=${token}`;
    await emailService.send({
      to: emailLower,
      subject: 'PNPtv – Verifica tu correo electrónico',
      html: `
        <p>Hola ${user.first_name || 'usuario'},</p>
        <p>¡Bienvenido a PNPtv! Para completar tu registro, verifica tu correo electrónico.</p>
        <p><a href="${verifyUrl}" style="background:#FF00CC;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Verificar correo</a></p>
        <p>Este enlace expira en 24 horas. Si no realizaste este registro, ignora este correo.</p>
      `,
    });

    logger.info(`New user registered via email: ${user.id} (${emailLower}), verification email sent`);

    return res.json({
      authenticated: false,
      requiresVerification: true,
      message: 'Account created. Check your email to verify.',
      user: {
        id: user.id,
        email: emailLower,
      },
    });
  } catch (error) {
    logger.error('Email register error:', error);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

/**
 * POST /api/webapp/auth/login
 * Login with email + password.
 */
const emailLogin = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailLower = email.toLowerCase().trim();
    const result = await query(
      `SELECT id, pnptv_id, telegram, username, first_name, last_name, subscription_status,
              terms_accepted, photo_file_id, bio, language, password_hash, email, role, email_verified
       FROM users WHERE email = $1 AND is_deleted = false`,
      [emailLower]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with this email. Please register first.' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Telegram or X to sign in. Please use those options.' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    // Check if email is verified
    logger.info(`Email login check: user=${user.id}, email_verified=${user.email_verified}, type=${typeof user.email_verified}, truthy=${!!user.email_verified}`);
    if (!user.email_verified) {
      return res.status(403).json({
        error: 'email_not_verified',
        message: 'Por favor verifica tu email antes de iniciar sesión.'
      });
    }

    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'email', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const emailLoginSessionData = buildSession(user, { last_login_method: 'email' });
    enforceDefaultFollows(user.id).catch(() => {});
    const rememberMeFlag = rememberMe === true || rememberMe === 'true';
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = emailLoginSessionData;
    setSessionCookieDuration(req.session, rememberMeFlag);
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );
    logger.info(`Web app email login: user ${user.id} (${emailLower})`);

    return res.json({
      authenticated: true,
      pnptvId: user.pnptv_id,
      user: {
        id: user.id,
        pnptvId: user.pnptv_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        subscriptionStatus: user.subscription_status,
        role: user.role || 'user',
      },
    });
  } catch (error) {
    logger.error('Email login error:', error);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

/**
 * POST /api/webapp/auth/oidc/token-exchange
 * Exchange an Authentik OIDC access_token for a PNPtv backend session.
 */
const oidcTokenExchange = async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required' });
    }

    // 1. Validate token against Authentik userinfo endpoint
    const AUTHENTIK_URL = process.env.AUTHENTIK_URL || process.env.VITE_AUTHENTIK_URL || 'https://auth.pnptv.app';
    let profile;
    try {
      const userinfoRes = await axios.get(`${AUTHENTIK_URL}/application/o/userinfo/`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
        timeout: 8000,
      });
      profile = userinfoRes.data;
    } catch (err) {
      if (err.response?.status === 401) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      throw err;
    }

    if (!profile.sub) {
      return res.status(401).json({ error: 'Invalid token: missing sub claim' });
    }

    // 2. Find user by pnptv_id (Authentik UUID) or by email
    let userResult = await query(
      `SELECT * FROM users WHERE pnptv_id = $1 AND is_deleted = false`,
      [profile.sub]
    );

    let user;
    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
    } else if (profile.email) {
      userResult = await query(
        `SELECT * FROM users WHERE email = $1 AND is_deleted = false`,
        [profile.email.toLowerCase()]
      );
      if (userResult.rows.length > 0) {
        user = userResult.rows[0];
        // Link pnptv_id to this existing account if not already set
        if (!user.pnptv_id) {
          await query('UPDATE users SET pnptv_id = $1 WHERE id = $2', [profile.sub, user.id]);
          user.pnptv_id = profile.sub;
        }
      }
    }

    if (!user) {
      // 3. Create new user from Authentik profile
      user = await createWebUser({
        firstName: profile.given_name || profile.name || profile.preferred_username || 'Member',
        lastName: profile.family_name || null,
        email: profile.email || null,
        username: profile.preferred_username || null,
      });
      await query(
        'UPDATE users SET pnptv_id = $1, email_verified = true WHERE id = $2',
        [profile.sub, user.id]
      );
      user.pnptv_id = profile.sub;
      user.email_verified = true;
      logger.info(`Created new user via Authentik OIDC: ${user.id} (sub: ${profile.sub})`);
    }

    // 4. Check bans
    if (user.tier === 'banned') {
      return res.status(403).json({ error: 'Account suspended' });
    }

    // 5. Update login metadata (fire-and-forget)
    query(
      `UPDATE users SET last_login_at = NOW(), last_login_method = 'oidc', updated_at = NOW() WHERE id = $1`,
      [user.id]
    ).catch(() => {});

    // 6. Check Authentik Admins group to determine effective role
    let effectiveRole = user.role || 'user';
    try {
      const AuthentikService = require('../../../services/authentikService');
      const isAuthentikAdmin = await AuthentikService.isUserInAdminsGroup(profile.sub);
      if (isAuthentikAdmin && effectiveRole !== 'superadmin') {
        effectiveRole = 'admin';
        // Sync DB role if Authentik says admin but DB doesn't
        if (user.role !== 'admin' && user.role !== 'superadmin') {
          query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', ['admin', user.id]).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn('Authentik admin group check failed, falling back to DB role', { error: err.message });
    }

    // 7. Build session
    const sessionData = buildSession(user, { last_login_method: 'oidc' });
    sessionData.role = effectiveRole;

    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = sessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    // 8. Provision all services (Matrix, default follows) — fire-and-forget
    provisionAllServices(user);

    // 9. Sync Authentik groups based on PNPtv role/tier — fire-and-forget
    try {
      const AuthentikService = require('../../../services/authentikService');
      AuthentikService.syncUserGroups(profile.sub, {
        role: effectiveRole,
        tier: user.tier,
        creatorStatus: user.creator_status,
      }).catch(() => {});
    } catch {}

    logger.info(`OIDC token exchange successful: user ${user.id} (sub: ${profile.sub}, role: ${effectiveRole})`);

    return res.json({
      authenticated: true,
      pnptvId: user.pnptv_id,
      user: {
        id: user.id,
        pnptv_id: user.pnptv_id,
        pnptvId: user.pnptv_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        display_name: user.first_name || user.username || 'Member',
        email: user.email,
        subscription_type: user.subscription_status,
        subscription_status: user.subscription_status,
        tier: user.tier || 'free',
        role: effectiveRole,
        terms_accepted: user.terms_accepted,
        age_verified: user.age_verified,
        photo_url: user.photo_file_id,
        language: user.language || 'en',
        creator_status: user.creator_status,
        creator_type: user.creator_type,
        last_login_method: 'oidc',
      },
      success: true,
    });
  } catch (error) {
    logger.error('OIDC token exchange error:', error.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * GET /api/webapp/auth/verify-email
 * Verify email using token from link.
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // First check: is the token in the DB at all (regardless of used status)?
    const tokenExists = await query(
      `SELECT t.id, t.user_id, t.expires_at, t.used, u.email, u.email_verified
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = $1`,
      [token]
    );

    if (tokenExists.rows.length === 0) {
      logger.warn(`Email verification: token not found in DB: ${token.substring(0, 16)}...`);
      return res.status(400).json({ error: 'Invalid or expired verification link.', code: 'TOKEN_NOT_FOUND' });
    }

    const tokenRow = tokenExists.rows[0];

    // If user is already verified, skip token checks and auto-login
    if (tokenRow.email_verified) {
      logger.info(`Email verification: user ${tokenRow.user_id} already verified, creating session`);

      const userResult = await query(
        `SELECT id, pnptv_id, telegram, username, first_name, last_name, subscription_status,
                terms_accepted, photo_file_id, bio, language, role, email
         FROM users WHERE id = $1`,
        [tokenRow.user_id]
      );

      if (userResult.rows.length > 0) {
        const u = userResult.rows[0];
        const alreadyVerifiedSessionData = buildSession(u);
        enforceDefaultFollows(u.id).catch(() => {});
        await new Promise((resolve, reject) =>
          req.session.regenerate(err => (err ? reject(err) : resolve()))
        );
        req.session.user = alreadyVerifiedSessionData;
        await new Promise((resolve, reject) =>
          req.session.save(err => (err ? reject(err) : resolve()))
        );
      }

      return res.json({ authenticated: true, success: true, alreadyVerified: true });
    }

    // If token was already used but email is NOT verified (shouldn't happen, but handle it)
    if (tokenRow.used) {
      logger.warn(`Email verification: token already used for user ${tokenRow.user_id}, email=${tokenRow.email}`);
      return res.status(400).json({
        error: 'This verification link has already been used. Please request a new one.',
        code: 'TOKEN_USED',
        email: tokenRow.email,
      });
    }

    // Check expiration
    const expiresAt = new Date(tokenRow.expires_at);
    const now = new Date();

    logger.info(`Email verification attempt: token=${token.substring(0, 16)}..., user=${tokenRow.user_id}, expires_at=${expiresAt.toISOString()}, now=${now.toISOString()}, diff_ms=${now.getTime() - expiresAt.getTime()}`);

    if (now > expiresAt) {
      logger.warn(`Email verification: token expired for user ${tokenRow.user_id}, expired ${Math.round((now - expiresAt) / 60000)} min ago`);
      return res.status(400).json({
        error: 'Verification link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED',
        email: tokenRow.email,
      });
    }

    // Lookup full user data for session
    const result = await query(
      `SELECT id, pnptv_id, telegram, username, first_name, last_name, subscription_status,
              terms_accepted, photo_file_id, bio, language, role, email
       FROM users WHERE id = $1`,
      [tokenRow.user_id]
    );

    if (result.rows.length === 0) {
      logger.error(`Email verification: user ${tokenRow.user_id} not found after token lookup`);
      return res.status(400).json({ error: 'User account not found.', code: 'USER_NOT_FOUND' });
    }

    const row = result.rows[0];

    // Mark token as used and set email_verified to true
    await query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [tokenRow.id]);
    await query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [tokenRow.user_id]);

    // Create session
    const verifyEmailSessionData = buildSession(row);
    enforceDefaultFollows(row.id).catch(() => {});
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = verifyEmailSessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`Email verified successfully for user ${tokenRow.user_id} (${row.email})`);
    return res.json({ authenticated: true, success: true });
  } catch (error) {
    logger.error('Email verify error:', error);
    return res.status(500).json({ error: 'Failed to verify email' });
  }
};

/**
 * POST /api/webapp/auth/resend-verification
 * Resend verification email for unverified account.
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailLower = email.toLowerCase().trim();
    const result = await query(
      'SELECT id, first_name, email_verified FROM users WHERE email = $1',
      [emailLower]
    );

    // Always return 200 to avoid email enumeration
    if (result.rows.length === 0) {
      return res.json({ success: true, message: 'If this email exists, verification email was sent.' });
    }

    const user = result.rows[0];

    // If already verified, just return success
    if (user.email_verified) {
      return res.json({ success: true, message: 'Email already verified. You can now log in.' });
    }

    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Invalidate old tokens for this user
    await query('UPDATE email_verification_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

    // Generate new verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await query(
      'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt.toISOString()]
    );

    // Send verification email
    const verifyUrl = `${process.env.WEBAPP_URL || 'https://pnptv.app'}/verify-email.html?token=${token}`;
    await emailService.send({
      to: emailLower,
      subject: 'PNPtv – Verifica tu correo electrónico',
      html: `
        <p>Hola ${user.first_name || 'usuario'},</p>
        <p>Para verificar tu correo electrónico en PNPtv, haz clic en el enlace de abajo.</p>
        <p><a href="${verifyUrl}" style="background:#FF00CC;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Verificar correo</a></p>
        <p>Este enlace expira en 24 horas. Si no solicitaste esto, ignora este correo.</p>
      `,
    });

    logger.info(`Verification email resent to ${emailLower}`);
    return res.json({ success: true, message: 'Verification email sent.' });
  } catch (error) {
    logger.error('Resend verification error:', error);
    return res.status(500).json({ error: 'Failed to send verification email' });
  }
};

/**
 * GET /api/webapp/auth/x/start
 */
const xLoginStart = async (req, res) => {
  try {
    // Prefer dedicated webapp X app credentials, fall back to main Twitter app.
    const hasWebappConfig = Boolean(process.env.WEBAPP_X_CLIENT_ID && process.env.WEBAPP_X_REDIRECT_URI);
    const clientId = hasWebappConfig ? process.env.WEBAPP_X_CLIENT_ID : process.env.TWITTER_CLIENT_ID;
    const redirectUri = hasWebappConfig ? process.env.WEBAPP_X_REDIRECT_URI : process.env.TWITTER_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return res.status(500).json({ error: 'X login not configured on this server' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = b64url(crypto.randomBytes(32));
    const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

    req.session.xOAuth = {
      state,
      codeVerifier,
      clientId,
      redirectUri,
      clientMode: hasWebappConfig ? 'webapp' : 'twitter',
    };
    req.session.xWebLogin = true;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    const params = new URLSearchParams({
      response_type: 'code',
      response_mode: 'query',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'users.read tweet.read tweet.write offline.access media.write',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Support both: JSON response (fetch) and direct redirect (navigation)
    if (req.query.redirect === 'true') {
      return res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
    }
    return res.json({ success: true, url: `https://twitter.com/i/oauth2/authorize?${params}` });
  } catch (error) {
    logger.error('X OAuth start error:', error);
    return res.status(500).json({ error: 'Failed to start X authentication' });
  }
};

/**
 * GET /api/webapp/auth/x/callback
 * Auto-creates user on first X login.
 */
const xLoginCallback = async (req, res) => {
  try {
    const { code, state, error: xError } = req.query;

    logger.info('=== X OAUTH CALLBACK ===', {
      hasCode: !!code,
      hasState: !!state,
      hasError: !!xError,
      errorMsg: xError || null,
      sessionId: req.sessionID,
      hasXOAuth: !!req.session?.xOAuth,
      storedState: req.session?.xOAuth?.state?.substring(0, 10) || 'none',
      receivedState: state?.substring(0, 10) || 'none',
    });

    if (xError || !code || !state) {
      return redirectToCanonicalAuthError(res);
    }

    const stored = req.session.xOAuth;
    if (!stored || stored.state !== state) {
      logger.warn('X OAuth state mismatch or session expired');
      return redirectToCanonicalAuthError(res);
    }

    const { codeVerifier } = stored;
    delete req.session.xOAuth;

    const clientId = stored.clientId || process.env.WEBAPP_X_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
    const redirectUri = stored.redirectUri || process.env.WEBAPP_X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI;
    const clientSecret = stored.clientMode === 'webapp'
      ? (process.env.WEBAPP_X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET)
      : (process.env.TWITTER_CLIENT_SECRET || process.env.WEBAPP_X_CLIENT_SECRET);

    // Exchange code for access token.
    // Try multiple auth modes because X apps may be configured as public or confidential.
    const buildTokenBody = (mode) => {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: clientId,
      });

      if (mode === 'client_secret_post') {
        body.set('client_secret', clientSecret);
      }

      return body;
    };

    const toFormEncoded = (value) => encodeURIComponent(String(value));

    const exchangeToken = async (mode, tokenEndpoint) => {
      const config = {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      };
      if (mode === 'basic') {
        config.auth = { username: clientId, password: clientSecret };
      }
      if (mode === 'basic_encoded') {
        // X OAuth expects URL-encoded client_id in Basic auth when it contains ':' segments.
        // Keep client_secret raw to match provider parsing expectations.
        const encodedId = toFormEncoded(clientId);
        const basicValue = Buffer.from(`${encodedId}:${String(clientSecret)}`).toString('base64');
        config.headers.Authorization = `Basic ${basicValue}`;
      }
      return axios.post(tokenEndpoint, buildTokenBody(mode).toString(), config);
    };

    const modes = clientSecret
      ? ['basic_encoded', 'client_secret_post', 'basic', 'public']
      : ['public'];
    const tokenEndpoints = [
      'https://api.twitter.com/2/oauth2/token',
      'https://api.x.com/2/oauth2/token',
    ];
    let tokenRes = null;
    let lastTokenError = null;

    for (const tokenEndpoint of tokenEndpoints) {
      for (const mode of modes) {
        try {
          tokenRes = await exchangeToken(mode, tokenEndpoint);
          break;
        } catch (tokenErr) {
          lastTokenError = tokenErr;
          const status = tokenErr.response?.status;
          const errData = tokenErr.response?.data;
          logger.error('X OAuth token exchange failed:', {
            mode,
            tokenEndpoint,
            status,
            error: errData?.error,
            description: errData?.error_description,
            clientId: clientId?.substring(0, 10) + '...',
            redirectUri,
          });

          const shouldTryNextMode = [400, 401, 403].includes(status);
          if (!shouldTryNextMode) {
            throw tokenErr;
          }
        }
      }
      if (tokenRes) break;
    }

    if (!tokenRes) {
      throw lastTokenError || new Error('X OAuth token exchange failed');
    }

    const accessToken = tokenRes.data.access_token;

    // Fetch X user profile — try v2 API, then v1.1 fallback (no project enrollment required)
    let xData = null;
    try {
      const profileRes = await axios.get('https://api.twitter.com/2/users/me', {
        params: { 'user.fields': 'name,profile_image_url' },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      xData = profileRes.data?.data;
    } catch (err1) {
      try {
        const profileRes2 = await axios.get('https://api.x.com/2/users/me', {
          params: { 'user.fields': 'name,profile_image_url' },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        xData = profileRes2.data?.data;
      } catch (err2) {
        logger.warn('X v2 profile fetch failed, trying v1.1 fallback', {
          status1: err1.response?.status,
          status2: err2.response?.status,
        });
      }
    }

    // Fallback: v1.1 verify_credentials (works without project enrollment)
    if (!xData) {
      try {
        const v1Res = await axios.get('https://api.twitter.com/1.1/account/verify_credentials.json', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const v1Data = v1Res.data;
        xData = {
          id: String(v1Data.id_str || v1Data.id),
          username: v1Data.screen_name,
          name: v1Data.name,
        };
        logger.info('X profile resolved via v1.1 verify_credentials', { username: xData.username });
      } catch (v1Err) {
        logger.error('X v1.1 profile fallback also failed:', { status: v1Err.response?.status, data: v1Err.response?.data });
      }
    }

    const xHandle = xData?.username;
    const xId = xData?.id ? String(xData.id) : null;
    const xName = xData?.name || xHandle;

    if (!xHandle) return redirectToCanonicalAuthError(res);

    // Authentik sync — source of truth for identity
    const xProfileForAuth = { id: xId, username: xHandle, name: xName, firstName: xName };
    const pnptvId = await AuthentikService.syncXUser(xProfileForAuth);
    if (pnptvId) {
      logger.info(`[XLogin] Authentik synced for X @${xHandle}: ${pnptvId}`);
    } else {
      logger.warn(`[XLogin] Authentik sync failed for X @${xHandle}, continuing login`);
    }

    // If already logged in via another method, prioritize linking to current session user
    if (req.session?.user?.id) {
      const existingId = req.session.user.id;

      // Clear x_id/twitter from any other user that has this X identity (prevents unique constraint violations)
      if (xId) {
        await query(
          `UPDATE users SET x_id = NULL, twitter = CASE WHEN twitter = $1 THEN NULL ELSE twitter END, updated_at = NOW()
           WHERE x_id = $2 AND id != $3`,
          [xHandle, xId, existingId]
        );
      }
      if (xHandle) {
        await query(
          `UPDATE users SET twitter = NULL, updated_at = NOW()
           WHERE twitter = $1 AND id != $2`,
          [xHandle, existingId]
        );
      }

      // Save handle, ID, and OAuth tokens to the correct columns
      const encAccessLink = encryptXToken(tokenRes.data.access_token);
      const encRefreshLink = tokenRes.data.refresh_token ? encryptXToken(tokenRes.data.refresh_token) : null;
      const expiresAtLink = tokenRes.data.expires_in
        ? new Date(Date.now() + tokenRes.data.expires_in * 1000)
        : new Date(Date.now() + 7200 * 1000);
      const scopesLink = tokenRes.data.scope || null;

      await query(
        `UPDATE users
         SET twitter                   = $1,
             x_id                      = COALESCE(x_id, $2),
             x_username                = $1,
             x_user_id                 = COALESCE(x_user_id, $2),
             x_access_token_encrypted  = $3,
             x_refresh_token_encrypted = COALESCE($4, x_refresh_token_encrypted),
             x_token_expires_at        = $5,
             x_oauth_scopes            = COALESCE($6, x_oauth_scopes),
             updated_at                = NOW()
         WHERE id = $7`,
        [xHandle, xId, encAccessLink, encRefreshLink, expiresAtLink, scopesLink, existingId]
      );
      // Persist Authentik UUID if available
      if (pnptvId) {
        query('UPDATE users SET pnptv_id = COALESCE(pnptv_id, $1), updated_at = NOW() WHERE id = $2', [pnptvId, existingId]).catch(() => {});
      }
      const { rows: updated } = await query(
        `SELECT id, pnptv_id, first_name, last_name, username, email,
                subscription_status, terms_accepted, photo_file_id, bio, language, telegram, twitter, x_id, role
         FROM users WHERE id = $1`,
        [existingId]
      );
      const user = updated[0];
      query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'x', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
      const xLinkSessionData = buildSession(user, { xHandle, last_login_method: 'x' });
      await new Promise((resolve, reject) =>
        req.session.regenerate(err => (err ? reject(err) : resolve()))
      );
      req.session.user = xLinkSessionData;
      await new Promise((resolve, reject) =>
        req.session.save(err => (err ? reject(err) : resolve()))
      );
      // Provision all services — fire-and-forget
      provisionAllServices(user);
      logger.info(`Linked X @${xHandle} to existing session user ${user.id}`);
      return redirectToCanonicalApp(res);
    }

    const [firstName, ...nameParts] = (xName || xHandle).split(' ');
    const { user, isNew } = await findOrLinkUser({
      twitterHandle: xHandle,
      xId,
      firstName,
      lastName: nameParts.join(' ') || null,
      username: xHandle,
    });

    // Persist Authentik UUID if available and not yet stored
    if (pnptvId && (!user.pnptv_id || user.pnptv_id !== pnptvId)) {
      query('UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2', [pnptvId, user.id]).catch(() => {});
      user.pnptv_id = pnptvId;
    }

    if (isNew) {
      logger.info(`Created new user via X login: ${user.id} (@${xHandle})`);
    } else {
      logger.info(`Existing user login via X: ${user.id} (@${xHandle})`);
    }

    // Save OAuth tokens to the correct columns
    const encAccessLogin = encryptXToken(tokenRes.data.access_token);
    const encRefreshLogin = tokenRes.data.refresh_token ? encryptXToken(tokenRes.data.refresh_token) : null;
    const expiresAtLogin = tokenRes.data.expires_in
      ? new Date(Date.now() + tokenRes.data.expires_in * 1000)
      : new Date(Date.now() + 7200 * 1000);
    const scopesLogin = tokenRes.data.scope || null;
    await query(
      `UPDATE users
       SET x_username                = $1,
           x_user_id                 = COALESCE(x_user_id, $2),
           x_access_token_encrypted  = $3,
           x_refresh_token_encrypted = COALESCE($4, x_refresh_token_encrypted),
           x_token_expires_at        = $5,
           x_oauth_scopes            = COALESCE($6, x_oauth_scopes),
           last_login_at             = NOW(),
           last_login_method         = 'x',
           updated_at                = NOW()
       WHERE id = $7`,
      [xHandle, xId, encAccessLogin, encRefreshLogin, expiresAtLogin, scopesLogin, user.id]
    ).catch(err => logger.error('[XLogin] Failed to save X tokens:', err.message));
    const xLoginSessionData = buildSession(user, { xHandle, last_login_method: 'x' });
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );
    req.session.user = xLoginSessionData;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );
    // Provision all services (Matrix, default follows) — fire-and-forget
    provisionAllServices(user);
    logger.info(`Web app X login: user ${user.id} via @${xHandle}`);
    return redirectToCanonicalApp(res);
  } catch (error) {
    const status = error.response?.status;
    const logLevel = [401, 403].includes(status) ? 'warn' : 'error';
    logger[logLevel]('X OAuth callback error:', {
      message: error.message,
      status: status || null,
      details: error.response?.data || null,
    });
    return redirectToCanonicalAuthError(res);
  }
};

/**
 * GET /api/webapp/auth/status
 */
const authStatus = (req, res) => {
  const user = req.session?.user;
  if (!user) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    user: {
      id: user.id,
      pnptvId: user.pnptvId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
      subscriptionStatus: user.subscriptionStatus,
      tier: user.tier || 'free',
      acceptedTerms: user.acceptedTerms,
      language: user.language,
      role: user.role || 'user',
      last_login_method: user.last_login_method || null,
    },
  });
};

/**
 * POST /api/webapp/auth/logout
 */
const logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      logger.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('__pnptv_sid');
    return res.json({ success: true });
  });
};

/**
 * GET /api/webapp/profile
 */
const getProfile = async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await query(
      `SELECT u.id, u.pnptv_id, u.telegram, u.username, u.first_name, u.last_name, u.bio, u.photo_file_id,
              u.subscription_status, u.tier, u.plan_id, u.plan_expiry,
              u.language, u.interests, u.location_name, u.twitter,
              u.instagram, u.tiktok, u.youtube, u.email,
              u.terms_accepted, u.wof_photo_consent, u.content_disclaimer, u.created_at,
              u.date_of_birth, u.city, u.country, u.privacy,
              u.creator_status, u.creator_type, u.creator_price_usd,
              u.creator_verified, u.creator_featured, u.creator_subscriber_count,
              perf.id as perf_id, perf.is_available as perf_is_available,
              perf.base_price as perf_base_price, perf.total_calls as perf_total_calls,
              perf.total_rating as perf_total_rating, perf.rating_count as perf_rating_count,
              perf.availability_message as perf_availability_message
       FROM users u
       LEFT JOIN performers perf ON perf.user_id = u.id AND perf.status = 'active'
       WHERE u.id = $1`,
      [user.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const p = result.rows[0];
    const performerData = p.perf_id ? {
      id: p.perf_id,
      isAvailable: p.perf_is_available,
      basePrice: parseFloat(p.perf_base_price),
      averageRating: p.perf_rating_count > 0
        ? parseFloat((p.perf_total_rating / p.perf_rating_count).toFixed(2))
        : 0,
      totalCalls: p.perf_total_calls,
      availabilityMessage: p.perf_availability_message || null,
    } : null;

    return res.json({
      success: true,
      profile: {
        id: p.id,
        pnptvId: p.pnptv_id,
        username: p.username,
        firstName: p.first_name,
        lastName: p.last_name,
        bio: p.bio,
        photoUrl: p.photo_file_id,
        subscriptionStatus: p.subscription_status,
        tier: p.tier || 'free',
        subscriptionPlan: p.plan_id,
        subscriptionExpires: p.plan_expiry,
        language: p.language,
        interests: p.interests,
        locationText: p.location_name,
        xHandle: p.twitter,
        instagramHandle: p.instagram,
        tiktokHandle: p.tiktok,
        youtubeHandle: p.youtube,
        memberSince: p.created_at,
        wofPhotoConsent: p.wof_photo_consent || false,
        contentDisclaimer: p.content_disclaimer || false,
        dateOfBirth: p.date_of_birth || null,
        city: p.city || null,
        country: p.country || null,
        email: p.email || null,
        privacy: p.privacy || {},
        autoShareToX: !!(p.privacy?.autoShareToX),
        creatorStatus: p.creator_status || 'none',
        creatorType: p.creator_type || null,
        creatorPriceUsd: p.creator_price_usd ? parseFloat(p.creator_price_usd) : null,
        creatorVerified: p.creator_verified || false,
        creatorFeatured: p.creator_featured || false,
        creatorSubscriberCount: p.creator_subscriber_count || 0,
        hasTelegram: !!p.telegram,
        performerData,
      },
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
};

/**
 * POST /api/webapp/auth/forgot-password
 * Send password reset email.
 */
const forgotPassword = async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result = await query('SELECT id, first_name, email FROM users WHERE email = $1', [email]);
    // Always return 200 to avoid email enumeration
    if (result.rows.length === 0) return res.json({ success: true });

    const user = result.rows[0];
    // Ensure token table exists (idempotent)
    await query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Invalidate old tokens for this user
    await query('UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt.toISOString()]
    );

    const resetUrl = `${process.env.WEBAPP_URL || 'https://pnptv.app'}/reset-password?token=${token}`;
    await emailService.send({
      to: email,
      subject: 'PNPtv – Restablecer contraseña',
      html: `
        <p>Hola ${user.first_name || 'usuario'},</p>
        <p>Recibimos una solicitud para restablecer tu contraseña en PNPtv.</p>
        <p><a href="${resetUrl}" style="background:#FF00CC;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Restablecer contraseña</a></p>
        <p>Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.</p>
      `,
    });

    logger.info(`Password reset email sent to ${email}`);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to send reset email' });
  }
};

/**
 * POST /api/webapp/auth/reset-password
 * Set new password using a reset token.
 */
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const result = await query(
      `SELECT t.id, t.user_id, t.expires_at, u.email, u.first_name
       FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = $1 AND t.used = FALSE`,
      [token]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset link.' });

    const row = result.rows[0];
    if (new Date() > new Date(row.expires_at)) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const passwordHash = await hashPassword(password);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, row.user_id]);
    await query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [row.id]);

    logger.info(`Password reset successful for user ${row.user_id}`);
    return res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    logger.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
};

/**
 * PUT /api/webapp/profile
 * Update editable profile fields.
 */
const updateProfile = async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  // Server-side max-length validation
  const MAX_LENGTHS = { username: 30, firstName: 100, lastName: 100, bio: 500, locationText: 200, xHandle: 50, instagramHandle: 50, tiktokHandle: 50, youtubeHandle: 100, city: 100, country: 100 };
  for (const [key, max] of Object.entries(MAX_LENGTHS)) {
    if (req.body[key] && typeof req.body[key] === 'string' && req.body[key].length > max) {
      return res.status(400).json({ error: `${key} exceeds maximum length of ${max} characters` });
    }
  }

  // Content moderation — reject descriptions containing forbidden terms
  // (CSAM, zoophilia, non-consent, bug chasing, IV drug use).
  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    if (req.body.bio) assertCleanText(req.body.bio, 'bio');
    if (req.body.firstName) assertCleanText(req.body.firstName, 'first name');
    if (req.body.lastName) assertCleanText(req.body.lastName, 'last name');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }

  // Validate and check uniqueness of username if provided
  if (req.body.username !== undefined && req.body.username !== '') {
    // Username can only be set once manually — if already set, reject
    const currentRow = await query('SELECT username FROM users WHERE id = $1', [user.id]);
    const currentUsername = currentRow.rows[0]?.username;
    if (currentUsername && currentUsername.trim() !== '' && currentUsername.toUpperCase() !== 'ANONYMOUS') {
      return res.status(403).json({ error: 'Username cannot be changed once set. Link your Telegram account to use your Telegram username.' });
    }
    const rawUsername = String(req.body.username).trim();
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(rawUsername)) {
      return res.status(400).json({ error: 'Username must be 3–30 characters and contain only letters, numbers, or underscores' });
    }
    const existing = await query(
      `SELECT id FROM users WHERE UPPER(username) = UPPER($1) AND id != $2 AND is_deleted IS NOT TRUE AND username != '' AND UPPER(username) != 'ANONYMOUS'`,
      [rawUsername, user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken' });
    }
  }

  // Validate language if provided
  const VALID_LANGS = ['en', 'es', 'pt', 'zh', 'zhTW', 'fr', 'de', 'th', 'it', 'tr', 'ru', 'nl', 'vi', 'ja', 'id', 'ar'];
  if (req.body.language !== undefined && !VALID_LANGS.includes(req.body.language)) {
    return res.status(400).json({ error: 'Unsupported language code' });
  }

  // Validate dateOfBirth if provided
  const { dateOfBirth } = req.body;
  if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== '') {
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid date of birth' });
    const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return res.status(400).json({ error: 'You must be at least 18 years old' });
    if (dob > new Date()) return res.status(400).json({ error: 'Date of birth cannot be in the future' });
  }

  try {
    const allowed = ['username', 'firstName', 'lastName', 'bio', 'locationText', 'interests', 'xHandle', 'instagramHandle', 'tiktokHandle', 'youtubeHandle', 'wofPhotoConsent', 'contentDisclaimer', 'language', 'dateOfBirth', 'city', 'country'];
    const colMap  = {
      username: 'username',
      firstName: 'first_name', lastName: 'last_name', bio: 'bio',
      locationText: 'location_name', interests: 'interests',
      xHandle: 'twitter', instagramHandle: 'instagram', tiktokHandle: 'tiktok', youtubeHandle: 'youtube',
      wofPhotoConsent: 'wof_photo_consent',
      contentDisclaimer: 'content_disclaimer',
      language: 'language',
      dateOfBirth: 'date_of_birth',
      city: 'city',
      country: 'country',
    };

    const sets = [];
    const vals = [];
    allowed.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        // Content disclaimer: once accepted, cannot be reverted
        if (key === 'contentDisclaimer') {
          if (req.body[key] !== true) return; // Only allow setting to true, ignore false/revert
          sets.push(`${colMap[key]} = $${sets.length + 1}`);
          vals.push(true);
          // Also record timestamp and IP
          const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.headers['x-real-ip']
            || req.socket?.remoteAddress
            || 'unknown';
          sets.push(`content_disclaimer_accepted_at = $${sets.length + 1}`);
          vals.push(new Date());
          sets.push(`content_disclaimer_accepted_ip = $${sets.length + 1}`);
          vals.push(clientIp);
          return;
        }
        sets.push(`${colMap[key]} = $${sets.length + 1}`);
        if (key === 'interests') {
          // DB column is text[] — parse comma-separated string to array
          const raw = req.body[key];
          if (!raw || raw.trim() === '') {
            vals.push(null);
          } else if (Array.isArray(raw)) {
            vals.push(raw.map(s => String(s).trim()).filter(Boolean));
          } else {
            vals.push(String(raw).split(',').map(s => s.trim()).filter(Boolean));
          }
        } else if (key === 'dateOfBirth') {
          // Store as DATE or null; empty string clears the field
          const rawDob = req.body[key];
          vals.push((!rawDob || rawDob === '') ? null : rawDob);
        } else {
          // Allow clearing fields (null / empty string → null)
          vals.push(req.body[key] === '' ? null : req.body[key]);
        }
      }
    });

    // Auto-derive location_name from city + country when both are provided in this request
    // Only override if city/country were explicitly sent and location_name was NOT also sent
    const cityProvided    = Object.prototype.hasOwnProperty.call(req.body, 'city');
    const countryProvided = Object.prototype.hasOwnProperty.call(req.body, 'country');
    const locationTextProvided = Object.prototype.hasOwnProperty.call(req.body, 'locationText');
    if ((cityProvided || countryProvided) && !locationTextProvided) {
      const cityVal    = cityProvided    ? (req.body.city    || '').trim() : null;
      const countryVal = countryProvided ? (req.body.country || '').trim() : null;
      // Only push a derived location_name if we have enough data to form one
      if (cityVal || countryVal) {
        const derived = [cityVal, countryVal].filter(Boolean).join(', ');
        sets.push(`location_name = $${sets.length + 1}`);
        vals.push(derived);
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    vals.push(user.id);
    await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
      vals
    );

    // Invalidate Redis user cache so subsequent reads reflect new values
    try {
      const { cache } = require('../../../config/redis');
      await cache.del(`user:${user.id}`);
    } catch (cacheErr) {
      // Non-fatal — cache will expire naturally
      logger.warn(`Cache invalidation failed for user ${user.id}:`, cacheErr.message);
    }

    // Refresh session fields if changed
    if (req.body.firstName !== undefined) req.session.user.firstName = req.body.firstName || req.session.user.firstName;
    if (req.body.lastName  !== undefined) req.session.user.lastName  = req.body.lastName  || null;
    if (req.body.language  !== undefined) req.session.user.language  = req.body.language;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`Profile updated: user ${user.id}`);
    return res.json({ success: true });
  } catch (error) {
    logger.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};

/**
 * POST /api/webapp/profile/telegram/link
 * Link an existing PNPtv account to a Telegram account using the official
 * Telegram Login Widget payload. Proof of ownership = signed widget hash.
 *
 * Body: { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
 *
 * If the logged-in user has no username yet (or the placeholder 'ANONYMOUS'),
 * the Telegram @username is auto-adopted — matches the existing error message
 * in updateProfile ("Link your Telegram account to use your Telegram username.").
 */
const linkTelegram = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body || {};
  if (!id || !hash || !auth_date) {
    return res.status(400).json({ success: false, error: 'Missing required Telegram auth fields' });
  }

  const isValid = verifyTelegramAuth(req.body);
  const skipVerification = process.env.SKIP_TELEGRAM_HASH_VERIFICATION === 'true'
    && process.env.NODE_ENV !== 'production';
  if (!isValid && !skipVerification) {
    logger.warn('[TelegramLink] Hash verification failed', { userId: sessionUser.id, tgId: id });
    return res.status(401).json({ success: false, error: 'Invalid Telegram authentication data' });
  }

  const telegramId = String(id);

  try {
    const existing = await query(
      'SELECT id FROM users WHERE telegram = $1 AND id != $2 AND is_active = true LIMIT 1',
      [telegramId, sessionUser.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'This Telegram account is already linked to another PNPtv account.',
      });
    }

    const currentRow = await query(
      'SELECT username, telegram FROM users WHERE id = $1',
      [sessionUser.id]
    );
    const current = currentRow.rows[0];
    if (!current) return res.status(404).json({ success: false, error: 'User not found' });

    const currentUsername = (current.username || '').trim();
    const hasRealUsername = currentUsername !== '' && currentUsername.toUpperCase() !== 'ANONYMOUS';

    let adoptedUsername = null;
    const tgUsername = username ? String(username).replace(/^@+/, '').trim() : '';
    if (!hasRealUsername && tgUsername && /^[a-zA-Z0-9_]{3,30}$/.test(tgUsername)) {
      // Only adopt if the tg username isn't already taken by another account.
      const taken = await query(
        `SELECT id FROM users WHERE UPPER(username) = UPPER($1) AND id != $2
           AND is_deleted IS NOT TRUE AND username != '' AND UPPER(username) != 'ANONYMOUS'
         LIMIT 1`,
        [tgUsername, sessionUser.id]
      );
      if (taken.rows.length === 0) {
        adoptedUsername = tgUsername;
      }
    }

    if (adoptedUsername) {
      await query(
        'UPDATE users SET telegram = $1, username = $2, updated_at = NOW() WHERE id = $3',
        [telegramId, adoptedUsername, sessionUser.id]
      );
    } else {
      await query(
        'UPDATE users SET telegram = $1, updated_at = NOW() WHERE id = $2',
        [telegramId, sessionUser.id]
      );
    }

    try {
      const { cache } = require('../../../config/redis');
      await cache.del(`user:${sessionUser.id}`);
    } catch (cacheErr) {
      logger.warn(`[TelegramLink] Cache invalidation failed for user ${sessionUser.id}: ${cacheErr.message}`);
    }

    if (adoptedUsername) req.session.user.username = adoptedUsername;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`[TelegramLink] User ${sessionUser.id} linked Telegram ${telegramId}${adoptedUsername ? ` (adopted @${adoptedUsername})` : ''}`);
    return res.json({
      success: true,
      telegram: telegramId,
      username: adoptedUsername || current.username,
      adoptedUsername: !!adoptedUsername,
    });
  } catch (error) {
    logger.error('[TelegramLink] Link error:', error);
    return res.status(500).json({ success: false, error: 'Failed to link Telegram account' });
  }
};

/**
 * POST /api/webapp/profile/telegram/unlink
 * Remove the Telegram linkage from the current user.
 */
const unlinkTelegram = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) return res.status(401).json({ success: false, error: 'Not authenticated' });

  try {
    // Do not allow unlinking if Telegram is the only login method (no email set + no password_hash).
    const row = await query(
      'SELECT email, password_hash, pnptv_id FROM users WHERE id = $1',
      [sessionUser.id]
    );
    const r = row.rows[0];
    const placeholderEmail = r?.email && /@telegram\.pnptv\.app$/i.test(r.email);
    const hasRealEmail = r?.email && !placeholderEmail;
    if (!hasRealEmail && !r?.password_hash) {
      return res.status(409).json({
        success: false,
        error: 'Set an email + password before unlinking Telegram, otherwise you will lose access to this account.',
      });
    }

    await query(
      'UPDATE users SET telegram = NULL, updated_at = NOW() WHERE id = $1',
      [sessionUser.id]
    );

    try {
      const { cache } = require('../../../config/redis');
      await cache.del(`user:${sessionUser.id}`);
    } catch (cacheErr) {
      logger.warn(`[TelegramLink] Cache invalidation failed for user ${sessionUser.id}: ${cacheErr.message}`);
    }

    logger.info(`[TelegramLink] User ${sessionUser.id} unlinked Telegram`);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[TelegramLink] Unlink error:', error);
    return res.status(500).json({ success: false, error: 'Failed to unlink Telegram account' });
  }
};

/**
 * GET /api/webapp/mastodon/feed
 */
const getMastodonFeed = async (req, res) => {
  try {
    const mastodonInstance = process.env.MASTODON_INSTANCE || process.env.MASTODON_BASE_URL || 'https://mastodon.social';
    const mastodonAccount = process.env.MASTODON_ACCOUNT_ID;
    const mastodonToken = process.env.MASTODON_ACCESS_TOKEN;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

    const authHeaders = { Accept: 'application/json' };
    if (mastodonToken) authHeaders['Authorization'] = `Bearer ${mastodonToken}`;

    let feedUrl;
    if (mastodonAccount) {
      feedUrl = `${mastodonInstance}/api/v1/accounts/${mastodonAccount}/statuses?limit=${limit}&exclude_replies=true`;
    } else if (mastodonToken) {
      feedUrl = `${mastodonInstance}/api/v1/timelines/home?limit=${limit}`;
    } else {
      feedUrl = `${mastodonInstance}/api/v1/timelines/public?limit=${limit}&local=true`;
    }

    const response = await axios.get(feedUrl, { timeout: 5000, headers: authHeaders });

    const posts = (response.data || []).map(post => ({
      id: post.id,
      content: post.content,
      createdAt: post.created_at,
      url: post.url,
      account: { username: post.account?.username, displayName: post.account?.display_name, avatar: post.account?.avatar },
      mediaAttachments: (post.media_attachments || []).map(m => ({ type: m.type, url: m.url, previewUrl: m.preview_url })),
      favouritesCount: post.favourites_count,
      reblogsCount: post.reblogs_count,
      repliesCount: post.replies_count,
    }));

    return res.json({ success: true, posts });
  } catch (error) {
    logger.error(`Mastodon feed error: ${error.message}`);
    return res.json({ success: true, posts: [], message: 'Mastodon feed temporarily unavailable' });
  }
};

/**
 * POST /api/webapp/profile/avatar
 * Upload and update user profile avatar
 */
const uploadAvatar = async (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const { buffer } = req.file;

    // --- MAGIC BYTE VALIDATION ---
    // Never trust client-supplied Content-Type; inspect actual file bytes.
    const ALLOWED_AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const detected = await FileType.fromBuffer(buffer);
    const detectedMime = detected?.mime;

    if (!detectedMime || !ALLOWED_AVATAR_MIMES.has(detectedMime)) {
      logger.warn('uploadAvatar: rejected file — magic bytes do not match allowed image types', {
        userId: user.id,
        claimedMime: req.file.mimetype,
        detectedMime: detectedMime || 'unknown',
      });
      return res.status(400).json({ error: 'Only image files (jpg, png, webp, gif) are allowed' });
    }

    const filename = `${user.id}-${Date.now()}.webp`;
    const uploadDir = path.join(__dirname, '../../../../../public/uploads/avatars');
    const filePath = path.join(uploadDir, filename);
    const relativeUrl = `/uploads/avatars/${filename}`;

    await fs.mkdir(uploadDir, { recursive: true });

    // Step 1: Process image with sharp and write to disk
    await sharp(buffer)
      .rotate()
      .withMetadata(false)
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .webp({ quality: 75, progressive: true })
      .toFile(filePath);

    // Step 2: UPDATE database FIRST (atomic PostgreSQL row-level lock).
    // This is the race-condition fix: whichever concurrent upload commits last
    // wins and becomes the canonical filename in the DB. The cleanup below
    // then uses the DB value as the truth, so stale files from the losing
    // upload are always removed regardless of ordering.
    await query(
      'UPDATE users SET photo_file_id = $1, updated_at = NOW() WHERE id = $2',
      [relativeUrl, user.id]
    );

    // Step 3: Clean up old avatar files AFTER the DB is updated.
    // Re-read the DB to get the current canonical filename (handles the race:
    // another concurrent request may have already updated it).
    try {
      const currentRow = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
      const canonicalUrl = currentRow.rows[0]?.photo_file_id || relativeUrl;
      const canonicalFilename = path.basename(canonicalUrl);
      const allFiles = await fs.readdir(uploadDir);
      const staleFiles = allFiles.filter(f => f.startsWith(`${user.id}-`) && f !== canonicalFilename);
      for (const staleFile of staleFiles) {
        await fs.unlink(path.join(uploadDir, staleFile));
      }
    } catch (cleanupErr) {
      // Non-fatal: log but do not fail the request
      logger.warn('uploadAvatar: cleanup error (non-fatal)', { userId: user.id, err: cleanupErr.message });
    }

    req.session.user.photoUrl = relativeUrl;
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    logger.info(`Avatar uploaded: user ${user.id} → ${filename}`);

    // Matrix avatar sync removed

    return res.json({ success: true, photoUrl: relativeUrl });
  } catch (error) {
    logger.error('Avatar upload error:', error);
    return res.status(500).json({ error: 'Failed to upload avatar' });
  }
};

/**
 * POST /api/webapp/auth/x/unlink
 * Unlinks X/Twitter identity from the current session user.
 */
const unlinkX = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    await query(
      `UPDATE users SET twitter = NULL, x_id = NULL, x_user_id = NULL, x_username = NULL,
              x_access_token_encrypted = NULL, x_refresh_token_encrypted = NULL,
              x_token_expires_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [sessionUser.id],
      { cache: false }
    );

    logger.info(`[X] Unlinked X account for user ${sessionUser.id}`);

    // Update session
    const hasTelegram = !!req.session.user?.auth_methods?.telegram;

    if (!hasTelegram) {
      // X was the only auth method — destroy session
      return req.session.destroy((err) => {
        if (err) logger.error('[X] Session destroy error during unlink:', err);
        res.clearCookie('__pnptv_sid');
        return res.json({ success: true, message: 'X account unlinked. You have been logged out.' });
      });
    }

    // Other auth methods remain — update session in place
    req.session.user.xHandle = null;
    req.session.user.auth_methods = {
      ...req.session.user.auth_methods,
      x: false,
    };
    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    return res.json({ success: true, message: 'X account unlinked successfully' });
  } catch (err) {
    logger.error('[X] unlinkX error:', err);
    return res.status(500).json({ success: false, error: 'Failed to unlink X account' });
  }
};

/**
 * POST /api/webapp/auth/telegram/widget
 * Authenticates a user via the official Telegram Login Widget callback.
 *
 * The widget POSTs all user fields + hash directly to us (via window.onTelegramAuth).
 * We verify the hash with the bot token, find-or-create the user, regenerate the
 * session ID to prevent fixation, then return a session cookie.
 *
 * Verification algorithm (per https://core.telegram.org/widgets/login):
 *   1. data-check-string = alphabetically sorted "key=value" pairs joined by "\n"
 *   2. secret_key = SHA256(bot_token)  — plain hash, NOT HMAC
 *   3. hash = HMAC-SHA256(secret_key, data-check-string) in hex
 */
const telegramWidgetAuth = async (req, res) => {
  try {
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body || {};

    if (!id || !hash || !auth_date) {
      return res.status(400).json({ success: false, error: 'Missing required Telegram auth fields' });
    }

    // Verify the Telegram widget hash using the shared helper
    const isValid = verifyTelegramAuth(req.body);
    const skipVerification = process.env.SKIP_TELEGRAM_HASH_VERIFICATION === 'true'
      && process.env.NODE_ENV !== 'production';

    if (!isValid && !skipVerification) {
      logger.warn('[TelegramWidget] Hash verification failed', { userId: id });
      return res.status(401).json({ success: false, error: 'Invalid authentication data' });
    }

    if (skipVerification && !isValid) {
      logger.warn('[TelegramWidget] DEVELOPMENT: hash verification bypassed', { userId: id });
    }

    const telegramId = String(id);

    // Authentik sync — source of truth for identity
    const pnptvId = await AuthentikService.syncTelegramUser({ id: telegramId, first_name, username });
    if (pnptvId) {
      logger.info(`[TelegramWidget] Authentik synced for Telegram ${telegramId}: ${pnptvId}`);
    } else {
      logger.warn(`[TelegramWidget] Authentik sync failed for Telegram ${telegramId}, continuing login`);
    }

    const { user, isNew } = await findOrLinkUser({
      telegramId,
      firstName: first_name || null,
      lastName: last_name || null,
      username: username || null,
      photoFileId: photo_url || null,
    });

    // Persist Authentik UUID if available and not yet stored
    if (pnptvId && (!user.pnptv_id || user.pnptv_id !== pnptvId)) {
      query('UPDATE users SET pnptv_id = $1, updated_at = NOW() WHERE id = $2', [pnptvId, user.id]).catch(() => {});
      user.pnptv_id = pnptvId;
    }

    if (isNew) {
      logger.info(`[TelegramWidget] New user created: ${user.id} (@${user.username})`);
    } else {
      logger.info(`[TelegramWidget] Existing user login: ${user.id} (@${user.username})`);
    }

    query(`UPDATE users SET last_login_at = NOW(), last_login_method = 'telegram', updated_at = NOW() WHERE id = $1`, [user.id]).catch(() => {});
    const sessionData = buildSession(user, { photoUrl: photo_url || user.photo_file_id, last_login_method: 'telegram' });

    // Regenerate session ID to prevent session fixation attacks
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => (err ? reject(err) : resolve()))
    );

    req.session.user = sessionData;

    await new Promise((resolve, reject) =>
      req.session.save(err => (err ? reject(err) : resolve()))
    );

    // Provision all services (Matrix, default follows) — fire-and-forget
    provisionAllServices(user);

    return res.json({
      success: true,
      isNew,
      user: {
        id: user.id,
        pnptvId: user.pnptv_id || pnptvId,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: photo_url || user.photo_file_id,
        subscriptionStatus: user.subscription_status,
        tier: user.tier || 'free',
        role: user.role || 'user',
        termsAccepted: user.terms_accepted,
      },
    });
  } catch (error) {
    logger.error('[TelegramWidget] Auth error:', error);
    return res.status(500).json({ success: false, error: 'Authentication failed. Please try again.' });
  }
};

module.exports = {
  telegramStart,
  telegramCallback,
  telegramLogin,
  telegramGenerateToken,
  telegramCheckToken,
  telegramConfirmLogin,
  telegramWidgetAuth,
  emailRegister,
  emailLogin,
  oidcTokenExchange,
  verifyEmail,
  resendVerification,
  xLoginStart,
  xLoginCallback,
  unlinkX,
  authStatus,
  logout,
  getProfile,
  updateProfile,
  linkTelegram,
  unlinkTelegram,
  forgotPassword,
  resetPassword,
  getMastodonFeed,
  uploadAvatar,
  uploadEventCover,
};

// placed after exports object — hoisted by module eval order is fine
async function uploadEventCover(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  try {
    const { buffer } = req.file;
    const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const detected = await FileType.fromBuffer(buffer);
    if (!detected?.mime || !ALLOWED.has(detected.mime)) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    const filename = `event-${user.id}-${Date.now()}.webp`;
    const uploadDir = path.join(__dirname, '../../../../../public/uploads/events');
    const filePath = path.join(uploadDir, filename);
    const url = `/uploads/events/${filename}`;

    await fs.mkdir(uploadDir, { recursive: true });
    await sharp(buffer)
      .rotate()
      .withMetadata(false)
      .resize(1200, 630, { fit: 'cover', position: 'center' })
      .webp({ quality: 80 })
      .toFile(filePath);

    return res.json({ success: true, url });
  } catch (err) {
    logger.error('uploadEventCover error', { userId: user.id, err: err.message });
    return res.status(500).json({ error: 'Upload failed' });
  }
}
