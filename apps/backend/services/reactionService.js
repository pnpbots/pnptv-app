'use strict';
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const DEFAULT_EMOJIS = ['❤️', '😈', '😆', '🔝', '🐷'];

// PNPtv allowed reaction set. Accept both fully-qualified (with VS16) and
// unqualified forms to tolerate platform differences between web, iOS, TG.
const ALLOWED_REACTIONS = new Set([
  '😈', '❤️', '❤', '😆', '🔝', '🐷', '🍆', '🍑', '💨', '🚀',
]);

function isAllowedReaction(emoji) {
  if (!emoji || typeof emoji !== 'string') return false;
  return ALLOWED_REACTIONS.has(emoji);
}

function validateEmoji(emoji) {
  if (!isAllowedReaction(emoji)) throw new Error('Invalid emoji');
}

async function _groupReactions(rows) {
  return rows.map(r => ({
    emoji: r.emoji,
    count: Number(r.count),
    users: r.users || [],
  }));
}

// ── Post reactions ──

async function togglePostReaction(userId, postId, emoji) {
  validateEmoji(emoji);

  // One reaction per user — check what they currently have (any emoji)
  const existing = await query(
    'SELECT id, emoji FROM post_reactions WHERE post_id=$1 AND user_id=$2',
    [postId, userId]
  );

  let added;
  if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
    // Same emoji tapped again — remove it (toggle off)
    await query('DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2', [postId, userId]);
    added = false;
  } else {
    // Different emoji (or no reaction yet) — upsert to the new one
    await query(
      `INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [postId, userId, emoji]
    );
    // Remove any previous different reaction
    if (existing.rows.length > 0) {
      await query(
        'DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji != $3',
        [postId, userId, emoji]
      );
    }
    added = true;

    // Fire notification to post owner (non-blocking)
    setImmediate(async () => {
      try {
        const NotificationEmitter = require('./notificationEmitter');
        const postRow = await query('SELECT user_id FROM social_posts WHERE id=$1', [postId]);
        if (postRow.rows.length > 0 && postRow.rows[0].user_id !== userId) {
          const actorRow = await query('SELECT username FROM users WHERE id=$1', [userId]);
          const actorName = actorRow.rows[0]?.username || 'Someone';
          await NotificationEmitter.emit({
            type: 'reaction_post',
            category: 'social',
            priority: 'low',
            actorId: userId,
            targetUserId: postRow.rows[0].user_id,
            entityType: 'post',
            entityId: String(postId),
            message: `@${actorName} reacted ${emoji} to your post`,
            metadata: { emoji },
          });
        }
      } catch (err) {
        logger.warn('reactionService: notification failed', { err: err.message });
      }
    });
  }

  const reactions = await getPostReactions(postId);
  return { added, reactions };
}

async function getPostReactions(postId) {
  const { rows } = await query(
    `SELECT pr.emoji, COUNT(*) AS count,
       COALESCE(
         json_agg(
           json_build_object('id', u.id, 'username', u.username)
           ORDER BY pr.created_at
         ) FILTER (WHERE u.id IS NOT NULL),
         '[]'
       ) AS users
     FROM post_reactions pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.post_id = $1
     GROUP BY pr.emoji
     ORDER BY count DESC`,
    [postId]
  );
  return _groupReactions(rows);
}

// ── Chat message reactions ──

async function toggleChatReaction(userId, messageId, emoji) {
  validateEmoji(emoji);

  // One reaction per user per message
  const existing = await query(
    'SELECT id, emoji FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2',
    [messageId, userId]
  );

  let added;
  if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
    // Same emoji — toggle off
    await query('DELETE FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2', [messageId, userId]);
    added = false;
  } else {
    // New or different emoji — upsert
    await query(
      `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [messageId, userId, emoji]
    );
    if (existing.rows.length > 0) {
      await query(
        'DELETE FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji != $3',
        [messageId, userId, emoji]
      );
    }
    added = true;

    setImmediate(async () => {
      try {
        const NotificationEmitter = require('./notificationEmitter');
        const msgRow = await query('SELECT user_id FROM chat_messages WHERE id=$1', [messageId]);
        if (msgRow.rows.length > 0 && msgRow.rows[0].user_id !== userId) {
          const actorRow = await query('SELECT username FROM users WHERE id=$1', [userId]);
          const actorName = actorRow.rows[0]?.username || 'Someone';
          await NotificationEmitter.emit({
            type: 'reaction_chat',
            category: 'social',
            priority: 'low',
            actorId: userId,
            targetUserId: msgRow.rows[0].user_id,
            entityType: 'chat_message',
            entityId: String(messageId),
            message: `@${actorName} reacted ${emoji} to your message`,
            metadata: { emoji },
          });
        }
      } catch (err) {
        logger.warn('reactionService: chat notification failed', { err: err.message });
      }
    });
  }

  const reactions = await getChatReactions(messageId);
  return { added, reactions };
}

