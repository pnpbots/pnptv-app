const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const { resolveUserId } = require('../../utils/helpers');
const DmService = require('../../services/dmService');
const { generateToken, LIVEKIT_WS_URL } = require('../../services/livekitService');

const DM_CALL_TTL_SECONDS = 4 * 60 * 60;
const DM_CALL_KEY_PREFIX = 'dm:call:';
const APP_PUBLIC_URL = (
  process.env.APP_PUBLIC_URL ||
  process.env.WEB_APP_URL ||
  process.env.WEBAPP_ORIGIN ||
  'https://app.pnptv.app'
).replace(/\/+$/, '');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

function buildDmCallLink(roomName, callerId, calleeId) {
  const params = new URLSearchParams({
    call: roomName,
    caller: String(callerId),
    callee: String(calleeId),
  });
  return `${APP_PUBLIC_URL}/dm?${params.toString()}`;
}

// List DM threads for current user
const getThreads = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const { rows } = await query(
      `SELECT dt.user_a, dt.user_b, dt.last_message, dt.last_message_at,
              dt.unread_for_a, dt.unread_for_b,
              CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END as partner_id,
              u.username as partner_username, u.first_name as partner_first_name,
              u.photo_file_id as partner_photo
       FROM dm_threads dt
       JOIN users u ON u.id = CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END
       WHERE dt.user_a = $1 OR dt.user_b = $1
       ORDER BY dt.last_message_at DESC
       LIMIT 50`,
      [user.id]
    );
    // Attach unread count per thread for the current user
    const threads = rows.map(r => ({
      ...r,
      unread: user.id === r.user_a ? r.unread_for_a : r.unread_for_b,
    }));
    return res.json({ success: true, threads });
  } catch (err) {
    logger.error('getThreads error', err);
    return res.status(500).json({ error: 'Failed to load threads' });
  }
};

// Get conversation messages with a specific user
const getConversation = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  const { cursor } = req.query;
  const currentUserId = String(user.id);
  try {
    const { rows } = await query(
      `SELECT dm.id, dm.sender_id, dm.recipient_id,
              dm.content, dm.is_deleted, dm.edited_at,
              dm.media_url, dm.media_type, dm.media_mime, dm.media_thumb_url,
              dm.is_read, dm.created_at,
              rxn.reactions
       FROM direct_messages dm
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'emoji', sub.emoji,
           'count', sub.cnt,
           'users', sub.users
         )) AS reactions
         FROM (
           SELECT dr.emoji,
                  COUNT(*)::int AS cnt,
                  json_agg(json_build_object('id', u.id, 'username', u.username)) AS users
           FROM dm_reactions dr
           JOIN users u ON u.id = dr.user_id
           WHERE dr.message_id = dm.id
           GROUP BY dr.emoji
         ) sub
       ) rxn ON true
       WHERE ((dm.sender_id=$1 AND dm.recipient_id=$2) OR (dm.sender_id=$2 AND dm.recipient_id=$1))
         ${cursor ? 'AND dm.created_at < $3' : ''}
       ORDER BY dm.created_at DESC LIMIT 30`,
      cursor ? [user.id, partnerId, cursor] : [user.id, partnerId]
    );

    // Normalize: deleted messages show placeholder, reactions always array
    const messages = rows.reverse().map((m) => ({
      ...m,
      content: m.is_deleted ? null : m.content,
      reactions: Array.isArray(m.reactions) ? m.reactions : [],
    }));

    // Mark messages as read
    await DmService.markAsRead(user.id, partnerId);

    return res.json({ success: true, messages });
  } catch (err) {
    logger.error('getConversation error', err);
    return res.status(500).json({ error: 'Failed to load conversation' });
  }
};

