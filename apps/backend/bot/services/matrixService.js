'use strict';

/**
 * matrixService.js
 *
 * Bridge layer between PNPtv users/rooms and the Synapse homeserver at
 * http://synapse:8008 (internal Docker network).
 *
 * All user accounts are provisioned automatically via the Synapse Admin API —
 * users never need to create or remember a Matrix password, and no shared
 * registration secret is required. Provisioning uses an admin access token to
 * create/ensure the account exists (PUT /_synapse/admin/v2/users/...) and then
 * obtains a fresh access token for that user via the admin login endpoint
 * (POST /_synapse/admin/v1/users/.../login). Their sole authentication surface
 * is the PNPtv webapp session.
 *
 * Matrix username format: pnptv_<telegram_id>  (e.g. pnptv_123456789)
 * Matrix user ID format:  @pnptv_<telegram_id>:matrix.pnptv.app
 */

const crypto = require('crypto');
const fs     = require('fs/promises');
const path   = require('path');
const logger = require('../../utils/logger');
const { query, getClient } = require('../../config/postgres');

const SYNAPSE_INTERNAL_URL = process.env.MATRIX_SYNAPSE_URL || 'http://synapse:8008';
const MATRIX_SERVER_NAME   = process.env.MATRIX_SERVER_NAME || 'matrix.pnptv.app';
const MATRIX_PUBLIC_URL    = process.env.MATRIX_PUBLIC_URL  || 'https://matrix.pnptv.app';

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
 * 1. If user.matrix_user_id is already set AND the stored token passes a
 *    whoami check, return the decrypted token immediately.
 * 2. Otherwise use the Synapse Admin API to create/ensure the account exists,
 *    obtain a fresh access token via the admin login endpoint (no password
 *    required), persist encrypted credentials, and return them.
 *
 * @param {{ id: number, telegram: string, username?: string, first_name?: string, matrix_user_id?: string, matrix_access_token?: string }} user
 * @returns {{ matrixUserId: string, accessToken: string, homeserverUrl: string }}
 */
