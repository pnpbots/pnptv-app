'use strict';

/**
 * matrixController.js
 *
 * HTTP API surface for the Matrix/Synapse bridge layer.
 *
 * All endpoints require an authenticated session (requireSessionAuth middleware
 * applied at route registration in routes.js).
 *
 * Routes (registered in routes.js):
 *   GET  /api/webapp/matrix/token
 *   POST /api/webapp/matrix/dm/:userId
 *   POST /api/webapp/matrix/hangout-room/:groupId
 *   POST /api/webapp/matrix/hangout-room/:groupId/sync-members
 */

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const matrixService = require('../../services/matrixService');

const MATRIX_PUBLIC_URL = process.env.MATRIX_PUBLIC_URL || 'https://matrix.pnptv.app';

// ─── helpers ──────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ success: false, error: { code: 'unauthorized', message: 'Not authenticated' } });
    return null;
  }
  return user;
};

// ─── GET /api/webapp/matrix/token ─────────────────────────────────────────────

/**
 * Returns the caller's Matrix credentials, provisioning the account if needed.
 *
 * Response: { success: true, matrixUserId, accessToken, homeserverUrl }
 */
const getToken = async (req, res) => {
  const sessionUser = authGuard(req, res);
  if (!sessionUser) return;

  try {
    const creds = await matrixService.getMatrixToken(sessionUser.id);

    return res.json({
      success: true,
      matrixUserId:   creds.matrixUserId,
      accessToken:    creds.accessToken,
      homeserverUrl:  MATRIX_PUBLIC_URL,
    });
  } catch (err) {
    logger.error(`[Matrix API] getToken error for user ${sessionUser.id}:`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'provision_failed', message: err.message },
    });
  }
};

// ─── POST /api/webapp/matrix/dm/:userId ───────────────────────────────────────

/**
 * Creates or retrieves a Matrix DM room between the authenticated user and
 * another PNPtv user identified by :userId (PNPtv users.id).
 *
 * Response: { success: true, roomId }
 */
const getOrCreateDmRoom = async (req, res) => {
  const sessionUser = authGuard(req, res);
  if (!sessionUser) return;

  const partnerId = String(req.params.userId || '').trim();
  if (!partnerId) {
    return res.status(400).json({
      success: false,
      error: { code: 'invalid_user_id', message: 'userId is required' },
    });
  }

  if (partnerId === String(sessionUser.id)) {
    return res.status(400).json({
      success: false,
      error: { code: 'self_dm', message: 'Cannot create a DM room with yourself' },
    });
  }

  try {
    // Load both users' DB rows so matrixService has telegram IDs
    const callerId = String(sessionUser.id);
    const { rows } = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users
       WHERE id = ANY($1::text[]) AND is_deleted = false`,
      [[callerId, partnerId]]
    );

    const callerUser  = rows.find(r => String(r.id) === callerId);
    const partnerUser = rows.find(r => String(r.id) === partnerId);

    if (!callerUser) {
      return res.status(401).json({
        success: false,
        error: { code: 'caller_not_found', message: 'Session user not found in database' },
      });
    }

    if (!partnerUser) {
      return res.status(404).json({
        success: false,
        error: { code: 'partner_not_found', message: 'Target user not found' },
      });
    }

    const roomId = await matrixService.getOrCreateDmRoom(callerUser, partnerUser);

    return res.json({ success: true, roomId });
  } catch (err) {
    logger.error(`[Matrix API] getOrCreateDmRoom error (caller=${sessionUser.id}, partner=${partnerId}):`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'room_creation_failed', message: err.message },
    });
  }
};

// ─── POST /api/webapp/matrix/hangout-room/:groupId ────────────────────────────

/**
 * Creates or retrieves the Matrix room for a hangout group.
 * Only members of the group may call this endpoint.
 *
 * Response: { success: true, roomId }
 */
const getOrCreateHangoutRoom = async (req, res) => {
  const sessionUser = authGuard(req, res);
  if (!sessionUser) return;

  const groupId = parseInt(req.params.groupId, 10);
  if (!groupId || isNaN(groupId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'invalid_group_id', message: 'groupId must be a valid integer' },
    });
  }

  try {
    // Verify group exists and caller is a member
    const groupResult = await query(
      `SELECT g.id, g.name, g.is_main
       FROM hangout_groups g
       JOIN hangout_group_members m ON m.group_id = g.id AND m.user_id = $1
       WHERE g.id = $2`,
      [sessionUser.id, groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: { code: 'not_a_member', message: 'You are not a member of this hangout group' },
      });
    }

    const group = groupResult.rows[0];

    // Load caller's full DB row for provisioning
    const userResult = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users WHERE id = $1 AND is_deleted = false`,
      [sessionUser.id]
    );

    const callerUser = userResult.rows[0];
    if (!callerUser) {
      return res.status(401).json({
        success: false,
        error: { code: 'user_not_found', message: 'Session user not found in database' },
      });
    }

    const roomId = await matrixService.getOrCreateHangoutRoom(groupId, callerUser, group.name);

    return res.json({ success: true, roomId });
  } catch (err) {
    logger.error(`[Matrix API] getOrCreateHangoutRoom error (user=${sessionUser.id}, group=${groupId}):`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'room_creation_failed', message: err.message },
    });
  }
};

