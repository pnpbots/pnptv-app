'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const userService = require('../../../services/userService');
const VideoCallModel = require('../../../models/videoCallModel');
const { buildJitsiHangoutsUrl } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');
const NotificationEmitter = require('../../services/notificationEmitter');
const { hasAccess } = require('../../services/accessService');
const matrixService = require('../../services/matrixService');
const BlockedUser = require('../../../models/blockedUser');
// Check if a photo path is a valid web URL (not a Telegram file ID)
const isValidPhotoUrl = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// Check if user is a member of the group
const isMember = async (groupId, userId) => {
  const { rows } = await query(
    'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
    [groupId, userId]
  );
  return rows.length > 0;
};

// Auto-join the main community group for everyone
const ensureMainGroupMembership = async (userId) => {
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     SELECT id, $1, 'member' FROM hangout_groups WHERE is_main = true
     ON CONFLICT DO NOTHING`,
    [userId]
  );
};

// Normalize a message row: strip invalid photo_urls, include all media fields
const normalizeMessage = (m) => ({
  ...m,
  photo_url: isValidPhotoUrl(m.photo_url) ? m.photo_url : null,
});

// GET /api/webapp/hangouts/groups
const listGroups = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    // Auto-join main group
    await ensureMainGroupMembership(user.id);

    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.creator_id,
              g.is_main, g.is_wall_of_fame, g.is_public, g.max_members, g.created_at,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              -- Check both legacy video_calls and new hangout_video_calls for active calls
              (
                (SELECT COUNT(*)::int FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true) > 0
                OR
                (SELECT COUNT(*)::int FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active') > 0
              ) as has_active_call,
              COALESCE(
                (SELECT hvc.id::text FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active' ORDER BY hvc.created_at DESC LIMIT 1),
                (SELECT v.id::text FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true ORDER BY v.created_at DESC LIMIT 1)
              ) as active_call_id,
              (SELECT cm.content FROM chat_messages cm WHERE cm.room = 'hangout:' || g.id::text ORDER BY cm.created_at DESC LIMIT 1) as last_message,
              (SELECT COUNT(*)::int FROM chat_messages cm
               WHERE cm.room = 'hangout:' || g.id::text
                 AND cm.is_deleted = false
                 AND cm.created_at > COALESCE(gm.last_read_at, gm.joined_at)
                 AND cm.user_id != $1::text) as unread_count
       FROM hangout_groups g
       JOIN hangout_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       ORDER BY g.is_main DESC, g.created_at DESC`,
      [user.id]
    );

    const groups = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      avatarUrl: r.avatar_url,
      creatorId: r.creator_id,
      isMain: r.is_main,
      isWallOfFame: r.is_wall_of_fame,
      isPublic: r.is_public,
      maxMembers: r.max_members,
      memberCount: r.member_count,
      createdAt: r.created_at,
      hasActiveCall: r.has_active_call,
      activeCallId: r.active_call_id,
      lastMessage: r.last_message,
      unreadCount: r.unread_count || 0,
    }));

    return res.json({ success: true, groups });
  } catch (err) {
    logger.error('listGroups error', err);
    return res.status(500).json({ error: 'Failed to load groups' });
  }
};

