#!/usr/bin/env node
'use strict';

/**
 * broadcast-app-update-june-2026.js
 *
 * Platform-wide update: Main Stage upgrades, video call overhaul,
 * Colombia/Venezuela unblock, payment + app stability fixes.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-app-update-june-2026.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-app-update-june-2026.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-app-update-june-2026.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-app-update-june-2026.js --skip-telegram
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

const ENTITY_ID          = 'app-update-june-2026';
const APP_URL            = 'https://pnptv.app';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 0.25; // 1 email per 4s — stays under Hostinger bulk limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🎉 PNPtv! just got a big update — Main Stage upgrades, video calls overhaul, and more. Come check it out.`,
  es: `🎉 ¡PNPtv! acaba de recibir una gran actualización — Main Stage mejorado, videollamadas rediseñadas y más. Ven a verlo.`,
};

const PUSH = {
  en: { title: '🎉 PNPtv! update is live', body: 'Main Stage skip voting, screen share, video call alerts anywhere, and more.' },
  es: { title: '🎉 Actualización de PNPtv!', body: 'Main Stage con skip voting, pantalla compartida, alertas de llamadas en cualquier pantalla y más.' },
};

const TG = {
  en: (name) =>
`🎉 <b>PNPtv! just got a big update — here's what's new, ${name}:</b>

🎛️ Main Stage now has skip voting, screen share, in-room chat &amp; emoji reactions
⭐ PRIME members can jump the queue and play next
📷 All members can go on cam in the Main Stage
📲 DM video calls overhauled — incoming alerts pop up anywhere in the app
🌎 Colombia 🇨🇴 and Venezuela 🇻🇪 — geo-block lifted, you're in
🔧 Crypto checkout inline, duplicate payment protection, auto-recovery on page freeze

Not a member yet? Join us 👉 <a href="${APP_URL}">${APP_URL}</a>`,

  es: (name) =>
`🎉 <b>¡PNPtv! acaba de recibir una gran actualización — esto es lo nuevo, ${name}:</b>

🎛️ Main Stage ahora tiene votación para cambiar canción, pantalla compartida, chat y reacciones
⭐ Los miembros PRIME pueden poner la siguiente canción sin esperar
📷 Todos los miembros pueden prender la cámara en el Main Stage
📲 Las videollamadas por DM fueron rediseñadas — las alertas te llegan en cualquier pantalla
🌎 Colombia 🇨🇴 y Venezuela 🇻🇪 — levantamos el bloqueo, ya pueden entrar
🔧 Pago cripto en popup, protección contra pagos duplicados, recuperación automática

¿Todavía no eres miembro? Únete en 👉 <a href="${APP_URL}">${APP_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🎉 PNPtv! update — Main Stage, video calls & more',
  es: '🎉 Actualización PNPtv! — Main Stage, videollamadas y más',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? "PNPtv! — What's new" : 'PNPtv! — Novedades'}</title>
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
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${en ? `Hey ${name}!` : `¡Hola ${name}!`}</p>
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            🎉 ${en ? "PNPtv! just got a big update." : '¡PNPtv! acaba de recibir una gran actualización.'}
          </h1>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(123,97,255,0.08);border:1px solid rgba(123,97,255,0.25);border-radius:14px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:900;color:#ffffff;">🎛️ Main Stage</p>
              <ul style="margin:0;padding-left:18px;color:#d1d5db;font-size:14px;line-height:1.8;">
                <li>${en ? 'Skip voting — vote to change the track' : 'Votación para cambiar la canción'}</li>
                <li>${en ? 'PRIME members can play next' : 'Miembros PRIME pueden poner la siguiente'}</li>
                <li>${en ? 'In-room chat & emoji reactions' : 'Chat en sala y reacciones con emojis'}</li>
                <li>${en ? 'Screen share' : 'Pantalla compartida'}</li>
                <li>${en ? 'All members can go on cam' : 'Todos los miembros pueden prender la cámara'}</li>
              </ul>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:900;color:#ffffff;">📲 ${en ? 'Video Calls' : 'Videollamadas'}</p>
              <p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.6;">
                ${en
                  ? 'DM video calls overhauled — incoming call alerts now pop up anywhere in the app. No more missed calls.'
                  : 'Las videollamadas por DM fueron rediseñadas — las alertas ahora aparecen en cualquier pantalla. No más llamadas perdidas.'}
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
              <p style="margin:0 0 10px;font-size:16px;font-weight:900;color:#ffffff;">🔧 ${en ? 'Fixes & more' : 'Mejoras y más'}</p>
              <ul style="margin:0;padding-left:18px;color:#d1d5db;font-size:14px;line-height:1.8;">
                <li>🌎 ${en ? 'Colombia 🇨🇴 & Venezuela 🇻🇪 — geo-block lifted' : 'Colombia 🇨🇴 y Venezuela 🇻🇪 — bloqueo levantado'}</li>
                <li>${en ? 'Crypto checkout inline — no more new tabs' : 'Pago cripto en popup — sin pestañas nuevas'}</li>
                <li>${en ? 'Duplicate payment protection' : 'Protección contra pagos duplicados'}</li>
                <li>${en ? 'App auto-recovers on page freeze' : 'Recuperación automática si la app se congela'}</li>
              </ul>
            </td></tr>
          </table>

          <div style="text-align:center;margin-bottom:28px;">
            <a href="${APP_URL}" style="display:inline-block;padding:14px 36px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              ${en ? 'Open PNPtv! →' : 'Abrir PNPtv! →'}
            </a>
          </div>

          <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            🔒 pnptv.app
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
  console.log(' App Update Broadcast — June 2026');
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
      const enIds = users.filter(u =>  isEn(u.language) && isNew(u)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language) && isNew(u)).map(u => u.id);
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
    console.log(`     [DRY] Would notify ${users.filter(isNew).length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language) && isNew(u)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language) && isNew(u)).map(u => u.id);
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
      try {
        await tg.sendMessage(u.telegram, TG[lang](name), { parse_mode: 'HTML', disable_web_page_preview: true });
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
