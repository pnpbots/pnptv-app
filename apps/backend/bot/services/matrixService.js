'use strict';

/**
 * matrixService.js
 *
 * Bridge layer between PNPtv users/rooms and the Synapse homeserver at
 * http://synapse:8008 (internal Docker network).
 *
 * All user accounts are provisioned automatically via the Synapse shared-secret
 * registration API — users never need to create or remember a Matrix password.
 * Their sole authentication surface is the PNPtv webapp session.
 *
 * Matrix username format: pnptv_<telegram_id>  (e.g. pnptv_123456789)
 * Matrix user ID format:  @pnptv_<telegram_id>:matrix.pnptv.app
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { query } = require('../../config/postgres');

const SYNAPSE_INTERNAL_URL = process.env.MATRIX_SYNAPSE_URL || 'http://synapse:8008';
const MATRIX_SERVER_NAME   = process.env.MATRIX_SERVER_NAME || 'matrix.pnptv.app';
const MATRIX_PUBLIC_URL    = process.env.MATRIX_PUBLIC_URL  || 'https://matrix.pnptv.app';
const REGISTRATION_SECRET  = process.env.MATRIX_REGISTRATION_SECRET ||
  ':#DWz*o&yO,koa8yBr4HoWBJ#g22ebMZOZI:8Wx5as0C=dO;vi';

// AES-256-CBC encryption key derived from the app's ENCRYPTION_KEY
const encryptionKey = () =>
  crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'pnptv-default-key').digest();

// ─── helpers ──────────────────────────────────────────────────────────────────

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptToken(stored) {
  const colonIdx = stored.indexOf(':');
  const ivHex    = stored.slice(0, colonIdx);
  const enc      = stored.slice(colonIdx + 1);
  const iv       = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey(), iv);
  let decrypted  = decipher.update(enc, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Build an HMAC-SHA1 MAC for the Synapse shared-secret registration protocol
// Message: nonce NUL username NUL password NUL "notadmin"
function buildRegistrationMac(nonce, username, password) {
  const msg  = `${nonce}\x00${username}\x00${password}\x00notadmin`;
  return crypto.createHmac('sha1', REGISTRATION_SECRET).update(msg).digest('hex');
}

// Thin fetch wrapper — throws on non-2xx unless the caller opts out via `raw`
async function synapsePost(path, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${SYNAPSE_INTERNAL_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error || `Synapse error ${response.status}`);
    err.errcode = data.errcode;
    err.statusCode = response.status;
    err.synapseData = data;
    throw err;
  }

  return data;
}

async function synapseGet(path, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${SYNAPSE_INTERNAL_URL}${path}`, {
    method: 'GET',
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error || `Synapse error ${response.status}`);
    err.errcode = data.errcode;
    err.statusCode = response.status;
    err.synapseData = data;
    throw err;
  }

  return data;
}

async function synapsePut(path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(`${SYNAPSE_INTERNAL_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.error || `Synapse error ${response.status}`);
    err.errcode = data.errcode;
    err.statusCode = response.status;
    throw err;
  }

  return data;
}

// ─── user provisioning ────────────────────────────────────────────────────────

/**
 * Provision a Matrix account for a PNPtv user (idempotent).
 *
 * 1. If user.matrix_user_id is already set AND the stored token is valid,
 *    return the decrypted token immediately.
 * 2. Otherwise register via Synapse shared-secret API, login, persist
 *    encrypted credentials, and return them.
 *
 * @param {{ id: number, telegram: string, username?: string, first_name?: string, matrix_user_id?: string, matrix_access_token?: string }} user
 * @returns {{ matrixUserId: string, accessToken: string, homeserverUrl: string }}
 */
