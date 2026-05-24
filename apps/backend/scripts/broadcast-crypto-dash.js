#!/usr/bin/env node
'use strict';

/**
 * broadcast-crypto-dash.js
 *
 * Crypto onboarding broadcast — Dash edition.
 * Targeted at members who have never used crypto. Plain-language walkthrough
 * of what Dash is, how to get it, and how to use it on PNPtv for 20% off.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-dash.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-dash.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-dash.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-dash.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-dash.js --email-only
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

const ENTITY_ID    = 'crypto-onboarding-dash-2026-05';
const CHECKOUT_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS  = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🥷 Pay with Dash — get 20% off any plan. No bank, no name, no trace. Takes 5 minutes to set up. We'll walk you through it. →`,
  es: `🥷 Paga con Dash — 20% de descuento en cualquier plan. Sin banco, sin nombre, sin rastro. Se configura en 5 minutos. Te explicamos cómo. →`,
};

const PUSH = {
  en: {
    title: '🥷 Pay with Dash — 20% off, no bank needed',
    body:  'Never used crypto? No problem. 5-minute setup, completely anonymous.',
  },
  es: {
    title: '🥷 Paga con Dash — 20% descuento, sin banco',
    body:  '¿Nunca usaste cripto? Sin problema. 5 minutos, completamente anónimo.',
  },
};

const TG = {
  en:
`🥷 <b>Pay with Dash and save 20%</b>

Never used crypto? That's exactly who this is for.

<b>What is Dash?</b>
Think of it as digital cash — like handing someone a bill, but through your phone. No bank involved. No one knows your name. No statement shows up anywhere.

<b>How to get Dash in 5 minutes:</b>
1️⃣ Download <b>Coinbase</b>, <b>Kraken</b>, or <b>Binance</b> on your phone (all free)
2️⃣ Create an account with your email
3️⃣ Buy the amount you need (Dash is usually $25–$40 per coin)
4️⃣ Go to <a href="${CHECKOUT_URL}">pnptv.app/subscribe</a> → choose your plan → tap <b>"Pay with Dash"</b>
5️⃣ Send Dash to the address shown — done. Your membership activates automatically.

<b>Why Dash on PNPtv?</b>
✅ <b>20% off</b> yearly and lifetime plans — applied automatically
✅ No bank statement, no third-party charge, no name
✅ Sends in seconds, confirms in about 2 minutes
✅ No minimum — buy exactly what you need

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`🥷 <b>Paga con Dash y ahorra 20%</b>

¿Nunca usaste cripto? Exactamente para eso es esto.

<b>¿Qué es Dash?</b>
Piénsalo como efectivo digital — como pasarle un billete a alguien, pero desde tu celular. Sin banco. Sin que nadie sepa tu nombre. Sin que aparezca en ningún estado de cuenta.

<b>Cómo conseguir Dash en 5 minutos:</b>
1️⃣ Descarga <b>Coinbase</b>, <b>Kraken</b> o <b>Binance</b> en tu celular (todos gratuitos)
2️⃣ Crea una cuenta con tu correo
3️⃣ Compra la cantidad que necesitas (Dash suele costar $25–$40 por moneda)
4️⃣ Ve a <a href="${CHECKOUT_URL}">pnptv.app/subscribe</a> → elige tu plan → toca <b>"Pagar con Dash"</b>
5️⃣ Envía Dash a la dirección que aparece — listo. Tu membresía se activa automáticamente.

<b>¿Por qué Dash en PNPtv?</b>
✅ <b>20% de descuento</b> en planes anuales y lifetime — se aplica solo
✅ Sin estado de cuenta, sin cargo de terceros, sin nombre
✅ Se envía en segundos, confirma en unos 2 minutos
✅ Sin mínimo — compra exactamente lo que necesitas

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🥷 Pay with Dash — 20% off + no bank statement (5-min setup)',
  es: '🥷 Paga con Dash — 20% descuento + sin estado de cuenta (5 min)',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Pay with Dash — 20% off' : 'Paga con Dash — 20% descuento'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(0,141,228,0.25);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#008DE4,#00c6ff,#008DE4);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            🥷 ${en ? 'Pay with Dash. Save 20%. Stay anonymous.' : 'Paga con Dash. Ahorra 20%. Quédate anónimo.'}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.5;">
            ${en
              ? 'Never used crypto before? Perfect. This is written for you.'
              : '¿Nunca usaste cripto? Perfecto. Esto está escrito para ti.'}
          </p>

          <!-- What is Dash -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="padding:18px;background:rgba(0,141,228,0.08);border:1px solid rgba(0,141,228,0.25);border-radius:12px;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#008DE4;">
                🥷 ${en ? 'What is Dash?' : '¿Qué es Dash?'}
              </p>
              <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en
                  ? 'Digital cash — like handing someone a bill, but through your phone. No bank. No name. No statement anywhere. It sends in seconds and confirms in about 2 minutes.'
                  : 'Efectivo digital — como pasarle un billete a alguien, pero desde tu celular. Sin banco. Sin nombre. Sin que aparezca en ningún estado de cuenta. Se envía en segundos y confirma en 2 minutos.'}
              </p>
            </td></tr>
          </table>

          <!-- Step by step -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? '5-minute setup:' : 'Configúralo en 5 minutos:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            ${[
              en
                ? ['1️⃣', 'Download <b>Coinbase</b>, <b>Kraken</b>, or <b>Binance</b>', 'Free on iOS & Android']
                : ['1️⃣', 'Descarga <b>Coinbase</b>, <b>Kraken</b> o <b>Binance</b>', 'Gratis en iOS y Android'],
              en
                ? ['2️⃣', 'Create an account with your email', 'Takes about 2 minutes']
                : ['2️⃣', 'Crea una cuenta con tu correo', 'Tarda unos 2 minutos'],
              en
                ? ['3️⃣', 'Buy Dash', 'Usually $25–$40 per coin — buy only what you need']
                : ['3️⃣', 'Compra Dash', 'Suele costar $25–$40 por moneda — compra solo lo que necesitas'],
              en
                ? ['4️⃣', 'Go to pnptv.app/subscribe → choose a plan → "Pay with Dash"', '20% discount applied automatically']
                : ['4️⃣', 'Ve a pnptv.app/subscribe → elige un plan → "Pagar con Dash"', 'El 20% de descuento se aplica solo'],
              en
                ? ['5️⃣', 'Send Dash to the address shown', 'Membership activates automatically when confirmed']
                : ['5️⃣', 'Envía Dash a la dirección que aparece', 'Tu membresía se activa automáticamente al confirmar'],
            ].map(([num, title, sub]) => `
            <tr><td style="padding:0 0 8px;">
              <div style="display:flex;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                <span style="font-size:16px;margin-right:12px;flex-shrink:0;">${num}</span>
                <div>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${title}</p>
                  <p style="margin:0;font-size:12px;color:#9ca3af;">${sub}</p>
                </div>
              </div>
            </td></tr>`).join('')}
          </table>

          <!-- Discount callout -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:16px;background:rgba(255,153,51,0.10);border:1px solid rgba(255,153,51,0.30);border-radius:12px;text-align:center;">
              <p style="margin:0 0 4px;font-size:22px;font-weight:900;color:#ff9933;">20% OFF</p>
              <p style="margin:0;font-size:13px;color:#d1d5db;">
                ${en
                  ? 'On all yearly and lifetime plans when you pay with Dash. Applied automatically — no codes needed.'
                  : 'En todos los planes anuales y lifetime cuando pagas con Dash. Se aplica automáticamente — sin códigos.'}
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#008DE4,#00c6ff);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">
                ${en ? 'Subscribe with Dash →' : 'Suscríbete con Dash →'}
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
          <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">🔒 Discreet · Private · pnptv.app</p>
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
  console.log(' Crypto Onboarding Broadcast — Dash');
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