async function provisionMatrixUser(user) {
  const telegramId  = user.telegram || String(user.id);
  const matrixName  = `pnptv_${telegramId}`.toLowerCase();
  const matrixUserId = `@${matrixName}:${MATRIX_SERVER_NAME}`;

  // Fast-path: credentials already stored and valid
  if (user.matrix_user_id && user.matrix_access_token) {
    try {
      const accessToken = decryptToken(user.matrix_access_token);
      await synapseGet('/_matrix/client/v3/account/whoami', accessToken);
      logger.debug(`[Matrix] Reusing existing credentials for user ${user.id} (${matrixUserId})`);
      return { matrixUserId, accessToken, deviceId: user.matrix_device_id || null, homeserverUrl: MATRIX_PUBLIC_URL };
    } catch (verifyErr) {
      const errCode = verifyErr?.response?.data?.errcode || verifyErr?.errcode || '';
      if (errCode === 'M_UNKNOWN_TOKEN' || errCode === 'M_MISSING_TOKEN') {
        logger.warn(`[Matrix] Token revoked/expired for user ${user.id} (${errCode}), re-provisioning`);
      } else {
        logger.warn(`[Matrix] Stored token invalid for user ${user.id}, re-provisioning: ${verifyErr.message}`);
      }
      // Fall through to re-provision with fresh admin login token below
    }
  }

  // Acquire per-user advisory lock to prevent duplicate token generation from concurrent requests.
  // pg_advisory_xact_lock uses user.id as key — only one provisioning per user at a time.
  const lockClient = await getClient();
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT pg_advisory_xact_lock($1)', [user.id]);

    // Re-check after acquiring lock — another request may have already provisioned
    const { rows: freshRows } = await lockClient.query(
      'SELECT matrix_user_id, matrix_access_token, matrix_device_id FROM users WHERE id = $1',
      [user.id]
    );
    if (freshRows[0]?.matrix_access_token) {
      try {
        const freshToken = decryptToken(freshRows[0].matrix_access_token);
        await synapseGet('/_matrix/client/v3/account/whoami', freshToken);
        await lockClient.query('COMMIT');
        logger.debug(`[Matrix] Another request already provisioned user ${user.id}`);
        return { matrixUserId, accessToken: freshToken, deviceId: freshRows[0].matrix_device_id || null, homeserverUrl: MATRIX_PUBLIC_URL };
      } catch (_) { /* token still bad, proceed with provisioning */ }
    }

  const adminToken = await getAdminToken();
  const displayName = user.first_name || user.username || matrixName;

  // Step 1: Ensure user exists via admin API (PUT is idempotent — creates or updates)
  try {
    await synapsePut(
      `/_synapse/admin/v2/users/${encodeURIComponent(matrixUserId)}`,
      { displayname: displayName, admin: false, deactivated: false },
      adminToken
    );
    logger.info(`[Matrix] Ensured user exists: ${matrixUserId}`);
  } catch (ensureErr) {
    // M_USER_IN_USE means the account already exists — safe to continue to login step
    if (ensureErr.errcode === 'M_USER_IN_USE') {
      logger.info(`[Matrix] User already exists: ${matrixUserId} — proceeding to login`);
    } else {
      logger.error(`[Matrix] Failed to ensure user ${matrixUserId}: ${ensureErr.message}`);
      throw ensureErr;
    }
  }

  // Step 2: Get access token via admin login API (no password needed)
  // Synapse admin login does NOT return device_id in the response,
  // so we generate one and pass it in the request body.
  const generatedDeviceId = `PNPTV_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  let accessToken, deviceId;
  try {
    const loginResp = await synapsePost(
      `/_synapse/admin/v1/users/${encodeURIComponent(matrixUserId)}/login`,
      { device_id: generatedDeviceId, initial_device_display_name: `pnptv-webapp-${telegramId}` },
      adminToken
    );
    accessToken = loginResp.access_token;
    deviceId = loginResp.device_id || generatedDeviceId;
  } catch (loginErr) {
    logger.error(`[Matrix] Admin login failed for ${matrixUserId}: ${loginErr.message}`);
    throw loginErr;
  }

  if (!accessToken) {
    throw new Error(`[Matrix] Failed to obtain access token for ${matrixUserId}`);
  }

  // Step 3: Set display name (best-effort)
  try {
    await synapsePut(
      `/_matrix/client/v3/profile/${encodeURIComponent(matrixUserId)}/displayname`,
      { displayname: displayName },
      accessToken
    );
  } catch (dnErr) {
    logger.warn(`[Matrix] Display name sync failed for ${matrixUserId}: ${dnErr.message}`);
  }

  // Step 3b: Set avatar (best-effort)
  await syncMatrixAvatar(
    { id: user.id, photo_file_id: user.photo_file_id, matrix_user_id: matrixUserId },
    accessToken
  );

  // Step 4: Persist encrypted credentials (inside advisory lock transaction)
  const encryptedToken = encryptToken(accessToken);
  await lockClient.query(
    `UPDATE users
     SET matrix_user_id      = $1,
         matrix_access_token = $2,
         matrix_device_id    = $3,
         updated_at          = NOW()
     WHERE id = $4`,
    [matrixUserId, encryptedToken, deviceId, user.id]
  );
  await lockClient.query('COMMIT');

  logger.info(`[Matrix] Provisioned credentials for user ${user.id} -> ${matrixUserId}`);
  return { matrixUserId, accessToken, deviceId, homeserverUrl: MATRIX_PUBLIC_URL };
  } catch (provisionErr) {
    await lockClient.query('ROLLBACK').catch(() => {});
    throw provisionErr;
  } finally {
    lockClient.release();
  }
}

// ─── avatar sync ─────────────────────────────────────────────────────────────

const AVATARS_DIR = path.join(__dirname, '../../../../public/uploads/avatars');

/**
 * Sync a user's PNPtv avatar to their Matrix profile.
 *
 * Accepts either a raw accessToken string OR an encrypted one (from DB).
 * During provisioning the raw token is passed directly; for post-upload
 * sync the encrypted token is read from the user record.
 *
 * Best-effort — errors are logged but never thrown.
 *
 * @param {object} user  Must have: id, photo_file_id, matrix_user_id
 * @param {string} [rawAccessToken]  If provided, used as-is (skip decrypt)
 */
async function syncMatrixAvatar(user, rawAccessToken) {
  try {
    // Resolve photo_file_id — may be passed in or need a DB lookup
    let photoFileId = user.photo_file_id;
    if (photoFileId === undefined) {
      const row = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
      photoFileId = row.rows[0]?.photo_file_id;
    }
    if (!photoFileId) {
      logger.debug(`[Matrix] syncAvatar: user ${user.id} has no avatar — skipping`);
      return;
    }

    // Resolve Matrix credentials
    let matrixUserId = user.matrix_user_id;
    let accessToken  = rawAccessToken || null;

    if (!matrixUserId || !accessToken) {
      const row = await query(
        'SELECT matrix_user_id, matrix_access_token FROM users WHERE id = $1',
        [user.id]
      );
      const u = row.rows[0];
      if (!u?.matrix_user_id || !u?.matrix_access_token) {
        logger.debug(`[Matrix] syncAvatar: user ${user.id} has no Matrix account — skipping`);
        return;
      }
      matrixUserId = u.matrix_user_id;
      if (!accessToken) accessToken = decryptToken(u.matrix_access_token);
    }

    // Read avatar from disk
    const filename = path.basename(photoFileId);
    const filePath = path.join(AVATARS_DIR, filename);
    const buffer   = await fs.readFile(filePath);

    // Upload to Matrix media repo
    const mxcUri = await uploadMedia(buffer, filename, 'image/webp', accessToken);

    // Set avatar_url on Matrix profile
    await synapsePut(
      `/_matrix/client/v3/profile/${encodeURIComponent(matrixUserId)}/avatar_url`,
      { avatar_url: mxcUri },
      accessToken
    );

    logger.info(`[Matrix] Avatar synced for user ${user.id} -> ${mxcUri}`);
  } catch (err) {
    logger.warn(`[Matrix] Avatar sync failed for user ${user.id}: ${err.message}`);
  }
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

// ─── room membership ──────────────────────────────────────────────────────────

/**
 * Ensure a user is joined to a Matrix room.
 * 1. Check joined_rooms with user's token
 * 2. Try join with user's token (works if invited or room is joinable)
 * 3. Fallback: admin force-join via Synapse admin API
 *
 * @param {string} roomId
 * @param {{ matrixUserId: string, accessToken: string }} userCreds
 * @returns {Promise<void>}
 */
async function ensureUserInRoom(roomId, userCreds) {
  try {
    const joined = await synapseGet('/_matrix/client/v3/joined_rooms', userCreds.accessToken);
    if (joined.joined_rooms && joined.joined_rooms.includes(roomId)) {
      return; // already in room
    }
  } catch (err) {
    logger.debug(`[Matrix] ensureUserInRoom: joined_rooms check failed for ${userCreds.matrixUserId}: ${err.message}`);
  }

  // Try direct join (works if user has a pending invite or room allows joining)
  try {
    await synapsePost(
      `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {},
      userCreds.accessToken
    );
    logger.debug(`[Matrix] ensureUserInRoom: ${userCreds.matrixUserId} joined ${roomId} directly`);
    return;
  } catch (joinErr) {
    if (joinErr.errcode === 'M_FORBIDDEN' && joinErr.message?.includes('already in the room')) {
      return; // already joined
    }
    logger.debug(`[Matrix] ensureUserInRoom: direct join failed for ${userCreds.matrixUserId}: ${joinErr.message}`);
  }

  // Fallback: admin force-join
  try {
    const adminToken = await getAdminToken();
    const adminUserId = `@${process.env.MATRIX_ADMIN_USER || 'pnptv_admin'}:${MATRIX_SERVER_NAME}`;

    // Synapse 1.147+: /_synapse/admin/v1/join requires the admin to be IN the room.
    // Step 1: make_room_admin gives the admin an invite + room admin powers
    // Step 2: admin joins the room via the standard client API
    // Step 3: admin force-joins the target user
    try {
      await synapsePost(
        `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/make_room_admin`,
        { user_id: adminUserId },
        adminToken
      );
      // Join the admin into the room (make_room_admin sends an invite)
      await synapsePost(
        `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
        {},
        adminToken
      );
    } catch (prepErr) {
      logger.debug(`[Matrix] ensureUserInRoom: admin room prep note: ${prepErr.message}`);
    }

    await synapsePost(
      `/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`,
      { user_id: userCreds.matrixUserId },
      adminToken
    );
    logger.info(`[Matrix] ensureUserInRoom: admin force-joined ${userCreds.matrixUserId} into ${roomId}`);
  } catch (adminErr) {
    logger.warn(`[Matrix] ensureUserInRoom: admin force-join failed for ${userCreds.matrixUserId} into ${roomId}: ${adminErr.message}`);
    throw adminErr;
  }
}

// ─── message sending ──────────────────────────────────────────────────────────

/**
 * Send a text message to a Matrix room.
 * @param {string} roomId
 * @param {string} accessToken - user's Matrix access token
 * @param {string} content - text content
 * @returns {Promise<{ event_id: string }>}
 */
async function sendRoomMessage(roomId, accessToken, content) {
  const txnId = `m${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return synapsePut(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    { msgtype: 'm.text', body: content },
    accessToken
  );
}

/**
 * Upload a file to the Synapse content repository.
 * Returns an mxc:// URI that can be used in media messages.
 *
 * @param {Buffer} buffer     File contents
 * @param {string} filename   Original filename
 * @param {string} contentType  MIME type (e.g. 'audio/webm', 'image/webp')
 * @param {string} accessToken  User's Matrix access token
 * @returns {Promise<string>}  mxc:// content URI
 */
async function uploadMedia(buffer, filename, contentType, accessToken) {
  const url = `${SYNAPSE_INTERNAL_URL}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: buffer,
  });

  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || `Synapse upload error ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  return data.content_uri; // mxc://matrix.pnptv.app/xxxxx
}

/**
 * Send a media message to a Matrix room.
 * @param {string} roomId
 * @param {string} accessToken
 * @param {{ url: string, msgtype: string, body?: string, info?: object }} media
 * @returns {Promise<{ event_id: string }>}
 */
async function sendRoomMediaMessage(roomId, accessToken, { url, msgtype, body, info }) {
  const txnId = `m${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return synapsePut(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    { msgtype, body: body || 'media', url, info },
    accessToken
  );
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

  // Check for existing room (FOR UPDATE prevents race condition where two concurrent
  // calls both read "not found" and create duplicate rooms)
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT matrix_room_id FROM dm_matrix_rooms WHERE user_a = $1 AND user_b = $2 FOR UPDATE`,
      [small.id, large.id]
    );

    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      logger.debug(`[Matrix] Reusing DM room for ${small.id}<->${large.id}: ${existing.rows[0].matrix_room_id}`);
      return existing.rows[0].matrix_room_id;
    }
    await client.query('COMMIT');
  } catch (lockErr) {
    await client.query('ROLLBACK').catch(() => {});
    throw lockErr;
  } finally {
    client.release();
  }

  // Provision both users
  const [credA, credB] = await Promise.all([
    provisionMatrixUser(small),
    provisionMatrixUser(large),
  ]);

  // Build display names for room metadata
  const nameA = small.first_name || small.username || `User ${small.id}`;
  const nameB = large.first_name || large.username || `User ${large.id}`;

  // Create DM room as userA with upgraded properties
  const roomResp = await synapsePost(
    '/_matrix/client/v3/createRoom',
    {
      is_direct:     true,
      invite:        [credB.matrixUserId],
      preset:        'private_chat',
      room_version:  '11',
      name:          `${nameA} \u2194 ${nameB}`,
      topic:         'PNPtv Direct Message',
      creation_content: { 'm.federate': false },
      initial_state: [
        {
          type:      'm.room.history_visibility',
          state_key: '',
          content:   { history_visibility: 'shared' },
        },
      ],
      power_level_content_override: {
        users: {
          [credA.matrixUserId]: 100,
          [credB.matrixUserId]: 100,
        },
        users_default: 0,
        events_default: 0,
        state_default: 100,
        ban: 100,
        kick: 100,
        redact: 100,
        invite: 100,
        events: {
          'm.room.name':         100,
          'm.room.topic':        100,
          'm.room.avatar':       100,
          'm.room.power_levels': 100,
        },
      },
    },
    credA.accessToken
  );

  const roomId = roomResp.room_id;

  // Auto-join userB via ensureUserInRoom (invite was sent at room creation)
  try {
    await ensureUserInRoom(roomId, credB);
  } catch (joinErr) {
    logger.warn(`[Matrix] Failed to join userB ${credB.matrixUserId} into DM room ${roomId}: ${joinErr.message}`);
    // Don't persist a broken room — next attempt will create a fresh one
    return roomId; // still return the roomId; it may work on retry
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
  // Use advisory lock to prevent duplicate room creation from concurrent requests
  const lockClient = await getClient();
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT pg_advisory_xact_lock($1)', [100000 + hangoutGroupId]);

    const existing = await lockClient.query(
      `SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1`,
      [hangoutGroupId]
    );

    if (existing.rows.length > 0) {
      await lockClient.query('COMMIT');
      lockClient.release();
      logger.debug(`[Matrix] Reusing hangout room for group ${hangoutGroupId}: ${existing.rows[0].matrix_room_id}`);
      return existing.rows[0].matrix_room_id;
    }

  const creatorCreds = await provisionMatrixUser(creatorUser);
  const adminToken = await getAdminToken();
  const adminUserId = `@${process.env.MATRIX_ADMIN_USER || 'pnptv_admin'}:${MATRIX_SERVER_NAME}`;

  const roomResp = await synapsePost(
    '/_matrix/client/v3/createRoom',
    {
      name:       groupName,
      topic:      `PNPtv Hangout \u2014 ${groupName}`,
      preset:     'private_chat',
      visibility: 'private',
      room_version: '11',
      invite:     [adminUserId],
      creation_content: { 'm.federate': false },
      initial_state: [
        {
          type:      'm.room.history_visibility',
          state_key: '',
          content:   { history_visibility: 'shared' },
        },
        {
          type:      'm.room.guest_access',
          state_key: '',
          content:   { guest_access: 'forbidden' },
        },
      ],
      power_level_content_override: {
        users: {
          [creatorCreds.matrixUserId]: 100,
          [adminUserId]: 100,
        },
        users_default: 0,
        events_default: 0,
        state_default: 50,
        ban: 50,
        kick: 50,
        redact: 0,
        invite: 0,
        events: {
          'm.room.name':         100,
          'm.room.topic':        50,
          'm.room.avatar':       50,
          'm.room.power_levels': 100,
          'm.room.history_visibility': 100,
        },
      },
    },
    creatorCreds.accessToken
  );

  const roomId = roomResp.room_id;

  // Auto-join admin into the room so it can manage membership
  try {
    await synapsePost(
      `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {},
      adminToken
    );
    logger.debug(`[Matrix] Admin joined hangout room ${roomId}`);
  } catch (adminJoinErr) {
    logger.warn(`[Matrix] Admin auto-join failed for hangout room ${roomId}: ${adminJoinErr.message}`);
  }

  await lockClient.query(
    `INSERT INTO hangout_matrix_rooms (hangout_group_id, matrix_room_id)
     VALUES ($1, $2)
     ON CONFLICT (hangout_group_id) DO UPDATE SET matrix_room_id = EXCLUDED.matrix_room_id`,
    [hangoutGroupId, roomId]
  );
  await lockClient.query('COMMIT');

  logger.info(`[Matrix] Created hangout room ${roomId} for group ${hangoutGroupId}`);
  return roomId;
  } catch (hangoutRoomErr) {
    await lockClient.query('ROLLBACK').catch(() => {});
    throw hangoutRoomErr;
  } finally {
    lockClient.release();
  }
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

  const roomId    = roomRow.rows[0].matrix_room_id;
  const userCreds = await provisionMatrixUser(user);

  // Use ensureUserInRoom — it checks membership, tries user join, then admin force-join
  await ensureUserInRoom(roomId, userCreds);
  logger.info(`[Matrix] Ensured ${userCreds.matrixUserId} is in hangout room ${roomId}`);
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

/**
 * Redact (delete) a message in a Matrix room using admin token.
 */
async function redactRoomEvent(roomId, eventId, reason = 'Deleted by admin') {
  const adminToken = await getAdminToken();
  const txnId = `redact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await synapsePost(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId}`,
    { reason },
    adminToken
  );
}

/**
 * Sync hangout group settings to the Matrix room state.
 * Updates power levels, room name, topic, and invite permissions.
 *
 * @param {number} hangoutGroupId
 * @param {{ isReadOnly?: boolean, allowMedia?: boolean, allowMemberInvites?: boolean, name?: string, description?: string }} settings
 */
async function syncRoomSettings(hangoutGroupId, settings) {
  const { rows } = await query(
    'SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1',
    [hangoutGroupId]
  );
  if (rows.length === 0) {
    logger.debug(`[Matrix] syncRoomSettings: no Matrix room for group ${hangoutGroupId}`);
    return;
  }

  const roomId = rows[0].matrix_room_id;
  const adminToken = await getAdminToken();

  // Update power levels for read-only / media / invite settings
  if (settings.isReadOnly !== undefined || settings.allowMedia !== undefined || settings.allowMemberInvites !== undefined) {
    try {
      // Get current power levels
      const currentPL = await synapseGet(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
        adminToken
      );

      // Read-only: set events_default to 50 (only mods can send) or 0 (everyone)
      if (settings.isReadOnly !== undefined) {
        currentPL.events_default = settings.isReadOnly ? 50 : 0;
      }

      // Allow media: restrict m.room.message with msgtype checks via events override
      // Matrix doesn't have per-msgtype power levels, so we use events_default for read-only
      // and let the webapp enforce media restrictions client-side + in sendMessage endpoint

      // Invite permissions: set invite power level
      if (settings.allowMemberInvites !== undefined) {
        currentPL.invite = settings.allowMemberInvites ? 0 : 50;
      }

      await synapsePut(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
        currentPL,
        adminToken
      );
      logger.info(`[Matrix] Updated power levels for group ${hangoutGroupId} room ${roomId}`);
    } catch (err) {
      logger.warn(`[Matrix] Failed to update power levels for group ${hangoutGroupId}: ${err.message}`);
    }
  }

  // Update room name
  if (settings.name) {
    try {
      await synapsePut(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
        { name: settings.name },
        adminToken
      );
    } catch (err) {
      logger.warn(`[Matrix] Failed to update room name for group ${hangoutGroupId}: ${err.message}`);
    }
  }

  // Update room topic (description)
  if (settings.description !== undefined) {
    try {
      await synapsePut(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.topic`,
        { topic: settings.description || '' },
        adminToken
      );
    } catch (err) {
      logger.warn(`[Matrix] Failed to update room topic for group ${hangoutGroupId}: ${err.message}`);
    }
  }
}

