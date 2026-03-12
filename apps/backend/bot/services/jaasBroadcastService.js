'use strict';

/**
 * JaaS Broadcast Service
 *
 * Bridges a JaaS (8x8.vc) meeting to the Restreamer RTMP pipeline.
 *
 * Flow:
 *  1. User starts a JaaS meeting via the StreamerDashboard and the Jitsi
 *     External API fires `videoConferenceJoined` → frontend emits `stream:start-jaas`.
 *  2. Backend calls the JaaS Livestream API:
 *       POST https://api.8x8.vc/{appId}/v1/conferences/{conferenceId}/livestream
 *     This tells JaaS to push the meeting's composite video+audio to the RTMP
 *     endpoint we supply — i.e. the user's Restreamer ingest.
 *  3. Restreamer repackages the RTMP into HLS and serves it at
 *       https://live.pnptv.app/memfs/{channelRef}.m3u8
 *  4. When the user ends the JaaS meeting, frontend emits `stream:stop-jaas`
 *     which calls the JaaS stop-livestream API and clears Redis.
 *
 * Redis key schema:
 *   jaas:broadcast:{userId}  →  JSON { conferenceId, channelRef, hlsUrl, startedAt }
 *   TTL: 6 hours (matches max JaaS token lifetime)
 */

const axios = require('axios');
const jwt   = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getRedis } = require('../../config/redis');
const { getPool }  = require('../../config/postgres');
const logger       = require('../../utils/logger');

// ── Constants ────────────────────────────────────────────────────────────────

const JAAS_API_BASE     = 'https://api.8x8.vc';
const BROADCAST_TTL_SEC = 6 * 60 * 60; // 6 hours

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a short-lived RS256 JWT for JaaS server-to-server API calls.
 * This is distinct from the client-facing meeting JWT — it has no `room` or
 * `context.user` block and is scoped only to the conference we're managing.
 */
function buildApiJwt() {
  const appId    = process.env.JAAS_APP_ID;
  const apiKeyId = process.env.JAAS_API_KEY_ID;
  let privateKey = process.env.JAAS_PRIVATE_KEY || null;

  if (!appId || !apiKeyId || !privateKey) {
    throw new Error('JaaS is not configured. Set JAAS_APP_ID, JAAS_API_KEY_ID, and JAAS_PRIVATE_KEY.');
  }

  // Normalise escaped newlines stored in env vars as literal \\n
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: appId,
    exp: now + 300, // 5-minute expiry — only used for one API call
    nbf: now,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    header: { alg: 'RS256', typ: 'JWT', kid: apiKeyId },
  });
}

/**
 * Extract the RTMP stream name from the user's assigned Restreamer channel.
 * Channel ref 'pnptv-frank' → stream name 'frank'.
 * Returns { channelRef, streamName, hlsUrl } or throws.
 */
