'use strict';

/**
 * livekitStreamService.js
 *
 * Manages LiveKit-based live streaming for PNP Live.
 * Performers publish camera/mic tracks to a LiveKit room via livekit-client SDK.
 * Viewers subscribe to the same room with read-only tokens.
 *
 * Room naming: live-{channelRef}  (e.g. live-pnptv-santino)
 * This keeps stream rooms distinct from hangout rooms (hangout-*).
 */

const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const logger = require('../../utils/logger');

// Lazy-load tokenService so a failure in that module does not prevent
// livekitStreamService (and the API server) from starting at all.
let _tokenService = null;
function getTokenService() {
  if (!_tokenService) {
    try {
      _tokenService = require('./tokenService');
    } catch (e) {
      logger.error('[livekitStreamService] tokenService failed to load — viewer token balance checks disabled:', e.message);
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

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://livekit-server:7880';
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL || 'wss://pnptv.app/livekit-ws';
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const TOKEN_TTL_SECONDS = 6 * 60 * 60; // 6 hours for long streams
const STREAM_JOIN_COST = 1; // Initial cost to join a stream
const STREAM_MIN_BALANCE = 10; // Min tokens required to join (prevents immediate disconnect)

let _roomService = null;
function getRoomService() {
  if (!_roomService) {
    _roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  }
  return _roomService;
}

/**
 * Convert a channel reference to a LiveKit room name.
 * @param {string} channelRef - e.g. "pnptv-santino"
 * @returns {string} e.g. "live-pnptv-santino"
 */
function toRoomName(channelRef) {
  return `live-${channelRef}`;
}

/**
 * Generate a streamer (publisher) token for a LiveKit live stream room.
 * Grants: publish video/audio, subscribe, room admin, publish data (for overlays).
 *
 * @param {string} channelRef - Restreamer channel reference (e.g. "pnptv-santino")
 * @param {string} userId     - User ID (identity)
 * @param {string} displayName
 * @param {string} [photoUrl]
 * @returns {Promise<string>} signed JWT
 */
async function generateStreamerToken(channelRef, userId, displayName, photoUrl) {
  const roomName = toRoomName(channelRef);

  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: String(userId),
    name: displayName || 'Streamer',
    ttl: TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      photoUrl: photoUrl || '',
      role: 'streamer',
      channelRef,
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: true,
  });

  return at.toJwt();
}

/**
 * Generate a viewer (subscriber-only) token for watching a live stream.
 * Grants: subscribe only (no publish).
 * First, checks if the user has enough tokens to join.
 *
 * @param {string} channelRef
 * @param {string} userId
 * @param {string} displayName
 * @returns {Promise<string|null>} signed JWT, or null if balance is insufficient.
 */
async function generateViewerToken(channelRef, userId, displayName) {
  // Check balance and deduct tokens at join time (not heartbeat)
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

  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: String(userId),
    name: displayName || 'Viewer',
    ttl: TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ role: 'viewer' }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: false,
    canSubscribe: true,
    canPublishData: true, // for chat messages via data channel
  });

  return at.toJwt();
}

/**
 * Create or ensure a live stream room exists in LiveKit.
 * Configures the room for live streaming (empty timeout, max participants).
 *
 * @param {string} channelRef
 * @returns {Promise<void>}
 */
async function ensureStreamRoom(channelRef) {
  const roomName = toRoomName(channelRef);
  try {
    await getRoomService().createRoom({
      name: roomName,
      emptyTimeout: 300,      // 5 min after last participant leaves
      maxParticipants: 10000,  // Generous viewer limit
    });
    logger.info('LiveKit stream room created', { roomName, channelRef });
  } catch (err) {
    if (err?.message?.includes('already exists')) {
      logger.debug('LiveKit stream room already exists', { roomName });
      return;
    }
    logger.warn('LiveKit ensureStreamRoom non-fatal error', { roomName, error: err?.message });
  }
}

/**
 * End a live stream by removing all participants and deleting the room.
 *
 * @param {string} channelRef
 * @returns {Promise<void>}
 */
async function endStream(channelRef) {
  const roomName = toRoomName(channelRef);
  try {
    await getRoomService().deleteRoom(roomName);
    logger.info('LiveKit stream room deleted', { roomName, channelRef });
  } catch (err) {
    logger.warn('LiveKit endStream error', { roomName, error: err?.message });
  }
}

/**
 * List all active live stream rooms with participant counts.
 * Only returns rooms prefixed with "live-".
 *
 * @returns {Promise<Array<{ channelRef: string, roomName: string, participantCount: number, isLive: boolean }>>}
 */
async function listActiveStreams() {
  try {
    const rooms = await getRoomService().listRooms();
    return rooms
      .filter(r => r.name.startsWith('live-'))
      .map(r => ({
        channelRef: r.name.replace(/^live-/, ''),
        roomName: r.name,
        participantCount: r.numParticipants || 0,
        isLive: (r.numParticipants || 0) > 0,
      }));
  } catch (err) {
    logger.warn('LiveKit listActiveStreams error', { error: err?.message });
    return [];
  }
}

/**
 * Get the status of a specific stream room.
 *
 * @param {string} channelRef
 * @returns {Promise<{ isLive: boolean, participantCount: number, streamerConnected: boolean } | null>}
 */
async function getStreamStatus(channelRef) {
  const roomName = toRoomName(channelRef);
  try {
    const participants = await getRoomService().listParticipants(roomName);
    const streamer = participants.find(p => {
      try {
        const meta = JSON.parse(p.metadata || '{}');
        return meta.role === 'streamer';
      } catch { return false; }
    });
    return {
      isLive: !!streamer,
      participantCount: participants.length,
      streamerConnected: !!streamer,
    };
  } catch (err) {
    // Room doesn't exist or error — not live
    return null;
  }
}

module.exports = {
  toRoomName,
  generateStreamerToken,
  generateViewerToken,
  ensureStreamRoom,
  endStream,
  listActiveStreams,
  getStreamStatus,
  LIVEKIT_WS_URL,
};
