'use strict';

const { query } = require('../utils/db');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Allowed enum values for validation
// ---------------------------------------------------------------------------
const VALID_QUALITY_PRESETS = ['360p', '480p', '720p', '1080p'];
const VALID_FPS = [24, 30, 60];
const VALID_FILTER_PRESETS = ['None', 'Vivid', 'Warm', 'Cool', 'B&W', 'Cinematic', 'Night', 'Glow'];

// ---------------------------------------------------------------------------
// Default settings — mirrors the DB column defaults so the frontend always
// receives the same shape regardless of whether a row exists yet.
// ---------------------------------------------------------------------------
const DEFAULTS = {
  quality_preset:    '720p',
  fps:               30,
  auto_reconnect:    true,
  low_latency:       true,
  hardware_accel:    false,
  local_record:      false,
  filter_preset:     'None',
  filter_brightness: 0,
  filter_contrast:   0,
  filter_saturation: 0,
  filter_warmth:     0,
  filter_sharpness:  0,
  beauty_mode:       false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp an integer value between min and max (inclusive).
 * Falls back to the provided default if the value is not a finite number.
 *
 * @param {*}      val
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate and sanitize raw settings from the request body.
 * Only recognised keys are included in the returned object.
 * Invalid enum values are silently reverted to defaults.
 *
 * @param {object} raw - req.body (may contain any keys)
 * @returns {object} - sanitized settings ready for upsert
 */
function sanitize(raw) {
  const s = {};

  if (raw.quality_preset !== undefined) {
    s.quality_preset = VALID_QUALITY_PRESETS.includes(raw.quality_preset)
      ? raw.quality_preset
      : DEFAULTS.quality_preset;
  }

  if (raw.fps !== undefined) {
    const fps = parseInt(raw.fps, 10);
    s.fps = VALID_FPS.includes(fps) ? fps : DEFAULTS.fps;
  }

  if (raw.auto_reconnect !== undefined)  s.auto_reconnect  = Boolean(raw.auto_reconnect);
  if (raw.low_latency !== undefined)     s.low_latency     = Boolean(raw.low_latency);
  if (raw.hardware_accel !== undefined)  s.hardware_accel  = Boolean(raw.hardware_accel);
  if (raw.local_record !== undefined)    s.local_record    = Boolean(raw.local_record);

  if (raw.filter_preset !== undefined) {
    s.filter_preset = VALID_FILTER_PRESETS.includes(raw.filter_preset)
      ? raw.filter_preset
      : DEFAULTS.filter_preset;
  }

  if (raw.filter_brightness !== undefined)
    s.filter_brightness = clampInt(raw.filter_brightness, -100, 100, DEFAULTS.filter_brightness);
  if (raw.filter_contrast !== undefined)
    s.filter_contrast   = clampInt(raw.filter_contrast,   -100, 100, DEFAULTS.filter_contrast);
  if (raw.filter_saturation !== undefined)
    s.filter_saturation = clampInt(raw.filter_saturation, -100, 100, DEFAULTS.filter_saturation);
  if (raw.filter_warmth !== undefined)
    s.filter_warmth     = clampInt(raw.filter_warmth,      -50,  50, DEFAULTS.filter_warmth);
  if (raw.filter_sharpness !== undefined)
    s.filter_sharpness  = clampInt(raw.filter_sharpness,    0,  100, DEFAULTS.filter_sharpness);

  if (raw.beauty_mode !== undefined) s.beauty_mode = Boolean(raw.beauty_mode);

  return s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve streamer settings for a user.
 * Returns the stored row if one exists, otherwise returns the default settings
 * object so the frontend always receives the same shape.
 *
 * @param {string} userId - pnptv_id of the requesting user
 * @returns {Promise<object>}
 */
async function getSettings(userId) {
  const result = await query(
    'SELECT * FROM streamer_settings WHERE user_id = $1',
    [userId],
  );

  if (result.rows.length === 0) {
    logger.debug(`streamerSettingsService.getSettings: no row for user ${userId}, returning defaults`);
    return { ...DEFAULTS };
  }

  return result.rows[0];
}

/**
 * Create or update streamer settings for a user.
 * Only columns present in the validated settings object are written; all
 * other columns retain their existing (or default) values via the ON CONFLICT
 * DO UPDATE clause.
 *
 * @param {string} userId  - pnptv_id of the requesting user
 * @param {object} rawBody - raw request body (will be sanitized internally)
 * @returns {Promise<object>} - the full updated row
 */
async function upsertSettings(userId, rawBody) {
  const settings = sanitize(rawBody);

  // Build dynamic column list for the UPDATE clause so we only write what
  // the caller actually sent, rather than overwriting unchanged fields.
  const columns = Object.keys(settings);

  if (columns.length === 0) {
    // Nothing to update — just return current settings.
    logger.debug(`streamerSettingsService.upsertSettings: no valid fields for user ${userId}, returning current`);
    return getSettings(userId);
  }

  // Parameterized upsert:
  //   $1 = user_id
  //   $2 … $N+1 = column values
  //
  // INSERT sets every column from the sanitized object (plus the PK).
  // ON CONFLICT updates only the columns that were actually provided.
  const insertCols   = ['user_id', ...columns].join(', ');
  const insertPlaceholders = ['$1', ...columns.map((_, i) => `$${i + 2}`)].join(', ');
  const updateClause = columns
    .map((col, i) => `${col} = $${i + 2}`)
    .join(', ');
  const values = [userId, ...columns.map(col => settings[col])];

  const sql = `
    INSERT INTO streamer_settings (${insertCols})
    VALUES (${insertPlaceholders})
    ON CONFLICT (user_id) DO UPDATE
      SET ${updateClause},
          updated_at = NOW()
    RETURNING *
  `;

  const result = await query(sql, values);
  logger.info(`streamerSettingsService.upsertSettings: saved settings for user ${userId}`);
  return result.rows[0];
}

module.exports = { getSettings, upsertSettings };
