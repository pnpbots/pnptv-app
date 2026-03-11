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
const PushNotificationService = require('../../services/pushNotificationService');
const NotificationEmitter = require('../../services/notificationEmitter');
const jaasService = require('../../services/jaasService');
const BlockedUser = require('../../../models/blockedUser');

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Auto-join main and wall-of-fame groups — but only for members with a valid entitlement
  if (is_main || is_wall_of_fame) {
    try {
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasMembership = await EntitlementAccessService.hasEntitlement(String(userId), 'pnp-member');
      if (!hasMembership) return false;
    } catch (err) {
      logger.error('Entitlement check failed in ensureMembership (main group)', { userId, groupId, error: err.message });
      return false;
    }
    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, userId]
    );
    return true;
  }

  // Public subgroups require a membership entitlement before auto-joining
  if (is_public) {
    try {
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasAccess = await EntitlementAccessService.hasEntitlement(String(userId), 'pnp-member');
      if (!hasAccess) return false;
    } catch (err) {
      logger.error('Entitlement check failed in ensureMembership', { userId, groupId, error: err.message });
      return false;
    }
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
 * Check if userId is blocked by or has blocked the group's creator.
 * Returns true when a block relationship exists and the action must be denied.
 * Skips the check when the user IS the creator (no self-block scenario).
 */
async function isBlockedFromGroup(groupId, userId) {
  const { rows } = await query(
    'SELECT creator_id FROM hangout_groups WHERE id = $1',
    [groupId]
  );
  const creatorId = rows[0]?.creator_id;
  if (!creatorId || String(creatorId) === String(userId)) return false;

  const [blockedByCreator, blockedByUser] = await Promise.all([
    BlockedUser.isBlocked(creatorId, userId),
    BlockedUser.isBlocked(userId, creatorId),
  ]);
  return blockedByCreator || blockedByUser;
}

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
 * Build a JaaS meeting payload with JWT token for a given user/call.
 */
function buildJaasPayload(roomName, user, isModerator, isPersistent = false) {
  if (!jaasService.isConfigured()) {
    return null;
  }

  try {
    // In persistent (main/24-7) community rooms everyone gets moderator-level access.
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

/**
 * Send push + in-app notifications to all group members except the actor.
 * @param {'hangout_call'|'hangout_creator_joined'} type
 */
// Maximum number of group members to notify per call event.
// Prevents fan-out explosions in large public/main groups.
const MAX_CALL_NOTIFY_RECIPIENTS = 500;

async function notifyGroupMembers({ type, groupId, groupName, actor, callId, message }) {
  try {
    // Only notify members who have been recently active (joined within 7 days) or, for smaller
    // groups, all members. Cap at MAX_CALL_NOTIFY_RECIPIENTS to prevent fan-out explosions.
    const { rows: members } = await query(
      `SELECT user_id
       FROM hangout_group_members
       WHERE group_id = $1
         AND user_id != $2
       ORDER BY joined_at DESC
       LIMIT $3`,
      [groupId, actor.id, MAX_CALL_NOTIFY_RECIPIENTS]
    );
    if (members.length === 0) return;

    const memberIds = members.map(m => m.user_id);
    const url = `/hangouts?group=${groupId}`;

    // Web Push (fire-and-forget)
    PushNotificationService.sendToUsers(memberIds, {
      title: groupName || 'Hangouts',
      body: message,
      url,
      tag: `hangout-${type}-${callId}`,
    }).catch(() => {});

    // In-app notifications via NotificationEmitter
    NotificationEmitter.emitToMany(memberIds, {
      type,
      category: 'hangouts',
      priority: type === 'hangout_creator_joined' ? 'high' : 'normal',
      actorId: actor.id,
      entityType: 'hangout_call',
      entityId: String(callId),
      message,
      metadata: { groupId, groupName },
    }).catch(() => {});
  } catch (err) {
    logger.error('notifyGroupMembers error', { type, groupId, error: err.message });
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

    // Block check: group creator blocked caller OR caller blocked group creator
    if (await isBlockedFromGroup(groupId, user.id)) {
      return res.status(403).json({ error: 'Cannot start a call in this group' });
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

    // Push + in-app notifications for non-persistent groups
    if (!isPersistent) {
      const { rows: gRows } = await query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]);
      const gName = gRows[0]?.name || 'Hangout';
      const displayName = user.firstName || user.first_name || user.username || 'Someone';

      // Notify: new call started
      notifyGroupMembers({
        type: 'hangout_call',
        groupId,
        groupName: gName,
        actor: user,
        callId: newCall.id,
        message: `${displayName} started a video call in ${gName}`,
      });

      // If the caller is a creator, also send creator-joined notification
      const { rows: callerRows } = await query(
        "SELECT creator_status FROM users WHERE id = $1",
        [user.id]
      );
      if (callerRows[0]?.creator_status === 'active') {
        notifyGroupMembers({
          type: 'hangout_creator_joined',
          groupId,
          groupName: gName,
          actor: user,
          callId: newCall.id,
          message: `${displayName} (creator) started a video call in ${gName}`,
        });
      }
    }

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
          const jaas = buildJaasPayload(call.room_name, user, isModerator, false);
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

    // Block check: group creator blocked requester OR requester blocked group creator
    if (await isBlockedFromGroup(groupId, user.id)) {
      return res.status(403).json({ error: 'Cannot access calls in this group' });
    }

    // NOTE: Stale participant cleanup (joined >2 hours ago, left_at IS NULL) was removed
    // from this per-request path to avoid write amplification on every GET.
    // TODO: Move to a scheduled job (e.g. run every 30 minutes via the scheduler worker).

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

      if (isPersistentGroup) {
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

  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }
  if (!callId || !UUID_RE.test(callId)) {
    return res.status(400).json({ error: 'Invalid call ID format' });
  }

  try {
    // Auto-join main/public groups so membership never blocks joining a call
    if (!(await ensureMembership(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Block check: group creator blocked joiner OR joiner blocked group creator
    if (await isBlockedFromGroup(groupId, user.id)) {
      return res.status(403).json({ error: 'Cannot join a call in this group' });
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

    // Keep participant_count column in sync with live participant rows
    await query(
      `UPDATE hangout_video_calls SET participant_count = (
        SELECT COUNT(*)::int FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL
      ) WHERE id = $1`,
      [callId]
    );

    const isModerator = String(call.creator_id) === String(user.id);
    const jaas = buildJaasPayload(call.room_name, user, isModerator, call.is_persistent);

    // Get authoritative participant count from DB
    const { rows: joinCountRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL`,
      [callId]
    );

    // Notify other call participants
    emitToHangout(req, groupId, 'hangout:call:joined', {
      callId: call.id,
      participantCount: joinCountRows[0]?.cnt || 0,
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

    // If the joining user is a creator, push-notify group members
    const { rows: userRows } = await query(
      "SELECT creator_status FROM users WHERE id = $1",
      [user.id]
    );
    if (userRows[0]?.creator_status === 'active') {
      const { rows: gRows } = await query('SELECT name FROM hangout_groups WHERE id = $1', [groupId]);
      const gName = gRows[0]?.name || 'Hangout';
      const displayName = user.firstName || user.first_name || user.username || 'A creator';
      notifyGroupMembers({
        type: 'hangout_creator_joined',
        groupId,
        groupName: gName,
        actor: user,
        callId: call.id,
        message: `${displayName} (creator) joined the call in ${gName}`,
      });
    }

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

  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }
  if (!callId || !UUID_RE.test(callId)) {
    return res.status(400).json({ error: 'Invalid call ID format' });
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

    // Reset participant_count to 0 — all participants have been marked as left
    await client.query(
      `UPDATE hangout_video_calls SET participant_count = 0 WHERE id = $1`,
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

  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }
  if (!callId || !UUID_RE.test(callId)) {
    return res.status(400).json({ error: 'Invalid call ID format' });
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

    // Keep participant_count column in sync with live participant rows
    await query(
      `UPDATE hangout_video_calls SET participant_count = (
        SELECT COUNT(*)::int FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL
      ) WHERE id = $1`,
      [callId]
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
