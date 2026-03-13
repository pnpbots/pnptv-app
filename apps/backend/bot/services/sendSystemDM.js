'use strict';

const NotificationEmitter = require('./notificationEmitter');
const logger = require('../../utils/logger');

/**
 * Insert a DM from senderId to recipientId directly into the DB.
 * Used for system/Cristina automated messages.
 */
async function sendSystemDM(senderId, recipientId, content, pgQuery) {
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) return;

  try {
    const { rows } = await pgQuery(
      `INSERT INTO direct_messages (sender_id, recipient_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, content, created_at`,
      [senderId, recipientId, text]
    );

    const message = rows[0];

    const [a, b] = [senderId, recipientId].sort();
    const incrementB = senderId === a;

    await pgQuery(
      `INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at, unread_for_a, unread_for_b)
       VALUES ($1, $2, $3, NOW(), CASE WHEN $4 THEN 0 ELSE 1 END, CASE WHEN $4 THEN 1 ELSE 0 END)
       ON CONFLICT (user_a, user_b) DO UPDATE SET
         last_message    = EXCLUDED.last_message,
         last_message_at = NOW(),
         unread_for_a    = dm_threads.unread_for_a + CASE WHEN $4 THEN 0 ELSE 1 END,
         unread_for_b    = dm_threads.unread_for_b + CASE WHEN $4 THEN 1 ELSE 0 END`,
      [a, b, text.slice(0, 100), incrementB]
    );

    // Trigger Push Notification
    // Fire-and-forget
    (async () => {
      try {
        const senderResult = await pgQuery('SELECT username, first_name FROM users WHERE id = $1', [senderId]);
        const sender = senderResult.rows[0];
        const senderName = sender?.first_name || sender?.username || 'System';

        await NotificationEmitter.emit({
          type: 'dm',
          category: 'messaging',
          priority: 'high',
          actorId: senderId,
          targetUserId: recipientId,
          entityType: 'message',
          entityId: String(message.id),
          message: `${senderName} sent you a message`,
          metadata: {
            senderId,
            senderName,
            messageId: message.id,
            preview: text.slice(0, 100),
            url: `/messages/${senderId}`
          }
        });
      } catch (notifErr) {
        logger.warn('System DM push notification error', { error: notifErr.message, messageId: message.id });
      }
    })();
  } catch (err) {
    logger.error('sendSystemDM error', err);
    throw err;
  }
}

module.exports = sendSystemDM;

