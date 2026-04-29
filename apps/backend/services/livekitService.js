'use strict';

const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const logger = require('../utils/logger');

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL || 'wss://livekit.pnptv.app';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in environment');
}

// Lazy-init RoomServiceClient — first call only, reused for all room ops.
let _roomClient = null;
function getRoomClient() {
  if (_roomClient) return _roomClient;
  const host = LIVEKIT_WS_URL.replace(/^wss?:\/\//, 'https://');
  _roomClient = new RoomServiceClient(host, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  return _roomClient;
}

/**
 * List participants currently connected to a LiveKit room.
 * Returns [] on error so callers can fail open (e.g. queue-cleanup sweeps
 * that shouldn't nuke the queue if LiveKit is briefly unreachable).
 */
async function listParticipants(roomName) {
  try {
    const client = getRoomClient();
    return await client.listParticipants(roomName);
  } catch (err) {
    logger.warn('[livekit] listParticipants failed', { roomName, error: err.message });
    return [];
  }
}

/**
 * Generate a LiveKit access token for a participant.
 *
 * @param {string} roomName              - The LiveKit room name.
 * @param {string} participantIdentity   - Unique identity string for the participant.
 * @param {string} participantName       - Display name shown in the call.
 * @param {boolean} isModerator          - True = can publish + admin grants; false = subscribe-only.
 * @param {Object} [options={}]
 * @param {number} [options.nbf]         - not-before Unix timestamp (seconds). Token is rejected by
 *                                         LiveKit until this time. Useful to gate pre-start joins.
 * @param {boolean} [options.canPublishAudio] - Override audio publish capability (default follows isModerator).
 * @param {boolean} [options.canPublishVideo] - Override video publish capability (default follows isModerator).
 * @param {string}  [options.identityOverride] - When set, replaces participantIdentity entirely.
 *                                         Hangout calls pass `${userId}-${randomHex}` here so that
 *                                         a user opening two tabs gets distinct LiveKit participant
 *                                         slots instead of being kicked from the first tab.
 *                                         Main Stage callers must NOT set this — stable identity is
 *                                         required there for cammer-queue dedup.
 * @returns {Promise<string>} Signed JWT string.
 */
async function generateToken(roomName, participantIdentity, participantName, isModerator = false, options = {}) {
  // Default TTL is 2h — covers most call/DM/booking scenarios. Callers with
  // legitimately longer-lived rooms (Main Stage rotation, persistent hangouts)
  // must pass options.ttlSeconds explicitly. Booking flows should pass the
  // actual slot duration + a small buffer so a leaked token doesn't outlast
  // the call window.
  const ttlSeconds = options.ttlSeconds || 2 * 60 * 60;

  // Use caller-supplied override when present (hangout multi-tab support).
  // Falls back to participantIdentity unchanged, preserving Main Stage dedup behaviour.
  const resolvedIdentity = options.identityOverride ? String(options.identityOverride) : String(participantIdentity);

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: resolvedIdentity,
    name: String(participantName).slice(0, 100),
    ttl: ttlSeconds,
  });

  // not-before gate: LiveKit AccessToken exposes `notBefore` on some SDK versions.
  // Set it directly on the token if the field is exposed; otherwise patch the JWT payload.
  if (options.nbf !== undefined && options.nbf !== null) {
    const nbfInt = Math.floor(Number(options.nbf));
    if (!isNaN(nbfInt) && nbfInt > 0) {
      // livekit-server-sdk >= 1.x: at.notBefore is supported
      if ('notBefore' in at) {
        at.notBefore = nbfInt;
      } else {
        // Older SDK: monkey-patch the payload via the internal _grants object's nbf
        // by overriding toJwt to inject the claim manually.
        const originalToJwt = at.toJwt.bind(at);
        at.toJwt = async () => {
          const jwt = require('jsonwebtoken');
          const token = await originalToJwt();
          // Decode, add nbf, re-sign with same secret
          const decoded = jwt.decode(token, { complete: true });
          if (decoded && decoded.payload) {
            decoded.payload.nbf = nbfInt;
            return jwt.sign(decoded.payload, LIVEKIT_API_SECRET, {
              algorithm: 'HS256',
              noTimestamp: true, // iat already in payload
            });
          }
          return token;
        };
      }
    }
  }

  // Role-aware publish grants:
  //  - Moderator (creator): can publish audio + video, room admin
  //  - Participant (member): subscribe-only by default; options can override
  const canPublish = isModerator ? true : false;
  const canPublishAudio = options.canPublishAudio !== undefined ? options.canPublishAudio : canPublish;
  const canPublishVideo = options.canPublishVideo !== undefined ? options.canPublishVideo : canPublish;

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canPublishAudio,
    canPublishVideo,
    canSubscribe: true,
    canPublishData: isModerator,
    ...(isModerator ? { roomAdmin: true } : {}),
  });

  const token = await at.toJwt();
  logger.debug(`livekitService: generated token for identity=${resolvedIdentity} room=${roomName} moderator=${isModerator}`);
  return token;
}

module.exports = { generateToken, LIVEKIT_WS_URL, getRoomClient, listParticipants };