// POST /api/webapp/hangouts/groups
const createGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { name, description = '', isPublic = true } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

  try {
    // Member+ check via live entitlement (not stale session.tier)
    const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';
    if (!isAdminRole) {
      const EntitlementAccessService = require('../../services/entitlementAccessService');
      const hasMembership = await EntitlementAccessService.hasEntitlement(user.id, 'pnp-member');
      if (!hasMembership) {
        return res.status(403).json({ error: 'Member subscription required to create hangout groups' });
      }
    }

    // Monthly limit: max 3 user-created hangouts per PRIME user per calendar month
    const { rows: limitRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM hangout_groups
       WHERE creator_id = $1 AND is_main = false AND is_wall_of_fame = false
         AND created_at >= date_trunc('month', NOW())`,
      [user.id]
    );
    if (limitRows[0].cnt >= 3) {
      return res.status(403).json({ error: 'Monthly hangout limit reached (3 per month)' });
    }

    const { rows } = await query(
      `INSERT INTO hangout_groups (name, description, creator_id, is_main, is_public, max_members)
       VALUES ($1, $2, $3, false, $4, 25)
       RETURNING *`,
      [name.trim().slice(0, 100), description.trim().slice(0, 500), user.id, isPublic !== false]
    );

    const group = rows[0];

    // Add creator as owner
    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [group.id, user.id]
    );

    // Eagerly create Matrix room so it's ready when the user opens chat
    try {
      const userRow = await query(
        `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
         FROM users WHERE id = $1 AND is_deleted = false`,
        [user.id]
      );
      if (userRow.rows[0]) {
        await matrixService.getOrCreateHangoutRoom(group.id, userRow.rows[0], group.name);
      }
    } catch (matrixErr) {
      logger.warn('createGroup: Matrix room creation failed (will retry on first chat open)', { groupId: group.id, error: matrixErr.message });
    }

    return res.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        avatarUrl: group.avatar_url,
        creatorId: group.creator_id,
        isMain: group.is_main,
        isPublic: group.is_public,
        maxMembers: group.max_members,
        memberCount: 1,
        createdAt: group.created_at,
        hasActiveCall: false,
        activeCallId: null,
      },
    });
  } catch (err) {
    logger.error('createGroup error', err);
    return res.status(500).json({ error: 'Failed to create group' });
  }
};

// GET /api/webapp/hangouts/groups/:id
const getGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows: groupRows } = await query(
      `SELECT g.*,
              g.slow_mode_seconds, g.is_read_only, g.allow_media, g.allow_member_invites,
              g.auto_delete_hours, g.tags, g.invite_code,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (
                (SELECT COUNT(*)::int FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true) > 0
                OR
                (SELECT COUNT(*)::int FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active') > 0
              ) as has_active_call,
              COALESCE(
                (SELECT hvc.id::text FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active' ORDER BY hvc.created_at DESC LIMIT 1),
                (SELECT v.id::text FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true ORDER BY v.created_at DESC LIMIT 1)
              ) as active_call_id
       FROM hangout_groups g WHERE g.id = $1`,
      [groupId]
    );

    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const g = groupRows[0];
    const member = await isMember(groupId, user.id);

    // Non-members cannot view private groups
    if (!g.is_public && !member) {
      return res.status(403).json({ error: 'This group is invite-only' });
    }

    const { rows: members } = await query(
      `SELECT gm.user_id, gm.role, gm.joined_at, gm.is_muted, gm.muted_until, gm.is_banned, gm.notification_mode,
              u.username, u.first_name, u.photo_file_id as photo_url
       FROM hangout_group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.role = 'owner' DESC, gm.role = 'moderator' DESC, gm.joined_at ASC
       LIMIT 100`,
      [groupId]
    );

    return res.json({
      success: true,
      group: {
        id: g.id,
        name: g.name,
        description: g.description,
        avatarUrl: g.avatar_url,
        creatorId: g.creator_id,
        isMain: g.is_main,
        isPublic: g.is_public,
        maxMembers: g.max_members,
        memberCount: g.member_count,
        createdAt: g.created_at,
        hasActiveCall: g.has_active_call,
        activeCallId: g.active_call_id,
        slowModeSeconds: g.slow_mode_seconds,
        isReadOnly: g.is_read_only,
        allowMedia: g.allow_media,
        allowMemberInvites: g.allow_member_invites,
        autoDeleteHours: g.auto_delete_hours,
        tags: g.tags || [],
        inviteCode: g.invite_code,
      },
      members: members.map(m => ({ ...m, photo_url: isValidPhotoUrl(m.photo_url) ? m.photo_url : null })),
    });
  } catch (err) {
    logger.error('getGroup error', err);
    return res.status(500).json({ error: 'Failed to load group' });
  }
};

// POST /api/webapp/hangouts/groups/:id/join
const joinGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (!rows[0].is_public) return res.status(403).json({ error: 'This group is invite-only' });

    // Ban check
    const { rows: banCheck } = await query(
      'SELECT is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND is_banned = true',
      [groupId, user.id]
    );
    if (banCheck.length > 0) return res.status(403).json({ error: 'You are banned from this group' });

    // Block check: creator blocked joiner OR joiner blocked creator
    const group = rows[0];
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot join this group' });
      }
    }

    // Atomic capacity-checked insert (prevents race condition)
    const { rowCount } = await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       SELECT $1, $2, 'member'
       WHERE (SELECT COUNT(*) FROM hangout_group_members WHERE group_id=$1) < $3
       ON CONFLICT DO NOTHING`,
      [groupId, user.id, rows[0].max_members]
    );
    if (rowCount === 0) {
      // Either already a member (ON CONFLICT) or group is full
      const { rows: checkRows } = await query(
        'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
        [groupId, user.id]
      );
      if (checkRows.length === 0) {
        return res.status(409).json({ error: 'Group is full' });
      }
      // Already a member — proceed silently
    }

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Notify group creator about new member
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      NotificationEmitter.emit({
        type: 'group_join', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: group.creator_id,
        entityType: 'group', entityId: String(groupId),
        message: `${user.firstName || user.first_name || user.username} joined ${group.name}`,
        metadata: { groupName: group.name },
      });
    }

    // Sync Matrix room membership — fire-and-forget (non-blocking, non-fatal)
    matrixService.inviteToHangoutRoom(groupId, {
      id:                  user.id,
      telegram:            user.telegram || String(user.id),
      username:            user.username || null,
      first_name:          user.firstName || user.first_name || null,
      matrix_user_id:      user.matrix_user_id      || null,
      matrix_access_token: user.matrix_access_token || null,
      matrix_device_id:    user.matrix_device_id    || null,
    }).catch((matrixErr) => {
      logger.warn(`[Matrix] joinGroup sync failed for user ${user.id} / group ${groupId}: ${matrixErr.message}`);
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('joinGroup error', err);
    return res.status(500).json({ error: 'Failed to join group' });
  }
};

// POST /api/webapp/hangouts/groups/:id/leave
const leaveGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Can't leave the main community group
    const { rows } = await query('SELECT is_main, is_public FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot leave the main community group' });

    await query(
      'DELETE FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );

    // Sync Matrix room membership — fire-and-forget (non-blocking, non-fatal)
    matrixService.removeFromHangoutRoom(groupId, {
      id:             user.id,
      matrix_user_id: user.matrix_user_id || null,
    }).catch((matrixErr) => {
      logger.warn(`[Matrix] leaveGroup sync failed for user ${user.id} / group ${groupId}: ${matrixErr.message}`);
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('leaveGroup error', err);
    return res.status(500).json({ error: 'Failed to leave group' });
  }
};

// DELETE /api/webapp/hangouts/groups/:id
const deleteGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot delete the main community group' });
    if (rows[0].creator_id !== String(user.id)) {
      return res.status(403).json({ error: 'Only the creator can delete this group' });
    }

    // End active calls (both legacy and new tables)
    await query(
      `UPDATE video_calls SET is_active=false, ended_at=NOW() WHERE group_id=$1 AND is_active=true`,
      [groupId]
    );
    await query(
      `UPDATE hangout_video_calls SET status='ended', ended_at=NOW() WHERE group_id=$1 AND status='active'`,
      [groupId]
    );

    // Clean up chat messages for this group before deleting (not covered by cascade)
    await query('DELETE FROM chat_messages WHERE room = $1', [`hangout:${groupId}`]);

    // Delete group (cascade deletes members, participants, join requests)
    await query('DELETE FROM hangout_groups WHERE id=$1', [groupId]);

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteGroup error', err);
    return res.status(500).json({ error: 'Failed to delete group' });
  }
};

