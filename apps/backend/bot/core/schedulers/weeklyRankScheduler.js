'use strict';

/**
 * Weekly group activity ranking + reward + strike system.
 *
 * Every Monday 08:00 UTC (03:00 America/Bogota) for each linked Telegram group:
 *   1. Compute points earned during the prior ISO week (Mon 00:00 → Sun 23:59 UTC).
 *   2. Rank all users with at least 1 point.
 *   3. Top ceil(30% of ranked_participants) → grant 7-day PRIME entitlement,
 *      write group_activity_ranks row with prime_awarded=true.
 *   4. Any user who has EVER posted in the group (group_points history) but had
 *      0 points this week → +1 strike in group_activity_strikes.
 *      Users who post again reset their streak.
 *   5. Any user reaching 2 consecutive-zero weeks → kick from Telegram group +
 *      remove from hangout_group_members. Strike row is retained for audit.
 *   6. Post a public announcement in the group.
 *
 * Safeguards:
 *   - Admins (creator/administrator) are exempt from strikes and kicks.
 *   - Users already granted lifetime prime are skipped for the timed prime grant
 *     (getting a 7-day prime on top of lifetime is a no-op but noisy — skip).
 *   - Idempotent per (chat_id, week_start): re-running the same week is a no-op.
 */

const cron = require('node-cron');
const logger = require('../../../utils/logger');
const { query, getClient } = require('../../../config/postgres');
const groupManagerService = require('../../../services/groupManagerService');
const EntitlementModel = require('../../../models/entitlementModel');

const CRON_EXPR = '0 8 * * 1'; // Monday 08:00 UTC = 03:00 COT
const CRON_TZ = 'UTC';

const REWARD_PERCENT = 0.30;         // top 30% get PRIME
const REWARD_DAYS = 7;               // duration of the PRIME grant
const STRIKES_TO_KICK = 2;           // 2 consecutive zero-activity weeks → kicked

// Returns { start: Date, end: Date, weekStartStr: 'YYYY-MM-DD' } for the ISO week
// that ENDED most recently (i.e. last Monday 00:00 UTC through last Sunday 23:59:59 UTC).
function getPriorWeekWindow(now = new Date()) {
  const d = new Date(now.getTime());
  // Move to UTC Monday of THIS week
  const day = d.getUTCDay(); // 0=Sun, 1=Mon
  const daysSinceMonday = (day + 6) % 7; // Mon=0, Sun=6
  const thisMonday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thisMonday.setUTCDate(thisMonday.getUTCDate() - daysSinceMonday);
  const priorMonday = new Date(thisMonday);
  priorMonday.setUTCDate(priorMonday.getUTCDate() - 7);
  const priorSundayEnd = new Date(thisMonday.getTime() - 1);
  return {
    start: priorMonday,
    end: priorSundayEnd,
    weekStartStr: priorMonday.toISOString().slice(0, 10),
  };
}

async function alreadyRanThisWeek(chatId, weekStartStr) {
  const r = await query(
    `SELECT 1 FROM group_activity_ranks
      WHERE telegram_chat_id = $1 AND week_start = $2 LIMIT 1`,
    [String(chatId), weekStartStr]
  );
  return r.rows.length > 0;
}

// Users who have EVER posted in this group. Used as the "known member" universe
// for strike detection — the bot API can't enumerate all Telegram members.
async function getKnownMembers(chatId) {
  const r = await query(
    `SELECT DISTINCT pnptv_user_id AS user_id,
                     MAX(telegram_user_id) AS telegram_user_id,
                     MAX(username) AS username
       FROM group_points
      WHERE telegram_chat_id = $1
      GROUP BY pnptv_user_id`,
    [String(chatId)]
  );
  return r.rows;
}

async function getWeeklyPoints(chatId, weekStart, weekEnd) {
  const r = await query(
    `SELECT pnptv_user_id AS user_id,
            MAX(telegram_user_id) AS telegram_user_id,
            MAX(username) AS username,
            SUM(points)::int AS points
       FROM group_points
      WHERE telegram_chat_id = $1
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY pnptv_user_id
      HAVING SUM(points) > 0
      ORDER BY SUM(points) DESC, MIN(created_at) ASC`,
    [String(chatId), weekStart, weekEnd]
  );
  return r.rows;
}