async function resolveUserChannel(userId) {
  const { rows } = await getPool().query(
    'SELECT live_channel FROM users WHERE id = $1',
    [userId]
  );

  const channelRef = rows[0]?.live_channel ?? null;
  if (!channelRef) {
    throw Object.assign(new Error('No streaming channel assigned to your account.'), { status: 404 });
  }

  const streamName = channelRef.startsWith('pnptv-')
    ? channelRef.slice('pnptv-'.length)
    : channelRef;

  const restreamerPublicUrl = (process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app').replace(/\/$/, '');
  const hlsUrl = `${restreamerPublicUrl}/memfs/${channelRef}.m3u8`;

  return { channelRef, streamName, hlsUrl };
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

function broadcastKey(userId) {
  return `jaas:broadcast:${userId}`;
}

async function saveBroadcast(userId, data) {
  const redis = getRedis();
  await redis.set(broadcastKey(userId), JSON.stringify(data), 'EX', BROADCAST_TTL_SEC);
}

async function clearBroadcast(userId) {
  const redis = getRedis();
  await redis.del(broadcastKey(userId));
}

async function loadBroadcast(userId) {
  const redis = getRedis();
  const raw = await redis.get(broadcastKey(userId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start JaaS → Restreamer livestream.
 *
 * @param {string|number} userId       — authenticated user's DB id
 * @param {string}        conferenceId — JaaS conference id (e.g. "vpaas-magic-cookie-xxx/roomName")
 * @param {string}        roomName     — JaaS room name (used for logging)
 * @returns {{ channelRef: string, hlsUrl: string, conferenceId: string }}
 */
async function startBroadcast(userId, conferenceId, roomName) {
  if (!conferenceId || typeof conferenceId !== 'string') {
    throw Object.assign(new Error('conferenceId is required'), { status: 400 });
  }

  const { channelRef, streamName, hlsUrl } = await resolveUserChannel(userId);

  // Derive RTMP ingest.  We use the internal Docker hostname for the backend →
  // Restreamer connection; Restreamer's RTMP port is 1935 and the app name is /live.
  const rtmpHost = (process.env.RESTREAMER_URL || 'http://restreamer:8080')
    .replace(/^https?:\/\//, '')   // strip protocol
    .split(':')[0];                 // drop :8080 port — RTMP is always on 1935

  const streamUrl = `rtmp://${rtmpHost}:1935/live`;

  logger.info('jaasBroadcastService.startBroadcast', {
    userId,
    conferenceId,
    channelRef,
    streamName,
    rtmpTarget: `${streamUrl}/${streamName}`,
  });

  // Build API JWT and call the JaaS Livestream API
  const apiToken = buildApiJwt();
  const appId    = process.env.JAAS_APP_ID;

  // conferenceId from the Jitsi External API is the full room path:
  // "{tenant}/{roomName}" — we URL-encode the whole thing as a path segment.
  const encodedConferenceId = encodeURIComponent(conferenceId);
  const endpoint = `${JAAS_API_BASE}/${appId}/v1/conferences/${encodedConferenceId}/livestream`;

  try {
    await axios.post(
      endpoint,
      { streamUrl, streamKey: streamName },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );
  } catch (err) {
    const status  = err.response?.status;
    const detail  = err.response?.data;

    // 409 Conflict = livestream already running for this conference.
    // Treat as success — return the existing HLS URL from Redis if available.
    if (status === 409) {
      logger.info('jaasBroadcastService: livestream already active (409), treating as success', {
        userId,
        conferenceId,
      });
    } else {
      logger.error('jaasBroadcastService: JaaS API error', {
        userId,
        conferenceId,
        status,
        detail,
        message: err.message,
      });
      throw Object.assign(
        new Error(`JaaS API error${status ? ` (HTTP ${status})` : ''}: ${JSON.stringify(detail) || err.message}`),
        { status: status || 502 }
      );
    }
  }

  // Persist broadcast state in Redis
  await saveBroadcast(userId, {
    conferenceId,
    channelRef,
    hlsUrl,
    startedAt: Date.now(),
  });

  logger.info('jaasBroadcastService: broadcast started successfully', { userId, channelRef, hlsUrl });

  return { channelRef, hlsUrl, conferenceId };
}

/**
 * Stop JaaS → Restreamer livestream.
 *
 * @param {string|number} userId
 * @param {string}        conferenceId
 */
async function stopBroadcast(userId, conferenceId) {
  logger.info('jaasBroadcastService.stopBroadcast', { userId, conferenceId });

  const appId  = process.env.JAAS_APP_ID;

  if (appId && conferenceId) {
    try {
      const apiToken        = buildApiJwt();
      const encodedConferenceId = encodeURIComponent(conferenceId);
      const endpoint        = `${JAAS_API_BASE}/${appId}/v1/conferences/${encodedConferenceId}/livestream`;

      await axios.delete(endpoint, {
        headers: { Authorization: `Bearer ${apiToken}` },
        timeout: 10_000,
      });

      logger.info('jaasBroadcastService: JaaS livestream stopped', { userId, conferenceId });
    } catch (err) {
      // 404 = already stopped; 409 = no active stream — both are acceptable.
      const status = err.response?.status;
      if (status === 404 || status === 409) {
        logger.info('jaasBroadcastService: livestream already stopped or not found', { userId, conferenceId, status });
      } else {
        logger.warn('jaasBroadcastService: error stopping JaaS livestream (non-fatal)', {
          userId,
          conferenceId,
          status,
          message: err.message,
        });
      }
    }
  }

  // Always clear Redis regardless of API result
  await clearBroadcast(userId);
}

/**
 * Get the current broadcast status for a user.
 *
 * @param {string|number} userId
 * @returns {{ conferenceId: string, channelRef: string, hlsUrl: string, startedAt: number } | null}
 */
async function getBroadcastStatus(userId) {
  return loadBroadcast(userId);
}

module.exports = { startBroadcast, stopBroadcast, getBroadcastStatus };
