'use strict';
const { query } = require('../config/postgres');
const logger = require('../utils/logger');

/** Extract @usernames from a content string. Returns unique lowercase array. */
function parseMentions(content) {
  if (!content || typeof content !== 'string') return [];
  const matches = content.match(/@([a-zA-Z0-9_]{2,32})/g) || [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

/** Resolve usernames to user rows. Returns only matched active users. */
async function resolveUsernames(usernames) {
  if (!usernames.length) return [];
  const { rows } = await query(
    `SELECT id, username
     FROM users
     WHERE LOWER(username) = ANY($1) AND subscription_status != 'banned'`,
    [usernames]
  );
  return rows;
}

/**
 * Save mention records for a social post and fire notifications.
 * Call after post is saved to DB.
 */
async function createPostMentions(postId, mentionerId, content) {
  const usernames = parseMentions(content);
  if (!usernames.length) return;

  const users = await resolveUsernames(usernames);
  if (!users.length) return;

  const NotificationEmitter = require('./notificationEmitter');
  const actorRow = await query('SELECT username FROM users WHERE id=$1', [mentionerId]);
  const actorName = actorRow.rows[0]?.username || 'Someone';

  for (const user of users) {
    if (String(user.id) === String(mentionerId)) continue; // skip self-mention
    try {
      await query(
        'INSERT INTO post_mentions (post_id, mentioned_user_id, mentioner_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [postId, user.id, mentionerId]
      );
      await NotificationEmitter.emit({
        type: 'mention_post',
        category: 'social',
        priority: 'normal',
        actorId: mentionerId,
        targetUserId: user.id,
        entityType: 'post',
        entityId: String(postId),
        message: `@${actorName} mentioned you in a post`,
        metadata: { post_id: postId },
      });
    } catch (err) {
      logger.warn('mentionService: post mention failed', { err: err.message, user: user.id });
    }
  }
}

/**
 * Save mention records for a chat message and fire notifications.
 * Call after message is saved to DB.
 */
async function createChatMentions(messageId, mentionerId, content, room) {
  const usernames = parseMentions(content);
  if (!usernames.length) return;

  const users = await resolveUsernames(usernames);
  if (!users.length) return;

  const NotificationEmitter = require('./notificationEmitter');
  const actorRow = await query('SELECT username FROM users WHERE id=$1', [mentionerId]);
  const actorName = actorRow.rows[0]?.username || 'Someone';

  for (const user of users) {
    if (String(user.id) === String(mentionerId)) continue;
    try {
      await query(
        'INSERT INTO chat_message_mentions (message_id, mentioned_user_id, mentioner_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [messageId, user.id, mentionerId]
      );
      await NotificationEmitter.emit({
        type: 'mention_chat',
        category: 'social',
        priority: 'normal',
        actorId: mentionerId,
        targetUserId: user.id,
        entityType: 'chat_message',
        entityId: String(messageId),
        message: `@${actorName} mentioned you in a chat`,
        metadata: { room, message_id: messageId },
      });
    } catch (err) {
      logger.warn('mentionService: chat mention failed', { err: err.message, user: user.id });
    }
  }
}

/**
 * User search for @mention autocomplete.
 * Returns top matches ordered by followers descending.
 */
async function searchUsersForMention(searchQuery, limit = 8) {
  if (!searchQuery || searchQuery.length < 1) return [];
  const { rows } = await query(
    `SELECT id, username, photo_file_id AS avatar_url, creator_status
     FROM users
     WHERE LOWER(username) LIKE $1 AND subscription_status != 'banned'
     ORDER BY COALESCE(followers_count, 0) DESC, username
     LIMIT $2`,
    [`${searchQuery.toLowerCase()}%`, limit]
  );
  return rows;
}

module.exports = {
  parseMentions,
  resolveUsernames,
  createPostMentions,
  createChatMentions,
  searchUsersForMention,
};
