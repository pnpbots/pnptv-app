const logger = require('../utils/logger');
const UserModel = require('../models/userModel');
const { query } = require('../config/postgres');
const { Pool } = require('pg');
const AuthentikService = require('./authentikService');

/**
 * Helper to check if user is admin/superadmin from env vars
 * @param {string|number} userId - User ID
 * @returns {boolean}
 */
function isEnvAdminOrSuperAdmin(userId) {
  const superAdminId = process.env.ADMIN_ID?.trim();
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(id => id);
  const userIdStr = String(userId);
  return (superAdminId && userIdStr === superAdminId) || adminIds.includes(userIdStr);
}

/**
 * User Service - Handles user-related operations
 */
class UserService {
  /**
   * Get or create user
   * @param {string|number} userId - Telegram user ID
   * @param {Object.<string, *>} userData - Initial user data if creating
   * @returns {Promise<Object>} User object
   */
  async getOrCreateUser(userId, userData) {
    try {
      let user = await UserModel.getById(userId);
      // Webapp-first users have UUID `id` and store the bare Telegram id in
      // a separate `telegram` column. Fall back to that lookup before
      // creating, otherwise INSERT collides with idx_users_telegram_unique
      // and the bot's session/userExists middleware crashes on every DM.
      if (!user && /^[0-9]+$/.test(String(userId))) {
        user = await UserModel.getByTelegram(userId);
      }
      if (!user) {
        logger.info('User not found, creating new user', { userId });
        user = await UserModel.createOrUpdate({
          id: userId,
          ...userData,
          onboardingComplete: false,
        });
        // Grant 3-day PRIME trial (fire-and-forget, never blocks bot session)
        const EntitlementAccessService = require('./entitlementAccessService');
        EntitlementAccessService.grantTrialPrime(user.id).catch(() => {});
      }
      return user;
    } catch (error) {
      logger.error('Error in getOrCreateUser:', error);
      throw error;
    }
  }

  /**
   * Telegraf-context-aware wrapper around getOrCreateUser. Used by bot
   * middleware and every handler that needs the current user record without
   * having to extract id/username/first_name/last_name/language_code by hand.
   *
   * @param {import('telegraf').Context} ctx
   * @returns {Promise<Object>} User row
   */
  async getOrCreateFromContext(ctx) {
    const from = ctx?.from;
    if (!from?.id) {
      throw new Error('getOrCreateFromContext: ctx.from.id missing');
    }
    return this.getOrCreateUser(from.id, {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      language: from.language_code,
    });
  }

  /**
   * Alias retained for handlers that name the method after the model layer
   * (UserService.getById is semantically identical to .getUser).
   */
  async getById(userId) {
    return this.getUser(userId);
  }

  /**
   * Alias for handlers that expect an "updateProfile" semantic. Same shape as
   * updateUser — accepts a partial user-fields object, delegates to UserModel.
   */
  async updateProfile(userId, updates) {
    return this.updateUser(userId, updates);
  }

