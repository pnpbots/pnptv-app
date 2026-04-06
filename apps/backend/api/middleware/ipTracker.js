'use strict';

/**
 * ipTracker middleware
 *
 * Logs every authenticated request (user + IP + path) to `user_access_logs`.
 * Runs after authGuard so req.user is guaranteed to be populated.
 * Uses fire-and-forget inserts — never blocks the request.
 *
 * Mount AFTER authGuard on any route group that needs tracking.
 * Or mount globally after the session middleware in routes.js.
 */

const { query } = require('../../config/postgres');
const logger = require('../../utils/logger');

/**
 * Resolve the real client IP, respecting Nginx X-Forwarded-For.
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Express middleware — call next() immediately, log asynchronously.
 */
const ipTracker = (req, _res, next) => {
  next(); // never block the request

  // Only log authenticated requests with a known user
  const user = req.session?.user || req.user;
  if (!user?.id) return;

  const ip = resolveIp(req);
  const userAgent = req.headers['user-agent'] || null;
  const sessionId = req.sessionID || null;

  query(
    `INSERT INTO user_access_logs (user_id, telegram_id, ip_address, user_agent, path, method, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      String(user.id),
      user.telegram || user.telegram_id || null,
      ip,
      userAgent,
      req.path || null,
      req.method || null,
      sessionId,
    ]
  ).catch((err) => {
    logger.debug('ipTracker insert failed', { error: err.message });
  });
};

module.exports = ipTracker;