// Get partner user info
const getPartnerInfo = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId);
  try {
    const { rows } = await query(
      `SELECT id, telegram, username, first_name, last_name, photo_file_id, pnptv_id FROM users WHERE id=$1`,
      [partnerId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    logger.error('getPartnerInfo error', err);
    return res.status(500).json({ error: 'Failed to load user' });
  }
};

const createDmVideoCallInvite = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = (await resolveUserId(req.params.partnerId)) || req.params.partnerId;

  if (!partnerId) {
    return res.status(400).json({ error: 'Partner is required' });
  }

  if (String(partnerId) === String(user.id)) {
    return res.status(400).json({ error: 'You cannot call yourself' });
  }

  try {
    const { rows } = await query(
      `SELECT id FROM users WHERE id = $1`,
      [partnerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const callerId = String(user.id);
    const calleeId = String(partnerId);
    // Deterministic room name — same for both participants regardless of who initiates
    const roomName = `dm-${Math.min(Number(callerId), Number(calleeId))}-${Math.max(Number(callerId), Number(calleeId))}`;

    // Dedup: atomic NX set — prevents duplicate rooms if bot and webapp race
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + DM_CALL_TTL_SECONDS * 1000).toISOString();
    const callData = JSON.stringify({ roomName, callerId, calleeId, createdAt: createdAt.toISOString(), expiresAt });

    const wasSet = await getRedis().set(
      `${DM_CALL_KEY_PREFIX}${roomName}`,
      callData,
      'EX',
      DM_CALL_TTL_SECONDS,
      'NX'
    );

    const displayName = user.firstName || user.first_name || user.username || 'PNPtv User';

    if (!wasSet) {
      const raw = await getRedis().get(`${DM_CALL_KEY_PREFIX}${roomName}`);
      const existingCall = raw ? JSON.parse(raw) : { callerId, calleeId, expiresAt };
      const token = await generateToken(roomName, callerId, displayName, true);
      return res.json({
        success: true,
        roomName,
        callLink: buildDmCallLink(roomName, existingCall.callerId, existingCall.calleeId),
        callerId: existingCall.callerId,
        calleeId: existingCall.calleeId,
        expiresAt: existingCall.expiresAt,
        token,
        livekitUrl: LIVEKIT_WS_URL,
      });
    }

    const callLink = buildDmCallLink(roomName, callerId, calleeId);
    const token = await generateToken(roomName, callerId, displayName, true);

    return res.json({
      success: true,
      roomName,
      callLink,
      callerId,
      calleeId,
      expiresAt,
      token,
      livekitUrl: LIVEKIT_WS_URL,
    });
  } catch (err) {
    logger.error('createDmVideoCallInvite error', err);
    return res.status(500).json({ error: 'Failed to create video call' });
  }
};

const joinDmVideoCall = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const roomName = String(req.body?.roomName || '').trim();

  if (!roomName) {
    return res.status(400).json({ error: 'Room name is required' });
  }

  try {
    const redis = getRedis();
    const rawCall = await redis.get(`${DM_CALL_KEY_PREFIX}${roomName}`);

    if (!rawCall) {
      return res.status(404).json({ error: 'This video call link has expired' });
    }

    const call = JSON.parse(rawCall);
    const callerId = String(call.callerId || '');
    const calleeId = String(call.calleeId || '');
    const currentUserId = String(user.id);

    if (currentUserId !== callerId && currentUserId !== calleeId) {
      return res.status(403).json({ error: 'You do not have access to this video call' });
    }

    await redis.expire(`${DM_CALL_KEY_PREFIX}${roomName}`, DM_CALL_TTL_SECONDS);

    const isModerator = currentUserId === callerId;
    const displayName = user.firstName || user.first_name || user.username || 'PNPtv User';
    const token = await generateToken(roomName, currentUserId, displayName, isModerator);

    return res.json({
      success: true,
      roomName,
      token,
      livekitUrl: LIVEKIT_WS_URL,
      callLink: buildDmCallLink(roomName, callerId, calleeId),
      callerId,
      calleeId,
      expiresAt: call.expiresAt || null,
      role: isModerator ? 'moderator' : 'viewer',
    });
  } catch (err) {
    logger.error('joinDmVideoCall error', err);
    return res.status(500).json({ error: 'Failed to join video call' });
  }
};

