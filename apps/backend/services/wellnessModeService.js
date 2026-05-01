/**
 * wellnessModeService.js — self-imposed access restriction for recovery /
 * sober breaks. The user enables it with a duration (1d, 7d, 30d, indefinite).
 * Once active, the entitlement guard refuses access to non-whitelisted
 * resources and the frontend renders a wellness-only shell.
 *
 * Why "until" instead of a boolean: lets us pre-commit to a duration. A
 * boolean toggle is too easy to flip back during a craving — the whole point
 * is friction. We additionally enforce a 24h cooling-off window: clicking
 * "disable" sets disable_requested_at, and only after 24h has elapsed since
 * that timestamp will the disable actually succeed.
 *
 * Indefinite mode uses 'infinity'::timestamptz, which compares correctly with
 * NOW() in Postgres (always greater).
 */

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const COOLING_OFF_HOURS = 24;
const ALLOWED_DURATIONS_DAYS = new Set([1, 7, 30, null]); // null = indefinite

const WELLNESS_PATH_ALLOWLIST = [
  // Account / settings — user must be able to manage their own state
  /^\/api\/webapp\/wellness-mode(\/|$)/,
  /^\/api\/webapp\/me(\/|$)/,
  /^\/api\/webapp\/profile\/me(\/|$)/,
  /^\/api\/webapp\/settings(\/|$)/,
  /^\/api\/webapp\/notifications\/counts$/,        // bell badge for wellness-related notifs
  /^\/api\/webapp\/notifications$/,
  /^\/api\/webapp\/auth-status$/,
  /^\/api\/auth-status$/,

  // Wellness hangouts only — the controller filters by is_wellness=true
  /^\/api\/webapp\/hangouts\/wellness$/,
  /^\/api\/webapp\/hangouts\/groups\/[^/]+$/, // group detail — shell only shows wellness groups
  /^\/api\/webapp\/hangouts\/groups\/[^/]+\/join$/, // joining a wellness hangout
  /^\/api\/webapp\/hangouts\/groups\/[^/]+\/messages$/, // getMessages enforces is_wellness when wellness mode is active
  /^\/api\/webapp\/hangouts\/groups\/[^/]+\/members$/,

  // Cristina AI — wellness/support assistant
  /^\/api\/webapp\/cristina(\/|$)/,
  /^\/api\/cristina(\/|$)/,

  // Harm-reduction use tracker — always accessible so users can log even on break
  /^\/api\/webapp\/use-tracker(\/|$)/,

  // Educational / harm-reduction surfaces
  /^\/api\/webapp\/wellness\/library(\/|$)/,
  /^\/community-guidelines$/,
  /^\/safety$/,
  /^\/terms$/,
  /^\/privacy$/,

  // Static assets so the shell can render
  /^\/uploads\/avatars\//,
  /^\/assets\//,
  /^\/sw\.js$/,
];

function isPathAllowed(path) {
  return WELLNESS_PATH_ALLOWLIST.some(rx => rx.test(path));
}

/**
 * Check the current wellness state for a user. Returns:
 *   { active: bool, until: Date|null, indefinite: bool, disableRequestedAt: Date|null,
 *     hoursLeftUntilDisableAllowed: number|null }
 */
