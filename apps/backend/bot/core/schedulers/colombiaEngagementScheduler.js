'use strict';

const { query, getPool } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

// Engagement quota: 10 pts/week
// post = 5 pts (max 10 from posts), hangout msg = 1 pt (max 5), reaction = 1 pt (max 3)
const WEEKLY_QUOTA = 10;
const MAX_POST_PTS = 10;
const MAX_MSG_PTS = 5;
const MAX_REACTION_PTS = 3;

class ColombiaEngagementScheduler {
  constructor() {
    this.CHECK_INTERVAL = 24 * 60 * 60 * 1000; // daily
    this._timer = null;
    // Prevent enforcement from running more than once per week_start string
    // within the same process lifetime (survives bot restarts gracefully — a second
    // run on the same Monday re-evaluates, but revoke/warn writes are idempotent now).
    this._lastEnforcedWeek = null;
  }

  start() {
    this.runChecks().catch((err) => logger.error('[ColombiaEngagement] initial run failed', { error: err.message }));
    this._timer = setInterval(() => {
      this.runChecks().catch((err) => logger.error('[ColombiaEngagement] scheduled run failed', { error: err.message }));
    }, this.CHECK_INTERVAL);
    logger.info('[ColombiaEngagement] scheduler started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async runChecks() {
    await this._grantPendingPrime();

    // Weekly enforcement runs on Mondays (COT = UTC-5)
    // nowCOT shifts the UTC clock back 5h so getUTCDay() reads the COT day of week.
    const nowCOT = new Date(Date.now() - 5 * 60 * 60 * 1000);
    if (nowCOT.getUTCDay() === 1) {
      const weekStart = this._cotWeekStart(nowCOT);
      if (this._lastEnforcedWeek === weekStart) {
        logger.info('[ColombiaEngagement] enforcement already ran for this week, skipping', { weekStart });
        return;
      }
      await this._enforceWeeklyEngagement(weekStart);
      this._lastEnforcedWeek = weekStart;
    }
  }

  // Returns the YYYY-MM-DD of last Monday in COT for the given COT date object.
  _cotWeekStart(nowCOT) {
    const d = new Date(nowCOT);
    // Go back to Monday (day 1)
    const day = d.getUTCDay(); // 1 = Monday
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().split('T')[0];
  }

  /**
   * Auto-grant PRIME for CO socios users who now meet photo + 3-post requirements.
   */
  async _grantPendingPrime() {
    const { rows: pending } = await query(
      `SELECT ilu.user_id, ilu.pending_prime_hours, ilu.code
       FROM invite_link_uses ilu
       JOIN invite_links il ON il.code = ilu.code
       WHERE il.co_only = true
         AND ilu.pending_prime_hours IS NOT NULL
         AND ilu.pending_prime_hours > 0`,
    );

    for (const row of pending) {
      try {
        const { rows: userRows } = await query(
          `SELECT u.photo_file_id,
             (SELECT COUNT(*)::int FROM social_posts WHERE user_id = $1::text AND is_deleted = false) AS post_count
           FROM users u WHERE u.id = $1::text`,
          [row.user_id],
        );
        if (!userRows[0]) continue;
        const { photo_file_id, post_count } = userRows[0];
        if (!photo_file_id || post_count < 3) continue;

        const client = await getPool().connect();
        try {
          await client.query('BEGIN');

          // Lock the use row to prevent race with claimPendingPrime()
          await client.query(
            `SELECT 1 FROM invite_link_uses WHERE code = $1 AND user_id = $2 AND pending_prime_hours IS NOT NULL FOR UPDATE`,
            [row.code, row.user_id],
          );

          // Re-check pending still set (may have been claimed concurrently)
          const { rows: recheck } = await client.query(
            `SELECT pending_prime_hours FROM invite_link_uses WHERE code = $1 AND user_id = $2`,
            [row.code, row.user_id],
          );
          if (!recheck[0]?.pending_prime_hours) {
            await client.query('ROLLBACK');
            continue; // already claimed
          }

          await client.query(
            `INSERT INTO user_entitlements (user_id, add_on_id, is_lifetime, expires_at, auto_renew, grant_source)
             VALUES ($1, 'prime', false, NOW() + ($2 || ' hours')::interval, false, 'colombia_socios')
             ON CONFLICT (user_id, add_on_id, creator_id) WHERE creator_id IS NULL
             DO UPDATE SET
               expires_at = CASE
                 WHEN user_entitlements.is_lifetime THEN user_entitlements.expires_at
                 WHEN user_entitlements.expires_at IS NOT NULL AND user_entitlements.expires_at > NOW()
                   THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
                 ELSE EXCLUDED.expires_at
               END,
               is_consumed = false,
               updated_at = NOW(),
               grant_source = CASE
                 WHEN user_entitlements.source_payment_id IS NOT NULL
                   OR user_entitlements.stripe_subscription_id IS NOT NULL
                   OR user_entitlements.source_plan_id IS NOT NULL
                 THEN user_entitlements.grant_source
                 ELSE 'colombia_socios'
               END
             WHERE NOT user_entitlements.is_lifetime`,
            [row.user_id, String(row.pending_prime_hours)],
          );

          await client.query(
            `UPDATE invite_link_uses SET pending_prime_hours = NULL WHERE code = $1 AND user_id = $2`,
            [row.code, row.user_id],
          );
          await client.query('COMMIT');
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (_) { /* best-effort */ }
          throw err;
        } finally {
          client.release();
        }

        try {
          const EntitlementAccessService = require('../../../services/entitlementAccessService');
          await EntitlementAccessService.recomputeUserTier(row.user_id);
          await EntitlementAccessService.invalidateCache(row.user_id);
        } catch (_) { /* non-critical */ }

        logger.info('[ColombiaEngagement] PRIME auto-granted', { userId: row.user_id, hours: row.pending_prime_hours });
      } catch (err) {
        logger.error('[ColombiaEngagement] PRIME grant failed', { userId: row.user_id, error: err.message });
      }
    }
  }

  /**
   * Weekly enforcement: warn or revoke PRIME for socios who missed engagement quota.
   * Runs on Mondays (COT). Evaluates the previous calendar week (Mon–Sun COT).
   * Only revokes PRIME rows with grant_source='colombia_socios' — paid PRIME is never touched.
   */
  async _enforceWeeklyEngagement(weekStart) {
    // Last week window in UTC (COT+5h offset)
    // weekStart is the CURRENT Monday in COT. "Last week" = 7 days before that.
    const currentMondayCOT = new Date(weekStart + 'T05:00:00Z'); // 00:00 COT = 05:00 UTC
    const lastMondayCOT = new Date(currentMondayCOT.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastSundayCOT = new Date(currentMondayCOT.getTime());
    const lastWeekStart = lastMondayCOT.toISOString().split('T')[0];

    logger.info('[ColombiaEngagement] running weekly enforcement', { evaluatingWeek: lastWeekStart });

    // All CO socios users who have claimed their PRIME (pending_prime_hours IS NULL)
    const { rows: socios } = await query(
      `SELECT DISTINCT u.id AS user_id
       FROM users u
       JOIN invite_link_uses ilu ON ilu.user_id = u.id
       JOIN invite_links il ON il.code = ilu.code
       JOIN user_entitlements ue ON ue.user_id = u.id
         AND ue.add_on_id = 'prime'
         AND NOT ue.is_consumed
         AND ue.grant_source = 'colombia_socios'
       WHERE il.co_only = true
         AND ilu.pending_prime_hours IS NULL
         AND (ue.is_lifetime OR ue.expires_at > NOW())`,
    );

    logger.info('[ColombiaEngagement] checking', { socioCount: socios.length, week: lastWeekStart });

    for (const { user_id } of socios) {
      try {
        const { rows: stats } = await query(
          `SELECT
             LEAST((SELECT COUNT(*)::int FROM social_posts WHERE user_id = $1::text AND created_at >= $2 AND created_at < $3 AND is_deleted = false) * 5, $4) AS post_pts,
             LEAST((SELECT COUNT(*)::int FROM chat_messages WHERE user_id = $1::text AND created_at >= $2 AND created_at < $3 AND is_deleted = false), $5) AS msg_pts,
             LEAST((SELECT COUNT(*)::int FROM post_reactions WHERE user_id = $1::text AND created_at >= $2 AND created_at < $3), $6) AS reaction_pts`,
          [user_id, lastMondayCOT.toISOString(), lastSundayCOT.toISOString(), MAX_POST_PTS, MAX_MSG_PTS, MAX_REACTION_PTS],
        );

        const { post_pts, msg_pts, reaction_pts } = stats[0];
        const totalPts = (post_pts || 0) + (msg_pts || 0) + (reaction_pts || 0);

        // Upsert engagement log
        await query(
          `INSERT INTO colombia_engagement_log (user_id, week_start, post_points, msg_points, reaction_points)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, week_start) DO UPDATE SET
             post_points = EXCLUDED.post_points,
             msg_points = EXCLUDED.msg_points,
             reaction_points = EXCLUDED.reaction_points,
             updated_at = NOW()`,
          [user_id, lastWeekStart, post_pts || 0, msg_pts || 0, reaction_pts || 0],
        );

        if (totalPts >= WEEKLY_QUOTA) {
          await query(
            `UPDATE colombia_engagement_log SET warned_at = NULL WHERE user_id = $1 AND week_start = $2`,
            [user_id, lastWeekStart],
          );
          continue;
        }

        // Check if warned the week before last (consecutive miss = revoke)
        const prevWeekMonday = new Date(lastMondayCOT.getTime() - 7 * 24 * 60 * 60 * 1000);
        const prevWeekStart = prevWeekMonday.toISOString().split('T')[0];
        const { rows: prevLog } = await query(
          `SELECT warned_at FROM colombia_engagement_log WHERE user_id = $1 AND week_start = $2`,
          [user_id, prevWeekStart],
        );

        if (prevLog[0]?.warned_at) {
          // Two consecutive misses — revoke ONLY socios-granted PRIME
          await query(
            `UPDATE user_entitlements SET is_consumed = true, updated_at = NOW()
             WHERE user_id = $1 AND add_on_id = 'prime' AND NOT is_lifetime AND grant_source = 'colombia_socios'`,
            [user_id],
          );
          await query(
            `UPDATE colombia_engagement_log SET prime_revoked_at = NOW() WHERE user_id = $1 AND week_start = $2`,
            [user_id, lastWeekStart],
          );
          try {
            const EntitlementAccessService = require('../../../services/entitlementAccessService');
            await EntitlementAccessService.recomputeUserTier(user_id);
            await EntitlementAccessService.invalidateCache(user_id);
          } catch (_) { /* non-critical */ }
          logger.info('[ColombiaEngagement] PRIME revoked (2 consecutive misses)', { userId: user_id, points: totalPts, week: lastWeekStart });
        } else {
          // First miss — record warning
          await query(
            `UPDATE colombia_engagement_log SET warned_at = NOW() WHERE user_id = $1 AND week_start = $2`,
            [user_id, lastWeekStart],
          );
          logger.info('[ColombiaEngagement] Warning recorded (quota missed)', { userId: user_id, points: totalPts, week: lastWeekStart });
        }
      } catch (err) {
        logger.error('[ColombiaEngagement] enforcement failed for user', { userId: user_id, error: err.message });
      }
    }
  }
}

module.exports = ColombiaEngagementScheduler;
