'use strict';

/**
 * NotificationThrottleService
 *
 * Redis-based per-user, per-channel notification throttle.
 *
 * Rate limits:
 *   push  — 10 / hour per user
 *   bot   — 5 / hour + 20 / day per user (+ quiet-hours suppression)
 *   email — 1 / day per user (digest gate only)
 *
 * Redis keys (ioredis applies the global `pnptv:` keyPrefix automatically to
 * every command, so all key strings here are written without that prefix):
 *
 *   throttle:push:{userId}:hourly    INCR  TTL = 3600
 *   throttle:bot:{userId}:hourly     INCR  TTL = 3600
 *   throttle:bot:{userId}:daily      INCR  TTL = 86400
 *   throttle:email:{userId}:daily    INCR  TTL = 86400
 *   user:{userId}:active             SET   TTL = 300   (managed by Socket.IO)
 */

const { cache, getRedis } = require('../../config/redis');
const { query }            = require('../../config/postgres');
const logger               = require('../../utils/logger');

// ─── Limits ──────────────────────────────────────────────────────────────────

const PUSH_HOURLY_LIMIT = 10;
const BOT_HOURLY_LIMIT  = 5;
const BOT_DAILY_LIMIT   = 20;
const EMAIL_DAILY_LIMIT = 1;

// TTLs in seconds
const TTL_HOUR   = 3600;
const TTL_DAY    = 86400;
const TTL_ACTIVE = 300; // 5 minutes

// ─── Key builders ─────────────────────────────────────────────────────────────

const pushHourlyKey = (userId) => `throttle:push:${userId}:hourly`;
const botHourlyKey  = (userId) => `throttle:bot:${userId}:hourly`;
const botDailyKey   = (userId) => `throttle:bot:${userId}:daily`;
const emailDailyKey = (userId) => `throttle:email:${userId}:daily`;
const activeKey     = (userId) => `user:${userId}:active`;

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Atomically increment a counter and set its TTL on the first write.
 * Returns the new counter value, or Infinity on Redis error (fail-closed).
 *
 * @param {string} key - bare key (no `pnptv:` prefix; ioredis adds it)
 * @param {number} ttl - window duration in seconds
 * @returns {Promise<number>}
 */
async function incrWithTTL(key, ttl) {
  try {
    const redis  = getRedis();
    const newVal = await redis.incr(key);
    if (newVal === 1) {
      // First increment — initialise the window TTL
      await redis.expire(key, ttl);
    }
    return newVal;
  } catch (err) {
    logger.warn('[NotificationThrottleService] incrWithTTL error', {
      key,
      error: err.message,
    });
    // Return Infinity so callers that check `value > limit` will fail-closed
    return Infinity;
  }
}

/**
 * Read a raw integer counter from Redis without modifying it.
 * Returns 0 if the key does not exist, or Infinity on error.
 *
 * @param {string} key - bare key
 * @returns {Promise<number>}
 */
async function readCounter(key) {
  try {
    const val = await getRedis().get(key);
    return val ? parseInt(val, 10) : 0;
  } catch (err) {
    logger.warn('[NotificationThrottleService] readCounter error', {
      key,
      error: err.message,
    });
    return Infinity;
  }
}

/**
 * Determine whether the current UTC hour falls inside the user's configured
 * quiet-hours window.
 *
 * Expected shape in notification_preferences JSON column:
 *   { quiet_hours: { enabled: true, start: 0-23, end: 0-23 } }
 *
 * When start > end the window wraps midnight (e.g. start=22, end=7 covers
 * [22, 23] ∪ [0, 6]).
 *
 * Fails open: returns false on any DB error so notifications are never
 * suppressed solely due to an infrastructure issue.
 *
 * @param {string|number} userId
 * @returns {Promise<boolean>}
 */
