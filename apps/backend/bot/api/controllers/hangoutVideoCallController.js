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
 * Ensure the user is a member of the group before they interact with its calls.
 * For is_main and is_wall_of_fame groups, auto-join instead of blocking.
 * Returns true if the user is (now) a member, false if they should be blocked.
 */
const ensureMembership = async (groupId, userId) => {
  if (await isMember(groupId, userId)) return true;

  const { rows: groupRows } = await query(
    'SELECT is_main, is_wall_of_fame, is_public FROM hangout_groups WHERE id = $1',
    [groupId]
  );
  if (groupRows.length === 0) return false;

  const { is_main, is_wall_of_fame, is_public } = groupRows[0];

  // Auto-join main community groups and public groups
  if (is_main || is_wall_of_fame || is_public) {
    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, userId]
    );
    return true;
  }

  return false;
};

/**
 * Generate a room name for a hangout call.
 * Persistent (is_main) groups get a stable name so Jitsi state survives restarts.
 * Ephemeral groups get a unique per-call name.
 */
function generateRoomName(groupId, isPersistent) {
  if (isPersistent) {
    return `hangout-${groupId}-main`;
  }
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `hangout-${groupId}-${ts}-${rand}`;
}

/**
 * Build a JaaS JWT and meeting URL for a given user/call, or return null if
 * JaaS is not configured (graceful degradation).
 *
 * For persistent (24/7) calls: everyone gets a moderator token (4h) so they
 * can manage their own audio/video and tokens don't expire mid-session.
 */