  /**
   * Update the user's last-known location. Used by the bot's profile.js
   * "share location" handler. Stores both raw lat/lng and a derived geohash
   * the nearby search uses for cheap proximity buckets.
   */
  async updateLocation(userId, { lat, lng } = {}) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { success: false, error: 'lat and lng required' };
    }
    try {
      await UserModel.updateProfile(userId, {
        location_lat: lat,
        location_lng: lng,
      });
      await UserModel.invalidateCache?.(userId);
      return { success: true };
    } catch (error) {
      logger.error('Error updating location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find users near `userId` within `radiusKm`. Resolves the requesting
   * user's saved location first, then delegates to UserModel.getNearby.
   * Returns [] if the user has no location saved.
   */
  async getNearbyUsers(userId, radiusKm = 10) {
    try {
      const user = await UserModel.getById(userId);
      if (!user || user.locationLat == null || user.locationLng == null) return [];
      return await UserModel.getNearby(
        { lat: Number(user.locationLat), lng: Number(user.locationLng) },
        radiusKm
      );
    } catch (error) {
      logger.error('Error fetching nearby users:', error);
      return [];
    }
  }

  /**
   * Persist a place favorite for the user. Backed by user_place_favorites
   * (composite PK on user_id, place_id) — the ON CONFLICT makes the call
   * idempotent so the bot's repeated callback taps don't error.
   */
  async saveFavoritePlace(userId, placeId) {
    if (!userId || !placeId) return { success: false, error: 'userId and placeId required' };
    try {
      await query(
        `INSERT INTO user_place_favorites (user_id, place_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, place_id) DO NOTHING`,
        [String(userId), Number(placeId)]
      );
      return { success: true };
    } catch (error) {
      logger.error('Error saving favorite place:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * True when the user has any active paid plan (basic 'pnp-member', PRIME,
   * or any lifetime). Admins/super-admins always count as subscribed.
   */
  async hasActiveSubscription(userId) {
    try {
      if (isEnvAdminOrSuperAdmin(userId)) return true;
      const user = await UserModel.getById(userId);
      if (!user) return false;
      // Lifetime plans don't have an expiry in the past
      const planId = String(user.planId || '').toLowerCase();
      if (planId.includes('lifetime')) return true;
      // Otherwise: active subscription_status with a future expiry
      if (user.subscriptionStatus === 'active') {
        if (!user.planExpiry) return true;
        return new Date(user.planExpiry) > new Date();
      }
      return false;
    } catch (error) {
      logger.error('Error checking active subscription:', error);
      return false;
    }
  }

  /**
   * Aggregate user-base statistics for admin dashboards.
   */
  async getStatistics() {
    try {
      return await UserModel.getStatistics();
    } catch (error) {
      logger.error('Error fetching user statistics:', error);
      return null;
    }
  }

  /** Alias retained for the analytics handler that uses the older name. */
  async getUserStats() {
    return this.getStatistics();
  }

  /**
   * Lookup the streamer record for a given live-channel reference. Used by
   * the token-wallet stream-heartbeat flow to credit the right creator.
   */
  async findUserByChannelRef(channelRef) {
    if (!channelRef) return null;
    try {
      const result = await query(
        `SELECT * FROM users WHERE live_channel = $1 LIMIT 1`,
        [String(channelRef)]
      );
      if (result.rows.length === 0) return null;
      return UserModel.mapRowToUser(result.rows[0]);
    } catch (error) {
      logger.error('Error finding user by channel ref:', error);
      return null;
    }
  }

  /**
   * Bulk fetch for admin tools. UserModel.getAll already paginates with a
   * sane default cap so we don't accidentally pull 50k rows into memory.
   */
  async getAllUsers(limit = 50, startAfter = null) {
    try {
      return await UserModel.getAll(limit, startAfter);
    } catch (error) {
      logger.error('Error fetching all users:', error);
      return [];
    }
  }

  /**
   * Case-insensitive username search. Strips a leading @ if present so the
   * admin handler can pass the user's raw input ("@bob" or "bob") unchanged.
   */
  async searchUserByUsername(username) {
    if (!username) return null;
    const normalized = String(username).replace(/^@+/, '').trim();
    if (!normalized) return null;
    try {
      const result = await query(
        `SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
        [normalized]
      );
      if (result.rows.length === 0) return null;
      return UserModel.mapRowToUser(result.rows[0]);
    } catch (error) {
      logger.error('Error searching user by username:', error);
      return null;
    }
  }

  /**
   * Admin helper: update a user's subscription. UserModel.updateSubscription
   * takes a single subscription-shape object; this wrapper accepts the bot's
   * (userId, planId, expiry) call shape for backward compatibility.
   */
  async updateSubscription(userId, planId, expiry) {
    try {
      return await UserModel.updateSubscription(userId, {
        planId,
        expiry,
        status: 'active',
      });
    } catch (error) {
      logger.error('Error updating subscription:', error);
      return false;
    }
  }

  /**
   * Get user by ID
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<Object|null>} User object or null
   */
  async getUser(userId) {
    try {
      return await UserModel.getById(userId);
    } catch (error) {
      logger.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Update user
   * @param {string|number} userId - Telegram user ID
   * @param {Object.<string, *>} updates - Fields to update
   * @returns {Promise<Object|null>} Updated user object or null
   */
  async updateUser(userId, updates) {
    try {
      await UserModel.updateProfile(userId, updates);
      // After update, fetch the latest user data to return
      const updatedUser = await UserModel.getById(userId);
      logger.info('User updated', { userId, updates });
      return updatedUser;
    } catch (error) {
      logger.error('Error updating user:', error);
      return null;
    }
  }

  /**
   * Get user by email
   * @param {string} email - Email address
   * @returns {Promise<Object|null>} User object or null
   */
  async getByEmail(email) {
    try {
      return await UserModel.getByEmail(email);
    } catch (error) {
      logger.error('Error getting user by email:', error);
      return null;
    }
  }

  /**
   * Check if user is premium
   * Admin/SuperAdmin users ALWAYS have access (bypass premium check)
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<boolean>}
   */
  async isPremium(userId) {
    try {
      // BYPASS: Admin and SuperAdmin always have premium access
      if (isEnvAdminOrSuperAdmin(userId)) {
        logger.debug('Admin/SuperAdmin bypass: premium check skipped', { userId });
        return true;
      }
      
      const user = await UserModel.getById(userId);
      return user && (user.tier || '').toLowerCase() === 'prime';
    } catch (error) {
      logger.error('Error checking premium status:', error);
      return false;
    }
  }

  /**
   * Check if user is admin
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<boolean>}
   */
  async isAdmin(userId) {
    try {
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim());
      return adminIds.includes(String(userId));
    } catch (error) {
      logger.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Get user subscription
   * @param {string|number} userId - Telegram user ID
   * @returns {Promise<Object|null>}
   */
  async getUserSubscription(userId) {
    try {
      const user = await UserModel.getById(userId); // Use getById
      if (!user) return null;

      return {
        status: user.subscriptionStatus,
        planId: user.planId,
        expiryDate: user.subscriptionExpiry,
        autoRenew: user.autoRenew,
      };
    } catch (error) {
      logger.error('Error getting user subscription:', error);
      return null;
    }
  }

  /**
   * Record user activity
   * @param {string|number} userId - Telegram user ID
   * @param {string} action - Action name
   * @param {Object} metadata - Additional data
   * @returns {Promise<boolean>}
   */
  async recordActivity(userId, action, metadata = {}) {
    try {
      logger.info('User activity recorded', {
        userId,
        action,
        metadata,
      });
      return true;
    } catch (error) {
      logger.error('Error recording activity:', error);
      return false;
    }
  }

  /**
   * Calculate a user's activity score.
   * Score = posts*3 + DMs(30d) + chat_messages(30d)
   */
  async getActivityScore(userId) {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM social_posts WHERE user_id = $1 AND is_deleted = false) * 3 +
         (SELECT COUNT(*) FROM direct_messages WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '30 days') +
         (SELECT COUNT(*) FROM chat_messages WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days') AS score`,
      [String(userId)]
    );
    return Number(rows[0]?.score || 0);
  }

  /**
   * Get the top-10% activity score threshold (among users with score > 0).
   */
  async getTop10PctThreshold() {
    const { rows } = await query(
      `WITH active_scores AS (
         SELECT
           (SELECT COUNT(*) FROM social_posts WHERE user_id = u.id::text AND is_deleted = false) * 3 +
           (SELECT COUNT(*) FROM direct_messages WHERE sender_id = u.id::text AND created_at > NOW() - INTERVAL '30 days') +
           (SELECT COUNT(*) FROM chat_messages WHERE user_id = u.id::text AND created_at > NOW() - INTERVAL '30 days') AS score
         FROM users u
         WHERE u.is_deleted = false AND u.role NOT IN ('blocked','system')
       )
       SELECT COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY score), 1) AS threshold
       FROM active_scores
       WHERE score > 0`
    );
    return Math.max(Number(rows[0]?.threshold || 1), 1);
  }

  /**
   * Check whether a user meets performer eligibility:
   *  1. Has a profile picture
   *  2. Activity score is in the top 10% of active users
   * Returns { eligible, reasons[] }
   */
  async checkPerformerEligibility(userId) {
    const reasons = [];

    const { rows } = await query(
      `SELECT photo_file_id FROM users WHERE id = $1 AND is_deleted = false`,
      [String(userId)]
    );
    if (rows.length === 0) return { eligible: false, reasons: ['user_not_found'] };

    const hasPhoto = rows[0].photo_file_id && rows[0].photo_file_id.trim() !== '';
    if (!hasPhoto) reasons.push('no_profile_picture');

    const [score, threshold] = await Promise.all([
      this.getActivityScore(userId),
      this.getTop10PctThreshold(),
    ]);

    if (score < threshold) {
      reasons.push(`activity_too_low`);
    }

    return { eligible: reasons.length === 0, reasons, score, threshold };
  }

  /**
   * Revoke performers who no longer meet eligibility criteria.
   * Returns { revoked: string[], kept: string[] }
   */
  async enforcePerformerEligibility() {
    const { rows: creators } = await query(
      `SELECT id, username FROM users WHERE role = 'creator' AND is_deleted = false`
    );

    const threshold = await this.getTop10PctThreshold();
    const revoked = [];
    const kept = [];

    for (const creator of creators) {
      const { eligible, reasons, score } = await this.checkPerformerEligibility(creator.id);
      if (!eligible) {
        await query(`UPDATE users SET role = 'user' WHERE id = $1`, [creator.id]);
        revoked.push({ id: creator.id, username: creator.username, score, threshold, reasons });
        logger.info('Performer revoked — eligibility failed', { userId: creator.id, username: creator.username, score, threshold, reasons });
      } else {
        kept.push({ id: creator.id, username: creator.username, score });
      }
    }

    return { revoked, kept, threshold };
  }

  /**
   * Provision a Cal.com user for a newly approved performer.
   * Creates: user → schedule → availability → "Private Session" event type.
   * Idempotent — skips if a Cal.com user with the same email already exists.
   * Returns { calcomUserId } or { skipped: true, reason }.
   */
  async provisionCalcomUser({ username, email, name, timeZone = 'America/New_York' }) {
    if (!email) {
      logger.warn('provisionCalcomUser: no email — skipping', { username });
      return { skipped: true, reason: 'no_email' };
    }

    const calcomDbUrl = `postgresql://${process.env.PG_CALCOM_USER || 'calcom_user'}:${process.env.PG_CALCOM_PASSWORD || ''}@pg-calcom:5432/${process.env.PG_CALCOM_DB || 'calcom_db'}`;
    const pool = new Pool({ connectionString: calcomDbUrl, max: 1 });

    try {
      const client = await pool.connect();
      try {
        // Check if user already exists
        const existing = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
        if (existing.rows.length > 0) {
          logger.info('provisionCalcomUser: user already exists', { email, calcomUserId: existing.rows[0].id });
          return { calcomUserId: existing.rows[0].id, skipped: true, reason: 'already_exists' };
        }

        // Create user
        const slug = (username || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 50);
        const userRes = await client.query(
          `INSERT INTO users (username, email, name, "timeZone", "completedOnboarding", "emailVerified", "identityProvider", uuid)
           VALUES ($1, $2, $3, $4, true, NOW(), 'CAL', gen_random_uuid())
           RETURNING id`,
          [slug, email, name || slug, timeZone]
        );
        const calcomUserId = userRes.rows[0].id;

        // Create default schedule (all 7 days, 10am-10pm)
        const schedRes = await client.query(
          `INSERT INTO "Schedule" ("userId", name, "timeZone")
           VALUES ($1, 'Working Hours', $2)
           RETURNING id`,
          [calcomUserId, timeZone]
        );
        const scheduleId = schedRes.rows[0].id;

        // Set as default schedule
        await client.query('UPDATE users SET "defaultScheduleId" = $1 WHERE id = $2', [scheduleId, calcomUserId]);

        // Create availability (all 7 days, 10:00-22:00)
        await client.query(
          `INSERT INTO "Availability" ("scheduleId", days, "startTime", "endTime")
           VALUES ($1, '{0,1,2,3,4,5,6}', '10:00:00', '22:00:00')`,
          [scheduleId]
        );

        // Create "Private Session" event type (30 min)
        await client.query(
          `INSERT INTO "EventType" (title, slug, length, "userId", description, "schedulingType")
           VALUES ($1, $2, 30, $3, 'Book a private 1-on-1 session', NULL)`,
          ['Private Session', 'private-session', calcomUserId]
        );

        logger.info('provisionCalcomUser: created Cal.com user', { calcomUserId, username: slug, email });
        return { calcomUserId };
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('provisionCalcomUser error', { error: err.message, username, email });
      return { skipped: true, reason: err.message };
    } finally {
      await pool.end();
    }
  }
}

// HTML-escape for safe email template interpolation
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Ensure user has email + password credentials (used by all payment flows and email-capture step).
// Idempotent: no-ops if user already has a password; atomically sets credentials and emails them otherwise.
async function ensureEmailCredentials(userId, email, language, options = {}) {
  const { skipEmail = false } = options;
  const crypto = require('crypto');
  const EmailService = require('./emailservice');

  // Case-insensitive conflict check — excludes soft-deleted rows
  const { rows: emailConflict } = await query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND COALESCE(is_deleted, false) = false',
    [email, String(userId)]
  );
  if (emailConflict.length > 0) {
    throw new Error('This email is already associated with another account');
  }

  // Warn if the email matches a soft-deleted row (allow reuse, but log for auditing)
  const { rows: deletedConflict } = await query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND COALESCE(is_deleted, false) = true',
    [email, String(userId)]
  );
  if (deletedConflict.length > 0) {
    logger.warn('ensureEmailCredentials: email reused from a soft-deleted account', {
      email,
      deletedUserId: deletedConflict[0].id,
      newUserId: String(userId),
    });
  }

  const { rows: existing } = await query('SELECT email, password_hash FROM users WHERE id = $1', [String(userId)]);
  if (!existing.length) {
    logger.warn('ensureEmailCredentials: user not found', { userId });
    return { created: false };
  }

  if (existing[0].password_hash) {
    if (existing[0].email !== email) {
      await query('UPDATE users SET email = $1 WHERE id = $2', [email, String(userId)]);
      const { rows: pRows } = await query('SELECT pnptv_id FROM users WHERE id = $1', [String(userId)]);
      if (pRows[0]?.pnptv_id) {
        AuthentikService.updateUserEmailByUuid(pRows[0].pnptv_id, email).catch(err =>
          logger.error('[ensureEmailCredentials] Authentik sync failed', { userId, error: err.message })
        );
      }
    }
    return { created: false };
  }

  const plainPassword = crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) =>
    crypto.scrypt(plainPassword, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))))
  );
  const passwordHash = `${salt}:${hash}`;

  // Atomic conditional update — prevents races between two concurrent requests
  const { rowCount } = await query(
    `UPDATE users SET email = $1, password_hash = $2, email_verified = true
     WHERE id = $3 AND (password_hash IS NULL OR password_hash = '')
     RETURNING id`,
    [email, passwordHash, String(userId)]
  );

  if (rowCount === 0) {
    return { created: false };
  }

  const { rows: pRows } = await query('SELECT pnptv_id FROM users WHERE id = $1', [String(userId)]);
  if (pRows[0]?.pnptv_id) {
    AuthentikService.updateUserEmailByUuid(pRows[0].pnptv_id, email).catch(err =>
      logger.error('[ensureEmailCredentials] Authentik sync failed', { userId, error: err.message })
    );
  }

  if (!skipEmail) {
    const isEs = (language || 'es').startsWith('es');
    const safeEmail = escapeHtml(email);
    try {
      const transporter = EmailService.transporters?.pnptv;
      if (!transporter) {
        logger.warn('PNPtv SMTP transporter not available, credentials email not sent', { to: email });
      } else {
        await transporter.sendMail({
          from: process.env.PNPTV_FROM_EMAIL || 'noreply@pnptv.app',
          to: email,
          subject: isEs ? 'Tus credenciales de acceso PNPtv' : 'Your PNPtv Login Credentials',
          html: isEs
            ? `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
                <h2 style="color:#D4007A;margin-top:0;">Bienvenido a PNPtv!</h2>
                <p>Ahora puedes iniciar sesi&oacute;n en la web con estas credenciales:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
                  <tr><td style="padding:8px 0;color:#A1A1A6;">Contrase&ntilde;a:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${plainPassword}</td></tr>
                </table>
                <div style="background: rgba(255,180,84,0.1); border-left: 4px solid #FFB454; padding: 12px; margin: 16px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #FFB454; font-weight: bold; font-size: 14px;">🔑 ID de Recuperaci&oacute;n:</p>
                  <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 16px;">${userId}</p>
                  <p style="margin: 8px 0 0 0; font-size: 12px; color: #A1A1A6;"><strong>IMPORTANTE:</strong> Guarda este ID en un lugar seguro. Es la &uacute;nica forma de recuperar tu cuenta si pierdes el acceso.</p>
                </div>
                <p style="font-size:13px;color:#A1A1A6;">Puedes cambiar tu contrase&ntilde;a en cualquier momento desde tu perfil.</p>
                <a href="https://pnptv.app/login" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Iniciar sesi&oacute;n</a>
              </div>`
            : `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
                <h2 style="color:#D4007A;margin-top:0;">Welcome to PNPtv!</h2>
                <p>You can now log in to the web app with these credentials:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
                  <tr><td style="padding:8px 0;color:#A1A1A6;">Password:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${plainPassword}</td></tr>
                </table>
                <div style="background: rgba(255,180,84,0.1); border-left: 4px solid #FFB454; padding: 12px; margin: 16px 0; border-radius: 4px;">
                  <p style="margin: 0; color: #FFB454; font-weight: bold; font-size: 14px;">🔑 Recovery ID:</p>
                  <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 16px;">${userId}</p>
                  <p style="margin: 8px 0 0 0; font-size: 12px; color: #A1A1A6;"><strong>IMPORTANT:</strong> Save this ID in a safe place. It is the only way to recover your account if you lose access.</p>
                </div>
                <p style="font-size:13px;color:#A1A1A6;">You can change your password anytime from your profile settings.</p>
                <a href="https://pnptv.app/login" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Log In</a>
              </div>`,
        });
      }
    } catch (emailErr) {
      logger.warn('Failed to send credentials email (non-critical)', { to: email, error: emailErr.message });
    }
  }

  return { created: true, plainPassword };
}

const userService = new UserService();
userService.ensureEmailCredentials = ensureEmailCredentials;
userService.escapeHtml = escapeHtml;
module.exports = userService;