async function recordRank(row) {
  await query(
    `INSERT INTO group_activity_ranks
       (telegram_chat_id, user_id, telegram_user_id, username, week_start,
        points, rank_position, total_ranked, prime_awarded, prime_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (telegram_chat_id, user_id, week_start) DO UPDATE
       SET points = EXCLUDED.points,
           rank_position = EXCLUDED.rank_position,
           total_ranked = EXCLUDED.total_ranked,
           prime_awarded = EXCLUDED.prime_awarded,
           prime_expires_at = EXCLUDED.prime_expires_at,
           updated_at = NOW()`,
    [
      String(row.telegram_chat_id),
      String(row.user_id),
      row.telegram_user_id ? String(row.telegram_user_id) : null,
      row.username || null,
      row.week_start,
      row.points || 0,
      row.rank_position || null,
      row.total_ranked || null,
      !!row.prime_awarded,
      row.prime_expires_at || null,
    ]
  );
}

async function upsertStrike(chatId, member, weekStartStr) {
  // First strike sets consecutive=1 + first/last week to weekStartStr.
  // If the previous strike's last_zero_week_start is EXACTLY one week before
  // this weekStartStr, increment; otherwise reset to 1.
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, consecutive_zero_weeks, last_zero_week_start, first_zero_week_start
         FROM group_activity_strikes
        WHERE telegram_chat_id = $1 AND user_id = $2
        FOR UPDATE`,
      [String(chatId), String(member.user_id)]
    );

    const priorWeek = new Date(weekStartStr + 'T00:00:00Z');
    priorWeek.setUTCDate(priorWeek.getUTCDate() - 7);
    const priorWeekStr = priorWeek.toISOString().slice(0, 10);

    let newConsecutive = 1;
    let firstZeroWeek = weekStartStr;

    if (existing.rows.length > 0) {
      const existingRow = existing.rows[0];
      const last = existingRow.last_zero_week_start.toISOString().slice(0, 10);
      if (last === priorWeekStr) {
        newConsecutive = (existingRow.consecutive_zero_weeks || 0) + 1;
        // Preserve original first_zero_week_start from the locked row (no second SELECT needed)
        firstZeroWeek = existingRow.first_zero_week_start.toISOString().slice(0, 10);
      } else if (last === weekStartStr) {
        // Same week re-processed — no change
        newConsecutive = existingRow.consecutive_zero_weeks;
        firstZeroWeek = existingRow.first_zero_week_start.toISOString().slice(0, 10);
      }
      // else: gap in weeks (they were active in-between) → reset to 1
    }

    await client.query(
      `INSERT INTO group_activity_strikes
         (telegram_chat_id, user_id, telegram_user_id, username,
          consecutive_zero_weeks, last_zero_week_start, first_zero_week_start)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (telegram_chat_id, user_id) DO UPDATE
         SET consecutive_zero_weeks  = EXCLUDED.consecutive_zero_weeks,
             last_zero_week_start    = EXCLUDED.last_zero_week_start,
             first_zero_week_start   = CASE
               WHEN group_activity_strikes.consecutive_zero_weeks = 0
                 OR EXCLUDED.consecutive_zero_weeks = 1
               THEN EXCLUDED.first_zero_week_start
               ELSE group_activity_strikes.first_zero_week_start
             END,
             telegram_user_id        = COALESCE(EXCLUDED.telegram_user_id, group_activity_strikes.telegram_user_id),
             username                = COALESCE(EXCLUDED.username, group_activity_strikes.username),
             updated_at              = NOW()`,
      [
        String(chatId),
        String(member.user_id),
        member.telegram_user_id ? String(member.telegram_user_id) : null,
        member.username || null,
        newConsecutive,
        weekStartStr,
        firstZeroWeek,
      ]
    );
    await client.query('COMMIT');
    return newConsecutive;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function resetStrike(chatId, userId) {
  // Called when a user is a winner or had activity — clear their streak.
  await query(
    `UPDATE group_activity_strikes
        SET consecutive_zero_weeks = 0, updated_at = NOW()
      WHERE telegram_chat_id = $1 AND user_id = $2 AND consecutive_zero_weeks > 0`,
    [String(chatId), String(userId)]
  );
}

async function kickFromTelegram(telegram, chatId, telegramUserId) {
  try {
    // Ban then immediately unban = kick without permanent ban (Telegram convention).
    await telegram.banChatMember(Number(chatId), Number(telegramUserId));
    await telegram.unbanChatMember(Number(chatId), Number(telegramUserId), {
      only_if_banned: true,
    });
    return true;
  } catch (err) {
    logger.warn('weeklyRankScheduler: Telegram kick failed — bot may not be admin', {
      chatId,
      userId: telegramUserId,
      error: err.message,
      action: 'Check bot admin status in group and re-add if needed',
    });
    return false;
  }
}

async function removeFromHangout(telegramChatId, userId) {
  try {
    const grpRes = await query(
      `SELECT id FROM hangout_groups WHERE telegram_chat_id = $1 LIMIT 1`,
      [String(telegramChatId)]
    );
    const hangoutId = grpRes.rows[0]?.id;
    if (!hangoutId) return false;

    const del = await query(
      `DELETE FROM hangout_group_members
        WHERE group_id = $1 AND user_id = $2`,
      [hangoutId, String(userId)]
    );
    return del.rowCount > 0;
  } catch (err) {
    logger.warn('[WeeklyRank] Hangout removal failed', {
      telegramChatId, userId, error: err.message,
    });
    return false;
  }
}

async function markKicked(chatId, userId, tgKicked, hangoutKicked) {
  await query(
    `UPDATE group_activity_strikes
        SET kicked_at = CASE WHEN $3 THEN NOW() ELSE kicked_at END,
            hangout_removed_at = CASE WHEN $4 THEN NOW() ELSE hangout_removed_at END,
            updated_at = NOW()
      WHERE telegram_chat_id = $1 AND user_id = $2`,
    [String(chatId), String(userId), tgKicked, hangoutKicked]
  );
}

async function processGroup(telegram, group, weekWindow) {
  const chatId = String(group.telegram_chat_id);
  const weekStartStr = weekWindow.weekStartStr;

  if (await alreadyRanThisWeek(chatId, weekStartStr)) {
    logger.info('[WeeklyRank] already ran this week, skipping', {
      chatId, name: group.name, weekStartStr,
    });
    return;
  }

  const weeklyPoints = await getWeeklyPoints(chatId, weekWindow.start, weekWindow.end);
  const knownMembers = await getKnownMembers(chatId);

  // Build winner set (top 30%, min 1 if any active)
  const activeCount = weeklyPoints.length;
  const winnerCount = activeCount === 0 ? 0 : Math.max(1, Math.ceil(activeCount * REWARD_PERCENT));
  const winners = weeklyPoints.slice(0, winnerCount);
  const winnerIds = new Set(winners.map((w) => String(w.user_id)));

  // ── Pre-fetch all lifetime-prime user IDs in one query (avoids N+1) ────────
  let lifetimePrimeSet = new Set();
  try {
    const { rows: lifetimePrimeRows } = await query(
      `SELECT DISTINCT user_id FROM user_entitlements
        WHERE add_on_id = 'prime' AND is_lifetime = true AND is_consumed = false`
    );
    lifetimePrimeSet = new Set(lifetimePrimeRows.map((r) => String(r.user_id)));
  } catch (err) {
    logger.warn('[WeeklyRank] could not pre-fetch lifetime prime set', { error: err.message });
  }

  // ── Grant prime + record rank ──────────────────────────────────────────────
  const grantedWinners = [];
  for (let i = 0; i < weeklyPoints.length; i++) {
    const row = weeklyPoints[i];
    const isWinner = i < winnerCount;
    let primeExpires = null;
    let primeAwarded = false;

    if (isWinner) {
      const alreadyLifetime = lifetimePrimeSet.has(String(row.user_id));
      if (!alreadyLifetime) {
        try {
          const ent = await EntitlementModel.grantEntitlement(row.user_id, 'prime', {
            isLifetime: false,
            durationDays: REWARD_DAYS,
            source: 'weekly_group_reward',
            actorId: 'system',
            reason: `Top-${winnerCount} weekly ranking in group ${chatId} (${weekStartStr})`,
          });
          primeExpires = ent?.expires_at || new Date(Date.now() + REWARD_DAYS * 86400000);
          primeAwarded = true;
          grantedWinners.push({ ...row, primeExpires });
        } catch (err) {
          logger.warn('[WeeklyRank] prime grant failed', {
            userId: row.user_id, error: err.message,
          });
        }
      } else {
        // Lifetime already — still mark them as "winner" for the announcement
        primeAwarded = true;
        grantedWinners.push({ ...row, primeExpires: null, lifetime: true });
      }
    }

    await recordRank({
      telegram_chat_id: chatId,
      user_id: row.user_id,
      telegram_user_id: row.telegram_user_id,
      username: row.username,
      week_start: weekStartStr,
      points: row.points,
      rank_position: i + 1,
      total_ranked: activeCount,
      prime_awarded: primeAwarded,
      prime_expires_at: primeExpires,
    });

    // Any active user gets their strike counter reset.
    await resetStrike(chatId, row.user_id).catch(() => {});
  }

  // ── Pre-fetch all group admins in one Telegram API call (avoids N+1) ───────
  let adminIds = new Set();
  try {
    const admins = await telegram.getChatAdministrators(Number(chatId));
    adminIds = new Set(admins.map((a) => String(a.user.id)));
  } catch (e) {
    logger.warn('weeklyRankScheduler: could not fetch admins', {
      chatId, error: e.message,
    });
  }

  // ── Strikes for known members with zero activity ──────────────────────────
  const activeUserIds = new Set(weeklyPoints.map((r) => String(r.user_id)));
  const kicked = [];
  for (const m of knownMembers) {
    if (activeUserIds.has(String(m.user_id))) continue;

    // Skip admins — never strike or kick them.
    if (m.telegram_user_id && adminIds.has(String(m.telegram_user_id))) continue;

    let consecutive;
    try {
      consecutive = await upsertStrike(chatId, m, weekStartStr);
    } catch (err) {
      logger.warn('[WeeklyRank] strike upsert failed', {
        chatId, userId: m.user_id, error: err.message,
      });
      continue;
    }

    if (consecutive >= STRIKES_TO_KICK && m.telegram_user_id) {
      const tgKicked = await kickFromTelegram(telegram, chatId, m.telegram_user_id);
      const hangoutKicked = await removeFromHangout(chatId, m.user_id);
      await markKicked(chatId, m.user_id, tgKicked, hangoutKicked).catch(() => {});
      if (tgKicked || hangoutKicked) {
        kicked.push({ ...m, tgKicked, hangoutKicked });
      }
    }
  }

  // ── Announcement ──────────────────────────────────────────────────────────
  try {
    const lines = [];
    lines.push(`🏆 *Weekly Community Rank — ${group.name}*`);
    lines.push(`_Week of ${weekStartStr}_`);
    lines.push('');
    if (grantedWinners.length > 0) {
      lines.push(`Top ${winnerCount} active members — each earns *7 days of PRIME* 💜`);
      lines.push('');
      grantedWinners.slice(0, 10).forEach((w, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
        const who = w.username ? `@${w.username}` : `Member`;
        lines.push(`${medal} ${who} — *${w.points} pts*`);
      });
      if (grantedWinners.length > 10) {
        lines.push(`…and ${grantedWinners.length - 10} more.`);
      }
      lines.push('');
    } else {
      lines.push('No active members this week — the room was quiet.');
      lines.push('');
    }
    lines.push('Post, share, react — every message counts toward next week\'s ranking.');
    lines.push('Two weeks with zero activity = auto-removed from the group and the hangout.');
    lines.push('');
    lines.push('_Ranking powered by [PNPtv!](https://pnptv.app)_');

    await telegram.sendMessage(Number(chatId), lines.join('\n'), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    logger.warn('[WeeklyRank] announcement failed', {
      chatId, error: err.message,
    });
  }

  logger.info('[WeeklyRank] processed group', {
    chatId,
    name: group.name,
    weekStart: weekStartStr,
    activeMembers: activeCount,
    winners: winnerCount,
    kicked: kicked.length,
  });
}

async function runWeeklyRank(telegram) {
  if (!telegram) {
    logger.warn('[WeeklyRank] no telegram instance available — skipping');
    return;
  }

  let groups;
  try {
    groups = await groupManagerService.getLinkedGroups();
  } catch (err) {
    logger.error('[WeeklyRank] failed to load linked groups', { error: err.message });
    return;
  }
  if (!groups.length) {
    logger.info('[WeeklyRank] no linked groups, skipping');
    return;
  }

  const weekWindow = getPriorWeekWindow();
  logger.info('[WeeklyRank] starting run', {
    groups: groups.length,
    weekStart: weekWindow.weekStartStr,
  });

  for (const g of groups) {
    try {
      await processGroup(telegram, g, weekWindow);
      await new Promise((r) => setTimeout(r, 1500)); // gentle Telegram pacing
    } catch (err) {
      logger.error('[WeeklyRank] group failed', {
        chatId: g.telegram_chat_id, error: err.message,
      });
    }
  }

  logger.info('[WeeklyRank] run complete');
}

function startWeeklyRankScheduler(botInstance) {
  if (!cron.validate(CRON_EXPR)) {
    logger.error('[WeeklyRank] invalid cron expression', { cron: CRON_EXPR });
    return;
  }
  cron.schedule(CRON_EXPR, () => {
    runWeeklyRank(botInstance?.telegram).catch((err) =>
      logger.error('[WeeklyRank] scheduled run failed', { error: err.message })
    );
  }, { timezone: CRON_TZ });

  logger.info('[WeeklyRank] scheduler started', {
    cron: CRON_EXPR, timezone: CRON_TZ,
  });
}

module.exports = {
  startWeeklyRankScheduler,
  runWeeklyRank,
  getPriorWeekWindow,
  processGroup,
};
