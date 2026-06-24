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
  static _buildThreadPreview({ content, mediaType, messageType, meta }) {
    const text = typeof content === 'string' ? content.trim() : '';
    if (messageType === 'post_card' && meta?.kind === 'forward') {
      const src = meta.source || {};
      const noteText = typeof meta.note === 'string' ? meta.note.trim() : '';
      const srcText = typeof src.text === 'string' ? src.text.trim() : '';
      const author = src.authorUsername
        ? `@${src.authorUsername}`
        : (src.authorFirstName || 'User');
      if (noteText) return noteText.slice(0, 100);
      if (srcText) return `↪ ${author}: ${srcText}`.slice(0, 100);
      if (src.mediaType === 'image') return `↪ ${author}: [image]`;
      if (src.mediaType === 'video') return `↪ ${author}: [video]`;
      if (src.mediaType === 'audio') return `↪ ${author}: [audio]`;
      return `↪ Forwarded from ${author}`.slice(0, 100);
    }
    if (messageType === 'post_card') {
      const snap = meta?.snapshot || null;
      const note = typeof snap?.note === 'string' ? snap.note.trim() : '';
      const preview = typeof snap?.content === 'string' ? snap.content.trim() : '';
      if (note) return note.slice(0, 100);
      if (preview) return `Shared post: ${preview}`.slice(0, 100);
      if (snap?.mediaType === 'image') return 'Shared post: [image]';
      if (snap?.mediaType === 'video') return 'Shared post: [video]';
      if (snap?.mediaType === 'audio') return 'Shared post: [audio]';
      return text.slice(0, 100) || 'Shared post';
    }
    if (text) return text.slice(0, 100);
    if (mediaType) return `[${mediaType}]`;
    return 'Media';
  }

  /**
   * Send a direct message (text or media)
   */
  static async sendMessage(senderId, recipientId, data, options = {}) {
    const { content, mediaUrl, mediaType, mediaMime, mediaThumbUrl, messageType, meta, replyToId } = data;
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

    let resolvedReplyToId = null;
    if (replyToId != null) {
      const replyId = Number(replyToId);
      if (!Number.isFinite(replyId) || replyId <= 0) {
        throw { statusCode: 400, message: 'Invalid reply target' };
      }
      const replyCheck = await query(
        `SELECT id
           FROM direct_messages
          WHERE id = $1
            AND ((sender_id = $2 AND recipient_id = $3) OR (sender_id = $3 AND recipient_id = $2))
            AND is_deleted = false
          LIMIT 1`,
        [replyId, senderId, resolvedRecipientId]
      );
      if (!replyCheck.rows.length) {
        throw { statusCode: 404, message: 'Reply target not found' };
      }
      resolvedReplyToId = replyId;
    }

    const text = content ? String(content).trim().slice(0, 4000) : null;
    const mType = (messageType === 'post_card' ? 'post_card' : 'text');
    const metaJson = meta ? JSON.stringify(meta) : null;
    const { rows } = await query(
      `INSERT INTO direct_messages
         (sender_id, recipient_id, content, media_url, media_type, media_mime, media_thumb_url, message_type, meta, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING *`,
      [senderId, resolvedRecipientId, text, mediaUrl || null, mediaType || null, mediaMime || null, mediaThumbUrl || null, mType, metaJson, resolvedReplyToId]
    );

    const message = rows[0];
    const [a, b] = [senderId, resolvedRecipientId].sort();
    const threadPreview = DmService._buildThreadPreview({
      content: text,
      mediaType,
      messageType: mType,
      meta,
    });

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
          metadata: { senderId, senderName, messageId: message.id, preview: threadPreview, url: `/dm/${senderId}` }
        });
      } catch (notifErr) {
        logger.warn('DM push notification error', { error: notifErr.message, messageId: message.id });
      }
    })();

    return message;
  }

  static async markAsRead(userId, otherUserId, io = null) {
    const resolvedOtherId = await resolveUserId(otherUserId);
    if (!resolvedOtherId) return;

    // N-07 privacy: if this user has hide_read_receipts=true for partner, still
    // clear unread badges locally, but don't stamp read_at or notify partner.
    let hideReceipts = false;
    try {
      const { rows: prefRows } = await query(
        `SELECT hide_read_receipts FROM dm_thread_state
          WHERE user_id = $1 AND partner_id = $2`,
        [userId, resolvedOtherId]
      );
      hideReceipts = prefRows[0]?.hide_read_receipts === true;
    } catch (_) { /* column may not exist yet pre-migration */ }

    const updateSql = hideReceipts
      ? `UPDATE direct_messages SET is_read = true
           WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false
         RETURNING id`
      : `UPDATE direct_messages SET is_read = true, read_at = now()
           WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false
         RETURNING id`;

    const { rows } = await query(updateSql, [userId, resolvedOtherId]);

    const [a, b] = [userId, resolvedOtherId].sort();
    const resetColumn = String(userId) === String(a) ? 'unread_for_a = 0' : 'unread_for_b = 0';
    await query(`UPDATE dm_threads SET ${resetColumn} WHERE user_a = $1 AND user_b = $2`, [a, b]);

    if (hideReceipts) return; // skip ✓✓ fanout

    let targetIo = io;
    if (!targetIo) {
      try { targetIo = require('./socketSingleton').get(); } catch (_) { targetIo = null; }
    }
    if (targetIo && rows.length > 0) {
      const readAt = new Date().toISOString();
      const lastReadMessageId = rows[rows.length - 1].id;
      try {
        targetIo.to(`user:${resolvedOtherId}`).emit('dm:message:read', {
          partnerId: String(userId),
          lastReadMessageId,
          readAt,
        });
      } catch (_) { /* ignore */ }
    }
  }

  // ─── Telegram-style: per-user thread state (pin / mute / archive / pin-message) ───

  static async setThreadFlag(userId, partnerId, patch) {
    const partnerResolved = await resolveUserId(partnerId) || partnerId;
    // Load existing row (if any)
    const { rows } = await query(
      `SELECT pinned_at, muted_until, archived_at, pinned_message_id, hide_read_receipts
         FROM dm_thread_state WHERE user_id = $1 AND partner_id = $2`,
      [userId, partnerResolved]
    );
    const existing = rows[0] || {
      pinned_at: null, muted_until: null, archived_at: null,
      pinned_message_id: null, hide_read_receipts: false,
    };

    const now = new Date();
    let pinnedAt = existing.pinned_at;
    if (patch.pinned === true) pinnedAt = pinnedAt || now;
    else if (patch.pinned === false) pinnedAt = null;

    let mutedUntil = existing.muted_until;
    if (patch.mutedUntil !== undefined) mutedUntil = patch.mutedUntil; // null clears mute

    let archivedAt = existing.archived_at;
    if (patch.archived === true) archivedAt = archivedAt || now;
    else if (patch.archived === false) archivedAt = null;

    let pinnedMessageId = existing.pinned_message_id;
    if (patch.pinnedMessageId !== undefined) pinnedMessageId = patch.pinnedMessageId;

    let hideReadReceipts = existing.hide_read_receipts === true;
    if (patch.hideReadReceipts !== undefined) hideReadReceipts = !!patch.hideReadReceipts;

    await query(
      `INSERT INTO dm_thread_state (user_id, partner_id, pinned_at, muted_until, archived_at, pinned_message_id, hide_read_receipts, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, partner_id) DO UPDATE SET
         pinned_at = EXCLUDED.pinned_at,
         muted_until = EXCLUDED.muted_until,
         archived_at = EXCLUDED.archived_at,
         pinned_message_id = EXCLUDED.pinned_message_id,
         hide_read_receipts = EXCLUDED.hide_read_receipts,
         updated_at = now()`,
      [userId, partnerResolved, pinnedAt, mutedUntil, archivedAt, pinnedMessageId, hideReadReceipts]
    );
    return { pinnedAt, mutedUntil, archivedAt, pinnedMessageId, hideReadReceipts };
  }

  static async getThreadStates(userId) {
    const { rows } = await query(
      `SELECT partner_id, pinned_at, muted_until, archived_at, pinned_message_id, hide_read_receipts
       FROM dm_thread_state WHERE user_id = $1`,
      [userId]
    );
    const map = new Map();
    for (const r of rows) {
      map.set(String(r.partner_id), {
        pinnedAt: r.pinned_at ? new Date(r.pinned_at).toISOString() : null,
        mutedUntil: r.muted_until ? new Date(r.muted_until).toISOString() : null,
        archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
        pinnedMessageId: r.pinned_message_id ? Number(r.pinned_message_id) : null,
        hideReadReceipts: r.hide_read_receipts === true,
      });
    }
    return map;
  }

  // ─── Global DM search (FTS) ───

  static async searchAllMessages(userId, q, limit = 30) {
    const term = String(q || '').trim();
    if (term.length < 2) return [];
    const { rows } = await query(
      `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.media_type, dm.created_at,
              u.id AS partner_id, u.username AS partner_username, u.first_name AS partner_first_name,
              u.photo_file_id AS partner_photo,
              ts_rank(to_tsvector('simple', COALESCE(dm.content, '')), plainto_tsquery('simple', $2)) AS rank
         FROM direct_messages dm
         JOIN users u ON u.id = CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END
        WHERE (dm.sender_id = $1 OR dm.recipient_id = $1)
          AND dm.is_deleted = false
          AND dm.content IS NOT NULL
          AND to_tsvector('simple', dm.content) @@ plainto_tsquery('simple', $2)
        ORDER BY rank DESC, dm.created_at DESC
        LIMIT $3`,
      [userId, term, limit]
    );
    return rows.map((r) => ({
      id: Number(r.id),
      partnerId: String(r.partner_id),
      partnerName: r.partner_first_name || r.partner_username || 'User',
      partnerPhoto: r.partner_photo || null,
      snippet: (r.content || '').slice(0, 160),
      mediaType: r.media_type || null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      isMine: String(r.sender_id) === String(userId),
    }));
  }

  // ─── Forward ───

  static async forwardMessage(userId, sourceMessageId, recipientIds, note) {
    const ids = (Array.isArray(recipientIds) ? recipientIds : []).slice(0, 5);
    if (!ids.length) return { success: true, sent: [] };

    // JOIN users so we can snapshot the original author onto a forward card.
    const { rows: srcRows } = await query(
      `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.media_url,
              dm.media_type, dm.media_mime, dm.media_thumb_url, dm.message_type,
              dm.meta, dm.created_at,
              u.username   AS sender_username,
              u.first_name AS sender_first_name,
              u.photo_file_id AS sender_photo
         FROM direct_messages dm
         LEFT JOIN users u ON u.id = dm.sender_id
        WHERE dm.id = $1 LIMIT 1`,
      [sourceMessageId]
    );
    const src = srcRows[0];
    if (!src) throw { statusCode: 404, message: 'Source message not found' };
    if (String(src.sender_id) !== String(userId) && String(src.recipient_id) !== String(userId)) {
      throw { statusCode: 403, message: 'Cannot forward this message' };
    }

    const noteText = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    const baseContent = src.content || '';
    const forwardedContent = noteText ? `${noteText}\n\n${baseContent}`.trim() : baseContent;

    let messageType;
    let meta;
    if (src.message_type === 'post_card') {
      messageType = 'post_card';
      meta = {
        ...(src.meta || {}),
        snapshot: {
          ...((src.meta && src.meta.snapshot) || {}),
          note: noteText || src.meta?.snapshot?.note || null,
        },
      };
    } else {
      // Wrap every non-post_card forward as a card so recipients see author
      // context + media preview instead of a bare text/media row.
      messageType = 'post_card';
      meta = {
        kind: 'forward',
        source: {
          type: 'dm',
          messageId: src.id,
          authorId: String(src.sender_id),
          authorUsername: src.sender_username || null,
          authorFirstName: src.sender_first_name || null,
          authorPhoto: src.sender_photo || null,
          createdAt: src.created_at ? new Date(src.created_at).toISOString() : null,
          text: src.content || null,
          mediaUrl: src.media_url || null,
          mediaType: src.media_type || null,
          mediaThumbUrl: src.media_thumb_url || null,
        },
        note: noteText || null,
      };
    }

    // For forward cards we intentionally zero the legacy media columns so the
    // recipient doesn't render the media twice (once from the column, once from
    // the card). meta.source carries the media for the card renderer; legacy
    // clients that ignore meta fall back to the text-only content.
    const isForwardCard = meta && meta.kind === 'forward';
    const sent = [];
    for (const rid of ids) {
      const resolvedRid = (await resolveUserId(rid)) || rid;
      try {
        const msg = await DmService.sendMessage(
          userId,
          resolvedRid,
          {
            content: forwardedContent || null,
            mediaUrl: isForwardCard ? null : (src.media_url || null),
            mediaType: isForwardCard ? null : (src.media_type || null),
            mediaMime: isForwardCard ? null : (src.media_mime || null),
            mediaThumbUrl: isForwardCard ? null : (src.media_thumb_url || null),
            messageType,
            meta,
          },
          {}
        );
        sent.push({ recipientId: String(resolvedRid), messageId: msg.id });
      } catch (err) {
        logger.warn('forwardMessage per-recipient failed', { rid: resolvedRid, err: err.message || err });
      }
    }
    return { success: true, sent };
  }

  // ─── Share a feed post to a DM (renders as post_card in the thread) ────
  static async sharePostToDm(senderId, recipientId, post, note) {
    const authorHandle = post.authorUsername ? `@${post.authorUsername}` : (post.authorFirstName || 'User');
    const preview = (post.content || '').trim().slice(0, 180);
    const noteText = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    const bodyParts = [];
    if (noteText) bodyParts.push(noteText);
    bodyParts.push(`📎 ${authorHandle}:`);
    if (preview) bodyParts.push(preview + (post.content && post.content.length > 180 ? '…' : ''));
    bodyParts.push(`https://pnptv.app/post/${post.id}`);
    const content = bodyParts.join('\n');
    const meta = {
      postId: post.id,
      snapshot: {
        authorUsername: post.authorUsername || null,
        authorFirstName: post.authorFirstName || null,
        authorPhoto: post.authorPhoto || null,
        content: preview || null,
        mediaUrl: post.mediaUrl || null,
        mediaType: post.mediaType || null,
        videoTitle: post.videoTitle || null,
        videoDescription: post.videoDescription || null,
        videoThumbnailUrl: post.videoThumbnailUrl || null,
        note: noteText || null,
      },
    };
    return DmService.sendMessage(
      senderId,
      recipientId,
      { content, mediaUrl: null, mediaType: null, messageType: 'post_card', meta },
      {}
    );
  }

  // ─── Presence (Redis-backed) ───

  static async setOnline(userId) {
    try {
      const { getRedis } = require('../config/redis');
      await getRedis().set(`presence:online:${userId}`, '1', 'EX', 60);
    } catch (_) { /* ignore */ }
  }
  static async refreshOnline(userId) {
    try {
      const { getRedis } = require('../config/redis');
      await getRedis().expire(`presence:online:${userId}`, 60);
    } catch (_) { /* ignore */ }
  }
  static async setOffline(userId) {
    try {
      const { getRedis } = require('../config/redis');
      const redis = getRedis();
      await redis.del(`presence:online:${userId}`);
      await redis.set(`presence:lastseen:${userId}`, new Date().toISOString(), 'EX', 60 * 60 * 24 * 30);
    } catch (_) { /* ignore */ }
  }
  static async getPresence(userIds) {
    const ids = (Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean).slice(0, 100);
    if (!ids.length) return [];
    try {
      const { getRedis } = require('../config/redis');
      const redis = getRedis();
      const results = [];
      for (const id of ids) {
        const onlineFlag = await redis.get(`presence:online:${id}`).catch(() => null);
        if (onlineFlag) {
          results.push({ id, online: true, lastSeen: null });
        } else {
          const lastSeen = await redis.get(`presence:lastseen:${id}`).catch(() => null);
          results.push({ id, online: false, lastSeen: lastSeen || null });
        }
      }
      return results;
    } catch (_) {
      return ids.map((id) => ({ id, online: false, lastSeen: null }));
    }
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

      const { getRedis } = require('../config/redis');
      const redis = getRedis();

      // Check if this is the first bridged DM for this recipient — send intro once per 7 days
      const introKey = `dm:tg-bridge-intro:${recipientTelegramId}`;
      const hasSeenIntro = await redis.get(introKey).catch(() => null);
      if (!hasSeenIntro) {
        await bot.telegram.sendMessage(
          recipientTelegramId,
          `📱 *PNPtv\\! — Notificaciones de mensajes activadas*\n\n` +
          `Este bot te entrega aquí los mensajes que recibes en la app de PNPtv\\!\n\n` +
          `*\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-*\n` +
          `_Esto NO es un chat de Telegram\\. Los mensajes que ves debajo fueron enviados dentro de la app pnptv\\.app \\— este bot solo te avisa aquí para que no te los pierdas\\._\n` +
          `*\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-*\n\n` +
          `↩️ *Responde* a cualquier notificación para contestar directamente desde aquí\\.\n` +
          `🌐 O abre [pnptv\\.app](https://pnptv.app) para ver la conversación completa\\.`,
          { parse_mode: 'MarkdownV2', disable_web_page_preview: true }
        ).catch(() => {});
        await redis.set(introKey, '2', 'EX', 604800).catch(() => {}); // 7 days — version 2
      }

      let tgMsg;
      const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || process.env.WEB_APP_URL || 'https://pnptv.app').replace(/\/+$/, '');
      const notifHeader = `📱 *PNPtv\\!* — mensaje de *${senderName.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n`;
      const notifFooter = `\n_↩️ Responde aquí · Abre [pnptv\\.app](${APP_PUBLIC_URL}/messages)_`;

      if (mediaUrl && mediaType) {
        const fullMediaUrl = mediaUrl.startsWith('/') ? `${APP_PUBLIC_URL}${mediaUrl}` : mediaUrl;
        const escapedContent = content ? content.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : '';
        const caption = `${notifHeader}${escapedContent}${notifFooter}`;
        if (mediaType === 'image') {
          tgMsg = await bot.telegram.sendPhoto(recipientTelegramId, fullMediaUrl, { caption, parse_mode: 'MarkdownV2' });
        } else if (mediaType === 'video') {
          tgMsg = await bot.telegram.sendVideo(recipientTelegramId, fullMediaUrl, { caption, parse_mode: 'MarkdownV2' });
        } else if (mediaType === 'audio') {
          tgMsg = await bot.telegram.sendVoice(recipientTelegramId, fullMediaUrl, { caption, parse_mode: 'MarkdownV2' });
        } else {
          tgMsg = await bot.telegram.sendMessage(recipientTelegramId, `${notifHeader}${escapedContent || fullMediaUrl}${notifFooter}`, { parse_mode: 'MarkdownV2', disable_web_page_preview: true });
        }
      } else if (content) {
        const escapedContent = content.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        tgMsg = await bot.telegram.sendMessage(
          recipientTelegramId,
          `${notifHeader}${escapedContent}${notifFooter}`,
          { parse_mode: 'MarkdownV2', disable_web_page_preview: true }
        );
      }

      // Store mapping so Telegram replies can be bridged back
      if (tgMsg) {
        try {
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
