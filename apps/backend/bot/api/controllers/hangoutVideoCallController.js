'use strict';

/**
 * hangoutVideoCallController.js
 *
 * Manages JaaS-backed video calls within hangout groups.
 *
 * Each hangout group can have at most ONE active call at a time (enforced by a
 * partial unique index on hangout_video_calls).
 *
 * Endpoints:
 *   POST /api/webapp/hangouts/groups/:id/calls         -- start a new call
 *   GET  /api/webapp/hangouts/groups/:id/calls/active   -- get the active call
 *   POST /api/webapp/hangouts/groups/:id/calls/:callId/join -- join a call
 *   POST /api/webapp/hangouts/groups/:id/calls/:callId/end  -- end a call
 *
 * All endpoints require a valid session.  Socket.IO events are emitted to
 * `hangout:<groupId>` so connected clients receive real-time call updates.
 */

const { query, getClient } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const jaasService = require('../../services/jaasService');

// ── Helpers ──────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

const isMember = async (groupId, userId) => {
  const { rows } = await query(
    'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
    [groupId, userId]
  );
  return rows.length > 0;
};

/**
 * Generate a deterministic, URL-safe room name for a hangout call.
 */
function generateRoomName(groupId) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `hangout-${groupId}-${ts}-${rand}`;
}

/**
 * Build a JaaS JWT and meeting URL for a given user/call, or return null if
 * JaaS is not configured (graceful degradation).
 */
function buildJaasPayload(roomName, user, isModerator) {
  if (!jaasService.isConfigured()) {
    return null;
  }

  try {
    const token = isModerator
      ? jaasService.generateModeratorToken(
          roomName,
          String(user.id),
          user.firstName || user.username || 'User',
          '',
          user.photoUrl || ''
        )
      : jaasService.generateViewerToken(
          roomName,
          String(user.id),
          user.firstName || user.username || 'User',
          '',
          user.photoUrl || ''
        );

    const meetingUrl = jaasService.generateMeetingUrl(roomName, token);

    return {
      token,
      meetingUrl,
      domain: '8x8.vc',
      appId: jaasService.appId,
    };
  } catch (err) {
    logger.warn('buildJaasPayload failed', { error: err.message });
    return null;
  }
}

/**
 * Emit a Socket.IO event to the hangout room.
 */
function emitToHangout(req, groupId, event, payload) {
  const io = req.app.get('io');
  if (io) {
    // Hangout group chats join room "hangout:<groupId>" via chat:join
    io.to(`hangout:${groupId}`).emit(event, payload);
  }
}

// ── POST /api/webapp/hangouts/groups/:id/calls ──────────────────────────────
// Start a new video call in the hangout group.

const startCall = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }

  try {
    // Verify membership
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Check for an already-active call
    const { rows: existing } = await query(
      `SELECT id, room_name, creator_id, created_at
       FROM hangout_video_calls
       WHERE group_id = $1 AND status = 'active'
       LIMIT 1`,
      [groupId]
    );

    if (existing.length > 0) {
      // Return the existing call instead of creating a duplicate
      const call = existing[0];
      const isModerator = String(call.creator_id) === String(user.id);
      const jaas = buildJaasPayload(call.room_name, user, isModerator);

      // Auto-join the caller as participant
      await query(
        `INSERT INTO hangout_call_participants (call_id, user_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL`,
        [call.id, user.id, user.firstName || user.username || 'User']
      );

      return res.json({
        success: true,
        isNew: false,
        call: {
          id: call.id,
          groupId,
          roomName: call.room_name,
          creatorId: call.creator_id,
          createdAt: call.created_at,
          isModerator,
        },
        jaas,
      });
    }

    // Verify JaaS is configured before creating a call
    if (!jaasService.isConfigured()) {
      return res.status(503).json({
        error: 'Video call service is not configured. Please contact support.',
      });
    }

    const roomName = generateRoomName(groupId);

    // Insert new call
    const { rows: callRows } = await query(
      `INSERT INTO hangout_video_calls (group_id, creator_id, room_name)
       VALUES ($1, $2, $3)
       RETURNING id, group_id, creator_id, room_name, status, created_at`,
      [groupId, user.id, roomName]
    );

    const newCall = callRows[0];

    // Add creator as first participant
    await query(
      `INSERT INTO hangout_call_participants (call_id, user_id, display_name)
       VALUES ($1, $2, $3)`,
      [newCall.id, user.id, user.firstName || user.username || 'User']
    );

    const jaas = buildJaasPayload(roomName, user, true);

    const callPayload = {
      id: newCall.id,
      groupId,
      roomName,
      creatorId: user.id,
      createdAt: newCall.created_at,
      isModerator: true,
    };

    // Notify all group members via Socket.IO
    emitToHangout(req, groupId, 'hangout:call:started', {
      call: callPayload,
      startedBy: {
        id: user.id,
        username: user.username,
        firstName: user.firstName || user.first_name,
      },
    });

    logger.info('Hangout video call started', {
      callId: newCall.id,
      groupId,
      creatorId: user.id,
      roomName,
    });

    return res.status(201).json({
      success: true,
      isNew: true,
      call: callPayload,
      jaas,
    });
  } catch (err) {
    // Handle race condition: the unique partial index prevents duplicates
    if (err.code === '23505' && err.constraint?.includes('hangout_video_calls_active')) {
      // Another request created the call concurrently; fetch and return it
      try {
        const { rows } = await query(
          `SELECT id, room_name, creator_id, created_at
           FROM hangout_video_calls
           WHERE group_id = $1 AND status = 'active'
           LIMIT 1`,
          [groupId]
        );
        if (rows.length > 0) {
          const call = rows[0];
          const isModerator = String(call.creator_id) === String(user.id);
          const jaas = buildJaasPayload(call.room_name, user, isModerator);
          return res.json({
            success: true,
            isNew: false,
            call: {
              id: call.id,
              groupId,
              roomName: call.room_name,
              creatorId: call.creator_id,
              createdAt: call.created_at,
              isModerator,
            },
            jaas,
          });
        }
      } catch (innerErr) {
        logger.error('startCall race-condition recovery failed', innerErr);
      }
    }

    logger.error('startCall error', err);
    return res.status(500).json({ error: 'Failed to start video call' });
  }
};