// Send a DM via REST (fallback when Socket.IO is unavailable)
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const requestedRecipientId = req.params.recipientId;
  const { content } = req.body;

  // Pre-validation: fail fast before touching DmService.
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }
  if (String(requestedRecipientId) === String(user.id)) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }

  try {
    const senderRole = user.role || '';
    const isAdminSender = senderRole === 'admin' || senderRole === 'superadmin';

    const message = await DmService.sendMessage(
      user.id,
      requestedRecipientId,
      { content },
      { isAdmin: isAdminSender }
    );

    // Deliver to recipient via Socket.IO if available
    const io = req.app.get('io');
    const senderName = user.firstName || user.first_name || user.username || 'User';
    if (io) {
      io.to(`user:${message.recipient_id}`).emit('dm:message', {
        ...message,
        senderName,
        senderPhoto: user.photoUrl || user.photo_url || null,
      });
    }

    // Fire push notification to recipient (non-blocking)
    const PushNotificationService = require('../../../services/pushNotificationService');
    const messageText = String(message.content || '');
    PushNotificationService.sendToUser(String(message.recipient_id), {
      title: senderName,
      body: messageText.slice(0, 120),
      url: '/messages',
      tag: `dm-${user.id}`,
    }).catch(() => {});

    return res.json({ success: true, message, remaining: req.dmLimit?.remaining ?? null });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('sendMessage DM error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

// Edit a sent DM (own message, within 48 hours)
const editDmMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const msgId = req.params.msgId;
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > 4000) {
    return res.status(400).json({ error: 'Message too long' });
  }

  try {
    const { rows } = await query(
      `SELECT id, sender_id, recipient_id, content, created_at, is_deleted
       FROM direct_messages WHERE id = $1`,
      [msgId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const msg = rows[0];
    if (String(msg.sender_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Cannot edit another user\'s message' });
    }
    if (msg.is_deleted) {
      return res.status(410).json({ error: 'Message has been deleted' });
    }

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (ageMs > 48 * 60 * 60 * 1000) {
      return res.status(403).json({ error: 'Message is too old to edit' });
    }

    const { rows: updated } = await query(
      `UPDATE direct_messages
       SET content = $1,
           edited_at = NOW(),
           edit_count = edit_count + 1,
           original_content = COALESCE(original_content, content)
       WHERE id = $2
       RETURNING id, sender_id, recipient_id, content, edited_at, edit_count, created_at`,
      [content.trim(), msgId]
    );

    const updatedMsg = updated[0];

    // Broadcast to both participants
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${updatedMsg.sender_id}`).to(`user:${updatedMsg.recipient_id}`)
        .emit('dm:message:edited', {
          messageId: updatedMsg.id,
          content: updatedMsg.content,
          editedAt: updatedMsg.edited_at,
          editCount: updatedMsg.edit_count,
        });
    }

    return res.json({ success: true, message: updatedMsg });
  } catch (err) {
    logger.error('editDmMessage error', err);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
};

// Delete a sent DM (soft-delete; sender only)
const deleteDmMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const msgId = req.params.msgId;

  try {
    const { rows } = await query(
      `SELECT id, sender_id, recipient_id, is_deleted FROM direct_messages WHERE id = $1`,
      [msgId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const msg = rows[0];
    if (String(msg.sender_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Cannot delete another user\'s message' });
    }
    if (msg.is_deleted) {
      return res.status(410).json({ error: 'Message already deleted' });
    }

    await query(
      `UPDATE direct_messages SET is_deleted = true WHERE id = $1`,
      [msgId]
    );

    // Broadcast to both participants
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`)
        .emit('dm:message:deleted', {
          messageId: msg.id,
          forAll: true,
        });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteDmMessage error', err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
};

// Full-text search within a DM conversation
const searchDmMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { partnerId: rawPartnerId } = req.params;
  const { q } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const { resolveUserId } = require('../../utils/helpers');
  const partnerId = (await resolveUserId(rawPartnerId)) || rawPartnerId;

  try {
    const { rows } = await query(
      `SELECT id, sender_id, recipient_id, content, media_url, media_type, created_at, edited_at
       FROM direct_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND is_deleted = false
         AND to_tsvector('english', content) @@ plainto_tsquery('english', $3)
       ORDER BY created_at DESC
       LIMIT 30`,
      [user.id, partnerId, q.trim()]
    );

    return res.json({ success: true, messages: rows });
  } catch (err) {
    logger.error('searchDmMessages error', err);
    return res.status(500).json({ error: 'Failed to search messages' });
  }
};

module.exports = {
  getThreads,
  getConversation,
  getPartnerInfo,
  createDmVideoCallInvite,
  joinDmVideoCall,
  sendMessage,
  editDmMessage,
  deleteDmMessage,
  searchDmMessages,
};