// ─── POST /api/webapp/matrix/hangout-room/:groupId/sync-members ───────────────

/**
 * Ensures every current member of the hangout group is joined to the Matrix room.
 * Creates the room if it does not yet exist.
 *
 * Only the group creator or a user with role='admin'/'owner' in the group may call this.
 *
 * Response: { success: true, synced: number }
 */
const syncHangoutRoomMembers = async (req, res) => {
  const sessionUser = authGuard(req, res);
  if (!sessionUser) return;

  const groupId = parseInt(req.params.groupId, 10);
  if (!groupId || isNaN(groupId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'invalid_group_id', message: 'groupId must be a valid integer' },
    });
  }

  try {
    // Load group + verify caller has sufficient role
    const groupResult = await query(
      `SELECT g.id, g.name, gm.role
       FROM hangout_groups g
       JOIN hangout_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       WHERE g.id = $2`,
      [sessionUser.id, groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: { code: 'not_a_member', message: 'You are not a member of this hangout group' },
      });
    }

    const { name: groupName, role: callerRole } = groupResult.rows[0];

    if (callerRole !== 'owner' && callerRole !== 'admin' && sessionUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: { code: 'insufficient_role', message: 'Only group owners and admins can sync Matrix room members' },
      });
    }

    // Load caller row for room creation (if room does not yet exist)
    const callerResult = await query(
      `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
       FROM users WHERE id = $1 AND is_deleted = false`,
      [sessionUser.id]
    );

    const callerUser = callerResult.rows[0];
    if (!callerUser) {
      return res.status(401).json({
        success: false,
        error: { code: 'user_not_found', message: 'Session user not found in database' },
      });
    }

    // Ensure room exists
    await matrixService.getOrCreateHangoutRoom(groupId, callerUser, groupName);

    // Load all current group members
    const membersResult = await query(
      `SELECT u.id, u.telegram, u.username, u.first_name, u.matrix_user_id, u.matrix_access_token
       FROM hangout_group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 AND u.is_deleted = false`,
      [groupId]
    );

    const members = membersResult.rows;
    let synced = 0;

    // Invite/join members in series to avoid hammering Synapse
    for (const member of members) {
      try {
        await matrixService.inviteToHangoutRoom(groupId, member);
        synced++;
      } catch (memberErr) {
        // Log and continue — a single member failure should not abort the sync
        logger.warn(`[Matrix API] syncHangoutRoomMembers: failed to sync member ${member.id} into group ${groupId}: ${memberErr.message}`);
      }
    }

    logger.info(`[Matrix API] Synced ${synced}/${members.length} members into Matrix room for group ${groupId}`);
    return res.json({ success: true, synced });
  } catch (err) {
    logger.error(`[Matrix API] syncHangoutRoomMembers error (user=${sessionUser.id}, group=${groupId}):`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'sync_failed', message: err.message },
    });
  }
};

module.exports = {
  getToken,
  getOrCreateDmRoom,
  getOrCreateHangoutRoom,
  syncHangoutRoomMembers,
};
