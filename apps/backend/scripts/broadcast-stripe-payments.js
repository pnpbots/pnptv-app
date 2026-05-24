#!/usr/bin/env node
'use strict';

/**
 * broadcast-stripe-payments.js
 *
 * Announce: Stripe is back — Apple Pay, Google Pay, Dash, stablecoins (USDC/USDT)
 * with 10% discount on all crypto payments.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-payments.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-payments.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-payments.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-payments.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-stripe-payments.js --email-only
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query } = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');
const EMAIL_ONLY    = process.argv.includes('--email-only');

const ENTITY_ID    = 'stripe-back-payments-2026-05-24';
const CHECKOUT_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS  = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ─────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `💳 Stripe is back! Pay with Apple Pay, Google Pay, Dash or stablecoins (USDC/USDT). Crypto payments get 10% off — 100% anonymous. →`,
  es: `💳 ¡Stripe volvió! Paga con Apple Pay, Google Pay, Dash o stablecoins (USDC/USDT). Los pagos con cripto tienen 10% de descuento — 100% anónimo. →`,
};

const PUSH = {
  en: {
    title: '💳 Stripe is back — Apple Pay, Google Pay & crypto',
    body:  'Dash, USDC, USDT — 10% off + 100% anonymous. Subscribe now.',
  },
  es: {
    title: '💳 Stripe volvió — Apple Pay, Google Pay y cripto',
    body:  'Dash, USDC, USDT — 10% descuento + 100% anónimo. Suscríbete ahora.',
  },
};

const TG = {
  en:
`💳 <b>Stripe is back on PNPtv!</b>

You can now pay for any plan with more options than ever:

🍎 <b>Apple Pay</b> — one tap, no card details needed
🤖 <b>Google Pay</b> — instant checkout from your phone
🥷 <b>Dash</b> — fast crypto, no name, no bank
🪙 <b>USDC / USDT</b> — stablecoins, 100% anonymous

🎁 <b>All crypto payments get 10% off</b> — Dash, USDC and USDT all qualify. Pay with crypto and save automatically.

Every payment method is discreet. No embarrassing bank statements, no third-party tracking.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`💳 <b>¡Stripe volvió a PNPtv!</b>

Ahora puedes pagar cualquier plan con más opciones que nunca:

🍎 <b>Apple Pay</b> — un toque, sin ingresar datos de tarjeta
🤖 <b>Google Pay</b> — pago instantáneo desde tu teléfono
🥷 <b>Dash</b> — cripto rápido, sin nombre, sin banco
🪙 <b>USDC / USDT</b> — stablecoins, 100% anónimo

🎁 <b>Todos los pagos con cripto tienen 10% de descuento</b> — Dash, USDC y USDT aplican. Paga con cripto y ahorra automáticamente.

Todos los métodos de pago son discretos. Sin estados de cuenta comprometedores, sin rastreo de terceros.

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '💳 Stripe is back — Apple Pay, Google Pay & 10% off crypto payments',
  es: '💳 Stripe volvió — Apple Pay, Google Pay y 10% descuento en cripto',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Stripe is back — more ways to pay' : 'Stripe volvió — más formas de pagar'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(99,179,237,0.2);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#635bff,#00d4ff,#ff3377);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            💳 ${en ? 'Stripe is back — more ways to pay than ever' : 'Stripe volvió — más formas de pagar que nunca'}
          </h1>

          <!-- Payment methods grid -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              <td width="50%" style="padding:0 6px 12px 0;">
                <div style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:12px;text-align:center;">
                  <p style="margin:0 0 4px;font-size:22px;line-height:1;">🍎</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">Apple Pay</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'One tap checkout' : 'Pago con un toque'}</p>
                </div>
              </td>
              <td width="50%" style="padding:0 0 12px 6px;">
                <div style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:12px;text-align:center;">
                  <p style="margin:0 0 4px;font-size:22px;line-height:1;">🤖</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">Google Pay</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'Instant from your phone' : 'Instantáneo desde tu celular'}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:0 6px 0 0;">
                <div style="padding:14px;background:rgba(0,141,228,0.08);border:1px solid rgba(0,141,228,0.30);border-radius:12px;text-align:center;position:relative;">
                  <p style="margin:0 0 4px;font-size:22px;line-height:1;">🥷</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#008DE4;">Dash</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'Fast · No name · No bank' : 'Rápido · Sin nombre · Sin banco'}</p>
                  <span style="position:absolute;top:-6px;right:-4px;font-size:9px;font-weight:800;background:#ff9933;color:#000;padding:2px 6px;border-radius:99px;">10% OFF</span>
                </div>
              </td>
              <td width="50%" style="padding:0 0 0 6px;">
                <div style="padding:14px;background:rgba(38,161,123,0.08);border:1px solid rgba(38,161,123,0.30);border-radius:12px;text-align:center;position:relative;">
                  <p style="margin:0 0 4px;font-size:22px;line-height:1;">🪙</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#26a17b;">USDC / USDT</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'Stablecoins · 100% anon' : 'Stablecoins · 100% anónimo'}</p>
                  <span style="position:absolute;top:-6px;right:-4px;font-size:9px;font-weight:800;background:#ff9933;color:#000;padding:2px 6px;border-radius:99px;">10% OFF</span>
                </div>
              </td>
            </tr>
          </table>

          <!-- Crypto discount callout -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px;background:rgba(255,153,51,0.10);border:1px solid rgba(255,153,51,0.30);border-radius:12px;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:800;color:#ff9933;">
                🎁 ${en ? '10% off all crypto payments' : '10% descuento en todos los pagos con cripto'}
              </p>
              <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.5;">
                ${en
                  ? 'Pay with Dash, USDC or USDT and your discount is applied automatically at checkout. No codes, no hassle.'
                  : 'Paga con Dash, USDC o USDT y el descuento se aplica automáticamente en el checkout. Sin códigos, sin complicaciones.'}
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#635bff,#ff3377);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">
                ${en ? 'Choose Your Plan →' : 'Elige tu Plan →'}
              </a>
            </td></tr>
          </table>

        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">
            ${en
              ? 'You received this as a member of PNPtv!.'
              : 'Recibiste esto por ser miembro de PNPtv!.'}
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet billing · pnptv.app</p>
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
  console.log(' Stripe Payments Announcement Broadcast');
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

  const withTelegram = users.filter(u => u.telegram);
  const withEmail    = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`   Total target users:  ${users.length}`);
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CHECKOUT_URL })]);
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
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: CHECKOUT_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: CHECKOUT_URL, tag: ENTITY_ID });
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
    const transporter = nodemailer.createTransport({
      host:   process.env.PNPTV_SMTP_HOST,
      port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth:   { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    });
    for (let i = 0; i < withEmail.length; i++) {
      const u = withEmail[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
      try {
        await transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>',
          to:   u.email,
          subject: EMAIL_SUBJECT[lang],
          html: buildEmailHtml(lang, name),
        });
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) {
          console.warn(`     Email err [${u.email}]: ${err.message}`);
        }
      }
      await sleep(EMAIL_DELAY_MS);
      if ((i + 1) % 100 === 0) console.log(`     Email progress: ${i + 1}/${withEmail.length}`);
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
