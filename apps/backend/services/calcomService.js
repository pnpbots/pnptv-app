'use strict';

/**
 * Cal.com Integration Service
 *
 * Provisions creators in Cal.com, fetches availability, and creates/cancels
 * bookings via the Cal.com v1 REST API.
 *
 * All API calls are fire-and-forget safe: ECONNREFUSED / ETIMEDOUT are caught
 * and logged; the caller receives null / [] instead of an unhandled rejection.
 */

const https = require('https');
const http = require('http');
const { query } = require('../utils/db');
const logger = require('../utils/logger');

const CALCOM_API_KEY = process.env.CALCOM_API_KEY || '';
const CALCOM_BASE_URL = process.env.NEXT_PUBLIC_WEBAPP_URL || 'https://booking.pnptv.app';

// 5-second timeout for all Cal.com API calls
const REQUEST_TIMEOUT_MS = 5000;

// Ensure the DB table exists on service load (non-blocking)
async function _ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS creator_calcom_accounts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      calcom_user_id INTEGER NOT NULL,
      calcom_username TEXT NOT NULL,
      calcom_api_key TEXT NOT NULL,
      event_type_30min_id INTEGER,
      event_type_60min_id INTEGER,
      provisioned_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Run table creation once at module load (errors are non-fatal)
_ensureTable().catch(err =>
  logger.warn('[calcomService] Table creation failed (non-fatal):', err.message)
);

/**
 * Make an HTTP/HTTPS request to the Cal.com API.
 * Returns the parsed JSON body on 2xx, or null on network / non-2xx errors.
 *
 * @param {'GET'|'POST'|'DELETE'|'PATCH'} method
 * @param {string} path  - e.g. '/api/v1/users'
 * @param {object|null} body
 * @returns {Promise<object|null>}
 */
