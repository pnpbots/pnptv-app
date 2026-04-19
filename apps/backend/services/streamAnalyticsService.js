'use strict';

/**
 * streamAnalyticsService.js
 * Per-session stream analytics: start/end lifecycle, 30-second peak-viewer
 * sampling, tip totals JOINed from creator_earnings, and summary aggregates.
 *
 * Import path for callers in bot/api/socketHandlers.js:
 *   require('../../services/streamAnalyticsService')
 */

const { getPool } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Open a new session row when a creator's stream starts.
 *
 * @param {string} creatorId
 * @param {string} channelRef
 * @returns {Promise<number>} session id (BIGINT returned as JS string; safe to keep)
 */
async function startSession(creatorId, channelRef) {
  const { rows } = await getPool().query(
    `INSERT INTO stream_sessions (creator_id, channel_ref, started_at)
     VALUES ($1, $2, NOW())
     RETURNING id`,
    [String(creatorId), channelRef]
  );
  const sessionId = rows[0].id;
  logger.info('streamAnalytics: session started', { sessionId, creatorId, channelRef });
  return sessionId;
}

/**
 * Close a session and write final metrics.
 * tip totals are derived live from creator_earnings so we only write viewer counts here.
 *
 * @param {string|number} sessionId
 * @param {{ peakViewers?: number, uniqueViewers?: number }} metrics
 */
async function endSession(sessionId, { peakViewers = 0, uniqueViewers = null } = {}) {
  await getPool().query(
    `UPDATE stream_sessions
     SET ended_at      = NOW(),
         peak_viewers  = GREATEST(peak_viewers, $2),
         unique_viewers = $3
     WHERE id = $1`,
    [sessionId, peakViewers, uniqueViewers]
  );
  logger.info('streamAnalytics: session ended', { sessionId, peakViewers, uniqueViewers });
}

/**
 * Bump peak_viewers if currentCount exceeds the stored maximum.
 * Called by a 30-second interval timer in socketHandlers.
 *
 * @param {string|number} sessionId
 * @param {number} currentCount
 */
async function sampleViewers(sessionId, currentCount) {
  if (typeof currentCount !== 'number' || !isFinite(currentCount) || currentCount < 0) return;
  await getPool().query(
    `UPDATE stream_sessions
     SET peak_viewers = GREATEST(peak_viewers, $2)
     WHERE id = $1 AND ended_at IS NULL`,
    [sessionId, currentCount]
  );
}

/**
 * Recent sessions for a creator, with duration and tip totals joined from
 * creator_earnings.  Tips are matched on creator_id and created_at window
 * (between started_at and COALESCE(ended_at, NOW())).
 *
 * @param {string} creatorId
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
async function getCreatorSessions(creatorId, limit = 20) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const { rows } = await getPool().query(
    `SELECT
       ss.id,
       ss.channel_ref,
       ss.started_at,
       ss.ended_at,
       ss.peak_viewers,
       ss.unique_viewers,
       EXTRACT(EPOCH FROM (COALESCE(ss.ended_at, NOW()) - ss.started_at))::int AS duration_seconds,
       COALESCE(tips.total_tokens, 0) AS total_tips_tokens,
       COALESCE(tips.total_usd, 0)    AS total_tips_usd
     FROM stream_sessions ss
     LEFT JOIN LATERAL (
       SELECT
         SUM(ce.amount_gross)   AS total_usd,
         -- amount_gross is USD; tokens are stored 1-to-1 in pnp_tips.amount
         -- We join pnp_tips for the raw token sum
         (SELECT COALESCE(SUM(t.amount), 0)
          FROM pnp_tips t
          WHERE t.performer_id IN (
            SELECT id::text FROM performers WHERE user_id = ss.creator_id LIMIT 1
          )
          AND t.created_at BETWEEN ss.started_at AND COALESCE(ss.ended_at, NOW())
         ) AS total_tokens
       FROM creator_earnings ce
       WHERE ce.creator_id = ss.creator_id
         AND ce.created_at BETWEEN ss.started_at AND COALESCE(ss.ended_at, NOW())
     ) tips ON true
     WHERE ss.creator_id = $1
     ORDER BY ss.started_at DESC
     LIMIT $2`,
    [String(creatorId), safeLimit]
  );
  return rows;
}

/**
 * Aggregate stats for the last N days.
 *
 * @param {string} creatorId
 * @param {number} [days=30]
 * @returns {Promise<object>}
 */
async function getCreatorSummary(creatorId, days = 30) {
  const safeDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const { rows } = await getPool().query(
    `SELECT
       COUNT(*)::int                                                    AS total_sessions,
       ROUND(
         SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))) / 3600.0,
         2
       )::float                                                         AS total_hours_live,
       ROUND(AVG(peak_viewers), 1)::float                              AS avg_peak_viewers,
       COALESCE(
         (SELECT SUM(t.amount)
          FROM pnp_tips t
          WHERE t.performer_id IN (
            SELECT id::text FROM performers WHERE user_id = ss_inner.creator_id LIMIT 1
          )
          AND t.created_at >= NOW() - ($2 || ' days')::interval
         ), 0
       )::int                                                           AS total_tips_tokens,
       COALESCE(
         (SELECT SUM(ce.amount_gross)
          FROM creator_earnings ce
          WHERE ce.creator_id = ss_inner.creator_id
            AND ce.created_at >= NOW() - ($2 || ' days')::interval
         ), 0
       )::numeric(10,2)                                                 AS total_tips_usd
     FROM stream_sessions ss_inner
     WHERE ss_inner.creator_id = $1
       AND ss_inner.started_at >= NOW() - ($2 || ' days')::interval`,
    [String(creatorId), safeDays]
  );
  return rows[0] || {
    total_sessions: 0,
    total_hours_live: 0,
    avg_peak_viewers: 0,
    total_tips_tokens: 0,
    total_tips_usd: 0,
  };
}

module.exports = { startSession, endSession, sampleViewers, getCreatorSessions, getCreatorSummary };