// ── GET /api/webapp/hangouts/groups/:id/calls/active ────────────────────────
// Returns the currently active call for the group, if any.

const getActiveCall = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const { rows } = await query(
      `SELECT hvc.id, hvc.room_name, hvc.creator_id, hvc.created_at,
              (SELECT COUNT(*)::int
               FROM hangout_call_participants hcp
               WHERE hcp.call_id = hvc.id AND hcp.left_at IS NULL) AS participant_count
       FROM hangout_video_calls hvc
       WHERE hvc.group_id = $1 AND hvc.status = 'active'
       LIMIT 1`,
      [groupId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, call: null });
    }

    const call = rows[0];

    // Fetch current participants
    const { rows: participants } = await query(
      `SELECT hcp.user_id, hcp.display_name, hcp.joined_at,
              u.username, u.photo_file_id AS photo_url
       FROM hangout_call_participants hcp
       LEFT JOIN users u ON u.id = hcp.user_id
       WHERE hcp.call_id = $1 AND hcp.left_at IS NULL
       ORDER BY hcp.joined_at ASC`,
      [call.id]
    );

    const isModerator = String(call.creator_id) === String(user.id);

    return res.json({
      success: true,
      call: {
        id: call.id,
        groupId,
        roomName: call.room_name,
        creatorId: call.creator_id,
        createdAt: call.created_at,
        participantCount: call.participant_count,
        isModerator,
        participants: participants.map(p => ({
          userId: p.user_id,
          displayName: p.display_name,
          username: p.username,
          photoUrl: p.photo_url && (p.photo_url.startsWith('/') || p.photo_url.startsWith('http'))
            ? p.photo_url
            : null,
          joinedAt: p.joined_at,
        })),
      },
    });
  } catch (err) {
    logger.error('getActiveCall error', err);
    return res.status(500).json({ error: 'Failed to get active call' });
  }
};

// ── POST /api/webapp/hangouts/groups/:id/calls/:callId/join ─────────────────
// Join an existing active call and receive a fresh JaaS JWT.

const joinCall = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  const callId = req.params.callId;

  if (!Number.isFinite(groupId) || !callId) {
    return res.status(400).json({ error: 'Invalid group ID or call ID' });
  }

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Fetch the call (must belong to this group and be active)
    const { rows } = await query(
      `SELECT id, room_name, creator_id, max_participants, created_at
       FROM hangout_video_calls
       WHERE id = $1 AND group_id = $2 AND status = 'active'`,
      [callId, groupId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No active call found' });
    }

    const call = rows[0];

    // Check participant count
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM hangout_call_participants
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    if (countRows[0].cnt >= call.max_participants) {
      return res.status(409).json({ error: 'Call is full' });
    }

    // Upsert participant (clear left_at if re-joining)
    const displayName = user.firstName || user.username || 'User';
    await query(
      `INSERT INTO hangout_call_participants (call_id, user_id, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (call_id, user_id)
       DO UPDATE SET left_at = NULL, joined_at = NOW(), display_name = $3`,
      [callId, user.id, displayName]
    );

    const isModerator = String(call.creator_id) === String(user.id);
    const jaas = buildJaasPayload(call.room_name, user, isModerator);

    // Notify other call participants
    emitToHangout(req, groupId, 'hangout:call:joined', {
      callId: call.id,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName || user.first_name,
        photoUrl: user.photoUrl || null,
      },
    });

    logger.info('User joined hangout call', {
      callId,
      groupId,
      userId: user.id,
    });

    return res.json({
      success: true,
      call: {
        id: call.id,
        groupId,
        roomName: call.room_name,
        creatorId: call.creator_id,
        createdAt: call.created_at,
        isModerator,
      },
      jaas,
    });
  } catch (err) {
    logger.error('joinCall error', err);
    return res.status(500).json({ error: 'Failed to join call' });
  }
};