async function provisionMatrixUser(user) {
  // Determine Matrix username from telegram ID (most stable unique identifier)
  const telegramId  = user.telegram || String(user.id);
  const matrixName  = `pnptv_${telegramId}`.toLowerCase();
  const matrixUserId = `@${matrixName}:${MATRIX_SERVER_NAME}`;

  // Fast-path: credentials already stored
  if (user.matrix_user_id && user.matrix_access_token) {
    try {
      const accessToken = decryptToken(user.matrix_access_token);

      // Verify the token is still valid with a lightweight whoami call
      await synapseGet('/_matrix/client/v3/account/whoami', accessToken);

      logger.debug(`[Matrix] Reusing existing credentials for user ${user.id} (${matrixUserId})`);
      return { matrixUserId, accessToken, homeserverUrl: MATRIX_PUBLIC_URL };
    } catch (verifyErr) {
      // Token expired or invalid — fall through to re-provision
      logger.warn(`[Matrix] Stored token invalid for user ${user.id}, re-provisioning: ${verifyErr.message}`);
    }
  }

  // Step 1: Obtain a registration nonce from Synapse
  const nonceResp = await synapseGet('/_synapse/admin/v1/register');
  const nonce = nonceResp.nonce;

  // Step 2: Generate a random server-side password (users log in via PNPtv session, not password)
  const password = crypto.randomBytes(32).toString('base64');
  const mac      = buildRegistrationMac(nonce, matrixName, password);

  // Step 3: Register the account
  let registrationResult;
  try {
    registrationResult = await synapsePost('/_synapse/admin/v1/register', {
      nonce,
      username:  matrixName,
      password,
      displayname: user.first_name || user.username || matrixName,
      admin:     false,
      mac,
    });
    logger.info(`[Matrix] Registered new account: ${matrixUserId}`);
  } catch (regErr) {
    if (regErr.errcode === 'M_USER_IN_USE') {
      // Account already exists — proceed to login
      logger.info(`[Matrix] Account already exists, logging in: ${matrixUserId}`);
    } else {
      throw regErr;
    }
  }

  // If registration returned an access_token we can skip the login step
  let accessToken = registrationResult?.access_token;
  let deviceId    = registrationResult?.device_id;

  if (!accessToken) {
    // Step 4: Login to get a fresh access token
    // We need the password — but if the account already existed we don't know it.
    // Use the Synapse admin API to reset the password first, then login.
    if (!registrationResult) {
      // Account pre-existed: reset password via admin API so we can login
      const adminToken = await getAdminToken();
      await synapsePut(
        `/_synapse/admin/v2/users/${encodeURIComponent(matrixUserId)}`,
        { password, logout_devices: true },
        adminToken
      );
    }

    const loginResp = await synapsePost('/_matrix/client/v3/login', {
      type:                        'm.login.password',
      identifier:                  { type: 'm.id.user', user: matrixName },
      password,
      initial_device_display_name: `pnptv-webapp-${user.id}`,
    });

    accessToken = loginResp.access_token;
    deviceId    = loginResp.device_id;
  }

  if (!accessToken) {
    throw new Error(`[Matrix] Failed to obtain access token for ${matrixUserId}`);
  }

  // Step 5: Set display name (best-effort, non-blocking)
  const displayName = user.first_name || user.username || matrixName;
  try {
    await synapsePut(
      `/_matrix/client/v3/profile/${encodeURIComponent(matrixUserId)}/displayname`,
      { displayname: displayName },
      accessToken
    );
  } catch (dnErr) {
    logger.warn(`[Matrix] Display name sync failed for ${matrixUserId}: ${dnErr.message}`);
  }

  // Step 6: Persist encrypted credentials
  const encryptedToken = encryptToken(accessToken);
  await query(
    `UPDATE users
     SET matrix_user_id      = $1,
         matrix_access_token = $2,
         matrix_device_id    = $3,
         updated_at          = NOW()
     WHERE id = $4`,
    [matrixUserId, encryptedToken, deviceId || null, user.id]
  );

  logger.info(`[Matrix] Provisioned credentials for user ${user.id} -> ${matrixUserId}`);
  return { matrixUserId, accessToken, homeserverUrl: MATRIX_PUBLIC_URL };
}

// ─── admin token ──────────────────────────────────────────────────────────────

// Cache the admin token in module scope (Matrix access tokens do not expire unless
// explicitly invalidated, so this is safe for the lifetime of the process)
let _adminToken = null;
let _adminTokenExpiry = 0;

async function getAdminToken() {
  // Refresh if missing or older than 23 hours
  if (_adminToken && Date.now() < _adminTokenExpiry) return _adminToken;

  const adminUser     = process.env.MATRIX_ADMIN_USER || `pnptv_admin`;
  const adminPassword = process.env.MATRIX_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error('[Matrix] MATRIX_ADMIN_PASSWORD env var not set — cannot obtain admin token');
  }

  const loginResp = await synapsePost('/_matrix/client/v3/login', {
    type:       'm.login.password',
    identifier: { type: 'm.id.user', user: adminUser },
    password:   adminPassword,
    initial_device_display_name: 'pnptv-backend-admin',
  });

  _adminToken       = loginResp.access_token;
  _adminTokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
  return _adminToken;
}