// GET /api/webapp/hangouts/groups/:id/messages
// Now returns all media fields so clients can render attachments inline.
const getMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { cursor } = req.query;

  // Validate cursor format if provided
  if (cursor !== undefined && isNaN(Date.parse(cursor))) {
    return res.status(400).json({ error: 'Invalid cursor format' });
  }

  try {
    // Check membership
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const room = `hangout:${groupId}`;
    const { rows } = await query(
      `SELECT cm.id, cm.room, cm.user_id, cm.username, cm.first_name,
              COALESCE(u.photo_file_id, cm.photo_url) as photo_url,
              cm.content,
              cm.media_url, cm.media_type, cm.media_mime,
              cm.media_thumb_url, cm.media_width, cm.media_height,
              cm.media_metadata, cm.reply_to_id,
              r.first_name AS reply_name, r.username AS reply_username, r.content AS reply_content,
              cm.created_at
       FROM chat_messages cm
       LEFT JOIN users u ON u.id = cm.user_id
       LEFT JOIN chat_messages r ON r.id = cm.reply_to_id
       WHERE cm.room=$1 AND cm.is_deleted=false
         ${cursor ? 'AND cm.created_at < $2' : ''}
       ORDER BY cm.created_at DESC LIMIT 50`,
      cursor ? [room, cursor] : [room]
    );

    // Attach reply_to object and clean up helper columns
    for (const msg of rows) {
      if (msg.reply_to_id && (msg.reply_name || msg.reply_username)) {
        msg.reply_to = { name: msg.reply_name || msg.reply_username || 'User', content: (msg.reply_content || '[media]').slice(0, 100) };
      }
      delete msg.reply_name; delete msg.reply_username; delete msg.reply_content;
    }

    return res.json({ success: true, messages: rows.reverse().map(normalizeMessage) });
  } catch (err) {
    logger.error('getMessages error', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
};

// POST /api/webapp/hangouts/groups/:id/messages
// Sends a text-only message. For media, use sendMediaMessage below.
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { content } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Block check: group creator blocked sender OR sender blocked group creator
    const { rows: groupCreatorRows } = await query(
      'SELECT creator_id FROM hangout_groups WHERE id = $1',
      [groupId]
    );
    const creatorId = groupCreatorRows[0]?.creator_id;
    if (creatorId && String(creatorId) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(creatorId, user.id),
        BlockedUser.isBlocked(user.id, creatorId),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot send message in this group' });
      }
    }

    const room = `hangout:${groupId}`;
    const text = content.trim().slice(0, 2000);

    // Look up fresh photo from DB for storage and response (only use valid web URLs)
    const photoResult = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
    const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
    const photoUrl = isValidPhotoUrl(rawPhoto) ? rawPhoto : null;

    const { rows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, room, user_id, username, first_name, photo_url, content,
                 media_url, media_type, media_mime, media_thumb_url,
                 media_width, media_height, media_metadata, created_at`,
      [room, user.id, user.username || null, user.firstName || user.first_name || null, photoUrl, text]
    );

    const msg = normalizeMessage(rows[0]);

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    return res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('sendMessage hangout error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

// POST /api/webapp/hangouts/groups/:id/call
const startCall = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Check if there's already an active call for this group
    const { rows: existing } = await query(
      'SELECT id, channel_name FROM video_calls WHERE group_id=$1 AND is_active=true LIMIT 1',
      [groupId]
    );

    if (existing.length > 0) {
      // Join existing call
      const call = existing[0];
      const jitsiUrl = buildJitsiHangoutsUrl({
        roomName: call.channel_name,
        userId: user.id,
        userName: user.firstName || user.username || 'User',
        isModerator: false,
        callId: call.id,
        type: 'public',
      });
      return res.json({ success: true, jitsiUrl, callId: call.id, isNew: false });
    }

    // Create new call
    const creatorName = user.firstName || user.username || 'User';
    const call = await VideoCallModel.create({
      creatorId: user.id,
      creatorName,
      title: `Group Call`,
      maxParticipants: 50,
      allowGuests: false,
      enforceCamera: false,
      isPublic: false,
    });

    // Link to group
    await query('UPDATE video_calls SET group_id=$1 WHERE id=$2', [groupId, call.id]);

    const jitsiUrl = buildJitsiHangoutsUrl({
      roomName: call.channelName,
      userId: user.id,
      userName: creatorName,
      isModerator: true,
      callId: call.id,
      type: 'public',
    });

    return res.json({ success: true, jitsiUrl, callId: call.id, isNew: true });
  } catch (err) {
    logger.error('startCall hangout error', err);
    return res.status(500).json({ error: 'Failed to start call' });
  }
};

// POST /api/webapp/hangouts/groups/:id/read
const markAsRead = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });
  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    await query(
      'UPDATE hangout_group_members SET last_read_at = NOW() WHERE group_id = $1 AND user_id = $2',
      [groupId, user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('markAsRead error', err);
    return res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// GET /api/webapp/hangouts/groups/discover
const discoverGroups = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.creator_id,
              g.is_public, g.created_at,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (SELECT jr.status FROM hangout_join_requests jr
               WHERE jr.group_id = g.id AND jr.user_id = $1
               ORDER BY jr.created_at DESC LIMIT 1) as my_request_status
       FROM hangout_groups g
       WHERE g.is_main = false
         AND g.is_wall_of_fame = false
         AND NOT EXISTS (
           SELECT 1 FROM hangout_group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1
         )
       ORDER BY g.created_at DESC
       LIMIT 50`,
      [user.id]
    );

    const groups = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      avatarUrl: r.avatar_url,
      creatorId: r.creator_id,
      isPublic: r.is_public,
      memberCount: r.member_count,
      createdAt: r.created_at,
      myRequestStatus: r.my_request_status || null,
    }));

    return res.json({ success: true, groups });
  } catch (err) {
    logger.error('discoverGroups error', err);
    return res.status(500).json({ error: 'Failed to discover groups' });
  }
};