// ── POST /api/webapp/hangouts/groups/:id/calls/:callId/end ──────────────────
// End an active call.  Only the call creator or a group owner can end it.

const endCall = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  const callId = req.params.callId;

  if (!Number.isFinite(groupId) || !callId) {
    return res.status(400).json({ error: 'Invalid group ID or call ID' });
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Lock the call row
    const { rows } = await client.query(
      `SELECT id, room_name, creator_id
       FROM hangout_video_calls
       WHERE id = $1 AND group_id = $2 AND status = 'active'
       FOR UPDATE`,
      [callId, groupId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active call found' });
    }

    const call = rows[0];

    // Authorization: call creator OR group owner can end the call
    const isCallCreator = String(call.creator_id) === String(user.id);
    let isGroupOwner = false;

    if (!isCallCreator) {
      const { rows: ownerRows } = await client.query(
        `SELECT 1 FROM hangout_group_members
         WHERE group_id = $1 AND user_id = $2 AND role = 'owner'`,
        [groupId, user.id]
      );
      isGroupOwner = ownerRows.length > 0;
    }

    if (!isCallCreator && !isGroupOwner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the call creator or group owner can end the call' });
    }

    // End the call
    await client.query(
      `UPDATE hangout_video_calls
       SET status = 'ended', ended_at = NOW(), ended_by = $1
       WHERE id = $2`,
      [user.id, callId]
    );

    // Mark all participants as left
    await client.query(
      `UPDATE hangout_call_participants
       SET left_at = NOW()
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    await client.query('COMMIT');

    // Notify all group members
    emitToHangout(req, groupId, 'hangout:call:ended', {
      callId: call.id,
      endedBy: {
        id: user.id,
        username: user.username,
        firstName: user.firstName || user.first_name,
      },
    });

    logger.info('Hangout video call ended', {
      callId,
      groupId,
      endedBy: user.id,
    });

    return res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('endCall error', err);
    return res.status(500).json({ error: 'Failed to end call' });
  } finally {
    client.release();
  }
};

// ── POST /api/webapp/hangouts/groups/:id/calls/:callId/leave ────────────────
// Leave a call without ending it (only marks the participant as left).

const leaveCall = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  const callId = req.params.callId;

  if (!Number.isFinite(groupId) || !callId) {
    return res.status(400).json({ error: 'Invalid group ID or call ID' });
  }

  try {
    // Verify the call belongs to this group and is active
    const { rows: callRows } = await query(
      `SELECT id FROM hangout_video_calls
       WHERE id = $1 AND group_id = $2 AND status = 'active'`,
      [callId, groupId]
    );

    if (callRows.length === 0) {
      return res.status(404).json({ error: 'No active call found' });
    }

    // Mark participant as left
    const { rowCount } = await query(
      `UPDATE hangout_call_participants
       SET left_at = NOW()
       WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [callId, user.id]
    );

    if (rowCount > 0) {
      emitToHangout(req, groupId, 'hangout:call:participant:left', {
        callId,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
        },
      });
    }

    // Auto-end the call if no participants remain
    const { rows: remaining } = await query(
      `SELECT COUNT(*)::int AS cnt
       FROM hangout_call_participants
       WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    if (remaining[0].cnt === 0) {
      await query(
        `UPDATE hangout_video_calls
         SET status = 'ended', ended_at = NOW(), ended_by = $1
         WHERE id = $2 AND status = 'active'`,
        [user.id, callId]
      );

      emitToHangout(req, groupId, 'hangout:call:ended', {
        callId,
        endedBy: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
        },
        reason: 'all_participants_left',
      });

      logger.info('Hangout call auto-ended (no participants)', { callId, groupId });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('leaveCall error', err);
    return res.status(500).json({ error: 'Failed to leave call' });
  }
};

module.exports = {
  startCall,
  getActiveCall,
  joinCall,
  endCall,
  leaveCall,
};