/**
 * Set a user's power level in a hangout's Matrix room.
 * Used when promoting/demoting moderators.
 *
 * @param {number} hangoutGroupId
 * @param {string} matrixUserId  e.g. @pnptv_123:matrix.pnptv.app
 * @param {number} powerLevel    0=member, 50=moderator, 100=admin
 */
async function setUserPowerLevel(hangoutGroupId, matrixUserId, powerLevel) {
  const { rows } = await query(
    'SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1',
    [hangoutGroupId]
  );
  if (rows.length === 0) return;

  const roomId = rows[0].matrix_room_id;
  const adminToken = await getAdminToken();

  try {
    const currentPL = await synapseGet(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
      adminToken
    );

    currentPL.users = currentPL.users || {};
    currentPL.users[matrixUserId] = powerLevel;

    await synapsePut(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
      currentPL,
      adminToken
    );
    logger.info(`[Matrix] Set power level ${powerLevel} for ${matrixUserId} in room ${roomId}`);
  } catch (err) {
    logger.warn(`[Matrix] Failed to set power level for ${matrixUserId}: ${err.message}`);
  }
}

module.exports = {
  provisionMatrixUser,
  getOrCreateDmRoom,
  getOrCreateHangoutRoom,
  inviteToHangoutRoom,
  removeFromHangoutRoom,
  getMatrixToken,
  ensureUserInRoom,
  sendRoomMessage,
  sendRoomMediaMessage,
  uploadMedia,
  redactRoomEvent,
  syncRoomSettings,
  setUserPowerLevel,
  syncMatrixAvatar,
};