function _calcomRequest(method, path, body = null) {
  return new Promise((resolve) => {
    if (!CALCOM_API_KEY) {
      logger.warn('[calcomService] CALCOM_API_KEY is not set — skipping API call');
      return resolve(null);
    }

    const url = new URL(`${CALCOM_BASE_URL}${path}`);
    url.searchParams.set('apiKey', CALCOM_API_KEY);

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = transport.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({ _raw: raw });
          }
        } else {
          logger.warn('[calcomService] Non-2xx response', {
            method, path, status: res.statusCode, body: raw.slice(0, 300),
          });
          resolve(null);
        }
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      logger.warn('[calcomService] Request timed out', { method, path });
      req.destroy();
      resolve(null);
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        logger.warn('[calcomService] Cal.com unreachable (non-fatal):', err.code);
      } else {
        logger.warn('[calcomService] Request error:', err.message);
      }
      resolve(null);
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get stored Cal.com account info for a creator.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getCreatorCalcomInfo(userId) {
  const result = await query(
    'SELECT * FROM creator_calcom_accounts WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Provision a single creator in Cal.com.
 * Idempotent — skips creation if the creator is already in creator_calcom_accounts.
 *
 * @param {string} userId
 * @param {string} username
 * @param {string} email
 * @returns {Promise<object|null>} The creator_calcom_accounts row, or null on failure.
 */
async function provisionCreator(userId, username, email) {
  if (!CALCOM_API_KEY) {
    logger.warn('[calcomService] provisionCreator: CALCOM_API_KEY not set — skipping');
    return null;
  }

  // Already provisioned?
  const existing = await getCreatorCalcomInfo(userId);
  if (existing) {
    logger.debug('[calcomService] Creator already provisioned', { userId, calcomUserId: existing.calcom_user_id });
    return existing;
  }

  // Sanitize username for Cal.com (lowercase, no special chars)
  const calcomUsername = `pnptv-${String(username || userId).toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  // 1. Create Cal.com user
  const userPayload = {
    email,
    name: username || userId,
    username: calcomUsername,
    password: `PNPtv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };

  logger.info('[calcomService] Provisioning Cal.com user', { userId, calcomUsername });
  const userResp = await _calcomRequest('POST', '/api/v1/users', userPayload);

  if (!userResp || !userResp.user?.id) {
    logger.warn('[calcomService] Failed to create Cal.com user', { userId, userResp });
    return null;
  }

  const calcomUserId = userResp.user.id;
  // Cal.com v1 creates an API key automatically; we store the admin key for now
  const calcomApiKey = CALCOM_API_KEY;

  // 2. Create 30-min event type
  const et30Resp = await _calcomRequest('POST', '/api/v1/event-types', {
    title: '30-Minute Private Session',
    slug: '30min-session',
    length: 30,
    userId: calcomUserId,
  });
  const eventType30MinId = et30Resp?.event_type?.id || et30Resp?.eventType?.id || null;

  // 3. Create 60-min event type
  const et60Resp = await _calcomRequest('POST', '/api/v1/event-types', {
    title: '60-Minute Private Session',
    slug: '60min-session',
    length: 60,
    userId: calcomUserId,
  });
  const eventType60MinId = et60Resp?.event_type?.id || et60Resp?.eventType?.id || null;

  // 4. Persist to DB
  try {
    const insertResult = await query(
      `INSERT INTO creator_calcom_accounts
         (user_id, calcom_user_id, calcom_username, calcom_api_key, event_type_30min_id, event_type_60min_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         calcom_user_id = EXCLUDED.calcom_user_id,
         calcom_username = EXCLUDED.calcom_username,
         calcom_api_key = EXCLUDED.calcom_api_key,
         event_type_30min_id = COALESCE(EXCLUDED.event_type_30min_id, creator_calcom_accounts.event_type_30min_id),
         event_type_60min_id = COALESCE(EXCLUDED.event_type_60min_id, creator_calcom_accounts.event_type_60min_id),
         provisioned_at = NOW()
       RETURNING *`,
      [userId, calcomUserId, calcomUsername, calcomApiKey, eventType30MinId, eventType60MinId]
    );
    logger.info('[calcomService] Creator provisioned successfully', {
      userId, calcomUserId, calcomUsername, eventType30MinId, eventType60MinId,
    });
    return insertResult.rows[0];
  } catch (dbErr) {
    logger.error('[calcomService] DB insert failed after Cal.com provisioning', {
      userId, calcomUserId, error: dbErr.message,
    });
    return null;
  }
}

/**
 * Provision all active creators in batch.
 * Called on startup and by the admin endpoint.
 * Errors per-creator are non-fatal; the loop continues.
 *
 * @returns {Promise<{ provisioned: number, skipped: number, failed: number }>}
 */
async function provisionAllCreators() {
  if (!CALCOM_API_KEY) {
    logger.warn('[calcomService] provisionAllCreators: CALCOM_API_KEY not set — skipping');
    return { provisioned: 0, skipped: 0, failed: 0 };
  }

  logger.info('[calcomService] Starting batch creator provisioning...');

  const { rows: creators } = await query(`
    SELECT u.id, u.username, u.email
    FROM users u
    WHERE u.role IN ('model', 'creator')
      AND u.creator_status IN ('active', 'approved')
      AND u.email IS NOT NULL
    ORDER BY u.id
    LIMIT 500
  `);

  logger.info(`[calcomService] Found ${creators.length} active creators to provision`);

  const stats = { provisioned: 0, skipped: 0, failed: 0 };

  for (const creator of creators) {
    try {
      const existing = await getCreatorCalcomInfo(creator.id);
      if (existing) {
        stats.skipped++;
        continue;
      }
      const result = await provisionCreator(creator.id, creator.username, creator.email);
      if (result) {
        stats.provisioned++;
      } else {
        stats.failed++;
      }
    } catch (err) {
      stats.failed++;
      logger.warn('[calcomService] Per-creator provisioning error', {
        userId: creator.id, error: err.message,
      });
    }

    // Avoid hammering Cal.com
    await new Promise(r => setTimeout(r, 300));
  }

  logger.info('[calcomService] Batch provisioning complete', stats);
  return stats;
}

/**
 * Get available booking slots for a creator via Cal.com.
 *
 * @param {string} userId
 * @param {string} dateFrom  - ISO date string, e.g. '2026-07-06'
 * @param {string} dateTo    - ISO date string, e.g. '2026-07-13'
 * @param {number} durationMinutes - 30 or 60
 * @returns {Promise<Array<{ time: string, available: true }>>}
 */
async function getCreatorAvailability(userId, dateFrom, dateTo, durationMinutes) {
  const info = await getCreatorCalcomInfo(userId);
  if (!info) {
    logger.warn('[calcomService] getCreatorAvailability: creator not provisioned', { userId });
    return [];
  }

  const eventTypeId = durationMinutes >= 60
    ? info.event_type_60min_id
    : info.event_type_30min_id;

  if (!eventTypeId) {
    logger.warn('[calcomService] getCreatorAvailability: no eventTypeId for duration', {
      userId, durationMinutes,
    });
    return [];
  }

  const path = `/api/v1/availability?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&eventTypeId=${eventTypeId}&username=${encodeURIComponent(info.calcom_username)}`;

  const resp = await _calcomRequest('GET', path);
  if (!resp) return [];

  // Cal.com v1 returns { slots: { "YYYY-MM-DD": [{ time: ISO }] } }
  const slotsMap = resp.slots || {};
  const available = [];
  for (const dateKey of Object.keys(slotsMap)) {
    const daySlots = slotsMap[dateKey];
    if (!Array.isArray(daySlots)) continue;
    for (const slot of daySlots) {
      if (slot?.time) {
        available.push({ time: slot.time, available: true });
      }
    }
  }
  return available;
}

/**
 * Create a confirmed booking in Cal.com after payment succeeds.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.startTime       - ISO datetime string
 * @param {number} opts.durationMinutes - 30 or 60
 * @param {string} opts.attendeeName
 * @param {string} opts.attendeeEmail
 * @param {string} [opts.attendeePhone]
 * @returns {Promise<object|null>} Cal.com booking object or null on failure
 */
async function createBooking({ userId, startTime, durationMinutes, attendeeName, attendeeEmail, attendeePhone }) {
  const info = await getCreatorCalcomInfo(userId);
  if (!info) {
    logger.warn('[calcomService] createBooking: creator not provisioned', { userId });
    return null;
  }

  const eventTypeId = durationMinutes >= 60
    ? info.event_type_60min_id
    : info.event_type_30min_id;

  if (!eventTypeId) {
    logger.warn('[calcomService] createBooking: no eventTypeId for duration', { userId, durationMinutes });
    return null;
  }

  const bookingPayload = {
    eventTypeId,
    start: startTime,
    responses: {
      name: attendeeName,
      email: attendeeEmail,
      ...(attendeePhone ? { phone: attendeePhone } : {}),
    },
    timeZone: 'America/Bogota',
    language: 'es',
    metadata: {
      source: 'pnptv',
      userId,
    },
  };

  const resp = await _calcomRequest('POST', '/api/v1/bookings', bookingPayload);

  if (!resp) {
    logger.warn('[calcomService] createBooking: API call returned null', { userId, startTime });
    return null;
  }

  logger.info('[calcomService] Booking created in Cal.com', {
    userId,
    bookingUid: resp.uid || resp.id,
    startTime,
  });
  return resp;
}

/**
 * Cancel a booking in Cal.com.
 *
 * @param {string} bookingUid - Cal.com booking UID
 * @returns {Promise<boolean>} true if cancelled, false on error
 */
async function cancelBooking(bookingUid) {
  if (!bookingUid) return false;

  const resp = await _calcomRequest('DELETE', `/api/v1/bookings/${encodeURIComponent(bookingUid)}`);

  if (resp === null) {
    logger.warn('[calcomService] cancelBooking: failed or timed out', { bookingUid });
    return false;
  }

  logger.info('[calcomService] Booking cancelled in Cal.com', { bookingUid });
  return true;
}

module.exports = {
  provisionCreator,
  provisionAllCreators,
  getCreatorAvailability,
  createBooking,
  cancelBooking,
  getCreatorCalcomInfo,
};
