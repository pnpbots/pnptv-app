'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');
const NotificationEmitter = require('./notificationEmitter');
const { resolveUserId } = require('../bot/utils/helpers');

/**
 * DM Service
 * Centralizes direct messaging logic for REST and Socket.IO
 */
class DmService {
  /**
   * Send a direct message (text or media)
   */
  static async sendMessage(senderId, recipientId, data, options = {}) {
    const { content, mediaUrl, mediaType, mediaMime, mediaThumbUrl } = data;
    const { isAdmin = false } = options;

    const resolvedRecipientId = await resolveUserId(recipientId);
    if (!resolvedRecipientId) {
      throw { statusCode: 404, message: 'Recipient not found' };
    }

    if (String(senderId) === String(resolvedRecipientId)) {
      throw { statusCode: 400, message: 'Cannot message yourself' };
    }

    // Intercept DMs to Cristina AI → create support ticket instead
    if (String(resolvedRecipientId) === 'cristina-ai') {
      const text = content ? String(content).trim().slice(0, 2000) : '';
      if (!text) {
        throw { statusCode: 400, message: 'Please describe your issue in a text message' };
      }
      await query(
        `INSERT INTO support_ticket_messages (user_id, sender_type, sender_name, content)
         VALUES ($1, 'user', (SELECT COALESCE(first_name, username, 'User') FROM users WHERE id = $1), $2)`,
        [senderId, text]
      );
      return {
        id: Date.now(),
        sender_id: senderId,
        recipient_id: resolvedRecipientId,
        content: text,
        is_read: true,
        created_at: new Date().toISOString(),
        _ticket: true,
        _ticketNotice: 'Your message has been sent to our support team. Open the Cristina AI widget (🧜‍♀️) for real-time help!',
      };
    }

    const blockCheck = await query(
      `SELECT 1 FROM blocked_users
       WHERE (user_id = $1 AND blocked_user_id = $2)
          OR (user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [resolvedRecipientId, senderId]
    );
    if (blockCheck.rows.length > 0) {
      throw { statusCode: 403, message: 'Cannot send message to this user', code: 'BLOCKED' };
    }

    if (!isAdmin) {
      const recipientResult = await query(
        'SELECT privacy, role, creator_status FROM users WHERE id = $1',
        [resolvedRecipientId]
      );
      const recipientRow = recipientResult.rows[0] || {};
      const privacy = recipientRow.privacy || {};
      const allowMessages = privacy.allowMessages !== undefined ? privacy.allowMessages : true;

      if (!allowMessages) {
        const followResult = await query(
          'SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1',
          [senderId, resolvedRecipientId]
        );
        if ((followResult.rowCount ?? followResult.rows.length) === 0) {
          throw { statusCode: 403, message: 'This user is not accepting messages', code: 'PRIVACY_RESTRICTED' };
        }
      }

      if (recipientRow.role === 'model' && recipientRow.creator_status === 'active') {
        const dmPolicy = privacy.creatorDmPolicy || 'subscribers_and_mutuals';
        if (dmPolicy === 'subscribers_and_mutuals') {
          const [subscriberCheck, mutualCheck] = await Promise.all([
            query(
              `SELECT 1 FROM user_entitlements
               WHERE user_id = $1 AND add_on_id = 'creator-subscription' AND creator_id = $2
                 AND (is_lifetime = true OR expires_at > NOW())
               LIMIT 1`,
              [String(senderId), String(resolvedRecipientId)]
            ),
            query(
              `SELECT 1 FROM user_follows f1
               JOIN user_follows f2
                 ON f1.follower_id = f2.following_id AND f1.following_id = f2.follower_id
               WHERE f1.follower_id = $1 AND f1.following_id = $2
               LIMIT 1`,
              [senderId, resolvedRecipientId]
            ),
          ]);

          if (subscriberCheck.rows.length === 0 && mutualCheck.rows.length === 0) {
            throw {
              statusCode: 403,
              message: 'Only subscribers and mutual follows can message this creator',
              code: 'CREATOR_DM_RESTRICTED',
            };
          }
        }
      }
    }

    const text = content ? String(content).trim().slice(0, 4000) : null;
    const { rows } = await query(
      `INSERT INTO direct_messages
         (sender_id, recipient_id, content, media_url, media_type, media_mime, media_thumb_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [senderId, resolvedRecipientId, text, mediaUrl || null, mediaType || null, mediaMime || null, mediaThumbUrl || null]
    );

    const message = rows[0];
    const [a, b] = [senderId, resolvedRecipientId].sort();
    const threadPreview = text ? text.slice(0, 100) : (mediaType ? `[${mediaType}]` : 'Media');

    await query(
      `INSERT INTO dm_threads (user_a, user_b, last_message_at, last_message, unread_for_a, unread_for_b)
       VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (user_a, user_b) DO UPDATE SET
         last_message_at = NOW(),
         last_message = EXCLUDED.last_message,
         unread_for_a = CASE WHEN dm_threads.user_a = $6 THEN 0 ELSE dm_threads.unread_for_a + 1 END,
         unread_for_b = CASE WHEN dm_threads.user_b = $6 THEN 0 ELSE dm_threads.unread_for_b + 1 END`,
      [a, b, threadPreview, senderId === a ? 0 : 1, senderId === b ? 0 : 1, senderId]
    );

    (async () => {
      try {
        const senderResult = await query('SELECT username, first_name FROM users WHERE id = $1', [senderId]);
        const sender = senderResult.rows[0];
        const senderName = sender?.first_name || sender?.username || 'Someone';

        await NotificationEmitter.emit({
          type: 'dm',
          category: 'messaging',
          priority: 'high',
          actorId: senderId,
          targetUserId: resolvedRecipientId,
          entityType: 'user',
          entityId: String(senderId),
          message: `${senderName} sent you a message`,
          metadata: { senderId, senderName, messageId: message.id, preview: threadPreview, url: `/messages/${senderId}` }
        });
      } catch (notifErr) {
        logger.warn('DM push notification error', { error: notifErr.message, messageId: message.id });
      }
    })();

    return message;
  }

  static async markAsRead(userId, otherUserId) {
    const resolvedOtherId = await resolveUserId(otherUserId);
    if (!resolvedOtherId) return;
    await query(
      `UPDATE direct_messages SET is_read = true WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false`,
      [userId, resolvedOtherId]
    );
    const [a, b] = [userId, resolvedOtherId].sort();
    const resetColumn = userId === a ? 'unread_for_a = 0' : 'unread_for_b = 0';
    await query(`UPDATE dm_threads SET ${resetColumn} WHERE user_a = $1 AND user_b = $2`, [a, b]);
  }

  static async deleteMessage(userId, messageId) {
    const result = await query(`UPDATE direct_messages SET is_deleted = true WHERE id = $1 AND sender_id = $2 RETURNING id`, [messageId, userId]);
    return result.rowCount > 0;
  }

  /**
   * Bridge a webapp DM to the recipient's Telegram account.
   * Sends via bot private message and stores the TG message ID in Redis
   * so the recipient can reply from Telegram.
   */
  static async bridgeToTelegram(senderId, recipientId, message) {
    try {
      const { getBotInstance } = require('../bot/core/bot');
      const bot = getBotInstance();
      if (!bot) return;

      // Look up recipient's Telegram ID
      const { rows: recipientRows } = await query(
        'SELECT telegram FROM users WHERE id = $1',
        [recipientId]
      );
      const recipientTelegramId = recipientRows[0]?.telegram;
      if (!recipientTelegramId) return; // recipient has no linked Telegram

      // Look up sender display name
      const { rows: senderRows } = await query(
        'SELECT username, first_name FROM users WHERE id = $1',
        [senderId]
      );
      const sender = senderRows[0];
      const senderName = sender?.first_name || sender?.username || 'Someone';

      const content = message.content || '';
      const mediaUrl = message.media_url || null;
      const mediaType = message.media_type || null;

      let tgMsg;
      const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || process.env.WEB_APP_URL || 'https://app.pnptv.app').replace(/\/+$/, '');

      if (mediaUrl && mediaType) {
        const fullMediaUrl = mediaUrl.startsWith('/') ? `${APP_PUBLIC_URL}${mediaUrl}` : mediaUrl;
        const caption = content ? `💬 ${senderName}: ${content}` : `💬 ${senderName}`;
        if (mediaType === 'image') {
          tgMsg = await bot.telegram.sendPhoto(recipientTelegramId, fullMediaUrl, { caption });
        } else if (mediaType === 'video') {
          tgMsg = await bot.telegram.sendVideo(recipientTelegramId, fullMediaUrl, { caption });
        } else if (mediaType === 'audio') {
          tgMsg = await bot.telegram.sendVoice(recipientTelegramId, fullMediaUrl, { caption });
        } else {
          tgMsg = await bot.telegram.sendMessage(recipientTelegramId, `💬 ${senderName}: ${fullMediaUrl}`);
        }
      } else if (content) {
        tgMsg = await bot.telegram.sendMessage(recipientTelegramId, `💬 ${senderName}: ${content}`);
      }

      // Store mapping so Telegram replies can be bridged back
      if (tgMsg) {
        try {
          const { getRedis } = require('../config/redis');
          const redis = getRedis();
          // Map TG message ID → webapp DM sender, so replies go to the right person
          await redis.set(
            `dm:tg-bridge:${recipientTelegramId}:${tgMsg.message_id}`,
            JSON.stringify({ senderId, recipientId, messageId: message.id }),
            'EX', 172800 // 48h TTL
          );
          // Also track the last DM partner for this Telegram user (fallback for non-reply messages)
          await redis.set(
            `dm:tg-last-partner:${recipientTelegramId}`,
            String(senderId),
            'EX', 86400 // 24h TTL
          );
        } catch (redisErr) {
          logger.warn('DM TG bridge: Redis store failed', { error: redisErr.message });
        }
      }

      logger.info(`[App→TG DM Bridge] ${senderName} → TG:${recipientTelegramId}`);
    } catch (bridgeErr) {
      // Fire-and-forget — don't break the DM flow
      logger.warn('[App→TG DM Bridge] Failed', { error: bridgeErr.message, senderId, recipientId });
    }
  }
}

module.exports = DmService;