// ─── DM rooms ─────────────────────────────────────────────────────────────────

/**
 * Get or create a Matrix DM room between two PNPtv users.
 *
 * The pair is stored with the smaller numeric ID as user_a to enforce
 * uniqueness without a duplicate row for (A,B) and (B,A).
 *
 * @param {{ id: number, telegram: string, username?: string, first_name?: string }} userA
 * @param {{ id: number, telegram: string, username?: string, first_name?: string }} userB
 * @returns {string} matrix_room_id
 */
async function getOrCreateDmRoom(userA, userB) {
  // Canonical ordering: smaller id is always user_a (compare as strings for consistency)
  const [small, large] = String(userA.id).localeCompare(String(userB.id)) <= 0
    ? [userA, userB]
    : [userB, userA];

  // Check for existing room
  const existing = await query(
    `SELECT matrix_room_id FROM dm_matrix_rooms WHERE user_a = $1 AND user_b = $2`,
    [small.id, large.id]
  );

  if (existing.rows.length > 0) {
    logger.debug(`[Matrix] Reusing DM room for ${small.id}<->${large.id}: ${existing.rows[0].matrix_room_id}`);
    return existing.rows[0].matrix_room_id;
  }

  // Provision both users
  const [credA, credB] = await Promise.all([
    provisionMatrixUser(small),
    provisionMatrixUser(large),
  ]);

  // Create DM room as userA
  const roomResp = await synapsePost(
    '/_matrix/client/v3/createRoom',
    {
      is_direct:     true,
      invite:        [credB.matrixUserId],
      preset:        'trusted_private_chat',
      creation_content: { 'm.federate': false },
    },
    credA.accessToken
  );

  const roomId = roomResp.room_id;

  // Auto-join userB via the Synapse admin join endpoint (no invite flow needed)
  try {
    const adminToken = await getAdminToken();
    await synapsePost(
      `/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`,
      { user_id: credB.matrixUserId },
      adminToken
    );
  } catch (joinErr) {
    // Non-fatal: userB was invited above and can join manually via the client
    logger.warn(`[Matrix] Admin join failed for DM room ${roomId} / user ${credB.matrixUserId}: ${joinErr.message}`);
  }

  // Persist mapping
  await query(
    `INSERT INTO dm_matrix_rooms (user_a, user_b, matrix_room_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_a, user_b) DO UPDATE SET matrix_room_id = EXCLUDED.matrix_room_id`,
    [small.id, large.id, roomId]
  );

  logger.info(`[Matrix] Created DM room ${roomId} for ${small.id}<->${large.id}`);
  return roomId;
}

// ─── hangout rooms ────────────────────────────────────────────────────────────

/**
 * Get or create a Matrix room for a hangout group.
 *
 * @param {number} hangoutGroupId
 * @param {{ id: number, telegram: string, username?: string, first_name?: string }} creatorUser
 * @param {string} groupName
 * @returns {string} matrix_room_id
 */
async function getOrCreateHangoutRoom(hangoutGroupId, creatorUser, groupName) {
  const existing = await query(
    `SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1`,
    [hangoutGroupId]
  );

  if (existing.rows.length > 0) {
    logger.debug(`[Matrix] Reusing hangout room for group ${hangoutGroupId}: ${existing.rows[0].matrix_room_id}`);
    return existing.rows[0].matrix_room_id;
  }

  const creatorCreds = await provisionMatrixUser(creatorUser);

  const roomResp = await synapsePost(
    '/_matrix/client/v3/createRoom',
    {
      name:    groupName,
      topic:   `PNPtv Hangout: ${groupName}`,
      preset:  'private_chat',
      visibility: 'private',
      creation_content: { 'm.federate': false },
      power_level_content_override: {
        // Creator gets power level 100 (room admin)
        users: { [creatorCreds.matrixUserId]: 100 },
        users_default: 0,
        events_default: 0,
        state_default: 50,
        ban: 50,
        kick: 50,
        redact: 50,
        invite: 0,
      },
    },
    creatorCreds.accessToken
  );

  const roomId = roomResp.room_id;

  await query(
    `INSERT INTO hangout_matrix_rooms (hangout_group_id, matrix_room_id)
     VALUES ($1, $2)
     ON CONFLICT (hangout_group_id) DO UPDATE SET matrix_room_id = EXCLUDED.matrix_room_id`,
    [hangoutGroupId, roomId]
  );

  logger.info(`[Matrix] Created hangout room ${roomId} for group ${hangoutGroupId}`);
  return roomId;
}

