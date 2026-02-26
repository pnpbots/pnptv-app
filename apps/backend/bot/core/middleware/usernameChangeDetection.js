const logger = require('../../../utils/logger');
const { getRedis, cache } = require('../../../config/redis');
const { query } = require('../../../config/postgres');

/**
 * Username/Name Change Detection Middleware
 * DISABLED - All username/name change detection rules have been disabled
 */
function usernameChangeDetectionMiddleware() {
  return async (ctx, next) => {
    // Middleware is disabled - all name/username changes are allowed
    return next();
  };
}

/**
 * Get change history for a user
 */
async function getUserChangeHistory(userId) {
  try {
    const redis = getRedis();
    const userIdStr = String(userId);
    const history = await redis.get(`user:${userIdStr}:username_history`);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    logger.error('Error getting user change history:', error);
    return [];
  }
}

/**
 * Get current change count for user
 */
async function getUserChangeCount(userId) {
  try {
    const redis = getRedis();
    const userIdStr = String(userId);
    const count = await redis.get(`user:${userIdStr}:username_changes:24h`);
    return parseInt(count) || 0;
  } catch (error) {
    logger.error('Error getting user change count:', error);
    return 0;
  }
}

/**
 * Check if user is blocked
 */
async function isUserBlocked(userId) {
  try {
    const redis = getRedis();
    const userIdStr = String(userId);
    const blocked = await redis.get(`user:${userIdStr}:blocked_suspicious`);
    return !!blocked;
  } catch (error) {
    logger.error('Error checking user blocked status:', error);
    return false;
  }
}

/**
 * Manually unblock a user (admin function)
 */
async function unblockUser(userId) {
  try {
    const redis = getRedis();
    const userIdStr = String(userId);
    await redis.del(`user:${userIdStr}:blocked_suspicious`);
    await redis.del(`user:${userIdStr}:username_changes:24h`);
    await redis.del(`user:${userIdStr}:username_history`);

    logger.info('User unblocked manually', { userId: userIdStr });
    return true;
  } catch (error) {
    logger.error('Error unblocking user:', error);
    return false;
  }
}

/**
 * Create security logs table
 */
async function initSecurityLogsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_security_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_user_security_user_id ON user_security_logs(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_security_event_type ON user_security_logs(event_type)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_user_security_created_at ON user_security_logs(created_at)`);

    logger.info('Security logs table initialized');
  } catch (error) {
    logger.debug('Security logs table already exists or error:', error.message);
  }
}

module.exports = {
  usernameChangeDetectionMiddleware,
  getUserChangeHistory,
  getUserChangeCount,
  isUserBlocked,
  unblockUser,
  initSecurityLogsTable,
};