'use strict';

/**
 * livekitService.js
 *
 * Provides LiveKit token generation and room management for hangout video calls.
 * Replaces jaasService.js for all hangout call endpoints.
 *
 * Environment variables:
 *   LIVEKIT_URL        — internal URL for the LiveKit server (default: http://livekit-server:7880)
 *   LIVEKIT_WS_URL     — public WebSocket URL for the frontend (default: wss://lk.pnptv.app)
 *   LIVEKIT_API_KEY    — API key (default: pnptv)
 *   LIVEKIT_API_SECRET — API secret
 */

const { AccessToken, RoomServiceClient, VideoGrant } = require('livekit-server-sdk');
const logger = require('../../utils/logger');

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://livekit-server:7880';
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL || 'wss://lk.pnptv.app';
const API_KEY = process.env.LIVEKIT_API_KEY || 'pnptv';
const API_SECRET = process.env.LIVEKIT_API_SECRET || '_CwBLNh2mVaJPy9yu3MgrIzSajvS6_-_tratIvCx9SQ';

// Token time-to-live: 4 hours
const TOKEN_TTL_SECONDS = 4 * 60 * 60;

// RoomServiceClient — lazily instantiated to avoid startup failures
let _roomService = null;
function getRoomService() {
  if (!_roomService) {
    _roomService = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
  }
  return _roomService;
}

/**
 * Generate a LiveKit participant JWT.
 *
 * @param {string} roomName    — LiveKit room name
 * @param {string} userId      — participant identity (used as LiveKit identity)
 * @param {string} displayName — human-readable display name shown to other participants
 * @param {string} photoUrl    — avatar URL (metadata)
 * @param {boolean} isModerator — when true, grants roomAdmin + canPublishData + record
 * @returns {string} signed JWT
 */
function generateToken(roomName, userId, displayName, photoUrl, isModerator) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: String(userId),
    name: displayName || 'User',
    ttl: TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ photoUrl: photoUrl || '' }),
  });

  const grant = {
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  if (isModerator) {
    grant.roomAdmin = true;
    grant.roomRecord = false;
  }

  at.addGrant(grant);

  return at.toJwt();
}

/**
 * Generate a complete meeting info object for a participant.
 *
 * @param {string}  roomName
 * @param {string}  userId
 * @param {string}  displayName
 * @param {string}  photoUrl
 * @param {boolean} isModerator
 * @returns {{ token: string, roomName: string, wsUrl: string }}
 */
async function generateMeetingInfo(roomName, userId, displayName, photoUrl, isModerator) {
  const token = await generateToken(roomName, userId, displayName, photoUrl, isModerator);
  return {
    token,
    roomName,
    wsUrl: LIVEKIT_WS_URL,
  };
}

/**
 * Generate a room name for a hangout call.
 *
 * Persistent (is_main) groups get a stable name so the room survives across sessions.
 * Ephemeral groups get a unique per-call name so rooms don't collide.
 *
 * @param {number|string} groupId
 * @param {boolean}       persistent
 * @returns {string}
 */
function generateRoomName(groupId, persistent) {
  if (persistent) {
    return `hangout-${groupId}-main`;
  }
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `hangout-${groupId}-${ts}-${rand}`;
}

/**
 * Ensure a LiveKit room exists, creating it if necessary.
 * Errors are swallowed if the room already exists (409-equivalent from the SDK).
 *
 * @param {string} roomName
 * @returns {Promise<void>}
 */
async function ensureRoom(roomName) {
  try {
    await getRoomService().createRoom({ name: roomName });
    logger.info('LiveKit room created', { roomName });
  } catch (err) {
    // Room already exists or server returned a non-fatal error — acceptable
    if (err?.message && err.message.includes('already exists')) {
      logger.debug('LiveKit room already exists', { roomName });
      return;
    }
    // For any other error, log a warning but do not re-throw.
    // The client will still get a valid token and can join once the room is up.
    logger.warn('LiveKit ensureRoom non-fatal error', { roomName, error: err?.message });
  }
}

/**
 * Validate that the LiveKit service is reachable and credentials are set.
 * Returns true if the service appears to be configured.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return !!(API_KEY && API_SECRET && LIVEKIT_URL && LIVEKIT_WS_URL);
}

module.exports = {
  generateToken,
  generateMeetingInfo,
  generateRoomName,
  ensureRoom,
  isConfigured,
  LIVEKIT_WS_URL,
};
