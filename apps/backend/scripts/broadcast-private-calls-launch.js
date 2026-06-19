#!/usr/bin/env node
'use strict';

/**
 * broadcast-private-calls-launch.js
 *
 * Announces 1-on-1 private video calls with SantinoFurioso & PNPLatinoBoy.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-launch.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-launch.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-launch.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-private-calls-launch.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }               = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer              = require('nodemailer');
const { Telegram }            = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID          = 'private-calls-launch-2026-06';
const URL_SANTINO        = 'https://pnptv.app/profile/8599671840';
const URL_LATINOBOY      = 'https://pnptv.app/profile/7246621722';
const APP_URL            = URL_SANTINO;
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `📞 Private 1-on-1 video calls with SantinoFurioso & PNPLatinoBoy are now available. Book your session today.`,
  es: `📞 Ya están disponibles las videollamadas privadas 1-a-1 con SantinoFurioso y PNPLatinoBoy. Reserva tu sesión hoy.`,
};

const PUSH = {
  en: { title: '📞 Private calls are here', body: 'Book a 1-on-1 private video session with SantinoFurioso or PNPLatinoBoy. Starting at $60.' },
  es: { title: '📞 Las llamadas privadas ya están', body: 'Reserva una sesión de video privado con SantinoFurioso o PNPLatinoBoy. Desde $60.' },
};

const TG = {
  en: (name) =>
`📞 <b>Hey ${name} — private 1-on-1 video calls are now live on PNPtv.</b>

You can now book a <b>private, encrypted video session</b> directly with your favorite creator — just the two of you.

━━━━━━━━━━━━━━━
🔥 <b>SANTINO FURIOSO</b>
━━━━━━━━━━━━━━━
Your dominant, kinky host. Available for private sessions now.

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

👉 <a href="${URL_SANTINO}">Book with Santino</a>

━━━━━━━━━━━━━━━
🌶️ <b>PNP LATINO BOY</b>
━━━━━━━━━━━━━━━
Hot, passionate, and ready to play. Available now.

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

👉 <a href="${URL_LATINOBOY}">Book with PNPLatinoBoy</a>

━━━━━━━━━━━━━━━

Sessions are private, encrypted, and discreet. Pay once, get a direct join link — no friction. 🖤`,

  es: (name) =>
`📞 <b>¡Hola ${name}! Las videollamadas privadas 1-a-1 ya están disponibles en PNPtv.</b>

Ahora puedes reservar una <b>sesión de video privada y encriptada</b> directamente con tu creador favorito — solo ustedes dos.

━━━━━━━━━━━━━━━
🔥 <b>SANTINO FURIOSO</b>
━━━━━━━━━━━━━━━
Tu anfitrión dominante y kinky. Disponible para sesiones privadas ahora.

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

👉 <a href="${URL_SANTINO}">Reservar con Santino</a>

━━━━━━━━━━━━━━━
🌶️ <b>PNP LATINO BOY</b>
━━━━━━━━━━━━━━━
Caliente, apasionado y listo para jugar. Disponible ahora.

⏱ 30 min — <b>$60</b>
⏱ 60 min — <b>$100</b>

👉 <a href="${URL_LATINOBOY}">Reservar con PNPLatinoBoy</a>

━━━━━━━━━━━━━━━

Las sesiones son privadas, encriptadas y discretas. Paga una vez, recibe el enlace directo — sin fricciones. 🖤`,
};

const EMAIL_SUBJECT = {
  en: '📞 Private video calls with Santino & PNPLatinoBoy — book your session',
  es: '📞 Videollamadas privadas con Santino y PNPLatinoBoy — reserva tu sesión',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Private 1-on-1 video calls are now live' : 'Las videollamadas privadas ya están disponibles'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#7B61FF);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
            📞 ${en ? 'Private 1-on-1 video calls are now live.' : 'Las videollamadas privadas 1-a-1 ya están disponibles.'}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'Book a private, encrypted video session with your favourite creator. Just the two of you — no audience, no interruptions.'
              : 'Reserva una sesión de video privada y encriptada con tu creador favorito. Solo ustedes dos — sin audiencia, sin interrupciones.'}
          </p>

          <!-- Santino -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:18px;font-weight:900;color:#ffffff;">🔥 Santino Furioso</p>
              <p style="margin:0 0 14px;font-size:13px;color:#9ca3af;line-height:1.5;">
                ${en ? 'Your dominant, kinky host. Private sessions available now.' : 'Tu anfitrión dominante y kinky. Sesiones privadas disponibles ahora.'}
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="padding:8px 14px;background:rgba(255,255,255,0.06);border-radius:8px;margin-right:8px;">
                    <span style="font-size:13px;color:#9ca3af;">⏱ 30 min</span>
                    <span style="font-size:15px;font-weight:800;color:#ffffff;margin-left:8px;">$60</span>
                  </td>
                  <td width="8"></td>
                  <td style="padding:8px 14px;background:rgba(255,255,255,0.06);border-radius:8px;">
                    <span style="font-size:13px;color:#9ca3af;">⏱ 60 min</span>
                    <span style="font-size:15px;font-weight:800;color:#ffffff;margin-left:8px;">$100</span>
                  </td>
                </tr>
              </table>
              <a href="${URL_SANTINO}" style="display:inline-block;padding:12px 28px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;">
                ${en ? 'Book with Santino →' : 'Reservar con Santino →'}
              </a>
            </td></tr>
          </table>

          <!-- PNPLatinoBoy -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(230,145,56,0.08);border:1px solid rgba(230,145,56,0.25);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:18px;font-weight:900;color:#ffffff;">🌶️ PNP Latino Boy</p>
              <p style="margin:0 0 14px;font-size:13px;color:#9ca3af;line-height:1.5;">
                ${en ? 'Hot, passionate, and ready to play. Available now.' : 'Caliente, apasionado y listo para jugar. Disponible ahora.'}
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td style="padding:8px 14px;background:rgba(255,255,255,0.06);border-radius:8px;margin-right:8px;">
                    <span style="font-size:13px;color:#9ca3af;">⏱ 30 min</span>
                    <span style="font-size:15px;font-weight:800;color:#ffffff;margin-left:8px;">$60</span>
                  </td>
                  <td width="8"></td>
                  <td style="padding:8px 14px;background:rgba(255,255,255,0.06);border-radius:8px;">
                    <span style="font-size:13px;color:#9ca3af;">⏱ 60 min</span>
                    <span style="font-size:15px;font-weight:800;color:#ffffff;margin-left:8px;">$100</span>
                  </td>
                </tr>
              </table>
              <a href="${URL_LATINOBOY}" style="display:inline-block;padding:12px 28px;background:linear-gradient(90deg,#E69138,#D4007A);color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;">
                ${en ? 'Book with PNPLatinoBoy →' : 'Reservar con PNPLatinoBoy →'}
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'Sessions are private, encrypted, and discreet. You get a direct join link after payment. 🖤'
              : 'Las sesiones son privadas, encriptadas y discretas. Recibes un enlace directo tras el pago. 🖤'}
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            🔒 Encrypted · Discreet · pnptv.app
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Private Calls Launch Broadcast — June 2026');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram\n');

  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
    ORDER BY u.id
  `);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows: alreadyRows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(alreadyRows.map(r => r.target_user_id));
  }
  const isNew = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && isNew(u));
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && isNew(u));

  console.log(`\n   Total users:      ${users.length}`);
  console.log(`   Already notified: ${alreadySent.size}`);
  console.log(`   New targets:      ${users.length - alreadySent.size}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell notification
  console.log('\n1/4  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'normal', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: APP_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted/upserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would notify ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: APP_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: APP_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ ${pushSent} push sent`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (!DRY_RUN && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'there' : 'amigo');
      const msg = TG[lang](name);
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 200 === 0) console.log(`     TG progress: ${i + 1}/${withTelegram.length}`);
    }
    console.log(`     ✓ TG: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
    console.log('\n── Sample TG message (ES) ──\n');
    console.log(TG.es('Amigo'));
    console.log('\n── Sample TG message (EN) ──\n');
    console.log(TG.en('there'));
  } else {
    console.log('     [SKIPPED] --skip-telegram');
  }

  // 4. Email
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    const transporter = nodemailer.createTransport({
      host:           process.env.PNPTV_SMTP_HOST,
      port:           parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure:         process.env.PNPTV_SMTP_SECURE === 'true',
      auth:           { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
      pool:           true,
      maxConnections: 1,
      maxMessages:    Infinity,
      rateDelta:      Math.floor(1000 / EMAIL_RATE_PER_SEC),
      rateLimit:      EMAIL_RATE_PER_SEC,
    });
    await new Promise((resolveAll) => {
      let sent = 0, failed = 0, completed = 0;
      if (!withEmail.length) { resolveAll(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>', to: u.email,
          subject: EMAIL_SUBJECT[lang], html: buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) { stats.email = sent; stats.emailFailed = failed; transporter.close(); resolveAll(); }
        });
      }
    });
    console.log(`     ✓ Email: ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log(`     [DRY] Would send to ${withEmail.length} users`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
  console.log('═══════════════════════════════════════════════════');
  if (!DRY_RUN) {
    console.log(` In-app:   ${stats.inApp}`);
    console.log(` Push:     ${stats.push}`);
    console.log(` Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
    console.log(` Email:    ${stats.email} sent / ${stats.emailFailed} failed`);
  }
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