function buildJaasPayload(roomName, user, isModerator, isPersistent = false) {
  if (!jaasService.isConfigured()) {
    return null;
  }

  try {
    // In persistent (main/24-7) community rooms everyone gets moderator-level access
    // so tokens last 4h and users can control their own media.
    // In user-created subgroups, only the call creator gets moderator access.
    const useMod = isModerator || isPersistent;
    const token = useMod
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
    // Verify / auto-join membership (main + public groups auto-enroll callers)
    if (!(await ensureMembership(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Determine if this is a persistent (24/7) group
    const { rows: groupRows } = await query(
      'SELECT is_main FROM hangout_groups WHERE id = $1',
      [groupId]
    );
    const isPersistent = groupRows[0]?.is_main === true;

    // Check for an already-active call
    const { rows: existing } = await query(
      `SELECT id, room_name, creator_id, created_at, is_persistent
       FROM hangout_video_calls
       WHERE group_id = $1 AND status = 'active'
       LIMIT 1`,
      [groupId]
    );

    if (existing.length > 0) {
      // Return the existing call instead of creating a duplicate
      const call = existing[0];
      const isModerator = String(call.creator_id) === String(user.id);
      const jaas = buildJaasPayload(call.room_name, user, isModerator, call.is_persistent);

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
          isPersistent: call.is_persistent,
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

    const roomName = generateRoomName(groupId, isPersistent);

    // Insert new call — persistent groups use is_persistent=TRUE
    const { rows: callRows } = await query(
      `INSERT INTO hangout_video_calls (group_id, creator_id, room_name, is_persistent)
       VALUES ($1, $2, $3, $4)
       RETURNING id, group_id, creator_id, room_name, status, is_persistent, created_at`,
      [groupId, user.id, roomName, isPersistent]
    );

    const newCall = callRows[0];

    // Add creator as first participant (always moderator)
    await query(
      `INSERT INTO hangout_call_participants (call_id, user_id, display_name, is_moderator)
       VALUES ($1, $2, $3, true)`,
      [newCall.id, user.id, user.firstName || user.username || 'User']
    );

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    const jaas = buildJaasPayload(roomName, user, true, isPersistent);

    const callPayload = {
      id: newCall.id,
      groupId,
      roomName,
      creatorId: user.id,
      createdAt: newCall.created_at,
      isPersistent,
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
    // Auto-join main/public groups so membership never blocks the call fetch
    if (!(await ensureMembership(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    let { rows } = await query(
      `SELECT hvc.id, hvc.room_name, hvc.creator_id, hvc.created_at, hvc.is_persistent,
              (SELECT COUNT(*)::int
               FROM hangout_call_participants hcp
               WHERE hcp.call_id = hvc.id AND hcp.left_at IS NULL) AS participant_count
       FROM hangout_video_calls hvc
       WHERE hvc.group_id = $1 AND hvc.status = 'active'
       LIMIT 1`,
      [groupId]
    );

    if (rows.length === 0) {
      // For persistent groups: auto-resurrect the most recent ended call so the
      // room is always available.  This handles the race between the last person
      // leaving and the next person arriving.
      const { rows: groupRows } = await query(
        'SELECT is_main FROM hangout_groups WHERE id = $1',
        [groupId]
      );
      const isPersistentGroup = groupRows[0]?.is_main === true;

      if (isPersistentGroup && jaasService.isConfigured()) {
        // Resurrect the most recent persistent call, or create a fresh one
        const { rows: lastCall } = await query(
          `SELECT id, room_name, creator_id FROM hangout_video_calls
           WHERE group_id = $1 AND is_persistent = TRUE
           ORDER BY created_at DESC LIMIT 1`,
          [groupId]
        );

        if (lastCall.length > 0) {
          await query(
            `UPDATE hangout_video_calls
             SET status = 'active', ended_at = NULL, ended_by = NULL
             WHERE id = $1`,
            [lastCall[0].id]
          );
          rows = lastCall.map(r => ({ ...r, is_persistent: true, participant_count: 0 }));
          logger.info('Persistent hangout call resurrected', { groupId, callId: lastCall[0].id });
        } else {
          // First ever call for this persistent group — create it now
          const roomName = generateRoomName(groupId, true);
          const { rows: created } = await query(
            `INSERT INTO hangout_video_calls (group_id, creator_id, room_name, is_persistent)
             VALUES ($1, '0', $2, TRUE)
             RETURNING id, room_name, creator_id, created_at`,
            [groupId, roomName]
          );
          rows = created.map(r => ({ ...r, is_persistent: true, participant_count: 0 }));
          logger.info('Persistent hangout call bootstrapped', { groupId, callId: created[0].id });
        }
      } else {
        return res.json({ success: true, call: null });
      }
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
    const jaas = buildJaasPayload(call.room_name, user, isModerator, call.is_persistent);

    return res.json({
      success: true,
      call: {
        id: call.id,
        groupId,
        roomName: call.room_name,
        creatorId: call.creator_id,
        createdAt: call.created_at,
        participantCount: call.participant_count,
        isPersistent: call.is_persistent,
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
      jaas,
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
    // Auto-join main/public groups so membership never blocks joining a call
    if (!(await ensureMembership(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Fetch the call (must belong to this group and be active)
    const { rows } = await query(
      `SELECT id, room_name, creator_id, max_participants, created_at, is_persistent
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
    const jaas = buildJaasPayload(call.room_name, user, isModerator, call.is_persistent);

    // Get authoritative participant count from DB
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    // Notify other call participants
    emitToHangout(req, groupId, 'hangout:call:joined', {
      callId: call.id,
      participantCount: countRows[0]?.cnt || 0,
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
      `SELECT id, room_name, creator_id, is_persistent
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

    // Persistent calls self-resurrect immediately after being ended so the room
    // is always available.  Re-activate with the same room name (no new row needed).
    if (call.is_persistent) {
      await query(
        `UPDATE hangout_video_calls
         SET status = 'active', ended_at = NULL, ended_by = NULL
         WHERE id = $1`,
        [callId]
      );
      emitToHangout(req, groupId, 'hangout:call:started', {
        call: { id: callId, groupId, roomName: call.room_name, isPersistent: true },
        startedBy: null,
      });
      logger.info('Persistent hangout call auto-resurrected after end', { callId, groupId });
    }

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
      `SELECT id, is_persistent, creator_id FROM hangout_video_calls
       WHERE id = $1 AND group_id = $2 AND status = 'active'`,
      [callId, groupId]
    );

    if (callRows.length === 0) {
      return res.status(404).json({ error: 'No active call found' });
    }

    const callRecord = callRows[0];

    // Mark participant as left
    const { rowCount } = await query(
      `UPDATE hangout_call_participants
       SET left_at = NOW()
       WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [callId, user.id]
    );

    if (rowCount > 0) {
      const { rows: countRows } = await query(
        `SELECT COUNT(*)::int AS cnt FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL`,
        [callId]
      );
      emitToHangout(req, groupId, 'hangout:call:participant:left', {
        callId,
        participantCount: countRows[0]?.cnt || 0,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
        },
      });
    }

    // For non-persistent (user-created) groups: end the call when the CREATOR leaves,
    // regardless of whether other participants remain.
    const isCreatorLeaving = !callRecord.is_persistent && String(callRecord.creator_id) === String(user.id);

    if (isCreatorLeaving) {
      // Creator left — terminate the call for everyone
      await query(
        `UPDATE hangout_video_calls
         SET status = 'ended', ended_at = NOW(), ended_by = $1
         WHERE id = $2 AND status = 'active'`,
        [user.id, callId]
      );

      // Mark all remaining participants as left
      await query(
        `UPDATE hangout_call_participants
         SET left_at = NOW()
         WHERE call_id = $1 AND left_at IS NULL`,
        [callId]
      );

      emitToHangout(req, groupId, 'hangout:call:ended', {
        callId,
        endedBy: {
          id: user.id,
          username: user.username,
          firstName: user.firstName || user.first_name,
        },
        reason: 'creator_left',
      });

      // Touch activity timestamp
      await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

      logger.info('Hangout call ended (creator left)', { callId, groupId, creatorId: user.id });
    } else if (!callRecord.is_persistent) {
      // Auto-end the call only for NON-persistent calls when everyone leaves.
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
    }
    // Persistent (24/7) community calls stay active even when empty.

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
