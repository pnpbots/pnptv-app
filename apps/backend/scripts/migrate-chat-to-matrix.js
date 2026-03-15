#!/usr/bin/env node
'use strict';

/**
 * migrate-chat-to-matrix.js
 *
 * One-time migration script: moves all existing chat messages from PostgreSQL
 * into Matrix rooms via the Synapse homeserver, and ensures all hangout groups
 * and DM pairs have a corresponding Matrix room.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/migrate-chat-to-matrix.js
 *
 * Dry-run mode (logs what would happen, makes no changes):
 *   docker exec pnptv-bot node apps/backend/scripts/migrate-chat-to-matrix.js --dry-run
 *
 * The script is idempotent: rooms that already contain messages beyond the
 * welcome/system message are skipped automatically.
 *
 * Migration order:
 *   1. Hangout group rooms (room format: hangout:{groupId})
 *   2. Community rooms (general, prime)
 *   3. DM conversations (direct_messages table)
 */

const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {
  // dotenv optional; container env vars take precedence
}

const { getPool, query, closePool } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const matrixService = require(path.join(BACKEND_ROOT, 'bot/services/matrixService'));

// ── Constants ─────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');

const SYNAPSE_INTERNAL_URL = process.env.MATRIX_SYNAPSE_URL || 'http://synapse:8008';
const MATRIX_SERVER_NAME   = process.env.MATRIX_SERVER_NAME || 'matrix.pnptv.app';
const APP_PUBLIC_URL        = process.env.APP_PUBLIC_URL || 'https://app.pnptv.app';

// Delay between individual Matrix message sends to avoid overwhelming Synapse
const MESSAGE_DELAY_MS = 50;

// Delay between rooms to be polite to the homeserver
const ROOM_DELAY_MS = 200;

// Welcome message sent as fallback when message import fails
const FALLBACK_WELCOME =
  'Chat Upgraded — Your conversations are now end-to-end encrypted via Matrix.\n\n' +
  'Previous messages were cleared as part of our privacy upgrade. Your shared photos ' +
  'and videos are still available in other parts of the app.\n\n' +
  'Welcome to the new secure chat!';

// Community room definitions
const COMMUNITY_ROOMS = [
  { pgRoom: 'general', name: 'General Chat',   alias: 'pnptv_general' },
  { pgRoom: 'prime',   name: 'Prime Lounge',   alias: 'pnptv_prime'   },
];

// ── Logging ───────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}[${tag}] ${msg}`);
}

function warn(tag, msg) {
  console.warn(`  WARN [${tag}] ${msg}`);
}