async function getChatReactions(messageId) {
  const { rows } = await query(
    `SELECT cr.emoji, COUNT(*) AS count,
       COALESCE(
         json_agg(
           json_build_object('id', u.id, 'username', u.username)
           ORDER BY cr.created_at
         ) FILTER (WHERE u.id IS NOT NULL),
         '[]'
       ) AS users
     FROM chat_message_reactions cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.message_id = $1
     GROUP BY cr.emoji
     ORDER BY count DESC`,
    [messageId]
  );
  return _groupReactions(rows);
}

// ── DM reactions ──

async function toggleDmReaction(userId, messageId, emoji) {
  validateEmoji(emoji);

  // One reaction per user per DM
  const existing = await query(
    'SELECT id, emoji FROM dm_reactions WHERE message_id=$1 AND user_id=$2',
    [messageId, userId]
  );

  let added;
  if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
    await query('DELETE FROM dm_reactions WHERE message_id=$1 AND user_id=$2', [messageId, userId]);
    added = false;
  } else {
    await query(
      `INSERT INTO dm_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji`,
      [messageId, userId, emoji]
    );
    if (existing.rows.length > 0) {
      await query(
        'DELETE FROM dm_reactions WHERE message_id=$1 AND user_id=$2 AND emoji != $3',
        [messageId, userId, emoji]
      );
    }
    added = true;
  }

  const reactions = await getDmReactions(messageId);
  return { added, reactions };
}

async function getDmReactions(messageId) {
  const { rows } = await query(
    `SELECT dr.emoji, COUNT(*) AS count,
       COALESCE(
         json_agg(
           json_build_object('id', u.id, 'username', u.username)
           ORDER BY dr.created_at
         ) FILTER (WHERE u.id IS NOT NULL),
         '[]'
       ) AS users
     FROM dm_reactions dr
     JOIN users u ON u.id = dr.user_id
     WHERE dr.message_id = $1
     GROUP BY dr.emoji
     ORDER BY count DESC`,
    [messageId]
  );
  return _groupReactions(rows);
}

// ── Content reactions (PRIME videos / audio — Directus content IDs) ──

async function toggleContentReaction(userId, contentId, emoji) {
  validateEmoji(emoji);

  const existing = await query(
    'SELECT id, emoji FROM content_reactions WHERE content_id=$1 AND user_id=$2',
    [contentId, userId]
  );

  let added;
  if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
    // Same emoji tapped again — toggle off
    await query('DELETE FROM content_reactions WHERE content_id=$1 AND user_id=$2', [contentId, userId]);
    added = false;
  } else {
    // New or different emoji — upsert to the new one
    await query(
      `INSERT INTO content_reactions (content_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT (content_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
      [contentId, userId, emoji]
    );
    added = true;
  }

  const reactions = await getContentReactions(contentId, userId);
  return { added, reactions };
}

async function getContentReactions(contentId, userId = null) {
  const { rows } = await query(
    `SELECT cr.emoji, COUNT(*) AS count,
       COALESCE(
         json_agg(
           json_build_object('id', u.id, 'username', u.username)
           ORDER BY cr.created_at
         ) FILTER (WHERE u.id IS NOT NULL),
         '[]'
       ) AS users,
       BOOL_OR(cr.user_id = $2) AS reacted_by_me
     FROM content_reactions cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.content_id = $1
     GROUP BY cr.emoji
     ORDER BY count DESC`,
    [contentId, userId || '']
  );
  return rows.map(r => ({
    emoji: r.emoji,
    count: Number(r.count),
    users: r.users || [],
    reactedByMe: r.reacted_by_me || false,
  }));
}

module.exports = {
  DEFAULT_EMOJIS,
  ALLOWED_REACTIONS,
  isAllowedReaction,
  togglePostReaction,
  getPostReactions,
  toggleChatReaction,
  getChatReactions,
  toggleDmReaction,
  getDmReactions,
  toggleContentReaction,
  getContentReactions,
};
