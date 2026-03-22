'use strict';

/**
 * jaasStreamService.js
 *
 * Manages JaaS-based live streaming for PNP Live.
 * Performers join a JaaS (8x8.vc) room as moderators and share their camera/mic.
 * Viewers join the same room with subscriber-only tokens.
 *
 * Powered by JaaS (8x8.vc) via jaasService.
 *
 * Room naming: live-{channelRef}  (e.g. live-pnptv-santino)
 * Active stream tracking: Redis SADD/SREM on key "streaming:rooms"
 * Active user flag: Redis key "streaming:active:{userId}"
 */

const jaasService = require('./jaasService');
const logger = require('../../utils/logger');

// Lazy-load tokenService so a failure in that module does not prevent
// jaasStreamService (and the API server) from starting at all.
let _tokenService = null;
function getTokenService() {
  if (!_tokenService) {
    try {
      _tokenService = require('./tokenService');
    } catch (e) {
      logger.error('[jaasStreamService] tokenService failed to load — viewer token balance checks disabled:', e.message);
      // Return a safe no-op fallback so callers don't have to null-check.
      _tokenService = {
        hasSufficientBalance: async () => true,
        deductTokens: async () => ({ success: true, newBalance: 0 }),
        creditTokens: async () => true,
        processStreamHeartbeat: async () => ({ success: true, newBalance: 0 }),
      };
    }
  }
  return _tokenService;
}

function getRedis() {
  try {
    const { getRedis: _getRedis } = require('../../config/redis');
    return _getRedis();
  } catch (e) {
    logger.warn('[jaasStreamService] Redis unavailable:', e.message);
    return null;
  }
}

const REDIS_ROOMS_KEY = 'streaming:rooms';
const STREAM_MIN_BALANCE = 10; // Min tokens required to join (prevents immediate disconnect)
const STREAM_JOIN_COST = 1;   // Initial cost to join a stream

/**
 * Convert a channel reference to a JaaS room name.
 * @param {string} channelRef - e.g. "pnptv-santino"
 * @returns {string} e.g. "live-pnptv-santino"
 */
function toRoomName(channelRef) {
  return `live-${channelRef}`;
}

/**
 * Generate a JaaS meeting URL for use in an iframe embed.
 * @param {string} roomName
 * @param {string} token
 * @returns {string}
 */
function toMeetingUrl(roomName, token) {
  return jaasService.generateMeetingUrl(roomName, token);
}

/**
 * No-op: JaaS rooms are created on-demand when the first participant joins.
 * We use this hook to register the channelRef in the Redis active-rooms set.
 *
 * @param {string} channelRef
 * @returns {Promise<void>}
 */
async function ensureStreamRoom(channelRef) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.sadd(REDIS_ROOMS_KEY, channelRef);
      logger.info('[jaasStreamService] Channel registered in streaming:rooms', { channelRef });
    } catch (err) {
      logger.warn('[jaasStreamService] Redis SADD streaming:rooms failed', { channelRef, error: err.message });
    }
  }
}

/**
 * Generate a moderator (streamer) token for a JaaS live stream room.
 *
 * @param {string} channelRef
 * @param {string} userId
 * @param {string} displayName
 * @param {string} [photoUrl]
 * @returns {Promise<string>} signed JWT
 */
async function generateStreamerToken(channelRef, userId, displayName, photoUrl) {
  const roomName = toRoomName(channelRef);
  const token = jaasService.generatePNPLiveModelToken(
    roomName,
    String(userId),
    displayName || 'Streamer',
    '',
    photoUrl || ''
  );
  return token;
}

/**
 * Generate a viewer (subscriber-only) JaaS token for watching a live stream.
 * Checks minimum balance and deducts join cost before issuing the token.
 *
 * @param {string} channelRef
 * @param {string} userId
 * @param {string} displayName
 * @returns {Promise<string|null>} signed JWT, or null if balance is insufficient.
 */
async function generateViewerToken(channelRef, userId, displayName) {
  const tokenSvc = getTokenService();

  // Require at least STREAM_MIN_BALANCE to join (e.g. 10 tokens)
  const hasMinBalance = await tokenSvc.hasSufficientBalance(userId, STREAM_MIN_BALANCE);
  if (!hasMinBalance) {
    logger.warn('Insufficient minimum balance for user to join stream.', { userId, channelRef, minRequired: STREAM_MIN_BALANCE });
    return null;
  }

  const deduction = await tokenSvc.deductTokens(userId, STREAM_JOIN_COST, `stream-join:${channelRef}`);
  if (!deduction.success) {
    logger.warn('Token deduction failed at stream join', { userId, channelRef });
    return null;
  }
  logger.info('Stream join token deducted', { userId, channelRef, cost: STREAM_JOIN_COST, newBalance: deduction.newBalance });

  const roomName = toRoomName(channelRef);
  const token = jaasService.generatePNPLiveClientToken(
    roomName,
    String(userId),
    displayName || 'Viewer',
    '',
    ''
  );
  return token;
}

/**
 * End a live stream — removes the channelRef from the Redis active-rooms set.
 * JaaS rooms expire automatically when all participants leave.
 *
 * @param {string} channelRef
 * @returns {Promise<void>}
 */
async function endStream(channelRef) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.srem(REDIS_ROOMS_KEY, channelRef);
      logger.info('[jaasStreamService] Channel removed from streaming:rooms', { channelRef });
    } catch (err) {
      logger.warn('[jaasStreamService] Redis SREM streaming:rooms failed', { channelRef, error: err.message });
    }
  }
}

/**
 * List all active live streams by reading the Redis rooms set.
 * Returns enriched shape compatible with the controller's DB lookup.
 *
 * @returns {Promise<Array<{ channelRef: string, roomName: string, participantCount: number, isLive: boolean }>>}
 */
async function listActiveStreams() {
  const redis = getRedis();
  if (!redis) {
    return [];
  }
  try {
    const channelRefs = await redis.smembers(REDIS_ROOMS_KEY);
    if (!channelRefs || channelRefs.length === 0) {
      return [];
    }
    return channelRefs.map(channelRef => ({
      channelRef,
      roomName: toRoomName(channelRef),
      // JaaS has no server-side participant count API — report 1 (streamer)
      // The frontend can update this via its own participant-joined events.
      participantCount: 1,
      isLive: true,
    }));
  } catch (err) {
    logger.warn('[jaasStreamService] listActiveStreams Redis error', { error: err.message });
    return [];
  }
}

/**
 * Get the live status of a specific channel.
 * Checks the Redis `streaming:rooms` set membership as the source of truth.
 *
 * @param {string} channelRef
 * @returns {Promise<{ isLive: boolean, participantCount: number, streamerConnected: boolean } | null>}
 */
async function getStreamStatus(channelRef) {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  try {
    const isMember = await redis.sismember(REDIS_ROOMS_KEY, channelRef);
    const isLive = isMember === 1;
    return {
      isLive,
      participantCount: isLive ? 1 : 0,
      streamerConnected: isLive,
    };
  } catch (err) {
    logger.warn('[jaasStreamService] getStreamStatus Redis error', { channelRef, error: err.message });
    return null;
  }
}

// Expose domain/appId for the controller to include in responses.
const JAAS_DOMAIN = '8x8.vc';
const JAAS_APP_ID = process.env.JAAS_APP_ID || '';

module.exports = {
  toRoomName,
  toMeetingUrl,
  ensureStreamRoom,
  generateStreamerToken,
  generateViewerToken,
  endStream,
  listActiveStreams,
  getStreamStatus,
  JAAS_DOMAIN,
  JAAS_APP_ID,
};
