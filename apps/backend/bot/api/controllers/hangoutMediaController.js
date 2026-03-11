'use strict';

/**
 * hangoutMediaController.js
 *
 * Handles media uploads for hangout group chats with per-hangout subdirectories.
 *
 *   POST /api/webapp/hangouts/groups/:id/media
 *     multipart body:
 *       - media   (File)   required  -- image (max 10 MB) or video (max 50 MB)
 *       - content (string) optional  -- caption text (max 500 chars)
 *
 * Returns the saved chat_messages row with all media columns populated,
 * and broadcasts the message over Socket.IO to the hangout room.
 */

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { processHangoutMedia } = require('../../services/hangoutMediaService');
const BlockedUser = require('../../../models/blockedUser');

// ── Helpers ──────────────────────────────────────────────────────────────────

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return user;
};

const isValidPhotoUrl = (p) =>
  p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));

const CHAT_MSG_RETURNING = `
  id, room, user_id, username, first_name, photo_url, content,
  media_url, media_type, media_mime, media_thumb_url,
  media_width, media_height, media_metadata, created_at
`;

// ── POST /api/webapp/hangouts/groups/:id/media ──────────────────────────────

const uploadHangoutMedia = async (req, res) => {
  const user = authGuard(req, res);
  if (!user) return;

  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group ID' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Membership check
    const { rows: memberRows } = await query(
      'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );
    if (memberRows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Block check: group creator blocked uploader OR uploader blocked group creator
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
        return res.status(403).json({ error: 'Cannot upload media in this group' });
      }
    }

    // Process the media into per-hangout directory
    const mediaResult = await processHangoutMedia(req.file, groupId, user.id);

    const room = `hangout:${groupId}`;
    const caption = (req.body?.content || '').trim().slice(0, 500) || null;

    // Resolve author avatar
    const photoResult = await query(
      'SELECT photo_file_id FROM users WHERE id=$1',
      [user.id]
    );
    const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
    const photoUrl = isValidPhotoUrl(rawPhoto) ? rawPhoto : null;

    const { rows } = await query(
      `INSERT INTO chat_messages
         (room, user_id, username, first_name, photo_url, content,
          media_url, media_type, media_mime, media_thumb_url,
          media_width, media_height, media_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${CHAT_MSG_RETURNING}`,
      [
        room,
        user.id,
        user.username || null,
        user.firstName || user.first_name || null,
        photoUrl,
        caption,
        mediaResult.mediaUrl,
        mediaResult.mediaType,
        mediaResult.mediaMime,
        mediaResult.thumbUrl || null,
        mediaResult.width || null,
        mediaResult.height || null,
        mediaResult.metadata ? JSON.stringify(mediaResult.metadata) : null,
      ]
    );

    const msg = {
      ...rows[0],
      photo_url: isValidPhotoUrl(rows[0].photo_url) ? rows[0].photo_url : null,
    };

    // Touch activity timestamp for 72h inactivity cleanup
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Broadcast to hangout room
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    return res.status(201).json({
      success: true,
      message: msg,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.userMessage || err.message });
    }
    logger.error('uploadHangoutMedia error', err);
    return res.status(500).json({ error: 'Failed to upload media' });
  }
};

module.exports = {
  uploadHangoutMedia,
};