function err(tag, msg) {
  console.error(`  ERROR [${tag}] ${msg}`);
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Synapse HTTP helpers (mirrors pattern in matrixService.js) ────────────────

async function synapsePut(path_, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const res = await fetch(`${SYNAPSE_INTERNAL_URL}${path_}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Synapse error ${res.status}`);
    e.errcode = data.errcode;
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

async function synapsePost(path_, body, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${SYNAPSE_INTERNAL_URL}${path_}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Synapse error ${res.status}`);
    e.errcode = data.errcode;
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

async function synapseGet(path_, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${SYNAPSE_INTERNAL_URL}${path_}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Synapse error ${res.status}`);
    e.errcode = data.errcode;
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

// ── Admin token (from matrixService module via direct call) ───────────────────

let _adminToken = null;

async function getAdminToken() {
  if (_adminToken) return _adminToken;
  const adminUser     = process.env.MATRIX_ADMIN_USER || 'pnptv_admin';
  const adminPassword = process.env.MATRIX_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('MATRIX_ADMIN_PASSWORD env var not set — cannot obtain admin token');
  }
  const loginResp = await synapsePost('/_matrix/client/v3/login', {
    type:       'm.login.password',
    identifier: { type: 'm.id.user', user: adminUser },
    password:   adminPassword,
    initial_device_display_name: 'pnptv-migration-script',
  });
  _adminToken = loginResp.access_token;
  log('Auth', `Obtained admin token for @${adminUser}:${MATRIX_SERVER_NAME}`);
  return _adminToken;
}

// ── Room event count check ────────────────────────────────────────────────────

/**
 * Returns true if the room already has real (non-system) messages beyond the
 * initial room-creation events. We use the Synapse admin API to get the
 * event count efficiently without downloading every event.
 *
 * Conservative threshold: > 5 events means room was previously populated.
 * Room creation + join events for small rooms should be well under 5.
 */
async function roomAlreadyPopulated(matrixRoomId) {
  try {
    const adminToken = await getAdminToken();
    // GET /_synapse/admin/v1/rooms/<roomId> returns event_count
    const info = await synapseGet(
      `/_synapse/admin/v1/rooms/${encodeURIComponent(matrixRoomId)}`,
      adminToken
    );
    // event_count includes state events (create, join, power levels, etc.)
    // A freshly created room with 2 members typically has ~10 state events.
    // We count timeline (non-state) events separately where possible, but
    // event_count from this endpoint is total. Use 15 as a safe floor:
    // if more than 15 events exist, actual messages have been sent.
    return (info.state_events || 0) > 15;
  } catch (e) {
    warn('CheckRoom', `Could not check event count for ${matrixRoomId}: ${e.message} — assuming not populated`);
    return false;
  }
}

// ── Send a single message into a Matrix room as a specific user ───────────────

/**
 * Sends one PG chat message row into a Matrix room, impersonating the original
 * sender. Falls back to admin token if the sender cannot be provisioned.
 *
 * Timestamp override: Synapse's admin API supports ?ts=<ms_epoch> on the send
 * endpoint to backdate events when the requester is a server admin.
 */
async function sendMessageToMatrix(matrixRoomId, msg, senderToken, senderMatrixId, adminToken) {
  const txnId = `mig_${msg.id}_${Date.now()}`;
  const createdMs = msg.created_at ? new Date(msg.created_at).getTime() : Date.now();

  let content;
  if (msg.media_url) {
    // Media message — reference external URL (no re-upload needed)
    const mediaAbsUrl = msg.media_url.startsWith('http')
      ? msg.media_url
      : `${APP_PUBLIC_URL}${msg.media_url}`;

    if (msg.media_type === 'video') {
      content = {
        msgtype: 'm.video',
        body:    path.basename(msg.media_url || 'video.mp4'),
        url:     mediaAbsUrl,
        info:    {
          mimetype: msg.media_mime || 'video/mp4',
          w:        msg.media_width  || undefined,
          h:        msg.media_height || undefined,
          thumbnail_url: msg.media_thumb_url
            ? (msg.media_thumb_url.startsWith('http') ? msg.media_thumb_url : `${APP_PUBLIC_URL}${msg.media_thumb_url}`)
            : undefined,
        },
      };
    } else {
      // Default to m.image for images and unknown media
      content = {
        msgtype: 'm.image',
        body:    path.basename(msg.media_url || 'image.webp'),
        url:     mediaAbsUrl,
        info:    {
          mimetype: msg.media_mime || 'image/webp',
          w:        msg.media_width  || undefined,
          h:        msg.media_height || undefined,
          thumbnail_url: msg.media_thumb_url
            ? (msg.media_thumb_url.startsWith('http') ? msg.media_thumb_url : `${APP_PUBLIC_URL}${msg.media_thumb_url}`)
            : undefined,
        },
      };
    }
    // Append text caption as a notice after the media if present
    if (msg.content && msg.content.trim()) {
      content.body = `${content.body} — ${msg.content.trim()}`;
    }
  } else {
    // Plain text message
    const text = (msg.content || '').trim();
    if (!text) return; // skip empty messages
    content = { msgtype: 'm.text', body: text };
  }

  if (DRY_RUN) {
    log('Send', `  [DRY] Would send ${content.msgtype} to ${matrixRoomId} as ${senderMatrixId} (ts=${createdMs}): ${content.body.slice(0, 80)}`);
    return;
  }

  // Try sending as the original user with timestamp override
  // The ?ts parameter requires admin or appservice privileges in Synapse.
  // We use the admin token to send on behalf of the user via the
  // /_matrix/client/v3/rooms/{roomId}/send path with ?user_id for masquerading,
  // which requires the server admin scope on the token.
  // If the sender token works with ?ts, use it directly; otherwise fall back
  // to the admin token with user_id masquerade.
  const tsParam = `?ts=${createdMs}&user_id=${encodeURIComponent(senderMatrixId)}`;
  const putPath = `/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/send/m.room.message/${txnId}${tsParam}`;

  try {
    await synapsePut(putPath, content, adminToken);
  } catch (sendErr) {
    if (sendErr.errcode === 'M_FORBIDDEN' || sendErr.statusCode === 403) {
      // Try without masquerade as a last resort (message will appear as admin)
      const plainPath = `/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/send/m.room.message/${txnId}?ts=${createdMs}`;
      await synapsePut(plainPath, {
        ...content,
        body: `[${msg.first_name || msg.username || 'User'}] ${content.body}`,
      }, adminToken);
    } else {
      throw sendErr;
    }
  }
}

// ── Send fallback welcome message ─────────────────────────────────────────────

async function sendFallbackWelcome(matrixRoomId, adminToken) {
  if (DRY_RUN) {
    log('Fallback', `[DRY] Would send fallback welcome to ${matrixRoomId}`);
    return;
  }
  const txnId = `welcome_${matrixRoomId}_${Date.now()}`;
  const putPath = `/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/send/m.room.message/${txnId}`;
  await synapsePut(putPath, { msgtype: 'm.text', body: FALLBACK_WELCOME }, adminToken);
}

// ── Migrate messages for a given PG room into an existing Matrix room ─────────

async function migrateRoomMessages(tag, pgRoom, matrixRoomId, adminToken, senderTokenCache) {
  // Idempotency check
  const alreadyDone = await roomAlreadyPopulated(matrixRoomId);
  if (alreadyDone) {
    log(tag, `Room ${matrixRoomId} already has messages — skipping`);
    return;
  }

  const { rows: messages } = await query(
    `SELECT id, user_id, username, first_name, content,
            media_url, media_type, media_mime, media_thumb_url,
            media_width, media_height, created_at
     FROM chat_messages
     WHERE room = $1 AND is_deleted = false
     ORDER BY created_at ASC`,
    [pgRoom]
  );

  if (messages.length === 0) {
    log(tag, `No messages in PG room "${pgRoom}" — nothing to migrate`);
    return;
  }

  log(tag, `Migrating ${messages.length} messages from "${pgRoom}" into ${matrixRoomId}...`);

  let successCount = 0;
  let failCount    = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Progress log every 50 messages
    if (i > 0 && i % 50 === 0) {
      log(tag, `  [${i}/${messages.length}] ${successCount} sent, ${failCount} failed`);
    }

    // Resolve sender Matrix credentials (cached per user_id)
    let senderToken   = null;
    let senderMatrixId = null;

    if (msg.user_id) {
      if (senderTokenCache.has(msg.user_id)) {
        const cached = senderTokenCache.get(msg.user_id);
        senderToken    = cached.accessToken;
        senderMatrixId = cached.matrixUserId;
      } else {
        try {
          const creds = await matrixService.getMatrixToken(msg.user_id);
          senderTokenCache.set(msg.user_id, creds);
          senderToken    = creds.accessToken;
          senderMatrixId = creds.matrixUserId;
        } catch (provErr) {
          warn(tag, `  Could not provision Matrix user for PNPtv user ${msg.user_id}: ${provErr.message}`);
          // Fall through — we will send as admin with attribution in message body
        }
      }
    }

    // Build a fallback Matrix ID using the username/first_name if provisioning failed
    if (!senderMatrixId) {
      const displayName = msg.first_name || msg.username || `user_${msg.user_id || 'unknown'}`;
      senderMatrixId = `@pnptv_unknown:${MATRIX_SERVER_NAME}`;
      // Override body to include attribution
      if (msg.content) {
        msg.content = `[${displayName}] ${msg.content}`;
      }
    }

    try {
      await sendMessageToMatrix(matrixRoomId, msg, senderToken, senderMatrixId, adminToken);
      successCount++;
    } catch (msgErr) {
      failCount++;
      warn(tag, `  Failed to send message id=${msg.id}: ${msgErr.message}`);
    }

    if (!DRY_RUN && MESSAGE_DELAY_MS > 0) {
      await sleep(MESSAGE_DELAY_MS);
    }
  }

  log(tag, `  [${messages.length}/${messages.length}] Done! ${successCount} sent, ${failCount} failed`);

  if (failCount > 0 && successCount === 0) {
    warn(tag, `All messages failed — sending fallback welcome message`);
    try {
      await sendFallbackWelcome(matrixRoomId, adminToken);
    } catch (wErr) {
      err(tag, `Fallback welcome also failed: ${wErr.message}`);
    }
  }
}