// ─── group membership ─────────────────────────────────────────────────────────

/**
 * Invite a PNPtv user to a hangout's Matrix room and auto-join them.
 *
 * @param {number} hangoutGroupId
 * @param {{ id: number, telegram: string, username?: string, first_name?: string, matrix_user_id?: string, matrix_access_token?: string }} user
 */
async function inviteToHangoutRoom(hangoutGroupId, user) {
  const roomRow = await query(
    `SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1`,
    [hangoutGroupId]
  );

  if (roomRow.rows.length === 0) {
    logger.warn(`[Matrix] inviteToHangoutRoom: no Matrix room for group ${hangoutGroupId}`);
    return;
  }

  const roomId   = roomRow.rows[0].matrix_room_id;
  const userCreds = await provisionMatrixUser(user);
  const adminToken = await getAdminToken();

  try {
    await synapsePost(
      `/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`,
      { user_id: userCreds.matrixUserId },
      adminToken
    );
    logger.info(`[Matrix] Joined ${userCreds.matrixUserId} into hangout room ${roomId}`);
  } catch (err) {
    // M_FORBIDDEN can occur if user is already in room — treat as non-fatal
    if (err.errcode !== 'M_FORBIDDEN') {
      logger.error(`[Matrix] Failed to join ${userCreds.matrixUserId} into ${roomId}: ${err.message}`);
      throw err;
    }
    logger.debug(`[Matrix] ${userCreds.matrixUserId} already in room ${roomId}`);
  }
}

/**
 * Kick a PNPtv user from a hangout's Matrix room.
 *
 * @param {number} hangoutGroupId
 * @param {{ id: number, matrix_user_id?: string }} user
 */
async function removeFromHangoutRoom(hangoutGroupId, user) {
  const roomRow = await query(
    `SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1`,
    [hangoutGroupId]
  );

  if (roomRow.rows.length === 0) {
    logger.debug(`[Matrix] removeFromHangoutRoom: no room mapped for group ${hangoutGroupId}`);
    return;
  }

  const roomId = roomRow.rows[0].matrix_room_id;

  // Resolve the target Matrix user ID
  let matrixUserId = user.matrix_user_id;
  if (!matrixUserId) {
    const dbRow = await query(`SELECT matrix_user_id FROM users WHERE id = $1`, [user.id]);
    matrixUserId = dbRow.rows[0]?.matrix_user_id;
  }

  if (!matrixUserId) {
    logger.warn(`[Matrix] removeFromHangoutRoom: user ${user.id} has no Matrix account, skipping kick`);
    return;
  }

  const adminToken = await getAdminToken();

  // Use the Synapse admin deactivate-or-kick endpoint via the rooms admin API
  try {
    // POST /_synapse/admin/v1/rooms/<roomId>/delete_devices_of_user is for keys —
    // use the standard Matrix kick via admin token acting as a room admin.
    await synapsePost(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`,
      { user_id: matrixUserId, reason: 'Removed from PNPtv hangout group' },
      adminToken
    );
    logger.info(`[Matrix] Kicked ${matrixUserId} from hangout room ${roomId}`);
  } catch (err) {
    if (err.errcode === 'M_FORBIDDEN' || err.statusCode === 404) {
      logger.debug(`[Matrix] Kick no-op: ${matrixUserId} not in room ${roomId}`);
      return;
    }
    logger.error(`[Matrix] Kick failed for ${matrixUserId} from ${roomId}: ${err.message}`);
    throw err;
  }
}

// ─── credential accessor ──────────────────────────────────────────────────────

/**
 * Get Matrix credentials for a PNPtv user by database user ID.
 * Provisions the account if it does not yet exist.
 *
 * @param {number} userId  PNPtv users.id
 * @returns {{ matrixUserId: string, accessToken: string, homeserverUrl: string }}
 */
async function getMatrixToken(userId) {
  const result = await query(
    `SELECT id, telegram, username, first_name,
            matrix_user_id, matrix_access_token, matrix_device_id
     FROM users
     WHERE id = $1 AND is_deleted = false`,
    [userId]
  );

  const user = result.rows[0];
  if (!user) throw new Error(`User ${userId} not found`);

  return provisionMatrixUser(user);
}

module.exports = {
  provisionMatrixUser,
  getOrCreateDmRoom,
  getOrCreateHangoutRoom,
  inviteToHangoutRoom,
  removeFromHangoutRoom,
  getMatrixToken,
};
