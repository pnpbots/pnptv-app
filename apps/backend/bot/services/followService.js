'use strict';

const { getPool, query } = require('../../config/postgres');
const logger = require('../../utils/logger');

// Accounts every user must follow — cannot be unfollowed
const ENFORCED_FOLLOW_IDS = ['8552451957', '8599671840']; // @pnptvadmin, @SantinoFurioso

/**
 * Check if a target user ID is an enforced-follow account.
 */
function isEnforcedFollow(targetId) {
  return ENFORCED_FOLLOW_IDS.includes(String(targetId));
}

/**
 * Ensure a user follows all enforced accounts.
 * Uses transactions to prevent counter drift from partial failures.
 * Idempotent — safe to call on every login.
 */
async function enforceDefaultFollows(userId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    for (const targetId of ENFORCED_FOLLOW_IDS) {
      if (String(userId) === String(targetId)) continue;
      // Skip if target user doesn't exist (prevents FK violation)
      const { rowCount: exists } = await client.query('SELECT 1 FROM users WHERE id = $1', [targetId]);
      if (!exists) continue;
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        'INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT (follower_id, following_id) DO NOTHING',
        [userId, targetId]
      );
      if (rowCount > 0) {
        await client.query('UPDATE users SET following_count = following_count + 1 WHERE id = $1', [userId]);
        await client.query('UPDATE users SET followers_count = followers_count + 1 WHERE id = $1', [targetId]);
      }
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('enforceDefaultFollows error', err);
  } finally {
    client.release();
  }
}

module.exports = { ENFORCED_FOLLOW_IDS, isEnforcedFollow, enforceDefaultFollows };
