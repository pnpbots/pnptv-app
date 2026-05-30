#!/usr/bin/env node
'use strict';

/**
 * broadcast-how-to-pay.js
 *
 * Payment guide broadcast — explains how to pay with card (+ 3DS tip),
 * USDC, and Dash. Links to pnptv.app/how-to-pay.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-how-to-pay.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-how-to-pay.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-how-to-pay.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-how-to-pay.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-how-to-pay.js --force
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

const ENTITY_ID     = 'how-to-pay-guide-2026-05';
const PAGE_URL      = 'https://pnptv.app/how-to-pay';
const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS   = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `💳 New payment guide: how to pay with card, USDC, or Dash — step by step. pnptv.app/how-to-pay →`,
  es: `💳 Nueva guía de pagos: cómo pagar con tarjeta, USDC o Dash — paso a paso. pnptv.app/how-to-pay →`,
};

const PUSH = {
  en: {
    title: '💳 How to pay on PNPtv — full guide',
    body:  'Card, USDC, or Dash. Step-by-step instructions for every method.',
  },
  es: {
    title: '💳 Cómo pagar en PNPtv — guía completa',
    body:  'Tarjeta, USDC o Dash. Instrucciones paso a paso para cada método.',
  },
};

const TG = {
  en:
`💳 <b>How to pay on PNPtv — full guide</b>

We just published a step-by-step payment guide covering every method we support:

<b>💳 Credit or Debit Card</b>
Pay instantly with Visa or Mastercard. Works from most countries.
<i>⚠️ Important: after submitting your card, wait 20–30 seconds for your bank's 3D Secure verification screen to appear. Do NOT close the page or press back while waiting.</i>

<b>🪙 USDC (stable digital dollar)</b>
Buy USDC on Coinbase/Binance and pay at checkout. Always $1 = 1 USDC.

<b>🥷 Dash (most private)</b>
Pay anonymously with Dash. No name, no bank, no traces.

👉 <a href="${PAGE_URL}">Full guide with all steps → ${PAGE_URL}</a>

Ready to subscribe? 👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,

  es:
`💳 <b>Cómo pagar en PNPtv — guía completa</b>

Publicamos una guía paso a paso con todos los métodos de pago disponibles:

<b>💳 Tarjeta de Crédito o Débito</b>
Paga al instante con Visa o Mastercard. Funciona desde la mayoría de países.
<i>⚠️ Importante: después de ingresar tu tarjeta, espera 20–30 segundos a que aparezca la pantalla de verificación 3D Secure de tu banco. No cierres la página ni presiones Atrás mientras esperas.</i>

<b>🪙 USDC (dólar digital estable)</b>
Compra USDC en Coinbase/Binance y paga en el checkout. Siempre $1 = 1 USDC.

<b>🥷 Dash (más privado)</b>
Paga de forma anónima con Dash. Sin nombre, sin banco, sin rastros.

👉 <a href="${PAGE_URL}">Guía completa con todos los pasos → ${PAGE_URL}</a>

¿Listo para suscribirte? 👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '💳 How to pay on PNPtv — card, USDC & Dash guide',
  es: '💳 Cómo pagar en PNPtv — guía de tarjeta, USDC y Dash',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'How to Pay on PNPtv' : 'Cómo Pagar en PNPtv'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.25);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#26a17b,#008DE4);"></td></tr>

        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>

        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>

          <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#ffffff;line-height:1.2;">
            💳 ${en ? 'How to Pay on PNPtv' : 'Cómo Pagar en PNPtv'}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.5;">
            ${en ? 'We now support three ways to pay. Here\'s how each one works.' : 'Ahora aceptamos tres formas de pago. Así funciona cada una.'}
          </p>

          <!-- Method 1: Card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td style="padding:20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#D4007A;">💳 ${en ? 'Option 1 — Credit or Debit Card' : 'Opción 1 — Tarjeta de Crédito o Débito'}</p>
              <p style="margin:0 0 12px;font-size:13px;color:#d1d5db;line-height:1.6;">
                ${en ? 'Pay instantly with Visa or Mastercard. Works from most countries.' : 'Paga al instante con Visa o Mastercard. Funciona desde la mayoría de países.'}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                <tr><td style="padding:12px 14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:10px;">
                  <p style="margin:0;font-size:12px;color:#fbbf24;line-height:1.6;">
                    ⚠️ <b>${en ? 'Important:' : 'Importante:'}</b> ${en
                      ? 'After submitting your card, wait 20–30 seconds for your bank\'s 3D Secure verification to appear. Do NOT close the page or press back while waiting. Check your phone — your bank may send a push notification or SMS.'
                      : 'Después de ingresar tu tarjeta, espera 20–30 segundos a que aparezca la verificación 3D Secure de tu banco. No cierres la página ni presiones Atrás. Revisa tu teléfono — tu banco puede enviar una notificación push o SMS.'}
                  </p>
                </td></tr>
              </table>
            </td></tr>
          </table>

          <!-- Method 2: USDC -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td style="padding:20px;background:rgba(38,161,123,0.06);border:1px solid rgba(38,161,123,0.25);border-radius:14px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#26a17b;">🪙 ${en ? 'Option 2 — USDC (stable digital dollar)' : 'Opción 2 — USDC (dólar digital estable)'}</p>
              <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.6;">
                ${en ? 'Buy USDC on Coinbase or Binance. 1 USDC = $1 USD, always. Send it at checkout — works from any country without card declines.' : 'Compra USDC en Coinbase o Binance. 1 USDC = $1 USD, siempre. Envíalo al hacer el checkout — funciona desde cualquier país sin rechazos de tarjeta.'}
              </p>
            </td></tr>
          </table>

          <!-- Method 3: Dash -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(0,141,228,0.06);border:1px solid rgba(0,141,228,0.25);border-radius:14px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#008DE4;">🥷 ${en ? 'Option 3 — Dash (most private)' : 'Opción 3 — Dash (más privado)'}</p>
              <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.6;">
                ${en ? 'Pay anonymously with Dash. No name, no bank, no statement. Just scan the QR and send.' : 'Paga de forma anónima con Dash. Sin nombre, sin banco, sin estado de cuenta. Solo escanea el QR y envía.'}
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td align="center">
              <a href="${PAGE_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#D4007A,#26a17b);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">
                ${en ? 'Read the full guide →' : 'Leer la guía completa →'}
              </a>
            </td></tr>
            <tr><td align="center" style="padding-top:8px;">
              <a href="${PAGE_URL}" style="font-size:12px;color:#6b7280;text-decoration:underline;">${PAGE_URL}</a>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr><td align="center">
              <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:12px 32px;background:rgba(255,255,255,0.08);color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;border:1px solid rgba(255,255,255,0.15);">
                ${en ? 'Go to Subscribe →' : 'Ir a Suscripciones →'}
              </a>
            </td></tr>
          </table>

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
  console.log(' How to Pay Guide Broadcast');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel will be skipped\n');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel will be skipped\n');

  console.log('\n── Fetching broadcast targets...');
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

  console.log(`   Total target users:  ${users.length}`);
  console.log(`   Already notified:    ${alreadySent.size}`);
  console.log(`   New (TG/email):      ${users.length - alreadySent.size}`);
  console.log(`   With Telegram:       ${withTelegram.length}`);
  console.log(`   With real email:     ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell
  console.log('\n1/4  In-app notifications...');
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: PAGE_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted/upserted: ${stats.inApp}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would insert for ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: PAGE_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: PAGE_URL, tag: ENTITY_ID });
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) { console.error(`     ✗ Error: ${err.message}`); }
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would push to subscribed users`);
  }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTelegram.length} users...`);
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
        host: process.env.PNPTV_SMTP_HOST, port: parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
        secure: process.env.PNPTV_SMTP_SECURE === 'true',
        auth: { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
        pool: true, maxConnections: 1, maxMessages: Infinity,
        rateDelta: 1000, rateLimit: 1,
      });
      await new Promise((resolveAll) => {
        let completed = 0;
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
            if (err) { stats.emailFailed++; } else { stats.email++; }
            if (completed % 100 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
            if (completed === withEmail.length) { transporter.close(); resolveAll(); }
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