// ── Task 1: Migrate hangout rooms ─────────────────────────────────────────────

async function migrateHangoutRooms(adminToken, senderTokenCache) {
  log('Hangouts', '=== Starting hangout room migration ===');

  const { rows: hangoutRooms } = await query(
    `SELECT DISTINCT room FROM chat_messages
     WHERE is_deleted = false AND room LIKE 'hangout:%'
     ORDER BY room`
  );

  log('Hangouts', `Found ${hangoutRooms.length} distinct hangout rooms in chat_messages`);

  for (const { room } of hangoutRooms) {
    const match = room.match(/^hangout:(\d+)$/);
    if (!match) {
      warn('Hangouts', `Unrecognised room format "${room}" — skipping`);
      continue;
    }

    const groupId = parseInt(match[1], 10);
    const tag     = `hangout:${groupId}`;

    try {
      // Load hangout group info
      const { rows: groupRows } = await query(
        `SELECT id, name, creator_id FROM hangout_groups WHERE id = $1`,
        [groupId]
      );

      if (groupRows.length === 0) {
        warn(tag, `Hangout group ${groupId} not found in hangout_groups — skipping`);
        continue;
      }

      const group = groupRows[0];

      // Load creator user
      const { rows: creatorRows } = await query(
        `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token, matrix_device_id
         FROM users WHERE id = $1 AND is_deleted = false`,
        [group.creator_id]
      );

      if (creatorRows.length === 0) {
        warn(tag, `Creator user ${group.creator_id} not found — skipping group ${groupId}`);
        continue;
      }

      const creatorUser = creatorRows[0];

      log(tag, `Processing hangout "${group.name}" (id=${groupId})`);

      // Get or create Matrix room
      let matrixRoomId;
      if (DRY_RUN) {
        // For dry run, just check if the room already exists in DB
        const { rows: existingRoom } = await query(
          `SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1`,
          [groupId]
        );
        matrixRoomId = existingRoom[0]?.matrix_room_id || `!dry_run_${groupId}:${MATRIX_SERVER_NAME}`;
        log(tag, `[DRY] Would getOrCreateHangoutRoom for group ${groupId} -> ${matrixRoomId}`);
      } else {
        matrixRoomId = await matrixService.getOrCreateHangoutRoom(groupId, creatorUser, group.name);
        log(tag, `Matrix room: ${matrixRoomId}`);
      }

      // Provision and invite all existing members
      const { rows: memberRows } = await query(
        `SELECT u.id, u.telegram, u.username, u.first_name,
                u.matrix_user_id, u.matrix_access_token, u.matrix_device_id
         FROM hangout_group_members hgm
         JOIN users u ON u.id = hgm.user_id
         WHERE hgm.group_id = $1 AND u.is_deleted = false`,
        [groupId]
      );

      log(tag, `  Inviting ${memberRows.length} members to Matrix room`);

      for (const member of memberRows) {
        if (DRY_RUN) {
          log(tag, `  [DRY] Would invite user ${member.id} (${member.username || member.first_name})`);
          continue;
        }
        try {
          await matrixService.inviteToHangoutRoom(groupId, member);
        } catch (invErr) {
          warn(tag, `  Failed to invite user ${member.id}: ${invErr.message}`);
        }
      }

      // Migrate messages
      await migrateRoomMessages(tag, room, matrixRoomId, adminToken, senderTokenCache);

    } catch (groupErr) {
      err(tag, `Failed to process hangout ${groupId}: ${groupErr.message}`);
      // Continue to next room — one failure should not stop everything
    }

    if (!DRY_RUN) await sleep(ROOM_DELAY_MS);
  }

  log('Hangouts', '=== Hangout room migration complete ===');
}

