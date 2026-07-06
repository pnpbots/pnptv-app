'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JAAS_APP_ID = process.env.JAAS_APP_ID || '';
const JAAS_API_KEY_ID = process.env.JAAS_API_KEY_ID || '';
const JAAS_PRIVATE_KEY_PATH = process.env.JAAS_PRIVATE_KEY_PATH || './config/jaas-private-key.pem';

// FIX MED-06: startup validation — warn early so ops see the issue in container logs.
if (!JAAS_APP_ID || !JAAS_API_KEY_ID) {
  logger.warn('[jaasService] JAAS_APP_ID or JAAS_API_KEY_ID not configured — private call rooms will fail');
}

let _privateKey = null;

function getPrivateKey() {
  if (_privateKey) return _privateKey;
  const keyPath = path.isAbsolute(JAAS_PRIVATE_KEY_PATH)
    ? JAAS_PRIVATE_KEY_PATH
    : path.resolve(__dirname, '..', JAAS_PRIVATE_KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `JaaS private key not found at ${keyPath}. ` +
      `Download from https://jaas.8x8.vc → API Keys → your key → Download, ` +
      `then place it at apps/backend/config/jaas-private-key.pem`
    );
  }
  _privateKey = fs.readFileSync(keyPath, 'utf8');
  logger.info('[jaasService] Private key loaded', { path: keyPath });
  return _privateKey;
}

/**
 * Generate a JaaS RS256 JWT for a participant joining a room.
 * @param {string} roomName   Unique room identifier (e.g. "pnptv-priv-<uuid>")
 * @param {string} userId     User's platform ID
 * @param {string} displayName  Name shown in the call UI
 * @param {boolean} isModerator  Host (creator) gets moderator role
 * @param {number} ttlSeconds  Token lifetime in seconds
 * @returns {string} Signed JWT
 */
function generateJaasToken(roomName, userId, displayName, isModerator, ttlSeconds = 3600) {
  // FIX MED-06: guard so the caller gets a clear error, not a cryptic JWT failure.
  if (!JAAS_APP_ID || !JAAS_API_KEY_ID) {
    const err = new Error('JaaS not configured');
    err.code = 'JAAS_NOT_CONFIGURED';
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  const privateKey = getPrivateKey();

  const payload = {
    iss: 'chat',
    iat: now,
    exp: now + ttlSeconds,
    nbf: now,
    aud: 'jitsi',
    sub: JAAS_APP_ID,
    context: {
      user: {
        avatar: '',
        name: displayName,
        email: '',
        id: String(userId),
        moderator: String(isModerator),
      },
      features: {
        livestreaming: 'false',
        'outbound-call': 'false',
        'sip-outbound-call': 'false',
        transcription: 'false',
        recording: 'false',
      },
    },
    room: roomName,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    keyid: JAAS_API_KEY_ID,
  });
}

/**
 * Build the embeddable JaaS room URL.
 * @param {string} roomName  Same roomName used when generating the token
 * @param {string} jaasToken  Signed JWT from generateJaasToken
 * @returns {string} Full iframe src URL
 */
function getJaasRoomUrl(roomName, jaasToken) {
  const config = '#config.startWithVideoMuted=false&config.startWithAudioMuted=false';
  return `https://8x8.vc/${JAAS_APP_ID}/${encodeURIComponent(roomName)}?jwt=${jaasToken}${config}`;
}

module.exports = { generateJaasToken, getJaasRoomUrl, JAAS_APP_ID };