async function getStatus(userId) {
  const { rows } = await query(
    `SELECT wellness_mode_until, wellness_mode_disable_requested_at,
            wellness_days_accumulated
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return { active: false, until: null, indefinite: false, disableRequestedAt: null, hoursLeftUntilDisableAllowed: null, wellnessDaysAccumulated: 0 };

  const until = rows[0].wellness_mode_until;
  const disableRequested = rows[0].wellness_mode_disable_requested_at;
  const now = Date.now();

  // 'infinity' comes back from pg as the string 'infinity' or as Infinity-like Date depending on driver.
  // Treat it as still-active.
  const indefinite = until && (until === 'infinity' || (until instanceof Date && !isFinite(until.getTime())));
  const active = until !== null && (indefinite || new Date(until).getTime() > now);

  let hoursLeft = null;
  if (active && disableRequested) {
    const elapsedH = (now - new Date(disableRequested).getTime()) / 3_600_000;
    hoursLeft = Math.max(0, COOLING_OFF_HOURS - elapsedH);
  }

  return {
    active,
    until: indefinite ? null : (until ? new Date(until).toISOString() : null),
    indefinite,
    disableRequestedAt: disableRequested ? new Date(disableRequested).toISOString() : null,
    hoursLeftUntilDisableAllowed: hoursLeft,
    wellnessDaysAccumulated: rows[0].wellness_days_accumulated || 0,
  };
}

/**
 * Enable wellness mode for `durationDays`. null = indefinite. Cannot SHORTEN
 * an existing active session — only extend or maintain.
 */
async function enable(userId, durationDays) {
  if (!ALLOWED_DURATIONS_DAYS.has(durationDays === undefined ? null : durationDays)) {
    const err = new Error('Invalid duration. Allowed: 1, 7, 30, or null (indefinite).');
    err.status = 400;
    throw err;
  }

  // Clear any pending disable — re-enabling cancels a cooling-off countdown.
  // Stamp started_at only when beginning a fresh session (COALESCE keeps the
  // original start time if the user is just extending an active session).
  if (durationDays === null) {
    await query(
      `UPDATE users SET wellness_mode_until = 'infinity'::timestamptz,
                        wellness_mode_disable_requested_at = NULL,
                        wellness_mode_started_at = COALESCE(wellness_mode_started_at, NOW()),
                        updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  } else {
    // Use GREATEST so we never shorten an existing active window.
    await query(
      `UPDATE users SET wellness_mode_until = GREATEST(
                          COALESCE(wellness_mode_until, NOW()),
                          NOW() + ($2 || ' days')::interval),
                        wellness_mode_disable_requested_at = NULL,
                        wellness_mode_started_at = COALESCE(wellness_mode_started_at, NOW()),
                        updated_at = NOW()
       WHERE id = $1`,
      [userId, durationDays]
    );
  }
  logger.info('Wellness mode enabled', { userId, durationDays });
  return await getStatus(userId);
}

/**
 * Request to disable wellness mode. First call sets disable_requested_at;
 * subsequent calls (after COOLING_OFF_HOURS have elapsed) actually clear
 * wellness_mode_until.
 *
 * If the user previously committed to a duration (e.g., 30 days) that has not
 * yet expired AND it's not indefinite, we honor the original commitment —
 * the only way out before the duration ends is the cooling-off path.
 */
async function disable(userId) {
  const status = await getStatus(userId);
  if (!status.active) {
    return status; // already off
  }

  if (!status.disableRequestedAt) {
    // First click: arm the cooling-off timer
    await query(
      `UPDATE users SET wellness_mode_disable_requested_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    logger.info('Wellness mode disable requested (cooling-off started)', { userId });
    return await getStatus(userId);
  }

  if (status.hoursLeftUntilDisableAllowed > 0) {
    // Still in cooling-off window
    return status;
  }

  // Cooling-off elapsed — actually disable. Accumulate days from this session.
  await query(
    `UPDATE users SET wellness_mode_until = NULL,
                      wellness_mode_disable_requested_at = NULL,
                      wellness_days_accumulated = wellness_days_accumulated +
                        GREATEST(1, CEIL(EXTRACT(EPOCH FROM NOW() - COALESCE(wellness_mode_started_at, NOW())) / 86400)::int),
                      wellness_mode_started_at = NULL,
                      updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  logger.info('Wellness mode disabled (cooling-off completed)', { userId });
  return await getStatus(userId);
}

/**
 * Cancel a pending disable request — back out without waiting the full 24h.
 * Common path: user clicked "disable" during a craving, then thought about
 * it and wants to stay in mode.
 */
async function cancelDisable(userId) {
  await query(
    `UPDATE users SET wellness_mode_disable_requested_at = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
  logger.info('Wellness mode disable request cancelled', { userId });
  return await getStatus(userId);
}

/**
 * Cheap lookup used by the access guard on every request. Returns true iff
 * the user is currently in active wellness mode.
 */
async function isActive(userId) {
  if (!userId) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM users
       WHERE id = $1 AND wellness_mode_until IS NOT NULL
         AND (wellness_mode_until = 'infinity'::timestamptz OR wellness_mode_until > NOW())
       LIMIT 1`,
      [userId]
    );
    return rows.length > 0;
  } catch (err) {
    logger.error('wellnessMode.isActive failed', { userId, error: err.message });
    return false; // fail-open: don't lock users out on a DB blip
  }
}

module.exports = {
  COOLING_OFF_HOURS,
  isPathAllowed,
  isActive,
  getStatus,
  enable,
  disable,
  cancelDisable,
};
