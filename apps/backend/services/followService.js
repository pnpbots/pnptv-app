'use strict';

const { getPool, query } = require('../config/postgres');
const logger = require('../utils/logger');

// Accounts every user must follow — cannot be unfollowed
const ENFORCED_FOLLOW_IDS = ['8552451957', '8599671840', 'cristina-ai', '66127d88-817a-445b-a398-81d22d2587c1']; // @pnptv, @SantinoFurioso, Cristina AI, @PNPLATINOBOY

/**
 * Check if a target user ID is an enforced-follow account.
 */
function isEnforcedFollow(targetId) {
  return ENFORCED_FOLLOW_IDS.includes(String(targetId));
}

/**
 * Ensure a user follows all enforced accounts.
 *
 * Single-transaction CTE: all 4 inserts + counter updates happen in one
 * round-trip. Prior implementation issued ~24 round-trips per login (1
 * existence check + BEGIN/INSERT/UPDATE/UPDATE/COMMIT × 4 targets).
 * Idempotent via ON CONFLICT DO NOTHING; counters only bump for rows
 * that actually inserted.
 */
async function enforceDefaultFollows(userId) {
  const targets = ENFORCED_FOLLOW_IDS.filter(id => String(id) !== String(userId));
  if (targets.length === 0) return;

  // Build VALUES list as ($2),($3),($4)... so we can pass userId as $1 and
  // targets as the rest in a parameterized array — no string interpolation.
  const targetPlaceholders = targets.map((_, i) => `($${i + 2})`).join(',');

  try {
    await query(`
      WITH targets(target_id) AS (VALUES ${targetPlaceholders}),
      live_targets AS (
        SELECT t.target_id FROM targets t
        JOIN users u ON u.id = t.target_id
      ),
      inserted AS (
        INSERT INTO user_follows (follower_id, following_id)
        SELECT $1, target_id FROM live_targets
        ON CONFLICT (follower_id, following_id) DO NOTHING
        RETURNING following_id
      ),
      bump_followers AS (
        UPDATE users SET followers_count = followers_count + 1
        WHERE id IN (SELECT following_id FROM inserted)
        RETURNING id
      )
      UPDATE users SET following_count = following_count + (SELECT COUNT(*)::int FROM inserted)
      WHERE id = $1
    `, [userId, ...targets]);
  } catch (err) {
    logger.error('enforceDefaultFollows error', err);
  }
}

module.exports = { ENFORCED_FOLLOW_IDS, isEnforcedFollow, enforceDefaultFollows };
