#!/usr/bin/env node
'use strict';

/**
 * broadcast-dash-winback.js
 *
 * Win-back campaign for users who started a Dash/BTCPay checkout but never
 * completed it. Creates a 20% off promo code (DASH20OFF) valid for 14 days
 * and broadcasts it across all 4 channels.
 *
 * Audience: users with at least one expired Dash order and zero completed ones.
 *
 * Channels (in order):
 *   1. In-app notification bell  — all target users
 *   2. Web push                  — users with active push subscriptions
 *   3. Telegram bot message      — users with telegram ID
 *   4. Email                     — users with real email addresses
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-dash-winback.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-dash-winback.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-dash-winback.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-dash-winback.js --skip-telegram
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }              = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService = require(path.join(BACKEND, 'services/pushNotificationService'));
const nodemailer              = require('nodemailer');
const { Telegram }            = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');

const PROMO_CODE    = 'DASH20OFF';
const ENTITY_ID     = 'dash-winback-2026-05-23';
const CHECKOUT_URL  = `https://pnptv.app/subscribe?promo=${PROMO_CODE}`;
const TG_DELAY_MS   = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `💸 You left a Dash payment incomplete — here's 20% off any plan. Use code DASH20OFF at checkout. Tap to open →`,
  es: `💸 Dejaste un pago con Dash incompleto — aquí tienes 20% de descuento en cualquier plan. Usa el código DASH20OFF. Toca aquí →`,
};

const PUSH = {
  en: {
    title: '20% off — Complete your PNPtv! subscription',
    body:  'Use code DASH20OFF at checkout. Valid 14 days.',
  },
  es: {
    title: '20% de descuento — Completa tu suscripción PNPtv!',
    body:  'Usa el código DASH20OFF en el checkout. Válido 14 días.',
  },
};

const TG = {
  en:
`💸 <b>You left a payment incomplete — here's 20% off</b>

Hey! We noticed you started a Dash/crypto checkout on PNPtv! but didn't complete it.

No worries — here's a thank-you discount:

🏷️ <b>Use code <code>DASH20OFF</code> for 20% off any plan</b>

✅ Works on monthly, yearly, and Lifetime100 plans
✅ Pay with card (Visa/Mastercard), Dash, or Bitcoin
✅ Valid for the next 14 days

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`💸 <b>Dejaste un pago incompleto — aquí tienes 20% de descuento</b>

¡Hola! Notamos que empezaste un checkout con Dash/cripto en PNPtv! pero no lo completaste.

Sin problema — aquí tienes un descuento de agradecimiento:

🏷️ <b>Usa el código <code>DASH20OFF</code> para 20% de descuento en cualquier plan</b>

✅ Válido para planes mensuales, anuales y Lifetime100
✅ Paga con tarjeta (Visa/Mastercard), Dash o Bitcoin
✅ Válido por los próximos 14 días

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '💸 20% off — complete your PNPtv! subscription',
  es: '💸 20% de descuento — completa tu suscripción PNPtv!',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting    = en ? `Hey ${name}!` : `¡Hola ${name}!`;
  const headline    = en ? '20% off — Complete your subscription' : '20% de descuento — Completa tu suscripción';
  const intro       = en
    ? `We noticed you started a Dash/crypto checkout on PNPtv! but didn't complete it. No worries — here's a special discount just for you.`
    : `Notamos que empezaste un checkout con Dash/cripto en PNPtv! pero no lo completaste. Sin problema — aquí tienes un descuento especial solo para ti.`;
  const codeLabel   = en ? 'Your discount code' : 'Tu código de descuento';
  const codeNote    = en
    ? '20% off any plan · Valid for 14 days'
    : '20% de descuento en cualquier plan · Válido 14 días';
  const plansLabel  = en ? 'Works on all plans' : 'Válido para todos los planes';
  const benefits    = en
    ? ['Monthly & yearly subscriptions', 'Lifetime100 — one payment, lifetime PRIME', 'Pay with card, Dash, or Bitcoin']
    : ['Suscripciones mensuales y anuales', 'Lifetime100 — un pago, PRIME de por vida', 'Paga con tarjeta, Dash o Bitcoin'];
  const cta         = en ? 'Claim 20% Off →' : 'Obtener 20% Descuento →';
  const urgency     = en ? 'Offer expires in 14 days.' : 'La oferta expira en 14 días.';
  const footer      = en
    ? `You received this because you started (but didn't complete) a Dash checkout on PNPtv!.`
    : `Recibiste esto porque comenzaste (pero no completaste) un checkout con Dash en PNPtv!.`;

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
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(94,209,196,0.2);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#5ED1C4,#A78BFA);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#5ED1C4;line-height:1.2;">💸 ${headline}</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">${intro}</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:20px;background:rgba(94,209,196,0.08);border:1px solid rgba(94,209,196,0.3);border-radius:12px;text-align:center;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:#9ca3af;margin-bottom:8px;">${codeLabel}</div>
              <div style="font-size:36px;font-weight:900;color:#5ED1C4;letter-spacing:0.1em;font-family:monospace;">${PROMO_CODE}</div>
              <div style="margin-top:8px;font-size:13px;color:#A78BFA;font-weight:600;">${codeNote}</div>
            </td></tr>
          </table>

          <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#ffffff;">${plansLabel}:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            ${benefits.map((b) => `<tr><td style="padding:5px 0;font-size:14px;color:#d1d5db;">✅&nbsp;&nbsp;${b}</td></tr>`).join('\n            ')}
          </table>

          <p style="margin:0 0 16px;font-size:13px;color:#9ca3af;font-style:italic;">⏳ ${urgency}</p>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#5ED1C4,#A78BFA);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">${cta}</a>
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

// ── Promo upsert ──────────────────────────────────────────────────────────────

async function ensurePromo() {
  const validUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { rows } = await query(
    `SELECT id, valid_until FROM promos WHERE UPPER(code) = $1`,
    [PROMO_CODE]
  );

  if (rows.length) {
    console.log(`  Promo ${PROMO_CODE} already exists (id=${rows[0].id}), extending valid_until to ${validUntil}`);
    if (!DRY_RUN) {
      await query(
        `UPDATE promos SET valid_until = $2, active = true, updated_at = NOW() WHERE UPPER(code) = $1`,
        [PROMO_CODE, validUntil]
      );
    }
    return rows[0].id;
  }

  console.log(`  Creating promo ${PROMO_CODE}...`);
  if (DRY_RUN) { console.log('  [DRY] Skipping promo insert'); return null; }

  const { rows: created } = await query(
    `INSERT INTO promos
       (code, name, name_es, description, description_es,
        base_plan_id, discount_type, discount_value,
        target_audience, max_spots, valid_from, valid_until,
        features, features_es, active, hidden)
     VALUES
       ($1, $2, $3, $4, $5,
        'any', 'percentage', 20,
        'all', 200, NOW(), $6,
        '[]'::jsonb, '[]'::jsonb, true, false)
     RETURNING id`,
    [
      PROMO_CODE,
      '20% Off — Dash Win-back',
      '20% Descuento — Recuperación Dash',
      '20% discount for users who started a Dash checkout but did not complete it.',
      '20% de descuento para usuarios que iniciaron un pago con Dash pero no lo completaron.',
      validUntil,
    ]
  );
  console.log(`  ✓ Promo created: id=${created[0].id}, valid_until=${validUntil}`);
  return created[0].id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Dash Win-back Broadcast — 20% Off Promo');
  console.log('═══════════════════════════════════════════════════════════════');
  if (DRY_RUN)       console.log(' MODE: DRY RUN — nothing will be sent or written\n');
  if (SKIP_EMAIL)    console.log(' --skip-email: email channel will be skipped');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram: Telegram channel will be skipped');
  if (!DRY_RUN)      console.log(' MODE: LIVE — will send real messages\n');

  // ── Create / refresh the promo ────────────────────────────────────────────
  console.log('Promo setup...');
  await ensurePromo();
  console.log();

  // ── Fetch abandoned Dash users ────────────────────────────────────────────
  console.log('Fetching abandoned Dash users...');
  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.id)
           u.id, u.first_name, u.username, u.email, u.telegram, u.language
    FROM users u
    INNER JOIN dash_subscription_orders dso ON dso.user_id = u.id
    WHERE dso.status = 'expired'
      AND COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND NOT EXISTS (
        SELECT 1 FROM dash_subscription_orders c
        WHERE c.user_id = u.id AND c.status = 'completed'
      )
    ORDER BY u.id
  `);

  const withTelegram = users.filter((u) => u.telegram);
  const withEmail    = users.filter((u) => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`  Total abandoned users: ${users.length}`);
  console.log(`  With Telegram:         ${withTelegram.length}`);
  console.log(`  With real email:       ${withEmail.length}`);
  console.log();

  if (!users.length) {
    console.log('No abandoned users found. Exiting.');
    process.exit(0);
  }

  const stats = { inApp: 0, push: 0, telegram: 0, telegramFailed: 0, email: 0, emailFailed: 0 };

  // ── 1. In-app notification bell ───────────────────────────────────────────
  console.log('1/4  In-app notifications...');
  if (!DRY_RUN) {
    try {
      const enIds = users.filter((u) =>  isEn(u.language)).map((u) => u.id);
      const esIds = users.filter((u) => !isEn(u.language)).map((u) => u.id);

      for (const [ids, msg] of [[enIds, NOTIFICATION_MSG.en], [esIds, NOTIFICATION_MSG.es]]) {
        if (!ids.length) continue;
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CHECKOUT_URL, promoCode: PROMO_CODE })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ Inserted/upserted: ${stats.inApp}`);
    } catch (err) {
      console.error(`     ✗ Error: ${err.message}`);
    }
  } else {
    console.log(`     [DRY] Would insert notifications for ${users.length} users`);
  }

  // ── 2. Web push ───────────────────────────────────────────────────────────
  console.log('2/4  Web push notifications...');
  if (!DRY_RUN) {
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

  // ── 3. Telegram bot ───────────────────────────────────────────────────────
  console.log(`3/4  Telegram messages to ${withTelegram.length} users...`);
  if (SKIP_TELEGRAM) {
    console.log('     [SKIPPED] --skip-telegram');
  } else if (!DRY_RUN) {
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
        if (stats.telegramFailed <= 5 || stats.telegramFailed % 50 === 0) {
          console.warn(`     TG err [${u.telegram}]: ${err.message}`);
        }
      }
      await sleep(TG_DELAY_MS);
      if ((i + 1) % 50 === 0) {
        console.log(`     TG progress: ${i + 1}/${withTelegram.length} processed`);
      }
    }
    console.log(`     ✓ Telegram sent: ${stats.telegram}, failed: ${stats.telegramFailed}`);
  } else {
    console.log(`     [DRY] Would send Telegram messages to ${withTelegram.length} users`);
  }

  // ── 4. Email ──────────────────────────────────────────────────────────────
  console.log(`4/4  Emails to ${withEmail.length} users...`);
  if (SKIP_EMAIL) {
    console.log('     [SKIPPED] --skip-email\n');
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
      if ((i + 1) % 25 === 0) {
        console.log(`     Email progress: ${i + 1}/${withEmail.length} processed`);
      }
    }
    console.log(`     ✓ Email sent: ${stats.email}, failed: ${stats.emailFailed}`);
  } else {
    console.log(`     [DRY] Would send emails to ${withEmail.length} users`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` BROADCAST ${DRY_RUN ? 'DRY RUN' : 'COMPLETE'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(` Target users:  ${users.length}`);
    console.log(` Telegram:      ${withTelegram.length} would receive`);
    console.log(` Email:         ${withEmail.length} would receive`);
    console.log(` Push:          up to push_subscriptions count`);
    console.log(` Promo code:    ${PROMO_CODE} (20% off, valid 14 days)`);
    console.log(` Checkout URL:  ${CHECKOUT_URL}`);
  } else {
    console.log(` In-app:   ${stats.inApp} notified`);
    console.log(` Push:     ${stats.push} delivered`);
    console.log(` Telegram: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
    console.log(` Email:    ${stats.email} sent / ${stats.emailFailed} failed`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
