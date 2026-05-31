#!/usr/bin/env node
'use strict';

/**
 * broadcast-payment-retry.js
 *
 * Targeted broadcast to all users who attempted a payment with any method
 * (ePayco, NOWPayments, BTCPay/Dash, Meru) — regardless of outcome.
 * Links: /how-to-pay  /subscribe  /lifetime80
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-retry.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-payment-retry.js
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

const ENTITY_ID      = 'payment-retry-guide-2026-05';
const HOW_TO_PAY_URL = 'https://pnptv.app/how-to-pay';
const SUBSCRIBE_URL  = 'https://pnptv.app/subscribe';
const LIFETIME_URL   = 'https://pnptv.app/lifetime80';
const TG_DELAY_MS    = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const PUSH = {
  en: { title: '💳 Complete your PNPtv subscription', body: 'Card, USDC, or Dash — step-by-step guide now available.' },
  es: { title: '💳 Completa tu suscripción a PNPtv',  body: 'Tarjeta, USDC o Dash — guía paso a paso ya disponible.' },
};

const NOTIFICATION_MSG = {
  en: `💳 We noticed you tried to subscribe. Here's a full guide on how to pay — card, USDC, or Dash. pnptv.app/how-to-pay →`,
  es: `💳 Vimos que intentaste suscribirte. Aquí tienes la guía completa de pagos — tarjeta, USDC o Dash. pnptv.app/how-to-pay →`,
};

const TG = {
  en:
`💳 <b>Having trouble paying on PNPtv?</b>

We noticed you tried to subscribe. Here's everything you need to complete your payment:

<b>💳 Option 1 — Credit or Debit Card (fastest)</b>
Pay with Visa or Mastercard. After entering your card, <b>wait 20–30 seconds</b> for your bank's 3D Secure verification — do NOT close the tab.

<b>🪙 Option 2 — USDC (stable, works from any country)</b>
1 USDC = $1 USD. Buy on Coinbase or Binance and pay at checkout.

<b>🥷 Option 3 — Dash (most private)</b>
No bank, no name. Just scan and send.

👉 <a href="${HOW_TO_PAY_URL}">Full step-by-step guide → pnptv.app/how-to-pay</a>

──────────────────
Subscribe: <a href="${SUBSCRIBE_URL}">pnptv.app/subscribe</a>
Lifetime PRIME $80: <a href="${LIFETIME_URL}">pnptv.app/lifetime80</a>`,

  es:
`💳 <b>¿Tuviste problemas para pagar en PNPtv?</b>

Vimos que intentaste suscribirte. Aquí tienes todo lo que necesitas para completar tu pago:

<b>💳 Opción 1 — Tarjeta de Crédito o Débito (más rápido)</b>
Paga con Visa o Mastercard. Después de ingresar tu tarjeta, <b>espera 20–30 segundos</b> a que aparezca la verificación 3D Secure de tu banco — no cierres la pestaña.

<b>🪙 Opción 2 — USDC (estable, funciona desde cualquier país)</b>
1 USDC = $1 USD. Compra en Coinbase o Binance y paga en el checkout.

<b>🥷 Opción 3 — Dash (más privado)</b>
Sin banco, sin nombre. Solo escanea y envía.

👉 <a href="${HOW_TO_PAY_URL}">Guía paso a paso completa → pnptv.app/how-to-pay</a>

──────────────────
Suscripciones: <a href="${SUBSCRIBE_URL}">pnptv.app/subscribe</a>
Lifetime PRIME $80: <a href="${LIFETIME_URL}">pnptv.app/lifetime80</a>`,
};

const EMAIL_SUBJECT = {
  en: '💳 Complete your PNPtv subscription — card, USDC & Dash guide',
  es: '💳 Completa tu suscripción a PNPtv — guía de tarjeta, USDC y Dash',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${en ? 'Complete your PNPtv subscription' : 'Completa tu suscripción a PNPtv'}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.25);">
      <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#26a17b,#008DE4);"></td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
      </td></tr>
      <tr><td style="padding:16px 32px 32px;">
        <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${en ? `Hey ${name}!` : `¡Hola ${name}!`}</p>
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
          💳 ${en ? 'Having trouble paying on PNPtv?' : '¿Tuviste problemas para pagar en PNPtv?'}
        </h1>
        <p style="margin:0 0 28px;font-size:15px;color:#9ca3af;line-height:1.5;">
          ${en ? "We noticed you tried to subscribe. Here's a full guide on how to complete your payment." : 'Vimos que intentaste suscribirte. Aquí tienes la guía completa para completar tu pago.'}
        </p>

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td style="padding:18px 20px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.25);border-radius:14px;">
            <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#D4007A;">💳 ${en ? 'Option 1 — Credit or Debit Card' : 'Opción 1 — Tarjeta'}</p>
            <p style="margin:0 0 10px;font-size:13px;color:#d1d5db;line-height:1.6;">${en ? 'Pay with Visa or Mastercard from most countries.' : 'Paga con Visa o Mastercard desde la mayoría de países.'}</p>
            <p style="margin:0;font-size:12px;color:#fbbf24;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:8px 12px;line-height:1.6;">
              ⚠️ ${en ? 'After submitting your card, wait 20–30 seconds for the 3D Secure popup. Do NOT close the tab.' : 'Después de ingresar tu tarjeta, espera 20–30 segundos al popup 3D Secure. No cierres la pestaña.'}
            </p>
          </td></tr>
        </table>

        <!-- USDC -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td style="padding:18px 20px;background:rgba(38,161,123,0.06);border:1px solid rgba(38,161,123,0.25);border-radius:14px;">
            <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#26a17b;">🪙 ${en ? 'Option 2 — USDC' : 'Opción 2 — USDC'}</p>
            <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.6;">${en ? '1 USDC = $1 USD always. Buy on Coinbase or Binance. Works from any country without card declines.' : '1 USDC = $1 USD siempre. Compra en Coinbase o Binance. Funciona desde cualquier país sin rechazos.'}</p>
          </td></tr>
        </table>

        <!-- Dash -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr><td style="padding:18px 20px;background:rgba(0,141,228,0.06);border:1px solid rgba(0,141,228,0.25);border-radius:14px;">
            <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#008DE4;">🥷 ${en ? 'Option 3 — Dash (most private)' : 'Opción 3 — Dash (más privado)'}</p>
            <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.6;">${en ? 'No bank, no name. Scan the QR and send.' : 'Sin banco, sin nombre. Escanea el QR y envía.'}</p>
          </td></tr>
        </table>

        <!-- CTAs -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr><td align="center">
            <a href="${HOW_TO_PAY_URL}" style="display:inline-block;padding:15px 36px;background:linear-gradient(90deg,#D4007A,#26a17b);color:#fff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              ${en ? '📖 Full step-by-step guide →' : '📖 Guía paso a paso completa →'}
            </a>
          </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td align="center" style="padding:0 4px;">
              <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:12px 20px;background:rgba(255,255,255,0.07);color:#fff;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;border:1px solid rgba(255,255,255,0.15);">
                ${en ? 'Subscribe →' : 'Suscripciones →'}
              </a>
            </td>
            <td align="center" style="padding:0 4px;">
              <a href="${LIFETIME_URL}" style="display:inline-block;padding:12px 20px;background:rgba(38,161,123,0.1);color:#26a17b;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;border:1px solid rgba(38,161,123,0.3);">
                ${en ? 'Lifetime PRIME $80 →' : 'Lifetime PRIME $80 →'}
              </a>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="margin:0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet · pnptv.app</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' Payment Retry Broadcast — attempted-payment users');
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  // Fetch all users who attempted a payment with any method
  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.id)
      u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE u.id IN (
      SELECT user_id FROM payments
      UNION
      SELECT user_id FROM dash_subscription_orders
      UNION
      SELECT reserved_for_user_id FROM meru_payment_links WHERE reserved_for_user_id IS NOT NULL
    )
    AND COALESCE(u.is_deleted, false) = false
    AND u.role != 'banned'
    ORDER BY u.id
  `);

  let alreadySent = new Set();
  if (!FORCE) {
    const { rows } = await query(`
      SELECT target_user_id FROM notifications
      WHERE entity_id = $1 AND entity_type = 'system' AND actor_id IS NULL
    `, [ENTITY_ID]);
    alreadySent = new Set(rows.map(r => r.target_user_id));
  }

  const targets    = users.filter(u => !alreadySent.has(u.id));
  const withTG     = targets.filter(u => u.telegram);
  const withEmail  = targets.filter(u => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`   Payment-attempt users: ${users.length}`);
  console.log(`   Already notified:      ${alreadySent.size}`);
  console.log(`   New targets:           ${targets.length}`);
  console.log(`   With Telegram:         ${withTG.length}`);
  console.log(`   With real email:       ${withEmail.length}`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // 1. In-app bell
  console.log('\n1/4  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = targets.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = targets.filter(u => !isEn(u.language)).map(u => u.id);
      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT 'announcement','system','high',NULL,t.id,'system',$2,$3,$4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET is_read = FALSE, created_at = NOW(), message = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: HOW_TO_PAY_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else { console.log(`     [DRY] Would insert for ${targets.length} users`); }

  // 2. Push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = targets.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = targets.filter(u => !isEn(u.language)).map(u => u.id);
      let sent = 0;
      if (enIds.length) sent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: HOW_TO_PAY_URL, tag: ENTITY_ID });
      if (esIds.length) sent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: HOW_TO_PAY_URL, tag: ENTITY_ID });
      stats.push = sent;
      console.log(`     ✓ ${sent} push sent`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else { console.log(`     [DRY] Would push to subscribed users`); }

  // 3. Telegram
  console.log(`3/4  Telegram to ${withTG.length} users...`);
  if (!DRY_RUN && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTG.length; i++) {
      const u = withTG[i];
      try {
        await tg.sendMessage(u.telegram, isEn(u.language) ? TG.en : TG.es, { parse_mode: 'HTML', disable_web_page_preview: false });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) console.warn(`     TG err [${u.telegram}]: ${err.message}`);
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 200 === 0) console.log(`     TG progress: ${i + 1}/${withTG.length}`);
    }
    console.log(`     ✓ ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else { console.log(`     [DRY] Would send to ${withTG.length} users`); }

  // 4. Email
  console.log(`4/4  Email to ${withEmail.length} users...`);
  if (DRY_RUN || SKIP_EMAIL) {
    console.log(`     [${SKIP_EMAIL ? 'SKIPPED' : 'DRY'}] Would send to ${withEmail.length} users`);
  } else if (process.env.RESEND_API_KEY) {
    console.log('     Using Resend (1/220ms)...');
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
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
      }
      await sleep(220);
      if ((i + 1) % 100 === 0 || i + 1 === withEmail.length) console.log(`     Email progress: ${i + 1}/${withEmail.length}`);
    }
    console.log(`     ✓ ${stats.email} sent / ${stats.emailFailed} failed`);
  } else {
    console.log('     Using Hostinger SMTP (1 msg/sec)...');
    const transporter = nodemailer.createTransport({
      host:    process.env.PNPTV_SMTP_HOST,
      port:    parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure:  process.env.PNPTV_SMTP_SECURE === 'true',
      auth:    { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
      pool:    true, maxConnections: 1, maxMessages: Infinity,
      rateDelta: 1000, rateLimit: 1,
    });
    await new Promise((resolve) => {
      let completed = 0;
      if (!withEmail.length) { resolve(); return; }
      for (let i = 0; i < withEmail.length; i++) {
        const u = withEmail[i];
        const lang = isEn(u.language) ? 'en' : 'es';
        const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
        transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>', to: u.email,
          subject: EMAIL_SUBJECT[lang], html: buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) { stats.emailFailed++; console.warn(`     Email err [${u.email}]: ${err.message}`); }
          else { stats.email++; }
          if (completed % 50 === 0 || completed === withEmail.length) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) { transporter.close(); resolve(); }
        });
      }
    });
    console.log(`     ✓ ${stats.email} sent / ${stats.emailFailed} failed`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
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
