const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

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
  const { partnerId } = req.params;
  const { cursor } = req.query;
  try {
    const { rows } = await query(
      `SELECT id, sender_id, recipient_id, content, is_read, created_at
       FROM direct_messages
       WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))
         AND is_deleted = false
         ${cursor ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC LIMIT 30`,
      cursor ? [user.id, partnerId, cursor] : [user.id, partnerId]
    );
    // Mark messages as read
    await query(
      `UPDATE direct_messages SET is_read = true
       WHERE sender_id=$1 AND recipient_id=$2 AND is_read=false`,
      [partnerId, user.id]
    );
    // Reset unread count in thread
    const [a, b] = [user.id, partnerId].sort();
    const field = user.id === a ? 'unread_for_a' : 'unread_for_b';
    await query(
      `UPDATE dm_threads SET ${field} = 0 WHERE user_a=$1 AND user_b=$2`,
      [a, b]
    ).catch(() => {});
    return res.json({ success: true, messages: rows.reverse() });
  } catch (err) {
    logger.error('getConversation error', err);
    return res.status(500).json({ error: 'Failed to load conversation' });
  }
};

// Get partner user info
const getPartnerInfo = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { partnerId } = req.params;
  try {
    const { rows } = await query(
      `SELECT id, username, first_name, last_name, photo_file_id, pnptv_id FROM users WHERE id=$1`,
      [partnerId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    logger.error('getPartnerInfo error', err);
    return res.status(500).json({ error: 'Failed to load user' });
  }
};

// Send a DM via REST (fallback when Socket.IO is unavailable)
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { recipientId } = req.params;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  if (recipientId === user.id) return res.status(400).json({ error: 'Cannot message yourself' });
  try {
    const text = content.trim().slice(0, 4000);
    const { rows } = await query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content)
       VALUES ($1, $2, $3) RETURNING *`,
      [user.id, recipientId, text]
    );
    const msg = rows[0];
    // Upsert dm_threads
    const [a, b] = [user.id, recipientId].sort();
    const unreadField = user.id === a ? 'unread_for_b' : 'unread_for_a';
    await query(
      `INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at, ${unreadField})
       VALUES ($1, $2, $3, NOW(), 1)
       ON CONFLICT (user_a, user_b) DO UPDATE SET
         last_message = EXCLUDED.last_message,
         last_message_at = NOW(),
         ${unreadField} = dm_threads.${unreadField} + 1`,
      [a, b, text.slice(0, 100)]
    );
    // Deliver to recipient via Socket.IO if available
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${recipientId}`).emit('dm:received', {
        id: msg.id,
        sender_id: msg.sender_id,
        recipient_id: msg.recipient_id,
        content: msg.content,
        created_at: msg.created_at,
      });
    }
    return res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('sendMessage DM error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

module.exports = { getThreads, getConversation, getPartnerInfo, sendMessage };
