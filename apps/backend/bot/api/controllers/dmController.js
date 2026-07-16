const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const { resolveUserId } = require('../../utils/helpers');
const DmService = require('../../../services/dmService');
const { generateToken, LIVEKIT_WS_URL } = require('../../../services/livekitService');

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

function buildDmReplyPreview(row) {
  if (!row || row.is_deleted) return { content: '', mediaType: row?.media_type || null, isDeleted: !!row?.is_deleted };
  if (row.message_type === 'post_card') {
    const snap = row.meta?.snapshot || null;
    const note = typeof snap?.note === 'string' ? snap.note.trim() : '';
    const preview = typeof snap?.content === 'string' ? snap.content.trim() : '';
    if (note) return { content: note.slice(0, 80), mediaType: snap?.mediaType || row.media_type || null, isDeleted: false };
    if (preview) return { content: preview.slice(0, 80), mediaType: snap?.mediaType || row.media_type || null, isDeleted: false };
    return { content: 'Shared post', mediaType: snap?.mediaType || row.media_type || null, isDeleted: false };
  }
  if (typeof row.content === 'string' && row.content.trim()) {
    return { content: row.content.trim().slice(0, 80), mediaType: row.media_type || null, isDeleted: false };
  }
  if (row.media_type === 'image') return { content: 'Photo', mediaType: 'image', isDeleted: false };
  if (row.media_type === 'video') return { content: 'Video', mediaType: 'video', isDeleted: false };
  if (row.media_type === 'audio') return { content: 'Voice message', mediaType: 'audio', isDeleted: false };
  return { content: '', mediaType: row.media_type || null, isDeleted: false };
}

function normalizeDmMessageRow(row) {
  const replyPreview = row.reply_preview
    ? {
        id: row.reply_preview.id,
        senderId: row.reply_preview.senderId,
        content: row.reply_preview.content || '',
        mediaType: row.reply_preview.mediaType || null,
        isDeleted: row.reply_preview.isDeleted === true,
      }
    : null;
  return {
    ...row,
    content: row.is_deleted ? null : row.content,
    reactions: Array.isArray(row.reactions) ? row.reactions : [],
    replyPreview,
  };
}

