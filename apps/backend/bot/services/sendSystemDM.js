'use strict';

/**
 * Insert a DM from senderId to recipientId directly into the DB.
 * Used for system/Cristina automated messages.
 */
async function sendSystemDM(senderId, recipientId, content, pgQuery) {
  const text = String(content || '').trim().slice(0, 4000);
  if (!text) return;

  await pgQuery(
    `INSERT INTO direct_messages (sender_id, recipient_id, content)
     VALUES ($1, $2, $3)`,
    [senderId, recipientId, text]
  );

  const [a, b] = [senderId, recipientId].sort();
  const senderIsA = senderId === a;
  const unreadCol = senderIsA ? 'unread_for_b' : 'unread_for_a';

  await pgQuery(
    `INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at, ${unreadCol})
     VALUES ($1, $2, $3, NOW(), 1)
     ON CONFLICT (user_a, user_b) DO UPDATE SET
       last_message     = EXCLUDED.last_message,
       last_message_at  = NOW(),
       ${unreadCol}     = dm_threads.${unreadCol} + 1`,
    [a, b, text.slice(0, 100)]
  );
}

module.exports = sendSystemDM;