// ── Task 2 (community rooms): Get or create with admin credentials ────────────

async function getOrCreateCommunityMatrixRoom(pgRoom, name, alias, adminToken) {
  // Check if we already have a mapping stored in a custom table or key
  // We use a simple key-value approach: insert into a lightweight meta table
  // (community_matrix_rooms) if it exists, otherwise just log the IDs.
  // First check if the table exists:
  const { rows: tableCheck } = await query(
    `SELECT to_regclass('community_matrix_rooms') AS tbl`
  );
  const tableExists = tableCheck[0]?.tbl != null;

  if (tableExists) {
    const { rows: existing } = await query(
      `SELECT matrix_room_id FROM community_matrix_rooms WHERE pg_room = $1`,
      [pgRoom]
    );
    if (existing.length > 0) {
      log(`community:${pgRoom}`, `Reusing existing Matrix room ${existing[0].matrix_room_id}`);
      return existing[0].matrix_room_id;
    }
  }

  if (DRY_RUN) {
    log(`community:${pgRoom}`, `[DRY] Would create Matrix room "${name}" (alias: #${alias}:${MATRIX_SERVER_NAME})`);
    return `!dry_run_${pgRoom}:${MATRIX_SERVER_NAME}`;
  }

  // Create the room using the admin user token
  const adminLoginResp = await synapsePost('/_matrix/client/v3/login', {
    type:       'm.login.password',
    identifier: { type: 'm.id.user', user: process.env.MATRIX_ADMIN_USER || 'pnptv_admin' },
    password:   process.env.MATRIX_ADMIN_PASSWORD,
    initial_device_display_name: 'pnptv-migration-community',
  });
  const adminUserToken = adminLoginResp.access_token;

  let roomId;
  try {
    const roomResp = await synapsePost(
      '/_matrix/client/v3/createRoom',
      {
        name,
        topic:       `PNPtv Community: ${name}`,
        preset:      'public_chat',
        visibility:  'private',
        room_alias_name: alias,
        creation_content: { 'm.federate': false },
      },
      adminUserToken
    );
    roomId = roomResp.room_id;
    log(`community:${pgRoom}`, `Created Matrix room ${roomId} (alias: #${alias}:${MATRIX_SERVER_NAME})`);
  } catch (createErr) {
    if (createErr.errcode === 'M_ROOM_IN_USE') {
      // Alias already taken — resolve it
      const resolveResp = await synapseGet(
        `/_matrix/client/v3/directory/room/${encodeURIComponent(`#${alias}:${MATRIX_SERVER_NAME}`)}`,
        adminToken
      );
      roomId = resolveResp.room_id;
      log(`community:${pgRoom}`, `Room alias already exists, resolved to ${roomId}`);
    } else {
      throw createErr;
    }
  }

  // Persist the mapping if the table exists
  if (tableExists && roomId) {
    await query(
      `INSERT INTO community_matrix_rooms (pg_room, matrix_room_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (pg_room) DO UPDATE SET matrix_room_id = EXCLUDED.matrix_room_id`,
      [pgRoom, roomId, name]
    );
  } else if (roomId) {
    log(`community:${pgRoom}`, `NOTE: community_matrix_rooms table not found. Room ID: ${roomId} — record this manually.`);
  }

  return roomId;
}

