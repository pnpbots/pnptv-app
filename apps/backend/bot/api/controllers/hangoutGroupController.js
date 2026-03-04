'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const userService = require('../../../services/userService');
const VideoCallModel = require('../../../models/videoCallModel');
const { buildJitsiHangoutsUrl } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');
const NotificationEmitter = require('../../services/notificationEmitter');
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

// Auto-join community groups based on user language:
// - PNPTV Community (is_main) for everyone
// - PNP English for English speakers (or unknown language)
// - PNP Español for Spanish speakers
const ensureMainGroupMembership = async (userId) => {
  // Always join the main community group
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     SELECT id, $1, 'member' FROM hangout_groups WHERE is_main = true
     ON CONFLICT DO NOTHING`,
    [userId]
  );

  // Join language-specific group based on user's language
  const { rows } = await query('SELECT language FROM users WHERE id = $1', [userId]);
  const lang = rows[0]?.language || 'en';
  const isSpanish = lang === 'es';

  // Join the matching language group (PNP English id=10, PNP Español id=11)
  const langGroupId = isSpanish ? 11 : 10;
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [langGroupId, userId]
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
    // PRIME check
    const isPrime = await userService.isPremium(user.id);
    if (!isPrime) {
      return res.status(403).json({ error: 'Only PRIME members can create subgroups' });
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
      `SELECT gm.user_id, gm.role, gm.joined_at,
              u.username, u.first_name, u.photo_file_id as photo_url
       FROM hangout_group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.role = 'owner' DESC, gm.joined_at ASC
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

  // Tier check: member subscription required to join subgroups
  const joinTier = (user.tier || req.session?.user?.tier || 'free').toLowerCase();
  const joinRole = user.role || req.session?.user?.role || '';
  const joinIsAdmin = joinRole === 'admin' || joinRole === 'superadmin';
  if (!joinIsAdmin && joinTier === 'free') {
    return res.status(403).json({
      success: false,
      error: 'Member subscription required',
      code: 'MEMBER_REQUIRED',
    });
  }

  try {
    const { rows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (!rows[0].is_public) return res.status(403).json({ error: 'This group is invite-only' });

    // Check member count
    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int as cnt FROM hangout_group_members WHERE group_id=$1',
      [groupId]
    );
    if (countRows[0].cnt >= rows[0].max_members) {
      return res.status(409).json({ error: 'Group is full' });
    }

    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, user.id]
    );

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Notify group creator about new member
    const group = rows[0];
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      NotificationEmitter.emit({
        type: 'group_join', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: group.creator_id,
        entityType: 'group', entityId: String(groupId),
        message: `${user.firstName || user.first_name || user.username} joined ${group.name}`,
        metadata: { groupName: group.name },
      });
    }

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
    // Can't leave public community groups
    const { rows } = await query('SELECT is_main, is_public FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main || rows[0].is_public) return res.status(400).json({ error: 'Cannot leave a community group' });

    await query(
      'DELETE FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );

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
    if (rows[0].is_main || rows[0].is_public) return res.status(400).json({ error: 'Cannot delete a community group' });
    if (rows[0].creator_id !== String(user.id)) {
      return res.status(403).json({ error: 'Only the creator can delete this group' });
    }

    // End active calls
    await query(
      `UPDATE video_calls SET is_active=false, ended_at=NOW() WHERE group_id=$1 AND is_active=true`,
      [groupId]
    );

    // Delete group (cascade deletes members)
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
              cm.media_metadata,
              cm.created_at
       FROM chat_messages cm
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.room=$1 AND cm.is_deleted=false
         ${cursor ? 'AND cm.created_at < $2' : ''}
       ORDER BY cm.created_at DESC LIMIT 50`,
      cursor ? [room, cursor] : [room]
    );

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

  // Tier check: member subscription required to send messages in subgroups
  const msgTier = (user.tier || req.session?.user?.tier || 'free').toLowerCase();
  const msgRole = user.role || req.session?.user?.role || '';
  const msgIsAdmin = msgRole === 'admin' || msgRole === 'superadmin';
  if (!msgIsAdmin && msgTier === 'free') {
    return res.status(403).json({
      success: false,
      error: 'Member subscription required',
      code: 'MEMBER_REQUIRED',
    });
  }

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
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

    // On accept, add as member
    if (action === 'accept') {
      await query(
        `INSERT INTO hangout_group_members (group_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [groupId, joinRequest.user_id]
      );

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
};
