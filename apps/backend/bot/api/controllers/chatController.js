const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// Get chat history for a room (REST fallback)
const getChatHistory = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const room = req.params.room || 'general';
  const { cursor } = req.query;
  try {
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
    logger.error('getChatHistory error', err);
    return res.status(500).json({ error: 'Failed to load chat history' });
  }
};

// Send a chat message via REST (fallback when Socket.IO is unavailable)
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const room = req.params.room || 'general';
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  try {
    const text = content.trim().slice(0, 2000);
    const { rows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [room, user.id, user.username || null, user.firstName || user.first_name || null, user.photoUrl || user.photo_url || null, text]
    );
    const msg = rows[0];
    // Broadcast to room via Socket.IO if available
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }
    return res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('chat sendMessage error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

module.exports = { getChatHistory, sendMessage };