// POST /api/webapp/hangouts/groups/:id/request-join
const requestJoinGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    if (group.is_public) return res.status(400).json({ error: 'This group is public, use join instead' });
    if (await isMember(groupId, user.id)) return res.status(409).json({ error: 'Already a member' });

    // Block check: creator blocked requester OR requester blocked creator
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot request to join this group' });
      }
    }

    // Upsert: reset rejected requests to pending
    const { rows } = await query(
      `INSERT INTO hangout_join_requests (group_id, user_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (group_id, user_id) DO UPDATE
         SET status = 'pending', created_at = NOW(), resolved_at = NULL, resolved_by = NULL
         WHERE hangout_join_requests.status = 'rejected'
       RETURNING *`,
      [groupId, user.id]
    );

    if (rows.length === 0) {
      return res.status(409).json({ error: 'Request already pending' });
    }

    // Notify group creator
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      NotificationEmitter.emit({
        type: 'group_join_request', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: group.creator_id,
        entityType: 'group', entityId: String(groupId),
        message: `${user.firstName || user.first_name || user.username} requested to join ${group.name}`,
        metadata: { groupName: group.name },
      });
    }

    return res.json({ success: true, request: rows[0] });
  } catch (err) {
    logger.error('requestJoinGroup error', err);
    return res.status(500).json({ error: 'Failed to submit join request' });
  }
};

