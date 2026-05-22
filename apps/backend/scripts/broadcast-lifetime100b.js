#!/usr/bin/env node
'use strict';

/**
 * broadcast-lifetime100b.js
 *
 * Announces the /lifetime100b direct checkout to all users who do NOT already
 * hold a lifetime pnp-member entitlement.
 *
 * Channels (in order):
 *   1. In-app notification bell  — all target users
 *   2. Web push                  — users with active push subscriptions
 *   3. Telegram bot message      — users with telegram ID
 *   4. Email                     — users with real email addresses
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100b.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-lifetime100b.js
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
const ENTITY_ID = 'lifetime100b-2026-05-18';
const CHECKOUT_URL = 'https://pnptv.app/lifetime100b';
const TG_DELAY_MS = 80;    // stay under Telegram's 30 msg/s group limit
const EMAIL_DELAY_MS = 120; // gentle SMTP pacing

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🔥 Lifetime100 checkout now available — pay with card or Dash. $99.99, lifetime PRIME access. Tap to open →`,
  es: `🔥 Checkout Lifetime100 disponible — paga con tarjeta o Dash. $99.99, acceso PRIME de por vida. Toca aquí →`,
};

const PUSH = {
  en: {
    title: 'Lifetime100 — Direct checkout available',
    body: 'Pay with card or Dash. $99.99 lifetime PRIME. Tap to open →',
  },
  es: {
    title: 'Lifetime100 — Checkout directo disponible',
    body: 'Paga con tarjeta o Dash. $99.99 PRIME de por vida. Toca aquí →',
  },
};

const TG = {
  en:
`🔥 <b>Lifetime100 — Direct checkout now available</b>

Hey! While Meru is briefly under maintenance, you can now get the Lifetime100 plan directly with card (Visa/Mastercard via ePayco) or Dash crypto.

💎 <b>$99.99 USD — one payment, lifetime PRIME access</b>

✅ Unlimited Videorama & Hangouts
✅ Premium Nearby features
✅ All PNP Latino Live events
✅ Live sessions with Santino
✅ No subscriptions, no renewals — ever

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`🔥 <b>Lifetime100 — Checkout directo disponible</b>

¡Hola! Mientras Meru está en mantenimiento, ya puedes obtener el plan Lifetime100 directamente con tarjeta (Visa/Mastercard vía ePayco) o Dash.

💎 <b>$99.99 USD — un pago, acceso PRIME de por vida</b>

✅ Videorama y Hangouts ilimitados
✅ Funciones Nearby Premium
✅ Todos los eventos PNP Latino Live
✅ Sesiones en vivo con Santino
✅ Sin suscripciones, sin renovaciones — jamás

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🔥 Lifetime100 — Pay directly now, no waiting',
  es: '🔥 Lifetime100 — Checkout directo disponible ahora',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;
  const headline = en
    ? 'Lifetime100 — Direct checkout now available'
    : 'Lifetime100 — Checkout directo disponible';
  const intro = en
    ? 'While our usual payment system (Meru) is briefly under maintenance, we\'ve opened a direct checkout for our Lifetime100 plan.'
    : 'Mientras nuestro sistema de pago habitual (Meru) está en mantenimiento, abrimos un checkout directo para el plan Lifetime100.';
  const priceLabel = en
    ? 'One payment · Lifetime PRIME access'
    : 'Un pago · Acceso PRIME de por vida';
  const benefits = en
    ? [
        'Unlimited Videorama & Hangouts',
        'Premium Nearby features',
        'All PNP Latino Live events',
        'Live sessions with Santino',
        'No subscriptions, no renewals — ever',
      ]
    : [
        'Videorama y Hangouts ilimitados',
        'Funciones Nearby Premium',
        'Todos los eventos PNP Latino Live',
        'Sesiones en vivo con Santino',
        'Sin suscripciones, sin renovaciones — jamás',
      ];
  const cta = en ? 'Get Lifetime Access →' : 'Obtener Acceso de por Vida →';
  const footer = en
    ? 'You received this as a member of PNPtv!. This is a limited-time direct checkout while Meru is under maintenance.'
    : 'Recibiste esto por ser miembro de PNPtv!. Este checkout directo está disponible mientras Meru está en mantenimiento.';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${headline}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,180,84,0.2);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#ff3377,#ff9933);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#ff9933;line-height:1.2;">🔥 ${headline}</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">${intro}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(255,180,84,0.08);border:1px solid rgba(255,180,84,0.25);border-radius:12px;text-align:center;">
              <div style="font-size:44px;font-weight:900;color:#ffffff;line-height:1;">$99.99 <span style="font-size:22px;opacity:0.7;">USD</span></div>
              <div style="margin-top:8px;font-size:14px;color:#ff9933;font-weight:700;">${priceLabel}</div>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            ${benefits.map((b) => `<tr><td style="padding:5px 0;font-size:14px;color:#d1d5db;">✅&nbsp;&nbsp;${b}</td></tr>`).join('\n            ')}
          </table>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#ff3377,#ff9933);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">${cta}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0 0 6px;font-size:11px;color:#6b7280;line-height:1.5;">${footer}</p>
          <p style="margin:0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet billing · pnptv.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log(' Lifetime100B Broadcast — All Channels');
  console.log('═══════════════════════════════════════════════');
  if (DRY_RUN)   console.log(' MODE: DRY RUN — nothing will be sent\n');
  if (SKIP_EMAIL) console.log(' --skip-email: email channel will be skipped\n');

  // Fetch target users — exclude existing lifetime pnp-member holders
  console.log('Fetching target users...');
  const { rows: users } = await query(`
    SELECT u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    WHERE COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = u.id
          AND ue.add_on_id = 'pnp-member'
          AND ue.is_lifetime = true
      )
    ORDER BY u.id
  `);

  const withTelegram = users.filter((u) => u.telegram);
  const withEmail    = users.filter((u) => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`  Total target users:  ${users.length}`);
  console.log(`  With Telegram:       ${withTelegram.length}`);
  console.log(`  With real email:     ${withEmail.length}`);
  console.log(`  Will get push:       ≤ push_subscriptions count\n`);

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // ── 1. In-app notification bell ──────────────────────────────────────────
  console.log('1/4  In-app notifications...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      const enIds = users.filter((u) =>  isEn(u.language)).map((u) => u.id);
      const esIds = users.filter((u) => !isEn(u.language)).map((u) => u.id);

      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (ids.length === 0) continue;
        await query(`
          INSERT INTO notifications
            (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message, metadata)
          SELECT
            'announcement', 'system', 'high', NULL,
            t.id, 'system', $2, $3, $4::jsonb
          FROM unnest($1::text[]) AS t(id)
          ON CONFLICT (type, target_user_id, entity_type, entity_id) WHERE actor_id IS NULL
          DO UPDATE SET
            is_read    = FALSE,
            created_at = NOW(),
            message    = EXCLUDED.message
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CHECKOUT_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted/upserted: ${stats.inApp}`);
    } catch (err) {
      console.error(`     ✗ Error: ${err.message}`);
    }
  } else {
    console.log(`     [DRY] Would insert notifications for ${users.length} users`);
  }

  // ── 2. Web push ──────────────────────────────────────────────────────────
  console.log('2/4  Web push notifications...');
  if (EMAIL_ONLY) { console.log('     [SKIPPED] --email-only'); }
  if (!DRY_RUN && !EMAIL_ONLY) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter((u) =>  isEn(u.language)).map((u) => u.id);
      const esIds = users.filter((u) => !isEn(u.language)).map((u) => u.id);
      let pushSent = 0;
      if (enIds.length) {
        pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: CHECKOUT_URL, tag: ENTITY_ID });
      }
      if (esIds.length) {
        pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: CHECKOUT_URL, tag: ENTITY_ID });
      }
      stats.push = pushSent;
      console.log(`     ✓ Push sent: ${pushSent}`);
    } catch (err) {
      console.error(`     ✗ Error: ${err.message}`);
    }
  } else {
    console.log(`     [DRY] Would push to subscribed users out of ${users.length}`);
  }

  // ── 3. Telegram bot ──────────────────────────────────────────────────────
  console.log(`3/4  Telegram messages to ${withTelegram.length} users...`);
  if (EMAIL_ONLY || SKIP_TELEGRAM) { console.log('     [SKIPPED]'); }
  if (!DRY_RUN && !EMAIL_ONLY && !SKIP_TELEGRAM) {
    const tg = new Telegram(process.env.BOT_TOKEN);
    for (let i = 0; i < withTelegram.length; i++) {
      const u = withTelegram[i];
      const msg = isEn(u.language) ? TG.en : TG.es;
      try {
        await tg.sendMessage(u.telegram, msg, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        });
        stats.telegram++;
      } catch (err) {
        stats.telegramFailed++;
        // Only log first 5 failures and every 100th to avoid noise
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 100 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 200 === 0) {
        console.log(`     TG progress: ${i + 1}/${withTelegram.length} processed`);
      }
    }
    console.log(`     ✓ Telegram sent: ${stats.telegram}, failed: ${stats.telegramFailed}`);
  } else {
    console.log(`     [DRY] Would send Telegram messages to ${withTelegram.length} users`);
  }

  // ── 4. Email ─────────────────────────────────────────────────────────────
  console.log(`4/4  Emails to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log(`     [SKIPPED] --skip-email flag set — recurring runs omit email to avoid SMTP rate limits\n`);
  } else if (!DRY_RUN) {
    const transporter = nodemailer.createTransport({
      host:   process.env.PNPTV_SMTP_HOST,
      port:   parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
      secure: process.env.PNPTV_SMTP_SECURE === 'true',
      auth: {
        user: process.env.PNPTV_SMTP_USER,
        pass: process.env.PNPTV_SMTP_PASS,
      },
    });

    for (let i = 0; i < withEmail.length; i++) {
      const u = withEmail[i];
      const lang = isEn(u.language) ? 'en' : 'es';
      const name = u.first_name || u.username || (lang === 'en' ? 'Member' : 'Miembro');
      try {
        await transporter.sendMail({
          from:    '"PNPtv!" <support@pnptv.app>',
          to:      u.email,
          subject: EMAIL_SUBJECT[lang],
          html:    buildEmailHtml(lang, name),
        });
        stats.email++;
      } catch (err) {
        stats.emailFailed++;
        if (stats.emailFailed <= 5 || stats.emailFailed % 50 === 0) {
          console.warn(`     Email err [${u.email}]: ${err.message}`);
        }
      }
      await sleep(EMAIL_DELAY_MS);
      if ((i + 1) % 100 === 0) {
        console.log(`     Email progress: ${i + 1}/${withEmail.length} processed`);
      }
    }
    console.log(`     ✓ Email sent: ${stats.email}, failed: ${stats.emailFailed}`);
  } else {
    console.log(`     [DRY] Would send emails to ${withEmail.length} users`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
  console.log('═══════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(` Target users:  ${users.length} (excl. ${105} lifetime holders)`);
    console.log(` Telegram:      ${withTelegram.length} would receive`);
    console.log(` Email:         ${withEmail.length} would receive`);
    console.log(` Push:          up to push_subscriptions count`);
  } else {
    console.log(` In-app:        ${stats.inApp} notified`);
    console.log(` Push:          ${stats.push} delivered`);
    console.log(` Telegram:      ${stats.telegram} sent / ${stats.telegramFailed} failed`);
    console.log(` Email:         ${stats.email} sent / ${stats.emailFailed} failed`);
  }
  console.log('═══════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