async function getHydratedDmMessage(messageId) {
  const { rows } = await query(
    `SELECT dm.id, dm.sender_id, dm.recipient_id,
            dm.content, dm.is_deleted, dm.edited_at,
            dm.media_url, dm.media_type, dm.media_mime, dm.media_thumb_url,
            dm.message_type, dm.meta, dm.reply_to_id,
            dm.is_read, dm.read_at, dm.created_at,
            rxn.reactions, rpv.reply_preview
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
       LEFT JOIN LATERAL (
         SELECT json_build_object(
           'id', rdm.id,
           'senderId', rdm.sender_id,
           'content', '',
           'mediaType', COALESCE((rdm.meta -> 'snapshot' ->> 'mediaType'), rdm.media_type),
           'isDeleted', rdm.is_deleted
         ) AS reply_preview
         FROM direct_messages rdm
         WHERE rdm.id = dm.reply_to_id
       ) rpv ON dm.reply_to_id IS NOT NULL
      WHERE dm.id = $1
      LIMIT 1`,
    [messageId]
  );
  if (!rows.length) return null;

  const row = rows[0];
  if (row.reply_to_id) {
    const { rows: replyRows } = await query(
      `SELECT id, sender_id, content, media_type, message_type, meta, is_deleted
         FROM direct_messages
        WHERE id = $1
        LIMIT 1`,
      [row.reply_to_id]
    );
    if (replyRows.length) {
      const preview = buildDmReplyPreview(replyRows[0]);
      row.reply_preview = {
        id: replyRows[0].id,
        senderId: replyRows[0].sender_id,
        content: preview.content,
        mediaType: preview.mediaType,
        isDeleted: preview.isDeleted,
      };
    }
  }

  return normalizeDmMessageRow(row);
}

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
              u.photo_file_id as partner_photo, u.pnptv_id as partner_pnptv_id,
              lm.id AS last_message_id,
              lm.sender_id AS last_message_sender_id,
              lm.media_type AS last_message_media_type,
              lm.is_read AS last_message_is_read,
              s.pinned_at, s.muted_until, s.archived_at, s.pinned_message_id, s.hide_read_receipts
       FROM dm_threads dt
       JOIN users u ON u.id = CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END
       LEFT JOIN dm_thread_state s
         ON s.user_id = $1
        AND s.partner_id = CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END
       LEFT JOIN LATERAL (
         SELECT id, sender_id, media_type, is_read
           FROM direct_messages
          WHERE ((sender_id = $1 AND recipient_id = CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END)
              OR (sender_id = CASE WHEN dt.user_a = $1 THEN dt.user_b ELSE dt.user_a END AND recipient_id = $1))
          ORDER BY created_at DESC LIMIT 1
       ) lm ON true
       WHERE dt.user_a = $1 OR dt.user_b = $1
       ORDER BY (s.pinned_at IS NOT NULL) DESC, s.pinned_at DESC NULLS LAST, dt.last_message_at DESC
       LIMIT 100`,
      [user.id]
    );

    const partnerIds = rows.map((r) => String(r.partner_id));
    const presenceList = await DmService.getPresence(partnerIds);
    const presenceMap = new Map(presenceList.map((p) => [String(p.id), p]));

    const threads = rows.map((r) => {
      const partnerIdStr = String(r.partner_id);
      const presence = presenceMap.get(partnerIdStr) || { online: false, lastSeen: null };
      const isMineLast = r.last_message_sender_id != null && String(r.last_message_sender_id) === String(user.id);
      // "Read by other" only meaningful when the last message is mine
      const lastMessageReadByOther = isMineLast ? !!r.last_message_is_read : false;
      const unread = String(user.id) === String(r.user_a) ? r.unread_for_a : r.unread_for_b;
      return {
        // canonical (new) field names
        partnerId: partnerIdStr,
        partnerUsername: r.partner_username || '',
        partnerFirstName: r.partner_first_name || '',
        partnerPhoto: r.partner_photo || null,
        partnerPnptvId: r.partner_pnptv_id || null,
        lastMessage: r.last_message || '',
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        lastMessageSenderId: r.last_message_sender_id ? String(r.last_message_sender_id) : null,
        lastMessageMediaType: r.last_message_media_type || null,
        lastMessageReadByOther,
        unread,
        pinnedAt: r.pinned_at ? new Date(r.pinned_at).toISOString() : null,
        mutedUntil: r.muted_until ? new Date(r.muted_until).toISOString() : null,
        archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
        pinnedMessageId: r.pinned_message_id ? Number(r.pinned_message_id) : null,
        hideReadReceipts: r.hide_read_receipts === true,
        online: !!presence.online,
        lastSeen: presence.lastSeen || null,
        // legacy aliases used by older callers (Layout.tsx, etc.)
        userId: partnerIdStr,
        username: r.partner_username || '',
        firstName: r.partner_first_name || '',
        photoUrl: r.partner_photo || null,
        unreadCount: unread,
      };
    });
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
  try {
    const { rows } = await query(
      `SELECT dm.id, dm.sender_id, dm.recipient_id,
              dm.content, dm.is_deleted, dm.edited_at,
              dm.media_url, dm.media_type, dm.media_mime, dm.media_thumb_url,
              dm.message_type, dm.meta,
              dm.is_read, dm.read_at, dm.created_at, dm.reply_to_id,
              rxn.reactions, rpv.reply_preview
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
      LEFT JOIN LATERAL (
        SELECT json_build_object(
          'id', rdm.id,
          'senderId', rdm.sender_id,
          'content', COALESCE(
            NULLIF(LEFT(BTRIM(COALESCE(rdm.meta -> 'snapshot' ->> 'note', '')), 80), ''),
            NULLIF(LEFT(BTRIM(COALESCE(rdm.meta -> 'snapshot' ->> 'content', '')), 80), ''),
            NULLIF(LEFT(BTRIM(COALESCE(rdm.content, '')), 80), ''),
            CASE
              WHEN COALESCE((rdm.meta -> 'snapshot' ->> 'mediaType'), rdm.media_type) = 'image' THEN 'Photo'
              WHEN COALESCE((rdm.meta -> 'snapshot' ->> 'mediaType'), rdm.media_type) = 'video' THEN 'Video'
              WHEN COALESCE((rdm.meta -> 'snapshot' ->> 'mediaType'), rdm.media_type) = 'audio' THEN 'Voice message'
              WHEN rdm.message_type = 'post_card' THEN 'Shared post'
              ELSE ''
            END
          ),
          'mediaType', COALESCE((rdm.meta -> 'snapshot' ->> 'mediaType'), rdm.media_type),
          'isDeleted', rdm.is_deleted
        ) AS reply_preview
        FROM direct_messages rdm
        WHERE rdm.id = dm.reply_to_id
       ) rpv ON dm.reply_to_id IS NOT NULL
       WHERE ((dm.sender_id=$1 AND dm.recipient_id=$2) OR (dm.sender_id=$2 AND dm.recipient_id=$1))
         ${cursor ? 'AND dm.created_at < $3' : ''}
       ORDER BY dm.created_at DESC LIMIT 30`,
      cursor ? [user.id, partnerId, cursor] : [user.id, partnerId]
    );

    // Normalize: deleted messages show placeholder, reactions always array
    const messages = rows.reverse().map(normalizeDmMessageRow);

    // Mark messages as read only on the first page (no cursor) — paginated history
    // fetches must not emit false read-receipts for messages the user hasn't seen yet
    if (!cursor) {
      await DmService.markAsRead(user.id, partnerId, req.app.get('io') || null);
    }

    return res.json({ success: true, messages });
  } catch (err) {
    logger.error('getConversation error', err);
    return res.status(500).json({ error: 'Failed to load conversation' });
  }
};

// Get partner user info
const getPartnerInfo = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  if (!partnerId) return res.status(400).json({ error: 'Invalid partner ID' });
  try {
    const { rows } = await query(
      `SELECT id, telegram, username, first_name, last_name, photo_file_id, pnptv_id, role, creator_status FROM users WHERE id=$1`,
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
    const { rows: partnerRows } = await query(
      `SELECT id FROM users WHERE id = $1`,
      [partnerId]
    );

    if (partnerRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const callerId = String(user.id);
    const calleeId = String(partnerId);
    // String sort produces a stable, deterministic room name regardless of which
    // user initiated the call. Don't use Number() — UUIDs cast to NaN, producing
    // "dm-NaN-NaN" and silently collapsing all UUID-vs-UUID calls into one room.
    const [a, b] = [callerId, calleeId].sort();
    const roomName = `dm-${a}-${b}`;

    // Abort if there is already an active call between these two users
    const { rows: activeRows } = await query(
      `SELECT id, room_name FROM dm_video_calls
       WHERE status = 'active'
         AND LEAST(caller_id, callee_id) = LEAST($1, $2)
         AND GREATEST(caller_id, callee_id) = GREATEST($1, $2)
       LIMIT 1`,
      [callerId, calleeId]
    );

    let callId;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + DM_CALL_TTL_SECONDS * 1000).toISOString();

    if (activeRows.length > 0) {
      // Resume existing call
      callId = activeRows[0].id;
    } else {
      // Create persistent call record so signaling, decline, and history all work
      const { rows: insertRows } = await query(
        `INSERT INTO dm_video_calls (id, caller_id, callee_id, room_name, status, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW())
         RETURNING id`,
        [callerId, calleeId, roomName]
      );
      callId = insertRows[0].id;
    }

    // Redis entry carries callId so socket handlers can look it up
    const callData = JSON.stringify({ callId, roomName, callerId, calleeId, createdAt: createdAt.toISOString(), expiresAt });
    await getRedis().set(`${DM_CALL_KEY_PREFIX}${roomName}`, callData, 'EX', DM_CALL_TTL_SECONDS);

    const displayName = user.firstName || user.first_name || user.username || 'PNPtv User';
    const callLink = buildDmCallLink(roomName, callerId, calleeId);
    const token = await generateToken(roomName, callerId, displayName, true);

    logger.info('DM call created', { callId, callerId, calleeId, roomName });

    return res.json({
      success: true,
      callId,
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
    // Both caller and callee need publish rights in a 1-on-1 call
    const token = await generateToken(roomName, currentUserId, displayName, isModerator, {
      canPublishAudio: true,
      canPublishVideo: true,
    });

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
  const { content, replyToId } = req.body;

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
      { content, replyToId },
      { isAdmin: isAdminSender, senderTier: user.tier || 'free' }
    );

    const hydratedMessage = await getHydratedDmMessage(message.id) || message;

    // Cristina AI ticket intercept — skip socket/push, return ticket notice
    if (message._ticket) {
      return res.json({ success: true, message, ticketNotice: message._ticketNotice, remaining: req.dmLimit?.remaining ?? null });
    }

    // Deliver to recipient via Socket.IO if available
    const io = req.app.get('io');
    const senderName = user.firstName || user.first_name || user.username || 'User';
    if (io) {
      io.to(`user:${message.recipient_id}`).emit('dm:message', {
        ...hydratedMessage,
        senderName,
        senderPhoto: user.photoUrl || user.photo_url || null,
      });
    }

    // Fire push notification to recipient (non-blocking)
    const PushNotificationService = require('../../../services/pushNotificationService');
    const messageText = String(hydratedMessage.content || message.content || '');
    PushNotificationService.sendToUser(String(message.recipient_id), {
      title: senderName,
      body: messageText.slice(0, 120),
      url: `/dm/${user.id}`,
      tag: `dm-${user.id}`,
    }).catch(() => {});

    // ── Webapp → Telegram DM bridge: forward to recipient's Telegram ──
    DmService.bridgeToTelegram(user.id, message.recipient_id, hydratedMessage).catch(() => {});

    return res.json({ success: true, message: hydratedMessage, remaining: message._remaining ?? null });
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
    const isAdminUser = user.role === 'admin' || user.role === 'superadmin';
    if (!isAdminUser && String(msg.sender_id) !== String(user.id)) {
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

// ─── Telegram-style: pin / mute / archive / mark unread / pin message ───

const pinThread = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  try {
    const states = await DmService.getThreadStates(user.id);
    const current = states.get(String(partnerId));
    const next = !(current && current.pinnedAt);
    const r = await DmService.setThreadFlag(user.id, partnerId, { pinned: next });
    return res.json({ success: true, pinned: next, pinnedAt: r.pinnedAt });
  } catch (err) {
    logger.error('pinThread error', err);
    return res.status(500).json({ error: 'Failed to pin thread' });
  }
};

const muteThread = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  let { untilIso } = req.body || {};
  try {
    let mutedUntil = null;
    if (untilIso === 'forever') mutedUntil = '2099-01-01T00:00:00Z';
    else if (untilIso) {
      const d = new Date(untilIso);
      if (!Number.isFinite(d.getTime())) return res.status(400).json({ error: 'Invalid untilIso' });
      mutedUntil = d.toISOString();
    }
    const r = await DmService.setThreadFlag(user.id, partnerId, { mutedUntil });
    return res.json({ success: true, mutedUntil: r.mutedUntil });
  } catch (err) {
    logger.error('muteThread error', err);
    return res.status(500).json({ error: 'Failed to mute thread' });
  }
};

const archiveThread = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  try {
    const states = await DmService.getThreadStates(user.id);
    const current = states.get(String(partnerId));
    const next = !(current && current.archivedAt);
    const r = await DmService.setThreadFlag(user.id, partnerId, { archived: next });
    return res.json({ success: true, archived: next, archivedAt: r.archivedAt });
  } catch (err) {
    logger.error('archiveThread error', err);
    return res.status(500).json({ error: 'Failed to archive thread' });
  }
};

// Share a feed post to a DM thread — inserts as message_type='post_card'
// POST /api/webapp/dm/thread/:partnerId/share-post/:postId  body: { note?: string }
const shareDmPost = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) {
    return res.status(400).json({ error: 'Invalid postId' });
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  // Fetch post (+ shareability + author display fields)
  const { rows: postRows } = await query(
    `SELECT sp.id, sp.user_id, sp.content, sp.media_url, sp.media_type,
            sp.is_deleted, sp.is_shareable,
            sp.video_title, sp.video_description, sp.video_thumbnail_url,
            u.username AS author_username, u.first_name AS author_first_name,
            u.photo_file_id AS author_photo
       FROM social_posts sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.id = $1`,
    [postId]
  );
  const post = postRows[0];
  if (!post || post.is_deleted) return res.status(404).json({ error: 'Post not found' });

  try {
    const resolvePhoto = (p) => (p && (p.startsWith('/') || p.startsWith('http'))) ? p : null;
    const msg = await DmService.sharePostToDm(
      user.id,
      partnerId,
      {
        id: post.id,
        authorUsername: post.author_username || null,
        authorFirstName: post.author_first_name || null,
        authorPhoto: resolvePhoto(post.author_photo),
        content: post.content || null,
        mediaUrl: post.media_url || null,
        mediaType: post.media_type || null,
        videoTitle: post.video_title || null,
        videoDescription: post.video_description || null,
        videoThumbnailUrl: post.video_thumbnail_url || null,
      },
      note
    );
    // Socket fanout to recipient
    const io = req.app.get('io');
    const hydratedMessage = await getHydratedDmMessage(msg.id) || msg;
    if (io) {
      try { io.to(`user:${partnerId}`).emit('dm:message', hydratedMessage); } catch (_) { /* ignore */ }
    }
    return res.json({ success: true, messageId: msg.id, message: hydratedMessage });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    logger.error('shareDmPost error', err);
    return res.status(500).json({ error: 'Failed to share post to DM' });
  }
};

// N-07: toggle per-thread read-receipts visibility
// PUT /api/webapp/dm/thread/:partnerId/read-receipts  body: { hide: boolean }
const setReadReceipts = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  const hide = req.body?.hide === true;
  try {
    const r = await DmService.setThreadFlag(user.id, partnerId, { hideReadReceipts: hide });
    return res.json({ success: true, hideReadReceipts: r.hideReadReceipts });
  } catch (err) {
    logger.error('setReadReceipts error', err);
    return res.status(500).json({ error: 'Failed to update read-receipts preference' });
  }
};

const markUnread = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  try {
    const [a, b] = [String(user.id), String(partnerId)].sort();
    const col = String(user.id) === a ? 'unread_for_a' : 'unread_for_b';
    if (!['unread_for_a', 'unread_for_b'].includes(col)) throw new Error('Invalid column');
    await query(
      `UPDATE dm_threads SET ${col} = GREATEST(1, ${col}) WHERE user_a = $1 AND user_b = $2`,
      [a, b]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('markUnread error', err);
    return res.status(500).json({ error: 'Failed to mark unread' });
  }
};

const pinMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const partnerId = await resolveUserId(req.params.partnerId) || req.params.partnerId;
  const messageId = req.body?.messageId == null ? null : Number(req.body.messageId);
  if (messageId !== null && !Number.isFinite(messageId)) {
    return res.status(400).json({ error: 'Invalid messageId' });
  }
  try {
    if (messageId !== null) {
      // Validate message belongs to this conversation
      const { rows } = await query(
        `SELECT 1 FROM direct_messages
         WHERE id = $1 AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))
         LIMIT 1`,
        [messageId, user.id, partnerId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Message not in this conversation' });
    }
    const r = await DmService.setThreadFlag(user.id, partnerId, { pinnedMessageId: messageId });
    return res.json({ success: true, pinnedMessageId: r.pinnedMessageId });
  } catch (err) {
    logger.error('pinMessage error', err);
    return res.status(500).json({ error: 'Failed to pin message' });
  }
};

// ─── Global DM search ───

const searchAllDms = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, results: [] });
  if (q.length > 200) return res.status(400).json({ error: 'Query too long' });
  try {
    const results = await DmService.searchAllMessages(user.id, q, 50);
    return res.json({ success: true, results });
  } catch (err) {
    logger.error('searchAllDms error', err);
    return res.status(500).json({ error: 'Search failed' });
  }
};

// ─── Forward ───

const forwardMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const messageId = Number(req.body?.messageId);
  const recipientIds = Array.isArray(req.body?.recipientIds) ? req.body.recipientIds : [];
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  if (!Number.isFinite(messageId)) return res.status(400).json({ error: 'Invalid messageId' });
  if (!recipientIds.length || recipientIds.length > 5) return res.status(400).json({ error: 'recipientIds must be 1..5' });
  try {
    const result = await DmService.forwardMessage(user.id, messageId, recipientIds, note);
    // Best-effort socket fanout — let recipients see the new message immediately
    const io = req.app.get('io');
    if (io && Array.isArray(result.sent)) {
      for (const item of result.sent) {
        try {
          const hydratedMessage = await getHydratedDmMessage(item.messageId);
          if (hydratedMessage) io.to(`user:${item.recipientId}`).emit('dm:message', hydratedMessage);
        } catch (_) {}
      }
    }
    return res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    logger.error('forwardMessage error', err);
    return res.status(500).json({ error: 'Forward failed' });
  }
};

// ─── Presence ───

const getPresence = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
  try {
    const presence = await DmService.getPresence(ids);
    return res.json({ success: true, presence });
  } catch (err) {
    logger.error('getPresence error', err);
    return res.status(500).json({ error: 'Failed to load presence' });
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
  pinThread,
  muteThread,
  archiveThread,
  markUnread,
  pinMessage,
  searchAllDms,
  forwardMessage,
  getPresence,
  setReadReceipts,
  shareDmPost,
};
