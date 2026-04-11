#!/usr/bin/env node
'use strict';

/**
 * sendCommunityRulesBroadcast.js
 *
 * One-shot community rules announcement, sent through:
 *   - In-app DM (from SYSTEM user, recipient = every active user)
 *   - Telegram DM (per active user with a telegram id)
 *   - Email (per active user with an email)
 *   - Single post to the main Telegram community group
 *
 * Every channel ships the bilingual (English + Spanish) message in a single
 * payload — no language detection. Users see both versions.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendCommunityRulesBroadcast.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendCommunityRulesBroadcast.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const emailService = require(path.join(BACKEND_ROOT, 'bot/services/emailservice'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const TG_DELAY_MS = 60;     // ~16 msgs/sec — under Telegram's 30/sec ceiling
const EMAIL_DELAY_MS = 400; // SMTP courtesy spacing
const SYSTEM_SENDER_ID = 'SYSTEM';
const COMMUNITY_GROUP_ID = process.env.GROUP_ID || '-1003650451429';
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Message bodies ──────────────────────────────────────────────────────────

const TELEGRAM_HTML = `⚠️ <b>Important — Please read carefully</b>

This is the same notice we have been sending for over <b>4 weeks</b>. Today is the last time before bans begin.

1. <b>Read the tutorials.</b> They are inside the app and answer 95% of common questions. We have just reset them for everyone — you will see them again on next login.

2. <b>Use Cristina AI for questions.</b> She is the shining circle widget on the app — impossible to miss. Tap it and ask anything in plain language. She is trained on the entire platform.

3. <b>Do not use the Feed or Hangouts to complain or ask questions.</b> Those are community spaces, not support channels. Use the proper channels inside the app.

4. <b>Emails and Telegram bot messages will no longer be answered.</b> All support requests must come through the app.

5. <b>The Telegram bot is a transition tool, not the future.</b> The app syncs with Telegram for now because Telegram is phasing out groups and channels. The future is <b>pnptv.app</b> — please use it. <b>Stop sending commands to the bot.</b>

6. <b>Bans begin today. No second chances.</b>
• 95% of you have figured this out and use the app the way it was designed. Thank you.
• The 5% who refuse to read tutorials, ignore Cristina, and demand personal hand-holding are making it impossible to ship features and respond to legitimate questions.
• If you can use X (Twitter), Telegram, and Zoom, you can use pnptv.app. We have personally explained this to many of you and you keep doing the same thing — this is not lack of support on our end.
• From today, users who continue to violate these rules will be banned. <b>No warnings, no second chances</b> like we gave in the past.

We are building this for the majority who want the full features of the app. Thank you for your patience.

— <b>The PNPtv! Team</b>

━━━━━━━━━━━━━━━━━━━━━

⚠️ <b>Importante — Por favor lean con atención</b>

Este es el mismo aviso que hemos enviado por más de <b>4 semanas</b>. Hoy es la última vez antes de que empiecen los baneos.

1. <b>Lean los tutoriales.</b> Están dentro de la app y responden el 95% de las preguntas comunes. Acabamos de reiniciarlos para todos — los verán de nuevo al iniciar sesión.

2. <b>Usen a Cristina AI para preguntas.</b> Es el círculo brillante en la app — imposible no verlo. Tóquenlo y pregunten lo que quieran en lenguaje natural. Está entrenada con toda la plataforma.

3. <b>No usen el Feed ni los Hangouts para quejarse o preguntar.</b> Esos son espacios comunitarios, no canales de soporte. Usen los canales correctos dentro de la app.

4. <b>Los correos y mensajes al bot de Telegram ya no serán respondidos.</b> Todas las consultas deben hacerse desde la app.

5. <b>El bot de Telegram es una herramienta de transición, no el futuro.</b> La app se sincroniza con Telegram por ahora porque Telegram está eliminando grupos y canales. El futuro es <b>pnptv.app</b> — por favor úsenla. <b>Dejen de enviar comandos al bot.</b>

6. <b>Los baneos empiezan hoy. No habrá segundas oportunidades.</b>
• El 95% de ustedes ya entendió y usa la app como fue diseñada. Gracias.
• El 5% que se niega a leer tutoriales, ignora a Cristina y exige atención personal está haciendo imposible que lancemos funciones y respondamos a preguntas legítimas.
• Si pueden usar X (Twitter), Telegram y Zoom, pueden usar pnptv.app. Les hemos explicado esto personalmente a muchos de ustedes y siguen haciendo lo mismo — esto no es por falta de soporte de nuestra parte.
• Desde hoy, los usuarios que sigan violando estas reglas serán baneados. <b>No habrá advertencias ni segundas oportunidades</b> como las dimos antes.

Estamos construyendo esto para la mayoría que quiere usar todas las funciones de la app. Gracias por su paciencia.

— <b>El equipo de PNPtv!</b>`;

// Plain text version for in-app DM and email body fallback
const PLAIN_TEXT = TELEGRAM_HTML.replace(/<\/?b>/g, '').replace(/&nbsp;/g, ' ');

// ── Email HTML ───────────────────────────────────────────────────────────────

const EMAIL_SUBJECT = '⚠️ Last warning before bans / Última advertencia antes de baneos — PNPtv!';

const EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Important — PNPtv! Community Rules</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #ddd; background-color: #0d0d0d; margin: 0; padding: 0; }
    .container { max-width: 640px; margin: 20px auto; background: #1a1a1a; padding: 30px; border-radius: 12px; box-shadow: 0 2px 20px rgba(212,0,122,0.15); }
    .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #D4007A; }
    .header h1 { background: linear-gradient(135deg, #D4007A, #E69138); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; font-size: 32px; }
    .badge { background: linear-gradient(135deg, #D4007A 0%, #E69138 100%); color: white; padding: 16px; border-radius: 10px; text-align: center; margin: 20px 0; font-size: 18px; font-weight: bold; }
    .content { padding: 10px 0; color: #ccc; }
    .content h2 { color: #E69138; font-size: 18px; margin-top: 24px; border-bottom: 1px solid #333; padding-bottom: 6px; }
    .content ol { padding-left: 20px; }
    .content li { margin-bottom: 12px; }
    .content strong { color: #fff; }
    .divider { border: none; border-top: 1px dashed #444; margin: 32px 0; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
    a { color: #D4007A; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PNPtv!</h1></div>
    <div class="badge">⚠️ Important — Please read carefully<br>⚠️ Importante — Por favor lean</div>

    <div class="content">
      <h2>English</h2>
      <p>This is the same notice we have been sending for over <strong>4 weeks</strong>. Today is the last time before bans begin.</p>
      <ol>
        <li><strong>Read the tutorials.</strong> They are inside the app and answer 95% of common questions. We have just reset them for everyone — you will see them again on next login.</li>
        <li><strong>Use Cristina AI for questions.</strong> She is the shining circle widget on the app — impossible to miss. Tap it and ask anything in plain language. She is trained on the entire platform.</li>
        <li><strong>Do not use the Feed or Hangouts to complain or ask questions.</strong> Those are community spaces, not support channels. Use the proper channels inside the app.</li>
        <li><strong>Emails and Telegram bot messages will no longer be answered.</strong> All support requests must come through the app.</li>
        <li><strong>The Telegram bot is a transition tool, not the future.</strong> The app syncs with Telegram for now because Telegram is phasing out groups and channels. The future is <a href="https://pnptv.app">pnptv.app</a> — please use it. <strong>Stop sending commands to the bot.</strong></li>
        <li><strong>Bans begin today. No second chances.</strong>
          <ul>
            <li>95% of you have figured this out and use the app the way it was designed. Thank you.</li>
            <li>The 5% who refuse to read tutorials, ignore Cristina, and demand personal hand-holding are making it impossible to ship features and respond to legitimate questions.</li>
            <li>If you can use X (Twitter), Telegram, and Zoom, you can use <a href="https://pnptv.app">pnptv.app</a>. We have personally explained this to many of you and you keep doing the same thing — this is not lack of support on our end.</li>
            <li>From today, users who continue to violate these rules will be banned. <strong>No warnings, no second chances</strong> like we gave in the past.</li>
          </ul>
        </li>
      </ol>
      <p>We are building this for the majority who want the full features of the app. Thank you for your patience.</p>
      <p>— <strong>The PNPtv! Team</strong></p>

      <hr class="divider">

      <h2>Español</h2>
      <p>Este es el mismo aviso que hemos enviado por más de <strong>4 semanas</strong>. Hoy es la última vez antes de que empiecen los baneos.</p>
      <ol>
        <li><strong>Lean los tutoriales.</strong> Están dentro de la app y responden el 95% de las preguntas comunes. Acabamos de reiniciarlos para todos — los verán de nuevo al iniciar sesión.</li>
        <li><strong>Usen a Cristina AI para preguntas.</strong> Es el círculo brillante en la app — imposible no verlo. Tóquenlo y pregunten lo que quieran en lenguaje natural. Está entrenada con toda la plataforma.</li>
        <li><strong>No usen el Feed ni los Hangouts para quejarse o preguntar.</strong> Esos son espacios comunitarios, no canales de soporte. Usen los canales correctos dentro de la app.</li>
        <li><strong>Los correos y mensajes al bot de Telegram ya no serán respondidos.</strong> Todas las consultas deben hacerse desde la app.</li>
        <li><strong>El bot de Telegram es una herramienta de transición, no el futuro.</strong> La app se sincroniza con Telegram por ahora porque Telegram está eliminando grupos y canales. El futuro es <a href="https://pnptv.app">pnptv.app</a> — por favor úsenla. <strong>Dejen de enviar comandos al bot.</strong></li>
        <li><strong>Los baneos empiezan hoy. No habrá segundas oportunidades.</strong>
          <ul>
            <li>El 95% de ustedes ya entendió y usa la app como fue diseñada. Gracias.</li>
            <li>El 5% que se niega a leer tutoriales, ignora a Cristina y exige atención personal está haciendo imposible que lancemos funciones y respondamos a preguntas legítimas.</li>
            <li>Si pueden usar X (Twitter), Telegram y Zoom, pueden usar <a href="https://pnptv.app">pnptv.app</a>. Les hemos explicado esto personalmente a muchos de ustedes y siguen haciendo lo mismo — esto no es por falta de soporte de nuestra parte.</li>
            <li>Desde hoy, los usuarios que sigan violando estas reglas serán baneados. <strong>No habrá advertencias ni segundas oportunidades</strong> como las dimos antes.</li>
          </ul>
        </li>
      </ol>
      <p>Estamos construyendo esto para la mayoría que quiere usar todas las funciones de la app. Gracias por su paciencia.</p>
      <p>— <strong>El equipo de PNPtv!</strong></p>
    </div>

    <div class="footer">
      <p>PNPtv! &bull; <a href="https://pnptv.app">pnptv.app</a></p>
      <p>This is an automated email. Para dejar de recibir estos correos, contacta support@pnptv.app</p>
    </div>
  </div>
</body>
</html>`;

// ── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    return { success: false, error: 'No BOT_TOKEN' };
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error', retryAfter: data.parameters?.retry_after };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── In-app DM ────────────────────────────────────────────────────────────────
// Inserts into direct_messages with sender=SYSTEM and recipient=user.id, plus
// upserts the dm_threads pair (constraint: user_a < user_b lexicographic).
//
// We do this in one transaction per user — failures are isolated and the
// run continues. Bulk INSERT would be faster but we want individual error
// handling so a single bad row doesn't abort the whole broadcast.

async function sendInAppDM(recipientId) {
  const [userA, userB] = SYSTEM_SENDER_ID < recipientId
    ? [SYSTEM_SENDER_ID, recipientId]
    : [recipientId, SYSTEM_SENDER_ID];

  try {
    await query('BEGIN');

    // Insert the message itself
    const msgRes = await query(
      `INSERT INTO direct_messages (sender_id, recipient_id, content, is_read, created_at)
       VALUES ($1, $2, $3, false, NOW())
       RETURNING id`,
      [SYSTEM_SENDER_ID, recipientId, PLAIN_TEXT]
    );

    // Upsert the thread + bump unread for the recipient
    // unread_for_a / unread_for_b depend on which slot the recipient is in
    const recipientIsB = recipientId === userB;
    await query(
      `INSERT INTO dm_threads (user_a, user_b, last_message, last_message_at, unread_for_a, unread_for_b)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (user_a, user_b) DO UPDATE SET
         last_message = EXCLUDED.last_message,
         last_message_at = NOW(),
         unread_for_a = dm_threads.unread_for_a + EXCLUDED.unread_for_a,
         unread_for_b = dm_threads.unread_for_b + EXCLUDED.unread_for_b`,
      [
        userA,
        userB,
        PLAIN_TEXT.substring(0, 100),
        recipientIsB ? 0 : 1, // recipient is user_a → unread_for_a += 1
        recipientIsB ? 1 : 0, // recipient is user_b → unread_for_b += 1
      ]
    );

    await query('COMMIT');
    return { success: true, messageId: msgRes.rows[0].id };
  } catch (err) {
    try { await query('ROLLBACK'); } catch (_) {}
    return { success: false, error: err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== PNPtv Community Rules Broadcast ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'} ===\n`);

  // Ensure SYSTEM sender exists (don't proceed if it doesn't — in-app DMs would FK-fail)
  const systemCheck = await query("SELECT id FROM users WHERE id = $1", [SYSTEM_SENDER_ID]);
  if (systemCheck.rows.length === 0) {
    console.error(`FATAL: ${SYSTEM_SENDER_ID} user does not exist. Cannot insert in-app DMs.`);
    process.exit(1);
  }

  // Fetch active users (accepted terms, not banned, not deleted)
  // Exclude SYSTEM and any obvious system users from being recipients of their own DM.
  const { rows: users } = await query(`
    SELECT id, telegram, email, first_name, language
    FROM users
    WHERE terms_accepted = true
      AND deleted_at IS NULL
      AND (tier IS NULL OR tier != 'banned')
      AND id NOT IN ('SYSTEM', 'cristina-ai')
    ORDER BY created_at ASC
  `);

  console.log(`Total active users (excluding system accounts): ${users.length}\n`);

  const tgUsers = users.filter((u) => u.telegram && String(u.telegram).trim() !== '');
  const emUsers = users.filter((u) => u.email && u.email.includes('@'));

  console.log(`In-app DM targets : ${users.length}`);
  console.log(`Telegram targets  : ${tgUsers.length}`);
  console.log(`Email targets     : ${emUsers.length}`);
  console.log(`Group post target : ${COMMUNITY_GROUP_ID}\n`);

  // ── In-app DM (per user) ──────────────────────────────────────────────────
  let dmOk = 0, dmFail = 0;
  console.log('--- Inserting in-app DMs ---');
  if (DRY_RUN) {
    console.log(`  [DRY] Would insert ${users.length} direct_messages rows + upsert dm_threads pairs from ${SYSTEM_SENDER_ID}`);
    dmOk = users.length;
  } else {
    for (const user of users) {
      const result = await sendInAppDM(user.id);
      if (result.success) {
        dmOk++;
      } else {
        dmFail++;
        console.log(`  [FAIL] DM -> ${user.id}: ${result.error}`);
      }
    }
    console.log(`  In-app DM: ${dmOk} ok, ${dmFail} failed`);
  }

  // ── Telegram community group post (single message) ───────────────────────
  console.log('\n--- Posting to Telegram community group ---');
  if (DRY_RUN) {
    console.log(`  [DRY] Would post bilingual notice to group ${COMMUNITY_GROUP_ID}`);
  } else {
    const groupRes = await sendTelegramMessage(COMMUNITY_GROUP_ID, TELEGRAM_HTML);
    if (groupRes.success) {
      console.log(`  [OK] Group post sent to ${COMMUNITY_GROUP_ID}`);
    } else {
      console.log(`  [FAIL] Group post: ${groupRes.error}`);
    }
  }

  // ── Telegram DMs (per user) ──────────────────────────────────────────────
  let tgOk = 0, tgFail = 0, tgSkip = 0;
  console.log('\n--- Sending Telegram DMs ---');
  for (const user of tgUsers) {
    if (DRY_RUN) {
      tgOk++;
      continue;
    }
    const result = await sendTelegramMessage(user.telegram, TELEGRAM_HTML);
    if (result.success) {
      tgOk++;
    } else {
      const err = (result.error || '').toLowerCase();
      if (err.includes('blocked') || err.includes('deactivated') || err.includes('chat not found')) {
        tgSkip++;
      } else if (result.retryAfter) {
        // Telegram rate limit — back off and retry once
        await sleep(result.retryAfter * 1000 + 200);
        const retry = await sendTelegramMessage(user.telegram, TELEGRAM_HTML);
        if (retry.success) tgOk++;
        else tgFail++;
      } else {
        tgFail++;
      }
    }
    if ((tgOk + tgFail + tgSkip) % 100 === 0) {
      process.stdout.write(`  ...${tgOk + tgFail + tgSkip}/${tgUsers.length}\n`);
    }
    await sleep(TG_DELAY_MS);
  }
  if (DRY_RUN) {
    console.log(`  [DRY] Would send ${tgUsers.length} Telegram DMs (~${Math.ceil(tgUsers.length * TG_DELAY_MS / 1000 / 60)} min at ${TG_DELAY_MS}ms pacing)`);
  } else {
    console.log(`  Telegram DMs: ${tgOk} sent, ${tgFail} failed, ${tgSkip} skipped (blocked/deactivated)`);
  }

  // ── Email ────────────────────────────────────────────────────────────────
  let emOk = 0, emFail = 0;
  console.log('\n--- Sending emails ---');
  if (DRY_RUN) {
    console.log(`  [DRY] Would send ${emUsers.length} emails (~${Math.ceil(emUsers.length * EMAIL_DELAY_MS / 1000 / 60)} min at ${EMAIL_DELAY_MS}ms pacing)`);
    emOk = emUsers.length;
  } else {
    const transporter = emailService.transporters?.pnptv;
    if (!transporter) {
      console.log('  [SKIP] PNPtv email transporter not configured');
    } else {
      for (const user of emUsers) {
        try {
          await transporter.sendMail({
            from: '"PNPtv!" <noreply@pnptv.app>',
            to: user.email,
            subject: EMAIL_SUBJECT,
            html: EMAIL_HTML,
          });
          emOk++;
        } catch (err) {
          emFail++;
          if (emFail <= 5) console.log(`  [FAIL] Email -> ${user.email}: ${err.message}`);
        }
        if ((emOk + emFail) % 50 === 0) {
          process.stdout.write(`  ...${emOk + emFail}/${emUsers.length}\n`);
        }
        await sleep(EMAIL_DELAY_MS);
      }
      console.log(`  Email: ${emOk} sent, ${emFail} failed`);
    }
  }

  console.log('\n=== Done ===\n');
  console.log('Summary:');
  console.log(`  In-app DM: ${dmOk} ok / ${dmFail} fail`);
  console.log(`  Telegram group post: ${COMMUNITY_GROUP_ID}`);
  console.log(`  Telegram DM: ${tgOk} ok / ${tgFail} fail / ${tgSkip} skipped`);
  console.log(`  Email: ${emOk} ok / ${emFail} fail\n`);

  process.exit(0);
}

main().catch((err) => {
  logger.error('sendCommunityRulesBroadcast failed:', err);
  console.error(err);
  process.exit(1);
});
