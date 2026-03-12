'use strict';
const { query } = require('../../../config/postgres');
const reactionService = require('../../services/reactionService');
const logger = require('../../../utils/logger');

// POST /api/webapp/social/posts/:postId/react  body: { emoji }
async function reactToPost(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const postId = parseInt(req.params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ error: 'Invalid post ID' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji required' });

  try {
    const result = await reactionService.togglePostReaction(user.id, postId, emoji);

    // Broadcast updated reactions to all clients via Socket.IO
    const io = req.app.get('io');
    if (io) io.emit('reaction:post', { postId, reactions: result.reactions });

    return res.json(result);
  } catch (err) {
    logger.error('[reactionController] reactToPost:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// GET /api/webapp/social/posts/:postId/reactions
async function getPostReactions(req, res) {
  const postId = parseInt(req.params.postId, 10);
  if (!Number.isFinite(postId) || postId <= 0) return res.status(400).json({ error: 'Invalid post ID' });

  try {
    const reactions = await reactionService.getPostReactions(postId);
    return res.json({ reactions });
  } catch (err) {
    logger.error('[reactionController] getPostReactions:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/webapp/chat/messages/:messageId/react  body: { emoji }
async function reactToChatMessage(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ error: 'Invalid message ID' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji required' });

  try {
    const result = await reactionService.toggleChatReaction(user.id, messageId, emoji);

    // Broadcast to the specific chat room
    const io = req.app.get('io');
    if (io) {
      const msgRow = await query('SELECT room FROM chat_messages WHERE id=$1', [messageId]);
      if (msgRow.rows.length > 0) {
        io.to(`chat:${msgRow.rows[0].room}`).emit('reaction:chat', { messageId, reactions: result.reactions });
      }
    }

    return res.json(result);
  } catch (err) {
    logger.error('[reactionController] reactToChatMessage:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// GET /api/webapp/chat/messages/:messageId/reactions
async function getChatReactions(req, res) {
  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ error: 'Invalid message ID' });

  try {
    const reactions = await reactionService.getChatReactions(messageId);
    return res.json({ reactions });
  } catch (err) {
    logger.error('[reactionController] getChatReactions:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/webapp/dm/messages/:messageId/react  body: { emoji }
async function reactToDm(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ error: 'Invalid message ID' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji required' });

  try {
    const result = await reactionService.toggleDmReaction(user.id, messageId, emoji);
    return res.json(result);
  } catch (err) {
    logger.error('[reactionController] reactToDm:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// GET /api/webapp/content/:contentId/reactions
async function getContentReactions(req, res) {
  const contentId = parseInt(req.params.contentId, 10);
  if (!Number.isFinite(contentId) || contentId <= 0) return res.status(400).json({ error: 'Invalid content ID' });

  const userId = req.session?.user?.id || null;

  try {
    const reactions = await reactionService.getContentReactions(contentId, userId);
    return res.json({ reactions });
  } catch (err) {
    logger.error('[reactionController] getContentReactions:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/webapp/content/:contentId/react  body: { emoji }
async function reactToContent(req, res) {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const contentId = parseInt(req.params.contentId, 10);
  if (!Number.isFinite(contentId) || contentId <= 0) return res.status(400).json({ error: 'Invalid content ID' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji required' });

  try {
    const result = await reactionService.toggleContentReaction(user.id, contentId, emoji);
    return res.json(result);
  } catch (err) {
    logger.error('[reactionController] reactToContent:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

module.exports = { reactToPost, getPostReactions, reactToChatMessage, getChatReactions, reactToDm, getContentReactions, reactToContent };
