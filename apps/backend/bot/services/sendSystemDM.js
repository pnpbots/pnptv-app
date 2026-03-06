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
}

module.exports = sendSystemDM;
