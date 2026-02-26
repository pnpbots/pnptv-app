const { query } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');
const performanceMonitor = require('../utils/performanceMonitor');

const TABLE = 'users';

const normalizeSubscriptionStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'prime' || normalized === 'trial') {
    return 'active';
  }
  return 'inactive';
};

/**
 * User Model - Handles all user data operations with PostgreSQL
 */
class UserModel {
  /**
   * Map database row to user object
   */
  static mapRowToUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      emailVerified: row.email_verified,
      bio: row.bio,
      photoFileId: row.photo_file_id,
      photoUpdatedAt: row.photo_updated_at,
      interests: row.interests || [],
      location: row.location_lat && row.location_lng ? {
        lat: parseFloat(row.location_lat),
        lng: parseFloat(row.location_lng),
        name: row.location_name,
        geohash: row.location_geohash,
      } : null,
      locationUpdatedAt: row.location_updated_at,
      locationSharingEnabled: row.location_sharing_enabled === null || row.location_sharing_enabled === undefined
        ? true
        : row.location_sharing_enabled,
      subscriptionStatus: row.subscription_status,
      planId: row.plan_id,
      planExpiry: row.plan_expiry,
      tier: row.tier,
      // Subscription object for access control compatibility
      subscription: {
        isPrime: normalizeSubscriptionStatus(row.subscription_status) === 'active',
        status: row.subscription_status,
        planId: row.plan_id,
        expiry: row.plan_expiry
      },
      role: row.role,
      status: row.status,
      assignedBy: row.assigned_by,
      roleAssignedAt: row.role_assigned_at,
      privacy: typeof row.privacy === 'string' ? JSON.parse(row.privacy) : (row.privacy || { showLocation: true, showInterests: true, showBio: true, allowMessages: true, showOnline: true }),
      profileViews: row.profile_views || 0,

