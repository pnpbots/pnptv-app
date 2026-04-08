'use strict';

const { AccessToken } = require('livekit-server-sdk');
const logger = require('../utils/logger');

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL || 'wss://livekit.pnptv.app';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in environment');
}

/**
 * Generate a LiveKit access token for a participant.
 * @param {string} roomName - The LiveKit room name.
 * @param {string} participantIdentity - Unique identity string for the participant.
 * @param {string} participantName - Display name shown in the call.
 * @param {boolean} isAdmin - Whether the participant gets admin-level room grants.
 * @returns {Promise<string>} Signed JWT string.
 */
async function generateToken(roomName, participantIdentity, participantName, isAdmin = false) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: String(participantIdentity),
    name: String(participantName).slice(0, 100),
    ttl: '6h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    ...(isAdmin ? { roomAdmin: true } : {}),
  });

  const token = await at.toJwt();
  logger.debug(`livekitService: generated token for identity=${participantIdentity} room=${roomName}`);
  return token;
}

module.exports = { generateToken, LIVEKIT_WS_URL };
