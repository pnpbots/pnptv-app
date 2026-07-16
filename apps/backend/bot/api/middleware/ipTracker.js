'use strict';

/**
 * ipTracker middleware
 *
 * Logs each unique user+IP combination to `user_access_logs` at most once per hour
 * using a Redis dedup key. Previously logged every request, creating 5M+ rows/2 weeks
 * and causing 300ms INSERT latency. Now writes ~1 row per user per IP per hour.
 *
 * Runs after authGuard so req.user is guaranteed to be populated.
 * Uses fire-and-forget — never blocks the request.
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

function resolveIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const ipTracker = (req, _res, next) => {
  next();

  const user = req.session?.user || req.user;
  if (!user?.id) return;

  const ip = resolveIp(req);

  // Dedup: only write one DB row per user+IP per hour.
  // Avoids hammering the table with 400K+ rows/day from heartbeats and polling.
  (async () => {
    try {
      const { getRedis } = require('../../../config/redis');
      const redis = getRedis();
      const dedupKey = `iptrack:${user.id}:${ip}`;
      const isNew = await redis.set(dedupKey, '1', 'NX', 'EX', 3600).catch(() => null);
      if (isNew === null) return; // already logged this user+IP in the last hour
    } catch { /* Redis down — fall through and log anyway */ }

    query(
      `INSERT INTO user_access_logs (user_id, telegram_id, ip_address, user_agent, path, method, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        String(user.id),
        user.telegram || user.telegram_id || null,
        ip,
        req.headers['user-agent'] || null,
        req.path || null,
        req.method || null,
        req.sessionID || null,
      ]
    ).catch((err) => {
      logger.debug('ipTracker insert failed', { error: err.message });
    });
  })();
};

module.exports = ipTracker;