      favorites: row.favorites || [],
      blocked: row.blocked || [],
      badges: row.badges || [],
      onboardingComplete: row.onboarding_complete,
      ageVerified: row.age_verified,
      ageVerifiedAt: row.age_verified_at,
      ageVerificationExpiresAt: row.age_verification_expires_at,
      ageVerificationIntervalHours: row.age_verification_interval_hours,
      termsAccepted: row.terms_accepted,
      privacyAccepted: row.privacy_accepted,
      lastActive: row.last_active,
      lastActivityInGroup: row.last_activity_in_group,
      groupActivityLog: row.group_activity_log,
      timezone: row.timezone,
      timezoneDetected: row.timezone_detected,
      timezoneUpdatedAt: row.timezone_updated_at,
      language: row.language,
      isActive: row.is_active === null || row.is_active === undefined
        ? true
        : row.is_active,
      deactivatedAt: row.deactivated_at,
      deactivationReason: row.deactivation_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Sovereign identity
      pnptvId: row.pnptv_id || null,
      xId: row.x_id || null,
      // Social media fields
      instagram: row.instagram || null,
      twitter: row.twitter || null,
      facebook: row.facebook || null,
      tiktok: row.tiktok || null,
      youtube: row.youtube || null,
      telegram: row.telegram || null,
      looking_for: row.looking_for || null,
      tribe: row.tribe || null,
      city: row.city || null,
      country: row.country || null,
      // Recurring subscription fields
      cardToken: row.card_token || null,
      cardTokenMask: row.card_token_mask || null,
      cardFranchise: row.card_franchise || null,
      autoRenew: row.auto_renew || false,
      subscriptionType: row.subscription_type || 'one_time',
      recurringPlanId: row.recurring_plan_id || null,
      nextBillingDate: row.next_billing_date || null,
      billingFailures: row.billing_failures || 0,
      lastBillingAttempt: row.last_billing_attempt || null,
    };
  }

  /**
   * Create or update user
   */
  static async createOrUpdate(userData) {
    try {
      const rawUserId = userData.userId ?? userData.id ?? userData.user_id ?? userData.telegramId ?? userData.telegram_id;
      if (rawUserId === undefined || rawUserId === null) {
        throw new Error('User ID is required to create or update a user');
      }
      const userId = rawUserId.toString();
      const onboardingCompleteProvided = Object.prototype.hasOwnProperty.call(userData, 'onboardingComplete')
        || Object.prototype.hasOwnProperty.call(userData, 'onboarding_complete');
      const ageVerifiedProvided = Object.prototype.hasOwnProperty.call(userData, 'ageVerified')
        || Object.prototype.hasOwnProperty.call(userData, 'age_verified');
      const termsAcceptedProvided = Object.prototype.hasOwnProperty.call(userData, 'termsAccepted')
        || Object.prototype.hasOwnProperty.call(userData, 'terms_accepted');
      const privacyAcceptedProvided = Object.prototype.hasOwnProperty.call(userData, 'privacyAccepted')
        || Object.prototype.hasOwnProperty.call(userData, 'privacy_accepted');

      const sql = `
        INSERT INTO ${TABLE} (
          id, username, first_name, last_name, email, bio, photo_file_id,
          interests, location_lat, location_lng, location_name, location_geohash,
          subscription_status, plan_id, plan_expiry, tier, role, status, privacy,
          profile_views, favorites, blocked, badges, onboarding_complete,
          age_verified, terms_accepted, privacy_accepted, language, is_active,
          x_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, NOW(), NOW()
        )
      ON CONFLICT (id) DO UPDATE SET
        username = COALESCE(EXCLUDED.username, ${TABLE}.username),
        first_name = COALESCE(EXCLUDED.first_name, ${TABLE}.first_name),
        last_name = COALESCE(EXCLUDED.last_name, ${TABLE}.last_name),
        status = COALESCE(EXCLUDED.status, ${TABLE}.status),
        x_id = COALESCE(EXCLUDED.x_id, ${TABLE}.x_id),
        onboarding_complete = CASE WHEN $31 THEN EXCLUDED.onboarding_complete ELSE ${TABLE}.onboarding_complete END,
        age_verified = CASE WHEN $32 THEN EXCLUDED.age_verified ELSE ${TABLE}.age_verified END,
        terms_accepted = CASE WHEN $33 THEN EXCLUDED.terms_accepted ELSE ${TABLE}.terms_accepted END,
        privacy_accepted = CASE WHEN $34 THEN EXCLUDED.privacy_accepted ELSE ${TABLE}.privacy_accepted END,
        language = COALESCE(EXCLUDED.language, ${TABLE}.language),
        updated_at = NOW()
      RETURNING *
    `;

      const location = userData.location || {};
      const privacy = userData.privacy || { showLocation: true, showInterests: true, showBio: true, allowMessages: true, showOnline: true };

      const executeInsert = async (usernameOverride) => query(sql, [
        userId,
        usernameOverride,
        userData.firstName || userData.first_name || 'User',
        userData.lastName || userData.last_name || null,
        userData.email || null,
        userData.bio || null,
        userData.photoFileId || null,
        userData.interests || [],
        location.lat || null,
        location.lng || null,
        location.name || null,
        location.geohash || null,
        userData.subscriptionStatus || 'free',
        userData.planId || null,
        userData.planExpiry || null,
        userData.tier || 'free',
        userData.role || 'user',
        userData.status || 'offline',
        JSON.stringify(privacy),
        userData.profileViews || 0,
        userData.favorites || [],
        userData.blocked || [],
        userData.badges || [],
        onboardingCompleteProvided
          ? (userData.onboardingComplete ?? userData.onboarding_complete ?? false)
          : false,
        ageVerifiedProvided
          ? (userData.ageVerified ?? userData.age_verified ?? false)
          : false,
        termsAcceptedProvided
          ? (userData.termsAccepted ?? userData.terms_accepted ?? false)
          : false,
        privacyAcceptedProvided
          ? (userData.privacyAccepted ?? userData.privacy_accepted ?? false)
          : false,
        userData.language || 'en',
        userData.isActive !== false,
        userData.xId || userData.x_id || null,
        onboardingCompleteProvided,
        ageVerifiedProvided,
        termsAcceptedProvided,
        privacyAcceptedProvided,
      ]);

      let result;
      try {
        result = await executeInsert(userData.username || null);
      } catch (error) {
        const isDuplicateUsername = error?.code === '23505'
          && String(error?.constraint || '').includes('users_username_key');
        if (isDuplicateUsername) {
          logger.warn('Duplicate username on create/update, retrying without username', {
            userId,
            username: userData.username,
          });
          result = await executeInsert(null);
        } else {
          throw error;
        }
      }

      await cache.del(`user:${userId}`);
      const mappedUser = this.mapRowToUser(result.rows[0]);
      if (cache.set) {
        try {
          await cache.set(`user:${userId}`, mappedUser, 600);
        } catch (cacheError) {
          logger.warn('Failed to update user cache after create/update:', cacheError.message || cacheError);
        }
      }
      logger.info('User created/updated', { userId, role: userData.role || 'user' });
      return mappedUser;
    } catch (error) {
      logger.error('Error creating/updating user:', error);
      throw error;
    }
  }

  /**
   * Get user by ID (with optimized caching)
   */
  static async getById(userId) {
    try {
      performanceMonitor.start('user_getById');
      const cacheKey = `user:${userId}`;

      if (cache.getOrSet && typeof cache.getOrSet === 'function') {
        const maybeCached = await cache.getOrSet(
          cacheKey,
          async () => {
            const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [userId.toString()]);
            if (result.rows.length === 0) return null;
            const userData = this.mapRowToUser(result.rows[0]);
            logger.debug(`Fetched user from database: ${userId}`);
            return userData;
          },
          600,
        );
        if (maybeCached !== undefined) {
          performanceMonitor.end('user_getById', { source: 'cache_getOrSet', userId });
          return maybeCached;
        }
      }

      const cached = await cache.get(cacheKey);
      if (cached) {
        performanceMonitor.end('user_getById', { source: 'cache', userId });
        return cached;
      }

      const result = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [userId.toString()]);
      if (result.rows.length === 0) return null;

      const userData = this.mapRowToUser(result.rows[0]);
      if (cache.set) await cache.set(cacheKey, userData, 600);
      performanceMonitor.end('user_getById', { source: 'database', userId });
      return userData;
    } catch (error) {
      logger.error('Error getting user:', error);
      return null;
    }
  }

  /**
   * Get user by email
   * @param {string} email - Email address
   * @returns {Promise<Object|null>} User object or null
   */
  static async getByEmail(email) {
    try {
      if (!email) return null;
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE LOWER(email) = LOWER($1) AND NOT id LIKE 'legacy_%' LIMIT 1`,
        [email.trim()]
      );
      if (result.rows.length === 0) return null;
      return this.mapRowToUser(result.rows[0]);
    } catch (error) {
      logger.error('Error getting user by email:', error);
      return null;
    }
  }

  /**
   * Get user by sovereign PNP TV ID (pnptv_id)
   * @param {string} pnptvId - UUID sovereign identity
   * @returns {Promise<Object|null>} User object or null
   */
  static async getByPnptvId(pnptvId) {
    try {
      if (!pnptvId) return null;
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE pnptv_id = $1 LIMIT 1`,
        [pnptvId.trim()]
      );
      if (result.rows.length === 0) return null;
      return this.mapRowToUser(result.rows[0]);
    } catch (error) {
      logger.error('Error getting user by pnptv_id:', error);
      return null;
    }
  }

  /**
   * Get user by X/Twitter OAuth ID (x_id)
   * @param {string} xId - X/Twitter numeric user ID
   * @returns {Promise<Object|null>} User object or null
   */
  static async getByXId(xId) {
    try {
      if (!xId) return null;
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE x_id = $1 LIMIT 1`,
        [xId.trim()]
      );
      if (result.rows.length === 0) return null;
      return this.mapRowToUser(result.rows[0]);
    } catch (error) {
      logger.error('Error getting user by x_id:', error);
      return null;
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId, updates) {
    try {
      const setClauses = ['updated_at = NOW()'];
      const values = [userId.toString()];
      let paramIndex = 2;

      const fieldMap = {
        username: 'username',
        firstName: 'first_name',
        lastName: 'last_name',
        email: 'email',
        bio: 'bio',
        photoFileId: 'photo_file_id',
        interests: 'interests',
        looking_for: 'looking_for',
        tribe: 'tribe',
        city: 'city',
        country: 'country',
        instagram: 'instagram',
        twitter: 'twitter',
        facebook: 'facebook',
        tiktok: 'tiktok',
        youtube: 'youtube',
        telegram: 'telegram',
        xId: 'x_id',
        locationSharingEnabled: 'location_sharing_enabled',
        onboardingComplete: 'onboarding_complete',
      hasSeenTutorial: 'has_seen_tutorial',
      ageVerified: 'age_verified',
      termsAccepted: 'terms_accepted',
      privacyAccepted: 'privacy_accepted',
      lastActive: 'last_active',
      language: 'language',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
          setClauses.push(`${col} = $${paramIndex++}`);
          values.push(updates[key]);
        }
      }

      if (updates.location) {
        setClauses.push(`location_lat = $${paramIndex++}`);
        values.push(updates.location.lat);
        setClauses.push(`location_lng = $${paramIndex++}`);
        values.push(updates.location.lng);
        setClauses.push(`location_name = $${paramIndex++}`);
        values.push(updates.location.name || null);
        setClauses.push(`location_geohash = $${paramIndex++}`);
        values.push(updates.location.geohash || null);
        setClauses.push(`location_updated_at = NOW()`);
      }

      await query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1`, values);
      await cache.del(`user:${userId}`);
      if (updates.location || Object.prototype.hasOwnProperty.call(updates, 'locationSharingEnabled')) {
        await cache.delPattern('nearby:*');
      }
      logger.info('User profile updated', { userId });
      return true;
    } catch (error) {
      logger.error('Error updating user profile:', error);
      return false;
    }
  }

  /**
   * Update the age verification flags on a user record
   * @param {string|number} userId - Telegram user ID
   * @param {Object} options - Verification options
   */
  static async updateAgeVerification(userId, { verified = true, method = 'ai_photo', expiresHours = 168 } = {}) {
    try {
      const now = new Date();
      const expiresAt = verified ? new Date(now.getTime() + expiresHours * 60 * 60 * 1000) : null;

      const result = await query(
        `UPDATE ${TABLE} SET
          age_verified = $2,
          age_verified_at = $3,
          age_verification_expires_at = $4,
          age_verification_method = $5,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
        [userId.toString(), verified, verified ? now : null, expiresAt, method]
      );

      if (result.rowCount === 0) {
        logger.warn('User not found when updating age verification', { userId });
        return false;
      }

      await cache.del(`user:${userId}`);
      logger.info('Age verification status updated', { userId, verified, method });
      return true;
    } catch (error) {
      logger.error('Error updating age verification:', error);
      return false;
    }
  }

  /**
   * Update user subscription
   * Unified logic: prime/active = membership active, churned/expired/free = membership not active
   */
  static async updateSubscription(userId, subscription) {
    try {
      const status = (subscription.status || '').toLowerCase();

      // Determine tier based on status
      // prime/active = PRIME tier (membership active)
      // churned/expired/free/empty = Free tier (membership not active)
      const isActive = status === 'active' || status === 'prime';
      const tier = isActive ? 'Prime' : 'Free';

      // Normalize status: churned/expired should remain as 'churned' for tracking,
      // but tier will be 'Free' for access control
      const normalizedStatus = isActive
        ? 'active'
        : (status === 'churned' || status === 'expired' ? 'churned' : 'free');

      await query(
        `UPDATE ${TABLE} SET subscription_status = $2, plan_id = $3, plan_expiry = $4, tier = $5, updated_at = NOW() WHERE id = $1`,
        [userId.toString(), normalizedStatus, subscription.planId, subscription.expiry, tier]
      );
      await cache.del(`user:${userId}`);
      await cache.delPattern('nearby:*');
      logger.info('User subscription updated', { userId, status: normalizedStatus, tier });
      return true;
    } catch (error) {
      logger.error('Error updating subscription:', error);
      return false;
    }
  }

  /**
   * Get nearby users (with optimized caching and bounding box pre-filtering)
   */
  static async getNearby(location, radiusKm = 10) {
    try {
      const lat = Math.round(location.lat * 100) / 100;
      const lng = Math.round(location.lng * 100) / 100;
      const cacheKey = `nearby:${lat},${lng}:${radiusKm}`;

      const fetchNearby = async () => {
        // Calculate bounding box for SQL pre-filtering (approximate rectangular area)
        // 1 degree latitude ≈ 111 km, 1 degree longitude varies by latitude
        const latDelta = radiusKm / 111;
        const lngDelta = radiusKm / (111 * Math.cos(this.toRad(location.lat)));

        const minLat = location.lat - latDelta;
        const maxLat = location.lat + latDelta;
        const minLng = location.lng - lngDelta;
        const maxLng = location.lng + lngDelta;

        // Use bounding box to pre-filter in SQL, also filter by location_sharing_enabled
        const result = await query(
          `SELECT * FROM ${TABLE}
           WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL
           AND location_lat BETWEEN $1 AND $2
           AND location_lng BETWEEN $3 AND $4
           AND COALESCE(location_sharing_enabled, true) = true
           AND COALESCE(is_active, true) = true
           LIMIT 200`,
          [minLat, maxLat, minLng, maxLng]
        );

        const users = [];
        for (const row of result.rows) {
          const userData = this.mapRowToUser(row);
          if (userData.location) {
            // Calculate exact distance using Haversine formula
            const distance = this.calculateDistance(location.lat, location.lng, userData.location.lat, userData.location.lng);
            if (distance <= radiusKm) {
              users.push({ ...userData, distance });
            }
          }
        }
        users.sort((a, b) => a.distance - b.distance);
        logger.info(`Found ${users.length} nearby users within ${radiusKm}km (pre-filtered ${result.rows.length} from bounding box)`);
        return users;
      };

      if (cache.getOrSet && typeof cache.getOrSet === 'function') {
        const maybeCached = await cache.getOrSet(cacheKey, fetchNearby, 300);
        if (maybeCached !== undefined) return maybeCached;
      }

      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const users = await fetchNearby();
      if (cache.set) await cache.set(cacheKey, users, 300);
      return users;
    } catch (error) {
      logger.error('Error getting nearby users:', error);
      return [];
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static toRad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Get expired subscriptions
   */
  static async getExpiredSubscriptions() {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE subscription_status = 'active' AND plan_expiry <= NOW()`
      );
      return result.rows.map((row) => this.mapRowToUser(row));
    } catch (error) {
      logger.error('Error getting expired subscriptions:', error);
      return [];
    }
  }

  /**
   * Get all users (with pagination)
   */
  static async getAll(limit = 50, startAfter = null) {
    try {
      let sql = `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT $1`;
      const values = [limit];

      if (startAfter) {
        sql = `SELECT * FROM ${TABLE} WHERE created_at < (SELECT created_at FROM ${TABLE} WHERE id = $2) ORDER BY created_at DESC LIMIT $1`;
        values.push(startAfter);
      }

      const result = await query(sql, values);
      const users = result.rows.map((row) => this.mapRowToUser(row));
      const lastDoc = users.length > 0 ? users[users.length - 1].id : null;

      return { users, lastDoc };
    } catch (error) {
      logger.error('Error getting all users:', error);
      return { users: [], lastDoc: null };
    }
  }

  /**
   * Get users by subscription status
   */
  static async getBySubscriptionStatus(status) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE subscription_status = $1`, [status]);
      return result.rows.map((row) => this.mapRowToUser(row));
    } catch (error) {
      logger.error('Error getting users by subscription status:', error);
      return [];
    }
  }

  /**
   * Update user role
   */
  static async updateRole(userId, role, assignedBy) {
    try {
      await query(
        `UPDATE ${TABLE} SET role = $2, updated_at = NOW() WHERE id = $1`,
        [userId.toString(), role]
      );
      await cache.del(`user:${userId}`);
      logger.info('User role updated', { userId, role, assignedBy });
      return true;
    } catch (error) {
      logger.error('Error updating user role:', error);
      return false;
    }
  }

  /**
   * Get users by role
   */
  static async getByRole(role) {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE role = $1`, [role]);
      const users = result.rows.map((row) => this.mapRowToUser(row));
      logger.info(`Found ${users.length} users with role: ${role}`);
      return users;
    } catch (error) {
      logger.error('Error getting users by role:', error);
      return [];
    }
  }

  /**
   * Get all admin users
   */
  static async getAllAdmins() {
    try {
      const result = await query(`SELECT * FROM ${TABLE} WHERE role IN ('superadmin', 'admin', 'moderator')`);
      const admins = result.rows.map((row) => this.mapRowToUser(row));
      logger.info(`Found ${admins.length} admin users`);
      return admins;
    } catch (error) {
      logger.error('Error getting admin users:', error);
      return [];
    }
  }

  /**
   * Delete user
   */
  static async delete(userId) {
    try {
      await query(`DELETE FROM ${TABLE} WHERE id = $1`, [userId.toString()]);
      await cache.del(`user:${userId}`);
      logger.info('User deleted', { userId });
      return true;
    } catch (error) {
      logger.error('Error deleting user:', error);
      return false;
    }
  }

  /**
   * Get statistics for dashboard
   */
  static async getStatistics() {
    try {
      const cacheKey = 'stats:users';

      const fetchStats = async () => {
        const result = await query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE subscription_status = 'active') as premium
          FROM ${TABLE}
        `);
        const row = result.rows[0];
        const total = parseInt(row.total) || 0;
        const premium = parseInt(row.premium) || 0;
        const free = total - premium;
        const conversionRate = total > 0 ? Math.round((premium / total) * 10000) / 100 : 0;

        const stats = { total, premium, free, conversionRate, timestamp: new Date().toISOString() };
        logger.info('User statistics calculated', stats);
        return stats;
      };

      if (cache.getOrSet && typeof cache.getOrSet === 'function') {
        return await cache.getOrSet(cacheKey, fetchStats, 60);
      }

      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const stats = await fetchStats();
      if (cache.set) await cache.set(cacheKey, stats, 60);
      return stats;
    } catch (error) {
      logger.error('Error getting user statistics:', error);
      return { total: 0, premium: 0, free: 0, conversionRate: 0 };
    }
  }

  /**
   * Get extended statistics for admin dashboard
   */
  static async getExtendedStatistics() {
    try {
      const cacheKey = 'stats:users:extended';

      const fetchStats = async () => {
        // Get comprehensive statistics
        const statsResult = await query(`
          SELECT
            COUNT(*) as total_users,
            COUNT(*) FILTER (WHERE subscription_status = 'active') as active_subscriptions,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_users_30_days
          FROM ${TABLE}
        `);

        // Get users by plan breakdown
        const planResult = await query(`
          SELECT
            COALESCE(plan_id, 'No Plan') as plan_name,
            COUNT(*) as count
          FROM ${TABLE}
          GROUP BY plan_id
          ORDER BY count DESC
        `);

        const row = statsResult.rows[0] || {};
        const totalUsers = parseInt(row.total_users) || 0;
        const activeSubscriptions = parseInt(row.active_subscriptions) || 0;
        const newUsersLast30Days = parseInt(row.new_users_30_days) || 0;

        // Build byPlan object
        const byPlan = {};
        for (const planRow of planResult.rows) {
          byPlan[planRow.plan_name] = parseInt(planRow.count) || 0;
        }

        // If no plans found, add a default
        if (Object.keys(byPlan).length === 0) {
          byPlan['Free'] = totalUsers;
        }

        const stats = {
          totalUsers,
          activeSubscriptions,
          newUsersLast30Days,
          byPlan,
          timestamp: new Date().toISOString()
        };

        logger.info('Extended user statistics calculated', { totalUsers, activeSubscriptions, newUsersLast30Days });
        return stats;
      };

      if (cache.getOrSet && typeof cache.getOrSet === 'function') {
        return await cache.getOrSet(cacheKey, fetchStats, 60);
      }

      const cached = await cache.get(cacheKey);
      if (cached) return cached;

      const stats = await fetchStats();
      if (cache.set) await cache.set(cacheKey, stats, 60);
      return stats;
    } catch (error) {
      logger.error('Error getting extended user statistics:', error);
      return {
        totalUsers: 0,
        activeSubscriptions: 0,
        newUsersLast30Days: 0,
        byPlan: { 'Free': 0 }
      };
    }
  }

  /**
   * Invalidate user cache
   */
  static async invalidateCache(userId) {
    try {
      await cache.del(`user:${userId}`);
      await cache.delPattern('nearby:*');
      await cache.del('stats:users');
      logger.info('User cache invalidated', { userId });
      return true;
    } catch (error) {
      logger.error('Error invalidating user cache:', error);
      return false;
    }
  }

  /**
   * Update user privacy settings
   */
  static async updatePrivacy(userId, privacy) {
    try {
      await query(`UPDATE ${TABLE} SET privacy = $2, updated_at = NOW() WHERE id = $1`, [userId.toString(), JSON.stringify(privacy)]);
      await cache.del(`user:${userId}`);
      logger.info('User privacy updated', { userId, privacy });
      return true;
    } catch (error) {
      logger.error('Error updating user privacy:', error);
      return false;
    }
  }

  /**
   * Increment profile views
   */
  static async incrementProfileViews(userId) {
    try {
      await query(`UPDATE ${TABLE} SET profile_views = profile_views + 1, updated_at = NOW() WHERE id = $1`, [userId.toString()]);
      await cache.del(`user:${userId}`);
      logger.info('Profile views incremented', { userId });
      return true;
    } catch (error) {
      logger.error('Error incrementing profile views:', error);
      return false;
    }
  }

  /**
   * Add user to favorites
   */
  static async addToFavorites(userId, targetUserId) {
    try {
      await query(
        `UPDATE ${TABLE} SET favorites = array_append(favorites, $2), updated_at = NOW() WHERE id = $1 AND NOT ($2 = ANY(favorites))`,
        [userId.toString(), targetUserId.toString()]
      );
      await cache.del(`user:${userId}`);
      logger.info('User added to favorites', { userId, targetUserId });
      return true;
    } catch (error) {
      logger.error('Error adding to favorites:', error);
      return false;
    }
  }

  /**
   * Remove user from favorites
   */
  static async removeFromFavorites(userId, targetUserId) {
    try {
      await query(
        `UPDATE ${TABLE} SET favorites = array_remove(favorites, $2), updated_at = NOW() WHERE id = $1`,
        [userId.toString(), targetUserId.toString()]
      );
      await cache.del(`user:${userId}`);
      logger.info('User removed from favorites', { userId, targetUserId });
      return true;
    } catch (error) {
      logger.error('Error removing from favorites:', error);
      return false;
    }
  }

  /**
   * Block user
   */
  static async blockUser(userId, targetUserId) {
    try {
      await query(
        `UPDATE ${TABLE} SET
          blocked = array_append(blocked, $2),
          favorites = array_remove(favorites, $2),
          updated_at = NOW()
        WHERE id = $1 AND NOT ($2 = ANY(blocked))`,
        [userId.toString(), targetUserId.toString()]
      );
      await cache.del(`user:${userId}`);
      logger.info('User blocked', { userId, targetUserId });
      return true;
    } catch (error) {
      logger.error('Error blocking user:', error);
      return false;
    }
  }

  /**
   * Unblock user
   */
  static async unblockUser(userId, targetUserId) {
    try {
      await query(
        `UPDATE ${TABLE} SET blocked = array_remove(blocked, $2), updated_at = NOW() WHERE id = $1`,
        [userId.toString(), targetUserId.toString()]
      );
      await cache.del(`user:${userId}`);
      logger.info('User unblocked', { userId, targetUserId });
      return true;
    } catch (error) {
      logger.error('Error unblocking user:', error);
      return false;
    }
  }

  /**
   * Check if user is blocked
   */
  static async isBlocked(userId, targetUserId) {
    try {
      const user = await this.getById(userId);
      if (!user) return false;
      const blocked = user.blocked || [];
      return blocked.includes(targetUserId.toString());
    } catch (error) {
      logger.error('Error checking blocked status:', error);
      return false;
    }
  }

  /**
   * Get user favorites
   */
  static async getFavorites(userId) {
    try {
      const user = await this.getById(userId);
      if (!user || !user.favorites || user.favorites.length === 0) return [];

      const result = await query(`SELECT * FROM ${TABLE} WHERE id = ANY($1)`, [user.favorites]);
      const favorites = result.rows.map((row) => this.mapRowToUser(row));
      logger.info(`Retrieved ${favorites.length} favorites for user ${userId}`);
      return favorites;
    } catch (error) {
      logger.error('Error getting favorites:', error);
      return [];
    }
  }

  /**
   * Add badge to user
   */
  static async addBadge(userId, badge) {
    try {
      await query(
        `UPDATE ${TABLE} SET badges = array_append(badges, $2), updated_at = NOW() WHERE id = $1 AND NOT ($2 = ANY(badges))`,
        [userId.toString(), badge]
      );
      await cache.del(`user:${userId}`);
      logger.info('Badge added to user', { userId, badge });
      return true;
    } catch (error) {
      logger.error('Error adding badge:', error);
      return false;
    }
  }

  /**
   * Remove badge from user
   */
  static async removeBadge(userId, badge) {
    try {
      await query(`UPDATE ${TABLE} SET badges = array_remove(badges, $2), updated_at = NOW() WHERE id = $1`, [userId.toString(), badge]);
      await cache.del(`user:${userId}`);
      logger.info('Badge removed from user', { userId, badge });
      return true;
    } catch (error) {
      logger.error('Error removing badge:', error);
      return false;
    }
  }

  /**
   * Remove badge from all users
   */
  static async removeBadgeFromAll(badge) {
    try {
      await query(
        `UPDATE ${TABLE} SET badges = array_remove(badges, $1), updated_at = NOW() WHERE $1 = ANY(badges)`,
        [badge]
      );
      logger.info('Badge removed from all users', { badge });
      return true;
    } catch (error) {
      logger.error('Error removing badge from all users:', error);
      return false;
    }
  }

  /**
   * Get churned users
   */
  static async getChurnedUsers() {
    try {
      const result = await query(`
        SELECT u.* FROM ${TABLE} u
        INNER JOIN payments p ON p.user_id = u.id AND p.status = 'success'
        WHERE u.subscription_status = 'free'
        GROUP BY u.id
      `);
      const churnedUsers = result.rows.map((row) => this.mapRowToUser(row));
      logger.info(`Found ${churnedUsers.length} churned users`);
      return churnedUsers;
    } catch (error) {
      logger.error('Error getting churned users:', error);
      return [];
    }
  }

  /**
   * Get users whose latest payment attempt was not completed
   * @param {Object} options
   * @param {number|null} options.sinceDays - Optional filter to only consider payments within N days
   */
  static async getUsersWithIncompletePayments({ sinceDays = null } = {}) {
    try {
      const params = [];
      let dateFilter = '';
      if (sinceDays && Number.isFinite(Number(sinceDays))) {
        params.push(Number(sinceDays));
        dateFilter = `WHERE p.created_at >= NOW() - ($${params.length} || ' days')::interval`;
      }

      const sql = `
        WITH latest_payments AS (
          SELECT DISTINCT ON (p.user_id) p.user_id, p.status, p.created_at
          FROM payments p
          ${dateFilter}
          ORDER BY p.user_id, p.created_at DESC
        )
        SELECT u.*, COALESCE(u.email, s.email) AS email
        FROM ${TABLE} u
        INNER JOIN latest_payments lp ON lp.user_id = u.id
        LEFT JOIN subscribers s ON s.telegram_id = u.id
        WHERE lp.status IN ('pending', 'processing', 'failed', 'cancelled', 'expired')
      `;

      const result = await query(sql, params);
      const users = result.rows.map((row) => this.mapRowToUser(row));
      logger.info(`Found ${users.length} users with incomplete payments`);
      return users;
    } catch (error) {
      logger.error('Error getting users with incomplete payments:', error);
      return [];
    }
  }

  /**
   * Get users with incomplete onboarding
   */
  static async getIncompleteOnboarding() {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE onboarding_complete = false ORDER BY created_at ASC`
      );
      return result.rows.map((row) => this.mapRowToUser(row));
    } catch (error) {
      logger.error('Error getting incomplete onboarding users:', error);
      return [];
    }
  }

  /**
   * Get subscriptions expiring between two dates
   */
  static async getSubscriptionsExpiringBetween(startDate, endDate) {
    try {
      const result = await query(
        `SELECT * FROM ${TABLE} WHERE subscription_status = 'active' AND plan_expiry >= $1 AND plan_expiry <= $2 ORDER BY plan_expiry ASC`,
        [startDate.toISOString(), endDate.toISOString()]
      );
      return result.rows.map((row) => this.mapRowToUser(row));
    } catch (error) {
      logger.error('Error getting subscriptions expiring between dates:', error);
      return [];
    }
  }

  /**
   * Find legacy user by email or username
   * Legacy users have IDs starting with 'legacy_'
   */
  static async findLegacyUser(email, username) {
    try {
      let legacyUser = null;

      // Try to match by email first (more reliable)
      if (email) {
        const emailResult = await query(
          `SELECT * FROM ${TABLE} WHERE id LIKE 'legacy_%' AND LOWER(email) = LOWER($1) LIMIT 1`,
          [email.trim()]
        );
        if (emailResult.rows.length > 0) {
          legacyUser = this.mapRowToUser(emailResult.rows[0]);
          logger.info('Found legacy user by email', { email, legacyId: legacyUser.id });
          return { user: legacyUser, matchedBy: 'email' };
        }
      }

      // Try to match by username
      if (username) {
        const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();
        const usernameResult = await query(
          `SELECT * FROM ${TABLE} WHERE id LIKE 'legacy_%' AND LOWER(username) = $1 LIMIT 1`,
          [cleanUsername]
        );
        if (usernameResult.rows.length > 0) {
          legacyUser = this.mapRowToUser(usernameResult.rows[0]);
          logger.info('Found legacy user by username', { username, legacyId: legacyUser.id });
          return { user: legacyUser, matchedBy: 'username' };
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding legacy user:', error);
      return null;
    }
  }

  /**
   * Merge legacy user data into a new user account
   * Transfers subscription, badges, and other data, then deletes the legacy record
   */
  static async mergeLegacyUser(newUserId, legacyUser) {
    try {
      const newUserIdStr = newUserId.toString();
      const legacyId = legacyUser.id;

      logger.info('Merging legacy user', { newUserId: newUserIdStr, legacyId });

      // Build the update query to transfer subscription data
      const updateSql = `
        UPDATE ${TABLE}
        SET
          subscription_status = $2,
          plan_id = $3,
          plan_expiry = $4,
          tier = $5,
          badges = array_cat(badges, $6),
          email = COALESCE(email, $7),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      // Add 'legacy_migrated' badge to track this was a merged account
      const badgesToAdd = ['legacy_migrated'];
      if (legacyUser.badges && Array.isArray(legacyUser.badges)) {
        legacyUser.badges.forEach(badge => {
          if (badge !== 'legacy_member' && !badgesToAdd.includes(badge)) {
            badgesToAdd.push(badge);
          }
        });
      }

      const result = await query(updateSql, [
        newUserIdStr,
        legacyUser.subscriptionStatus || 'free',
        legacyUser.planId || null,
        legacyUser.planExpiry || null,
        legacyUser.tier || 'Free',
        badgesToAdd,
        legacyUser.email || null,
      ]);

      if (result.rows.length === 0) {
        logger.error('Failed to update new user with legacy data', { newUserId: newUserIdStr, legacyId });
        return null;
      }

      // Delete the legacy placeholder record
      await query(`DELETE FROM ${TABLE} WHERE id = $1`, [legacyId]);
      logger.info('Legacy user record deleted', { legacyId });

      // Clear cache for both users
      await cache.del(`user:${newUserIdStr}`);
      await cache.del(`user:${legacyId}`);

      const mergedUser = this.mapRowToUser(result.rows[0]);
      logger.info('Legacy user merged successfully', {
        newUserId: newUserIdStr,
        legacyId,
        subscriptionStatus: mergedUser.subscriptionStatus,
        planId: mergedUser.planId,
      });

      return mergedUser;
    } catch (error) {
      logger.error('Error merging legacy user:', error);
      return null;
    }
  }

  /**
   * Check and merge legacy user during user creation/update
   * Returns the merged user if a legacy match was found, null otherwise
   */
  static async checkAndMergeLegacy(userId, email, username) {
    try {
      // Find matching legacy user
      const legacyMatch = await this.findLegacyUser(email, username);

      if (!legacyMatch) {
        return null;
      }

      // Merge the legacy user data
      const mergedUser = await this.mergeLegacyUser(userId, legacyMatch.user);

      if (mergedUser) {
        logger.info('Auto-merged legacy user', {
          userId: userId.toString(),
          legacyId: legacyMatch.user.id,
          matchedBy: legacyMatch.matchedBy,
          plan: mergedUser.planId,
        });
      }

      return mergedUser;
    } catch (error) {
      logger.error('Error in checkAndMergeLegacy:', error);
      return null;
    }
  }
}

module.exports = UserModel;