// GET /api/webapp/hangouts/groups/:id/requests
const getJoinRequests = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Only creator can view requests
    const { rows: groupRows } = await query('SELECT creator_id FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (String(groupRows[0].creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group creator can view requests' });
    }

    const { rows } = await query(
      `SELECT jr.id, jr.user_id, jr.status, jr.created_at,
              u.username, u.first_name, u.photo_file_id as photo_url
       FROM hangout_join_requests jr
       JOIN users u ON u.id = jr.user_id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at ASC`,
      [groupId]
    );

    return res.json({
      success: true,
      requests: rows.map(r => ({
        ...r,
        photo_url: isValidPhotoUrl(r.photo_url) ? r.photo_url : null,
      })),
    });
  } catch (err) {
    logger.error('getJoinRequests error', err);
    return res.status(500).json({ error: 'Failed to load requests' });
  }
};

// POST /api/webapp/hangouts/groups/:id/requests/:requestId/:action
const handleJoinRequest = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const requestId = parseInt(req.params.requestId);
  const action = req.params.action;

  if (!Number.isFinite(groupId) || !Number.isFinite(requestId)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  if (action !== 'accept' && action !== 'reject') {
    return res.status(400).json({ error: 'Action must be accept or reject' });
  }

  try {
    // Only creator can handle requests
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (String(groupRows[0].creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group creator can manage requests' });
    }

    // Update request
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    const { rows } = await query(
      `UPDATE hangout_join_requests
       SET status = $1, resolved_at = NOW(), resolved_by = $2
       WHERE id = $3 AND group_id = $4 AND status = 'pending'
       RETURNING *`,
      [newStatus, user.id, requestId, groupId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already handled' });
    }

    const joinRequest = rows[0];

    // On accept, re-check block status in case a block was placed after the request
    if (action === 'accept') {
      if (joinRequest.user_id && String(joinRequest.user_id) !== String(user.id)) {
        const [blockedByCreator, blockedByRequester] = await Promise.all([
          BlockedUser.isBlocked(user.id, joinRequest.user_id),
          BlockedUser.isBlocked(joinRequest.user_id, user.id),
        ]);
        if (blockedByCreator || blockedByRequester) {
          // Silently reject: revert the accept we just wrote
          await query(
            `UPDATE hangout_join_requests
             SET status = 'rejected', resolved_at = NOW(), resolved_by = $1
             WHERE id = $2`,
            [user.id, requestId]
          );
          return res.status(403).json({ error: 'Cannot accept this request' });
        }
      }

      const { rowCount } = await query(
        `INSERT INTO hangout_group_members (group_id, user_id, role)
         SELECT $1, $2, 'member'
         WHERE (SELECT COUNT(*) FROM hangout_group_members WHERE group_id = $1) < (
           SELECT max_members FROM hangout_groups WHERE id = $1
         )
         ON CONFLICT DO NOTHING`,
        [groupId, joinRequest.user_id]
      );
      if (rowCount === 0) {
        return res.status(409).json({ error: 'Group is full or user is already a member' });
      }

      // Notify the requester
      NotificationEmitter.emit({
        type: 'group_request_accepted', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: joinRequest.user_id,
        entityType: 'group', entityId: String(groupId),
        message: `Your request to join ${groupRows[0].name} was accepted`,
        metadata: { groupName: groupRows[0].name },
      });
    }

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    logger.error('handleJoinRequest error', err);
    return res.status(500).json({ error: 'Failed to handle request' });
  }
};

// Helper: check if user is owner or moderator
const isOwnerOrMod = async (groupId, userId) => {
  const { rows } = await query(
    "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role IN ('owner','moderator')",
    [groupId, userId]
  );
  return rows.length > 0;
};

// POST /api/webapp/hangouts/groups/:id/kick
const kickMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    // Can't kick owner
    const { rows: targetRows } = await query(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not in group' });
    if (targetRows[0].role === 'owner') return res.status(403).json({ error: 'Cannot kick the owner' });
    // Moderators can only be kicked by owner
    if (targetRows[0].role === 'moderator') {
      const { rows: callerRows } = await query(
        'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
        [groupId, user.id]
      );
      if (callerRows[0]?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can remove moderators' });
    }

    await query('DELETE FROM hangout_group_members WHERE group_id=$1 AND user_id=$2', [groupId, targetId]);
    matrixService.removeFromHangoutRoom(groupId, { id: targetId, matrix_user_id: null }).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    logger.error('kickMember error', err);
    return res.status(500).json({ error: 'Failed to kick member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/ban
const banMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    const { rows: targetRows } = await query(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not in group' });
    if (targetRows[0].role === 'owner') return res.status(403).json({ error: 'Cannot ban the owner' });

    await query(
      'UPDATE hangout_group_members SET is_banned = true WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    matrixService.removeFromHangoutRoom(groupId, { id: targetId, matrix_user_id: null }).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    logger.error('banMember error', err);
    return res.status(500).json({ error: 'Failed to ban member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/unban
const unbanMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query(
      'UPDATE hangout_group_members SET is_banned = false WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('unbanMember error', err);
    return res.status(500).json({ error: 'Failed to unban member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/mute
const muteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId, durationMinutes = 60 } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    const { rows: targetRows } = await query(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not in group' });
    if (targetRows[0].role === 'owner') return res.status(403).json({ error: 'Cannot mute the owner' });

    const mutedUntil = new Date(Date.now() + Math.min(durationMinutes, 10080) * 60000); // max 7 days
    await query(
      'UPDATE hangout_group_members SET is_muted = true, muted_until = $3 WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId, mutedUntil]
    );
    return res.json({ success: true, mutedUntil });
  } catch (err) {
    logger.error('muteMember error', err);
    return res.status(500).json({ error: 'Failed to mute member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/unmute
const unmuteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query(
      'UPDATE hangout_group_members SET is_muted = false, muted_until = NULL WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('unmuteMember error', err);
    return res.status(500).json({ error: 'Failed to unmute member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/promote
const promoteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Only owner can promote
    const { rows: callerRows } = await query(
      "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'",
      [groupId, user.id]
    );
    if (callerRows.length === 0) return res.status(403).json({ error: 'Only the owner can promote members' });

    const { rowCount } = await query(
      "UPDATE hangout_group_members SET role = 'moderator' WHERE group_id=$1 AND user_id=$2 AND role='member'",
      [groupId, targetId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Member not found or already a moderator' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('promoteMember error', err);
    return res.status(500).json({ error: 'Failed to promote member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/demote
const demoteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { rows: callerRows } = await query(
      "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'",
      [groupId, user.id]
    );
    if (callerRows.length === 0) return res.status(403).json({ error: 'Only the owner can demote moderators' });

    const { rowCount } = await query(
      "UPDATE hangout_group_members SET role = 'member' WHERE group_id=$1 AND user_id=$2 AND role='moderator'",
      [groupId, targetId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Moderator not found' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('demoteMember error', err);
    return res.status(500).json({ error: 'Failed to demote member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/pin
const pinMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId, body } = req.body;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });

    const { rows } = await query(
      `INSERT INTO hangout_pinned_messages (group_id, matrix_event_id, message_body, pinned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, matrix_event_id) DO NOTHING
       RETURNING *`,
      [groupId, eventId, (body || '').slice(0, 500), user.id]
    );
    return res.json({ success: true, pin: rows[0] || null });
  } catch (err) {
    logger.error('pinMessage error', err);
    return res.status(500).json({ error: 'Failed to pin message' });
  }
};

// DELETE /api/webapp/hangouts/groups/:id/pin/:eventId
const unpinMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId } = req.params;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query('DELETE FROM hangout_pinned_messages WHERE group_id=$1 AND matrix_event_id=$2', [groupId, eventId]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('unpinMessage error', err);
    return res.status(500).json({ error: 'Failed to unpin message' });
  }
};

// GET /api/webapp/hangouts/groups/:id/pins
const getPinnedMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    const { rows } = await query(
      `SELECT p.*, u.first_name AS pinned_by_name
       FROM hangout_pinned_messages p
       LEFT JOIN users u ON u.id = p.pinned_by
       WHERE p.group_id = $1
       ORDER BY p.pinned_at DESC
       LIMIT 20`,
      [groupId]
    );
    return res.json({ success: true, pins: rows });
  } catch (err) {
    logger.error('getPinnedMessages error', err);
    return res.status(500).json({ error: 'Failed to load pins' });
  }
};

// PUT /api/webapp/hangouts/groups/:id/settings
const updateGroupSettings = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });

    const { slowModeSeconds, isReadOnly, allowMedia, allowMemberInvites, autoDeleteHours, tags, isPublic, name, description } = req.body;

    const sets = [];
    const vals = [];
    let idx = 1;

    if (slowModeSeconds !== undefined) { sets.push(`slow_mode_seconds = $${idx++}`); vals.push(Math.max(0, Math.min(slowModeSeconds, 3600))); }
    if (isReadOnly !== undefined) { sets.push(`is_read_only = $${idx++}`); vals.push(!!isReadOnly); }
    if (allowMedia !== undefined) { sets.push(`allow_media = $${idx++}`); vals.push(!!allowMedia); }
    if (allowMemberInvites !== undefined) { sets.push(`allow_member_invites = $${idx++}`); vals.push(!!allowMemberInvites); }
    if (autoDeleteHours !== undefined) { sets.push(`auto_delete_hours = $${idx++}`); vals.push(Math.max(0, Math.min(autoDeleteHours, 8760))); }
    if (tags !== undefined && Array.isArray(tags)) { sets.push(`tags = $${idx++}`); vals.push(tags.slice(0, 5).map(t => String(t).slice(0, 30))); }
    if (isPublic !== undefined) { sets.push(`is_public = $${idx++}`); vals.push(!!isPublic); }
    if (name !== undefined && name.trim()) { sets.push(`name = $${idx++}`); vals.push(name.trim().slice(0, 100)); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push((description || '').trim().slice(0, 500)); }

    if (sets.length === 0) return res.status(400).json({ error: 'No settings to update' });

    vals.push(groupId);
    const { rows } = await query(
      `UPDATE hangout_groups SET ${sets.join(', ')} WHERE id = $${idx} AND is_main = false
       RETURNING id, name, description, is_public, slow_mode_seconds, is_read_only, allow_media, allow_member_invites, auto_delete_hours, tags`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found or is main' });
    return res.json({ success: true, settings: rows[0] });
  } catch (err) {
    logger.error('updateGroupSettings error', err);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

// POST /api/webapp/hangouts/groups/:id/transfer
const transferOwnership = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: newOwnerId } = req.body;
  if (!Number.isFinite(groupId) || !newOwnerId) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Only current owner
    const { rows: groupRows } = await query('SELECT creator_id, is_main FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (groupRows[0].is_main) return res.status(400).json({ error: 'Cannot transfer main group' });
    if (String(groupRows[0].creator_id) !== String(user.id)) return res.status(403).json({ error: 'Only the owner can transfer' });

    // Verify target is a member
    if (!(await isMember(groupId, newOwnerId))) return res.status(404).json({ error: 'Target user is not a member' });

    // Transfer
    await query('UPDATE hangout_groups SET creator_id = $1 WHERE id = $2', [newOwnerId, groupId]);
    await query("UPDATE hangout_group_members SET role = 'member' WHERE group_id=$1 AND user_id=$2", [groupId, user.id]);
    await query("UPDATE hangout_group_members SET role = 'owner' WHERE group_id=$1 AND user_id=$2", [groupId, newOwnerId]);

    return res.json({ success: true });
  } catch (err) {
    logger.error('transferOwnership error', err);
    return res.status(500).json({ error: 'Failed to transfer ownership' });
  }
};

// GET /api/webapp/hangouts/groups/:id/invite-link
const getInviteLink = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) {
      // Check if non-owner invites are allowed
      const { rows: gs } = await query('SELECT allow_member_invites FROM hangout_groups WHERE id=$1', [groupId]);
      if (!gs[0]?.allow_member_invites) return res.status(403).json({ error: 'Not authorized' });
      if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    }

    // Get or generate invite code
    let { rows } = await query('SELECT invite_code FROM hangout_groups WHERE id=$1', [groupId]);
    if (!rows[0]?.invite_code) {
      const code = require('crypto').randomBytes(6).toString('hex');
      const result = await query(
        'UPDATE hangout_groups SET invite_code = $1 WHERE id = $2 RETURNING invite_code',
        [code, groupId]
      );
      rows = result.rows;
    }
    return res.json({ success: true, inviteCode: rows[0].invite_code, inviteUrl: `https://app.pnptv.app/hangouts/invite/${rows[0].invite_code}` });
  } catch (err) {
    logger.error('getInviteLink error', err);
    return res.status(500).json({ error: 'Failed to generate invite link' });
  }
};

// POST /api/webapp/hangouts/groups/join-by-invite/:code
const joinByInvite = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: 'Missing invite code' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE invite_code = $1', [code]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Invalid invite link' });
    const group = groupRows[0];

    // Block check
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [b1, b2] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (b1 || b2) return res.status(403).json({ error: 'Cannot join this group' });
    }

    // Ban check
    const { rows: memberCheck } = await query(
      'SELECT is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [group.id, user.id]
    );
    if (memberCheck.length > 0 && memberCheck[0].is_banned) return res.status(403).json({ error: 'You are banned from this group' });
    if (memberCheck.length > 0) return res.json({ success: true, groupId: group.id }); // already member

    // Capacity check + insert
    const { rowCount } = await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       SELECT $1, $2, 'member'
       WHERE (SELECT COUNT(*) FROM hangout_group_members WHERE group_id=$1) < $3
       ON CONFLICT DO NOTHING`,
      [group.id, user.id, group.max_members]
    );
    if (rowCount === 0) return res.status(409).json({ error: 'Group is full' });

    matrixService.inviteToHangoutRoom(group.id, {
      id: user.id, telegram: user.telegram || String(user.id),
      username: user.username || null, first_name: user.firstName || user.first_name || null,
      matrix_user_id: null, matrix_access_token: null, matrix_device_id: null,
    }).catch(() => {});

    return res.json({ success: true, groupId: group.id });
  } catch (err) {
    logger.error('joinByInvite error', err);
    return res.status(500).json({ error: 'Failed to join group' });
  }
};

// PUT /api/webapp/hangouts/groups/:id/notification
const updateNotificationMode = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { mode } = req.body;
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group ID' });
  const validModes = ['all', 'mentions', 'muted'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: 'Invalid mode. Use: all, mentions, muted' });

  try {
    if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    await query(
      'UPDATE hangout_group_members SET notification_mode = $3 WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id, mode]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('updateNotificationMode error', err);
    return res.status(500).json({ error: 'Failed to update notification mode' });
  }
};

// POST /api/webapp/hangouts/groups/:id/delete-message
const adminDeleteMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId } = req.body;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    // Look up the Matrix room for this group
    const { rows: roomRows } = await query(
      'SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1',
      [groupId]
    );
    if (roomRows.length === 0) return res.status(404).json({ error: 'Matrix room not found' });

    await matrixService.redactRoomEvent(roomRows[0].matrix_room_id, eventId, 'Deleted by moderator');
    return res.json({ success: true });
  } catch (err) {
    logger.error('adminDeleteMessage error', err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
};

module.exports = {
  listGroups,
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  deleteGroup,
  getMessages,
  sendMessage,
  startCall,
  markAsRead,
  discoverGroups,
  requestJoinGroup,
  getJoinRequests,
  handleJoinRequest,
  kickMember,
  banMember,
  unbanMember,
  muteMember,
  unmuteMember,
  promoteMember,
  demoteMember,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  updateGroupSettings,
  transferOwnership,
  getInviteLink,
  joinByInvite,
  updateNotificationMode,
  adminDeleteMessage,
};
