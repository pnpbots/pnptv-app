const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const userService = require('../../../services/userService');
const VideoCallModel = require('../../../models/videoCallModel');
const { buildJitsiHangoutsUrl } = require('../../utils/jitsiHangoutsWebApp');
const jaasService = require('../../services/jaasService');

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

// Auto-join main group if not already a member
const ensureMainGroupMembership = async (userId) => {
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     SELECT id, $1, 'member' FROM hangout_groups WHERE is_main = true
     ON CONFLICT DO NOTHING`,
    [userId]
  );
};

// GET /api/webapp/hangouts/groups
const listGroups = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    // Auto-join main group
    await ensureMainGroupMembership(user.id);

    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.creator_id,
              g.is_main, g.is_public, g.max_members, g.created_at,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (SELECT COUNT(*)::int FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true) > 0 as has_active_call,
              (SELECT v.id FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true ORDER BY v.created_at DESC LIMIT 1) as active_call_id,
              (SELECT cm.content FROM chat_messages cm WHERE cm.room = 'hangout:' || g.id::text ORDER BY cm.created_at DESC LIMIT 1) as last_message
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
      isPublic: r.is_public,
      maxMembers: r.max_members,
      memberCount: r.member_count,
      createdAt: r.created_at,
      hasActiveCall: r.has_active_call,
      activeCallId: r.active_call_id,
      lastMessage: r.last_message,
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
  const { name, description = '' } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

  try {
    // PRIME check
    const isPrime = await userService.isPremium(user.id);
    if (!isPrime) {
      return res.status(403).json({ error: 'Only PRIME members can create subgroups' });
    }

    const { rows } = await query(
      `INSERT INTO hangout_groups (name, description, creator_id, is_main, is_public, max_members)
       VALUES ($1, $2, $3, false, true, 200)
       RETURNING *`,
      [name.trim().slice(0, 100), description.trim().slice(0, 500), user.id]
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

  try {
    const { rows: groupRows } = await query(
      `SELECT g.*,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (SELECT COUNT(*)::int FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true) > 0 as has_active_call,
              (SELECT v.id FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true ORDER BY v.created_at DESC LIMIT 1) as active_call_id
       FROM hangout_groups g WHERE g.id = $1`,
      [groupId]
    );

    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const g = groupRows[0];

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
      members,
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

  try {
    // Can't leave the main group
    const { rows } = await query('SELECT is_main FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot leave the main community group' });

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

  try {
    const { rows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot delete the main group' });
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
const getMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { cursor } = req.query;

  try {
    // Check membership
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const room = `hangout:${groupId}`;
    const { rows } = await query(
      `SELECT id, room, user_id, username, first_name, photo_url, content, created_at
       FROM chat_messages
       WHERE room=$1 AND is_deleted=false
         ${cursor ? 'AND created_at < $2' : ''}
       ORDER BY created_at DESC LIMIT 50`,
      cursor ? [room, cursor] : [room]
    );

    return res.json({ success: true, messages: rows.reverse() });
  } catch (err) {
    logger.error('getMessages error', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
};

// POST /api/webapp/hangouts/groups/:id/messages
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { content } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const room = `hangout:${groupId}`;
    const text = content.trim().slice(0, 2000);
    const { rows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [room, user.id, user.username || null, user.firstName || user.first_name || null, user.photoUrl || user.photo_url || null, text]
    );

    const msg = rows[0];

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
      let jitsiUrl = null;
      if (jaasService.isConfigured()) {
        try {
          jitsiUrl = buildJitsiHangoutsUrl({
            roomName: call.channel_name,
            userId: user.id,
            userName: user.firstName || user.username || 'User',
            isModerator: false,
            callId: call.id,
            type: 'public',
          });
        } catch (e) {
          logger.warn('Failed to generate Jitsi URL:', e.message);
        }
      }
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

    let jitsiUrl = null;
    if (jaasService.isConfigured()) {
      try {
        jitsiUrl = buildJitsiHangoutsUrl({
          roomName: call.channelName,
          userId: user.id,
          userName: creatorName,
          isModerator: true,
          callId: call.id,
          type: 'public',
        });
      } catch (e) {
        logger.warn('Failed to generate Jitsi URL:', e.message);
      }
    }

    return res.json({ success: true, jitsiUrl, callId: call.id, isNew: true });
  } catch (err) {
    logger.error('startCall hangout error', err);
    return res.status(500).json({ error: 'Failed to start call' });
  }
};

module.exports = { listGroups, createGroup, getGroup, joinGroup, leaveGroup, deleteGroup, getMessages, sendMessage, startCall };
