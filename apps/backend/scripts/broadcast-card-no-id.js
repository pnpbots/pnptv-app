#!/usr/bin/env node
'use strict';

/**
 * broadcast-card-no-id.js
 *
 * Informs all users that credit/debit card payments no longer require
 * a document ID number — international users can now check out freely.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-card-no-id.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-card-no-id.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-card-no-id.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-card-no-id.js --skip-telegram
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
const EMAIL_ONLY    = process.argv.includes('--email-only');
const FORCE         = process.argv.includes('--force');

const ENTITY_ID     = 'card-no-id-required-2026-05';
const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS   = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `💳 Card payments just got easier — no ID number required. Subscribe now at pnptv.app/subscribe →`,
  es: `💳 Pagar con tarjeta ahora es más fácil — sin número de documento. Suscríbete en pnptv.app/subscribe →`,
};

const PUSH = {
  en: {
    title: '💳 No ID required — pay with your card now',
    body:  'We removed the document ID field. Just your card details and you\'re in.',
  },
  es: {
    title: '💳 Sin número de documento — paga con tarjeta',
    body:  'Eliminamos el campo de ID. Solo los datos de tu tarjeta y listo.',
  },
};

const TG = {
  en:
`💳 <b>Good news — no ID number required anymore.</b>

We just removed the document ID field from our card checkout. If you tried to pay before and got stuck on that field, it's gone now.

<b>Just enter your card details and you're done.</b> No Colombian ID, no passport number, nothing extra.

👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>

💎 Monthly, yearly, and lifetime plans available.`,

  es:
`💳 <b>Buenas noticias — ya no se requiere número de documento.</b>

Eliminamos el campo de documento de nuestra página de pago con tarjeta. Si antes intentaste pagar y te quedaste atascado en ese campo, ya no existe.

<b>Solo ingresa los datos de tu tarjeta y listo.</b> Sin cédula, sin pasaporte, sin nada extra.

👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>

💎 Planes mensuales, anuales y lifetime disponibles.`,
};

const EMAIL_SUBJECT = {
  en: '💳 No ID number required — card payments just got easier on PNPtv',
  es: '💳 Sin número de documento — pagar con tarjeta en PNPtv es más fácil',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'No ID required — card payments on PNPtv' : 'Sin ID — pagos con tarjeta en PNPtv'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.25);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#E69138);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
            💳 ${en ? 'No ID number required.' : 'Sin número de documento.'}
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#9ca3af;line-height:1.6;">
            ${en
              ? 'We removed the document ID field from our card checkout. If you tried to subscribe before and got stuck on that step — it\'s gone now. Just your card details and you\'re in.'
              : 'Eliminamos el campo de número de documento del pago con tarjeta. Si antes intentaste suscribirte y te bloqueaste en ese paso — ya no existe. Solo los datos de tu tarjeta y listo.'}
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
              ${[
                en ? ['✅', 'Card number'] : ['✅', 'Número de tarjeta'],
                en ? ['✅', 'Expiry date'] : ['✅', 'Fecha de expiración'],
                en ? ['✅', 'CVC'] : ['✅', 'CVC'],
                en ? ['🚫', '<s style="color:#6b7280;">Document ID number</s> — <span style="color:#30D158;">removed</span>'] : ['🚫', '<s style="color:#6b7280;">Número de documento</s> — <span style="color:#30D158;">eliminado</span>'],
              ].map(([icon, label]) => `
              <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
                <span style="font-size:16px;">${icon}</span>
                <span style="font-size:14px;color:#ffffff;">${label}</span>
              </div>`).join('')}
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:18px 48px;background:linear-gradient(90deg,#D4007A,#E69138);color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px;letter-spacing:0.03em;">
                ${en ? 'Subscribe Now →' : 'Suscribirme ahora →'}
              </a>
            </td></tr>
            <tr><td align="center" style="padding-top:10px;">
              <a href="${SUBSCRIBE_URL}" style="font-size:12px;color:#6b7280;text-decoration:underline;">${SUBSCRIBE_URL}</a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
            ${en
              ? '💎 Monthly, yearly, and lifetime plans available. Pay with card, USDC, or Dash.'
              : '💎 Planes mensuales, anuales y lifetime disponibles. Paga con tarjeta, USDC o Dash.'}
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet · pnptv.app</p>
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
  console.log(' Card Checkout — No ID Required Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel will be skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel will be skipped\n');

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
  const newUsersOnly = (u) => !alreadySent.has(u.id);

  const withTelegram = users.filter(u => u.telegram && newUsersOnly(u));
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app') && newUsersOnly(u));

  console.log(`\n   Total target users:  ${users.length}`);
  console.log(`   Already notified:    ${alreadySent.size}`);
  console.log(`   New (TG/email):      ${users.length - alreadySent.size}`);
  console.log(`   With Telegram:       ${withTelegram.length}`);
  console.log(`   With real email:     ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell
  console.log('\n1/4  In-app notifications...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: SUBSCRIBE_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted/upserted: ${stats.inApp}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would insert for ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: SUBSCRIBE_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: SUBSCRIBE_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
  if (EMAIL_ONLY || SKIP_TELEGRAM) { console.log('     [SKIPPED]'); }
  if (!DRY_RUN && !EMAIL_ONLY && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        await tg.sendMessage(u.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
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
    console.log(`     ✓ Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
  }

  // 4. Email
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email');
  } else if (!DRY_RUN) {
    if (process.env.RESEND_API_KEY) {
      console.log('     Using Resend API (1/220ms)...');
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ from: 'PNPtv! <support@pnptv.app>', to: [u.email], subject: EMAIL_SUBJECT[lang], html: buildEmailHtml(lang, name) }),
          });
          if (!res.ok) { const t = await res.text(); throw new Error(`${res.status} ${t}`); }
          stats.email++;
        } catch (err) {
          stats.emailFailed++;
          if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) {
            console.warn(`     Email err [${u.email}]: ${err.message}`);
          }
        }
        await sleep(220);
        const done = i + 1;
        if (done % 100 === 0 || done === withEmail.length) console.log(`     Email progress: ${done}/${withEmail.length}`);
      }
    } else {
      console.warn('     RESEND_API_KEY not set — falling back to Hostinger SMTP');
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
    }
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