async function isInQuietHours(userId) {
  try {
    // Use cache.get/set to avoid hammering the DB on every bot notification —
    // same read-through pattern used by notificationEmitter.js.
    const cacheKey = `user:${userId}:notif_prefs`;
    let prefs = await cache.get(cacheKey);

    if (prefs === null) {
      const { rows } = await query(
        'SELECT notification_preferences FROM users WHERE id = $1',
        [userId]
      );
      prefs = rows[0]?.notification_preferences || {};
      await cache.set(cacheKey, prefs, 300); // 5-min TTL, same as notificationEmitter
    }

    const qh = prefs.quiet_hours;
    if (!qh || !qh.enabled) return false;

    const { start, end } = qh;
    if (typeof start !== 'number' || typeof end !== 'number') return false;

    const nowHour = new Date().getUTCHours();

    if (start <= end) {
      // Contiguous window, e.g. start=1, end=8 suppresses hours [1, 7]
      return nowHour >= start && nowHour < end;
    }
    // Wraps midnight, e.g. start=22, end=7 suppresses [22, 23] ∪ [0, 6]
    return nowHour >= start || nowHour < end;
  } catch (err) {
    logger.warn('[NotificationThrottleService] isInQuietHours error', {
      userId,
      error: err.message,
    });
    return false; // fail open
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const NotificationThrottleService = {

  /**
   * Check whether a push notification may be sent to this user this hour.
   *
   * Uses an increment-then-check strategy: we commit the increment first
   * (INCR is atomic) and roll it back with DECRBY if the new value exceeds
   * the limit.  This ensures that under concurrent callers exactly one of them
   * "wins" the final available slot, with no double-sends.
   *
   * @param   {string|number} userId
   * @returns {Promise<boolean>} true = send is allowed
   */
  async canSendPush(userId) {
    try {
      const key     = pushHourlyKey(userId);
      const current = await incrWithTTL(key, TTL_HOUR);

      if (current > PUSH_HOURLY_LIMIT) {
        // Roll back so the window counter stays accurate.
        // ioredis applies `pnptv:` automatically — pass the bare key.
        await getRedis().decrby(key, 1);
        logger.debug('[NotificationThrottleService] push throttled', {
          userId,
          current,
          limit: PUSH_HOURLY_LIMIT,
        });
        return false;
      }

      return true;
    } catch (err) {
      logger.error('[NotificationThrottleService] canSendPush error', {
        userId,
        error: err.message,
      });
      return true; // fail open
    }
  },

  /**
   * Check whether a Telegram bot notification may be sent to this user.
   *
   * Enforces (in order of cheapest-to-most-expensive):
   *   1. Quiet-hours window  (Redis-cached DB read, 5-min TTL)
   *   2. Hourly limit        (5 / hour)
   *   3. Daily limit         (20 / day)
   *
   * Uses a read-then-increment strategy: both counters are read first with
   * MGET, checked against their limits, and only committed if both windows
   * have headroom.  This avoids needing rollbacks when one window is full.
   *
   * Note: there is a small TOCTOU gap between the MGET and the two INCRs
   * under very high concurrency, but for notification rate-limiting purposes
   * occasional off-by-one is acceptable and far preferable to a Lua script.
   *
   * @param   {string|number} userId
   * @returns {Promise<boolean>} true = send is allowed
   */
  async canSendBot(userId) {
    try {
      // 1. Quiet hours (cheapest exit path)
      const quiet = await isInQuietHours(userId);
      if (quiet) {
        logger.debug('[NotificationThrottleService] bot suppressed (quiet hours)', { userId });
        return false;
      }

      // 2. Read both counters atomically without modifying them
      const [rawHourly, rawDaily] = await getRedis().mget(
        botHourlyKey(userId),
        botDailyKey(userId)
      );

      const hourlyCount = rawHourly ? parseInt(rawHourly, 10) : 0;
      const dailyCount  = rawDaily  ? parseInt(rawDaily,  10) : 0;

      if (hourlyCount >= BOT_HOURLY_LIMIT) {
        logger.debug('[NotificationThrottleService] bot throttled (hourly)', {
          userId,
          hourlyCount,
          limit: BOT_HOURLY_LIMIT,
        });
        return false;
      }

      if (dailyCount >= BOT_DAILY_LIMIT) {
        logger.debug('[NotificationThrottleService] bot throttled (daily)', {
          userId,
          dailyCount,
          limit: BOT_DAILY_LIMIT,
        });
        return false;
      }

      // 3. Both windows have headroom — commit both increments in parallel.
      //    incrWithTTL sets the window TTL only on the very first increment.
      await Promise.all([
        incrWithTTL(botHourlyKey(userId), TTL_HOUR),
        incrWithTTL(botDailyKey(userId),  TTL_DAY),
      ]);

      return true;
    } catch (err) {
      logger.error('[NotificationThrottleService] canSendBot error', {
        userId,
        error: err.message,
      });
      return true; // fail open
    }
  },

  /**
   * Check whether a digest email may be sent to this user today.
   *
   * Uses the same increment-then-check pattern as canSendPush.
   * Allows exactly one email per 24-hour window.
   *
   * @param   {string|number} userId
   * @returns {Promise<boolean>} true = first email today, send is allowed
   */
  async canSendEmail(userId) {
    try {
      const key     = emailDailyKey(userId);
      const current = await incrWithTTL(key, TTL_DAY);

      if (current > EMAIL_DAILY_LIMIT) {
        await getRedis().decrby(key, 1);
        logger.debug('[NotificationThrottleService] email throttled (daily)', {
          userId,
          current,
          limit: EMAIL_DAILY_LIMIT,
        });
        return false;
      }

      return true;
    } catch (err) {
      logger.error('[NotificationThrottleService] canSendEmail error', {
        userId,
        error: err.message,
      });
      return true; // fail open
    }
  },

  /**
   * Check whether the user has had recent Socket.IO activity (within 5 min).
   *
   * The `user:{userId}:active` key is written — and its TTL refreshed — by
   * recordActivity() below, which is called from Socket.IO connection and
   * heartbeat handlers.
   *
   * @param   {string|number} userId
   * @returns {Promise<boolean>} true = user is currently active in the app
   */
  async isUserActiveInApp(userId) {
    try {
      return await cache.exists(activeKey(userId));
    } catch (err) {
      logger.error('[NotificationThrottleService] isUserActiveInApp error', {
        userId,
        error: err.message,
      });
      return false; // assume inactive — deliver the notification
    }
  },

  /**
   * Record that the user is currently active in the app.
   *
   * Call this from the Socket.IO connection handler and on any meaningful
   * client event (heartbeat, page navigation, etc.).  Every call refreshes
   * the 5-minute TTL so the key stays alive as long as the user is connected.
   *
   * Uses the raw ioredis client with SET … EX so the value is a plain
   * timestamp string — no JSON wrapping, and avoids the cache helper overhead
   * on this hot path.
   *
   * @param   {string|number} userId
   * @returns {Promise<void>}
   */
  async recordActivity(userId) {
    try {
      // ioredis applies `pnptv:` automatically — pass the bare key.
      await getRedis().set(activeKey(userId), Date.now().toString(), 'EX', TTL_ACTIVE);
    } catch (err) {
      logger.error('[NotificationThrottleService] recordActivity error', {
        userId,
        error: err.message,
      });
    }
  },
};

module.exports = NotificationThrottleService;
