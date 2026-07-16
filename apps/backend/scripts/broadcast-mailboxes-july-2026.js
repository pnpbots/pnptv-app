#!/usr/bin/env node
'use strict';

/**
 * broadcast-mailboxes-july-2026.js
 *
 * Announces the three official PNPtv! contact mailboxes and invites users
 * with unactivated memberships to email support@pnptv.app.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mailboxes-july-2026.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mailboxes-july-2026.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mailboxes-july-2026.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-mailboxes-july-2026.js --skip-telegram
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

const ENTITY_ID          = 'mailboxes-july-2026';
const APP_URL            = 'https://pnptv.app';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 0.25; // 1 email per 4s — stays under Hostinger limits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── In-app / push ─────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `📬 PNPtv! now has three official email addresses — we're easier to reach than ever. Tap to read more.`,
  es: `📬 PNPtv! ahora tiene tres correos oficiales — estamos más disponibles que nunca. Toca para leer más.`,
};

const PUSH = {
  en: { title: '📬 PNPtv! — We\'re easier to reach', body: 'Three official mailboxes are now active. Membership not activated? Email support@pnptv.app.' },
  es: { title: '📬 PNPtv! — Ahora somos más fáciles de contactar', body: 'Tres correos oficiales ahora activos. ¿Membresía no activada? Escribe a support@pnptv.app.' },
};

// ── Telegram ──────────────────────────────────────────────────────────────────

const TG = {
  en: (name) =>
`📬 <b>Hey ${name} — PNPtv! now has three official email addresses.</b>

Here's what each one is for:

🔒 <b>noreply@pnptv.app</b>
Automated system emails — login magic links, security codes. <i>Do not reply to these.</i>

💬 <b>hello@pnptv.app</b>
General updates, announcements and confirmations from the team. You can reply here.

🛟 <b>support@pnptv.app</b>
Questions, billing, account issues — anything you need help with. We're here.

—

⚠️ <b>Did you pay but your membership didn't activate?</b>
Email us at <b>support@pnptv.app</b> with your payment details and we'll sort it out immediately.

👉 <a href="${APP_URL}">${APP_URL}</a>`,

  es: (name) =>
`📬 <b>¡Hola ${name}! PNPtv! ahora tiene tres correos oficiales.</b>

Para qué sirve cada uno:

🔒 <b>noreply@pnptv.app</b>
Correos automáticos del sistema — magic links de login, códigos de seguridad. <i>No respondas a estos.</i>

💬 <b>hello@pnptv.app</b>
Actualizaciones, anuncios y confirmaciones del equipo. Puedes responder aquí.

🛟 <b>support@pnptv.app</b>
Preguntas, pagos, problemas con tu cuenta — lo que necesites. Estamos aquí.

—

⚠️ <b>¿Pagaste pero tu membresía no se activó?</b>
Escríbenos a <b>support@pnptv.app</b> con los detalles de tu pago y lo resolvemos de inmediato.

👉 <a href="${APP_URL}">${APP_URL}</a>`,
};

// ── Email HTML ─────────────────────────────────────────────────────────────────

const EMAIL_SUBJECT = {
  en: '📬 PNPtv! — Three ways to reach us (+ membership help)',
  es: '📬 PNPtv! — Tres formas de contactarnos (+ ayuda con membresías)',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'PNPtv! — Three ways to reach us' : 'PNPtv! — Tres formas de contactarnos'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">

        <!-- Top accent bar -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#7B61FF);"></td></tr>

        <!-- Logo -->
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:16px 32px 36px;">

          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${en ? `Hey ${name}!` : `¡Hola ${name}!`}</p>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.25;">
            📬 ${en ? 'We\'re easier to reach than ever.' : 'Ahora somos más fáciles de contactar.'}
          </h1>
          <p style="margin:0 0 28px;font-size:14px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'PNPtv! now has three official email addresses, each with a clear purpose. Here\'s what each one is for.'
              : 'PNPtv! ahora tiene tres correos oficiales, cada uno con un propósito claro. Esto es para qué sirve cada uno.'}
          </p>

          <!-- noreply -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td style="padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">🔒 ${en ? 'Automated — Do not reply' : 'Automático — No responder'}</p>
              <p style="margin:0 0 8px;font-size:18px;font-weight:900;color:#ffffff;">noreply@pnptv.app</p>
              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                ${en
                  ? 'Login magic links, security codes and system notifications. These are sent automatically — replies are not monitored.'
                  : 'Magic links de login, códigos de seguridad y notificaciones del sistema. Se envían automáticamente — las respuestas no se monitorean.'}
              </p>
            </td></tr>
          </table>

          <!-- hello -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td style="padding:20px;background:rgba(123,97,255,0.08);border:1px solid rgba(123,97,255,0.25);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#7B61FF;text-transform:uppercase;letter-spacing:0.5px;">💬 ${en ? 'Updates & announcements' : 'Actualizaciones y anuncios'}</p>
              <p style="margin:0 0 8px;font-size:18px;font-weight:900;color:#ffffff;">hello@pnptv.app</p>
              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                ${en
                  ? 'Platform news, feature announcements, purchase confirmations and general updates from the team. You can reply here.'
                  : 'Noticias de la plataforma, anuncios de funciones, confirmaciones de compra y actualizaciones del equipo. Puedes responder aquí.'}
              </p>
            </td></tr>
          </table>

          <!-- support -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.08);border:1px solid rgba(212,0,122,0.35);border-radius:14px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#D4007A;text-transform:uppercase;letter-spacing:0.5px;">🛟 ${en ? 'Help & support' : 'Ayuda y soporte'}</p>
              <p style="margin:0 0 8px;font-size:18px;font-weight:900;color:#ffffff;">support@pnptv.app</p>
              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;">
                ${en
                  ? 'Questions, billing, account issues — anything you need. A real person reads every message and we aim to reply within 24 hours.'
                  : 'Preguntas, pagos, problemas con tu cuenta — lo que necesites. Una persona real lee cada mensaje y buscamos responder en 24 horas.'}
              </p>
            </td></tr>
          </table>

          <!-- Membership alert -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr><td style="padding:22px 24px;background:rgba(255,193,7,0.07);border:1px solid rgba(255,193,7,0.35);border-radius:14px;">
              <p style="margin:0 0 10px;font-size:16px;font-weight:900;color:#fbbf24;">
                ⚠️ ${en ? 'Membership not activated?' : '¿Tu membresía no se activó?'}
              </p>
              <p style="margin:0 0 16px;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en
                  ? 'If you made a payment but your PRIME membership or access wasn\'t activated automatically, <strong style="color:#ffffff;">email us at support@pnptv.app</strong> with your payment details (screenshot, transaction ID or amount) and we\'ll activate it manually within hours.'
                  : 'Si hiciste un pago pero tu membresía PRIME o tu acceso no se activó automáticamente, <strong style="color:#ffffff;">escríbenos a support@pnptv.app</strong> con los detalles de tu pago (captura de pantalla, ID de transacción o monto) y lo activamos manualmente en pocas horas.'}
              </p>
              <a href="mailto:support@pnptv.app"
                 style="display:inline-block;padding:12px 24px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;border-radius:10px;">
                ${en ? 'Email support@pnptv.app →' : 'Escribir a support@pnptv.app →'}
              </a>
            </td></tr>
          </table>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:28px;">
            <a href="${APP_URL}"
               style="display:inline-block;padding:14px 36px;background:linear-gradient(90deg,#D4007A,#7B61FF);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              ${en ? 'Open PNPtv! →' : 'Abrir PNPtv! →'}
            </a>
          </div>

          <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            &nbsp;·&nbsp; <a href="mailto:support@pnptv.app" style="color:#6b7280;">support@pnptv.app</a>
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
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Mailboxes Broadcast — July 2026');
  console.log('═══════════════════════════════════════════════════════');
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
  console.log(`   New targets:      ${users.filter(isNew).length}`);
  console.log(`   With Telegram:    ${withTelegram.length}`);
  console.log(`   With real email:  ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell
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
    console.log('\n── Sample TG (ES) ──\n');
    console.log(TG.es('Amigo'));
    console.log('\n── Sample TG (EN) ──\n');
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
      rateLimit:      1,
    });
    await new Promise((resolveAll) => {
      let completed = 0;
      if (!withEmail.length) { resolveAll(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from:     `"PNPtv!" <${process.env.PNPTV_SMTP_USER || 'hello@pnptv.app'}>`,
          replyTo:  'support@pnptv.app',
          to:       u.email,
          subject:  EMAIL_SUBJECT[lang],
          html:     buildEmailHtml(lang, name),
        }, (err) => {
          if (err) {
            stats.emailFailed++;
            if (stats.emailFailed <= 5) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else {
            stats.email++;
          }
          completed++;
          if (completed % 50 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) resolveAll();
        });
      }
    });
    console.log(`     ✓ Email: ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log(`     [DRY] Would email ${withEmail.length} users`);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' DONE');
  console.log(`   In-app: ${stats.inApp}  Push: ${stats.push}  TG: ${stats.telegram} (${stats.telegramFailed} failed)  Email: ${stats.email} (${stats.emailFailed} failed)`);
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