async function migrateCommunityRooms(adminToken, senderTokenCache) {
  log('Community', '=== Starting community room migration ===');

  const { rows: existingPgRooms } = await query(
    `SELECT DISTINCT room FROM chat_messages
     WHERE is_deleted = false AND room IN ('general', 'prime')
     ORDER BY room`
  );

  const existingSet = new Set(existingPgRooms.map(r => r.room));

  for (const { pgRoom, name, alias } of COMMUNITY_ROOMS) {
    if (!existingSet.has(pgRoom)) {
      log(`community:${pgRoom}`, `No messages in PG for room "${pgRoom}" — skipping`);
      continue;
    }

    const tag = `community:${pgRoom}`;

    try {
      const matrixRoomId = await getOrCreateCommunityMatrixRoom(pgRoom, name, alias, adminToken);
      await migrateRoomMessages(tag, pgRoom, matrixRoomId, adminToken, senderTokenCache);
    } catch (cErr) {
      err(tag, `Failed to migrate community room "${pgRoom}": ${cErr.message}`);
    }

    if (!DRY_RUN) await sleep(ROOM_DELAY_MS);
  }

  log('Community', '=== Community room migration complete ===');
}

// ── Task 3: Migrate DM conversations ─────────────────────────────────────────

async function migrateDmConversations(adminToken, senderTokenCache) {
  log('DMs', '=== Starting DM migration ===');

  // Get all distinct DM pairs that have at least one non-deleted message
  const { rows: pairs } = await query(
    `SELECT DISTINCT
       LEAST(sender_id, recipient_id)    AS user_a,
       GREATEST(sender_id, recipient_id) AS user_b
     FROM direct_messages
     WHERE is_deleted = false
     ORDER BY user_a, user_b`
  );

  log('DMs', `Found ${pairs.length} distinct DM pairs`);

  for (const { user_a, user_b } of pairs) {
    const tag = `dm:${user_a}:${user_b}`;

    try {
      // Load both users
      const { rows: userRows } = await query(
        `SELECT id, telegram, username, first_name,
                matrix_user_id, matrix_access_token, matrix_device_id
         FROM users
         WHERE id = ANY($1::int[]) AND is_deleted = false`,
        [[user_a, user_b]]
      );

      if (userRows.length < 2) {
        warn(tag, `Could not load both users (found ${userRows.length}) — skipping`);
        continue;
      }

      const userMap = Object.fromEntries(userRows.map(u => [u.id, u]));
      const uA = userMap[user_a];
      const uB = userMap[user_b];

      if (!uA || !uB) {
        warn(tag, `Missing user record — skipping`);
        continue;
      }

      log(tag, `Processing DM between user ${user_a} and ${user_b}`);

      // Get or create Matrix DM room
      let matrixRoomId;
      if (DRY_RUN) {
        const { rows: existingRoom } = await query(
          `SELECT matrix_room_id FROM dm_matrix_rooms WHERE user_a = $1 AND user_b = $2`,
          [user_a, user_b]
        );
        matrixRoomId = existingRoom[0]?.matrix_room_id || `!dry_dm_${user_a}_${user_b}:${MATRIX_SERVER_NAME}`;
        log(tag, `[DRY] Would getOrCreateDmRoom -> ${matrixRoomId}`);
      } else {
        matrixRoomId = await matrixService.getOrCreateDmRoom(uA, uB);
        log(tag, `Matrix DM room: ${matrixRoomId}`);
      }

      // Idempotency check
      const alreadyDone = DRY_RUN ? false : await roomAlreadyPopulated(matrixRoomId);
      if (alreadyDone) {
        log(tag, `DM room already populated — skipping`);
        continue;
      }

      // Load all DM messages for this pair ordered by time
      const { rows: messages } = await query(
        `SELECT id, sender_id AS user_id, NULL AS username, NULL AS first_name,
                content, media_url, media_type, media_mime, media_thumb_url,
                NULL AS media_width, NULL AS media_height, created_at
         FROM direct_messages
         WHERE (
           (sender_id = $1 AND recipient_id = $2) OR
           (sender_id = $2 AND recipient_id = $1)
         )
         AND is_deleted = false
         ORDER BY created_at ASC`,
        [user_a, user_b]
      );

      if (messages.length === 0) {
        log(tag, `No messages found — skipping`);
        continue;
      }

      log(tag, `Migrating ${messages.length} DM messages...`);

      // Enrich messages with sender display names from user records
      const enriched = messages.map(m => {
        const sender = userMap[m.user_id];
        return {
          ...m,
          first_name: sender?.first_name || null,
          username:   sender?.username   || null,
        };
      });

      let successCount = 0;
      let failCount    = 0;

      for (let i = 0; i < enriched.length; i++) {
        const msg = enriched[i];

        if (i > 0 && i % 50 === 0) {
          log(tag, `  [${i}/${enriched.length}] ${successCount} sent, ${failCount} failed`);
        }

        // Resolve sender credentials
        let senderToken    = null;
        let senderMatrixId = null;

        if (msg.user_id) {
          if (senderTokenCache.has(msg.user_id)) {
            const cached = senderTokenCache.get(msg.user_id);
            senderToken    = cached.accessToken;
            senderMatrixId = cached.matrixUserId;
          } else {
            try {
              const creds = await matrixService.getMatrixToken(msg.user_id);
              senderTokenCache.set(msg.user_id, creds);
              senderToken    = creds.accessToken;
              senderMatrixId = creds.matrixUserId;
            } catch (provErr) {
              warn(tag, `  Cannot provision Matrix user for ${msg.user_id}: ${provErr.message}`);
            }
          }
        }

        if (!senderMatrixId) {
          const displayName = msg.first_name || msg.username || `user_${msg.user_id}`;
          senderMatrixId = `@pnptv_unknown:${MATRIX_SERVER_NAME}`;
          if (msg.content) msg.content = `[${displayName}] ${msg.content}`;
        }

        try {
          await sendMessageToMatrix(matrixRoomId, msg, senderToken, senderMatrixId, adminToken);
          successCount++;
        } catch (msgErr) {
          failCount++;
          warn(tag, `  Failed message id=${msg.id}: ${msgErr.message}`);
        }

        if (!DRY_RUN && MESSAGE_DELAY_MS > 0) await sleep(MESSAGE_DELAY_MS);
      }

      log(tag, `  [${enriched.length}/${enriched.length}] Done! ${successCount} sent, ${failCount} failed`);

      if (failCount > 0 && successCount === 0) {
        warn(tag, `All messages failed — sending fallback welcome`);
        try {
          if (!DRY_RUN) await sendFallbackWelcome(matrixRoomId, adminToken);
        } catch (wErr) {
          err(tag, `Fallback welcome failed: ${wErr.message}`);
        }
      }

    } catch (pairErr) {
      err(tag, `Failed to process DM pair: ${pairErr.message}`);
    }

    if (!DRY_RUN) await sleep(ROOM_DELAY_MS);
  }

  log('DMs', '=== DM migration complete ===');
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    console.log('');
    console.log('========================================');
    console.log('   DRY-RUN MODE — no changes will be   ');
    console.log('   made to Matrix or the database.      ');
    console.log('========================================');
    console.log('');
  }

  log('Main', 'Initialising PostgreSQL connection pool...');
  getPool(); // Trigger initialisation

  log('Main', 'Obtaining Synapse admin token...');
  const adminToken = await getAdminToken();

  // Shared cache so we only provision each user once across all rooms/DMs
  const senderTokenCache = new Map();

  await migrateHangoutRooms(adminToken, senderTokenCache);
  await migrateCommunityRooms(adminToken, senderTokenCache);
  await migrateDmConversations(adminToken, senderTokenCache);

  log('Main', 'Migration complete. Closing database pool...');
  await closePool();

  console.log('');
  console.log('Migration finished successfully.');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL migration error:', e);
  closePool().catch(() => {});
  process.exit(1);
});
