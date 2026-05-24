#!/usr/bin/env node
'use strict';

/**
 * broadcast-crypto-usdc.js
 *
 * Crypto onboarding broadcast — USDC edition.
 * Targeted at members who have never used crypto. Plain-language walkthrough
 * of what USDC is, how to get it, and how to use NOWPayments checkout for 20% off.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-usdc.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-usdc.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-usdc.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-usdc.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-usdc.js --email-only
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

const ENTITY_ID    = 'crypto-onboarding-usdc-2026-05';
const CHECKOUT_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS  = 80;
const EMAIL_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🪙 Pay with USDC — get 20% off. It's a digital dollar: 1 USDC = $1, always. No bank statement. Takes 5 minutes to set up. →`,
  es: `🪙 Paga con USDC — 20% de descuento. Es un dólar digital: 1 USDC = $1, siempre. Sin estado de cuenta. Se configura en 5 minutos. →`,
};

const PUSH = {
  en: {
    title: '🪙 Pay with USDC — 20% off, 1 USDC = $1 always',
    body:  'The safest crypto for beginners. No price swings. 100% anonymous.',
  },
  es: {
    title: '🪙 Paga con USDC — 20% descuento, 1 USDC = $1 siempre',
    body:  'El cripto más seguro para principiantes. Sin cambios de precio. 100% anónimo.',
  },
};

const TG = {
  en:
`🪙 <b>Pay with USDC and save 20%</b>

If crypto has ever felt risky or confusing — USDC is different. Here's why.

<b>What is USDC?</b>
It's a dollar. A digital dollar. <b>1 USDC = $1 USD — always.</b> It doesn't go up or down in value like Bitcoin. What you put in is exactly what you get. No surprises.

<b>Why is this better than a card for PNPtv?</b>
🔒 <b>Zero trace</b> — no bank statement, no third-party charge, no name attached
💰 <b>20% off</b> on yearly and lifetime plans — automatically
🌎 <b>Works from any country</b> — no card declines, no geo-blocks
⚡ <b>Instant checkout</b> — NOWPayments handles everything, you just confirm

<b>How to get USDC in 5 minutes:</b>
1️⃣ Download <b>Coinbase</b> (easiest for beginners) or <b>Kraken</b> / <b>Binance</b>
2️⃣ Create a free account with your email
3️⃣ Buy USDC — it costs exactly $1 per token, buy what you need for your plan
4️⃣ Go to <a href="${CHECKOUT_URL}">pnptv.app/subscribe</a> → pick your plan → tap <b>"Pay with USDC"</b>
5️⃣ A secure NOWPayments page opens — send your USDC there → membership activates

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,

  es:
`🪙 <b>Paga con USDC y ahorra 20%</b>

Si el cripto te ha parecido arriesgado o confuso — USDC es diferente. Aquí te explicamos por qué.

<b>¿Qué es USDC?</b>
Es un dólar. Un dólar digital. <b>1 USDC = $1 USD — siempre.</b> No sube ni baja como el Bitcoin. Lo que pones es exactamente lo que obtienes. Sin sorpresas.

<b>¿Por qué es mejor que una tarjeta para PNPtv?</b>
🔒 <b>Sin rastro</b> — sin estado de cuenta, sin cargo de terceros, sin nombre
💰 <b>20% de descuento</b> en planes anuales y lifetime — automáticamente
🌎 <b>Funciona desde cualquier país</b> — sin rechazos de tarjeta, sin bloqueos
⚡ <b>Checkout instantáneo</b> — NOWPayments se encarga de todo, tú solo confirmas

<b>Cómo conseguir USDC en 5 minutos:</b>
1️⃣ Descarga <b>Coinbase</b> (el más fácil para principiantes) o <b>Kraken</b> / <b>Binance</b>
2️⃣ Crea una cuenta gratis con tu correo
3️⃣ Compra USDC — cuesta exactamente $1 por token, compra lo que necesitas para tu plan
4️⃣ Ve a <a href="${CHECKOUT_URL}">pnptv.app/subscribe</a> → elige tu plan → toca <b>"Pagar con USDC"</b>
5️⃣ Se abre una página segura de NOWPayments — envía tu USDC ahí → tu membresía se activa

👉 <a href="${CHECKOUT_URL}">${CHECKOUT_URL}</a>`,
};

const EMAIL_SUBJECT = {
  en: '🪙 Pay with USDC — 20% off + no bank statement (1 USDC = $1, always)',
  es: '🪙 Paga con USDC — 20% descuento + sin estado de cuenta (1 USDC = $1, siempre)',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? 'Pay with USDC — 20% off' : 'Paga con USDC — 20% descuento'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(38,161,123,0.25);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#26a17b,#00d4aa,#26a17b);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">
            🪙 ${en ? 'Pay with USDC — a digital dollar that\'s always worth $1.' : 'Paga con USDC — un dólar digital que siempre vale $1.'}
          </h1>
          <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.5;">
            ${en
              ? 'The safest intro to crypto. No price swings. No confusion. Just a dollar — but private.'
              : 'La mejor introducción al cripto. Sin cambios de precio. Sin confusión. Solo un dólar — pero privado.'}
          </p>

          <!-- USDC explanation -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td style="padding:18px;background:rgba(38,161,123,0.08);border:1px solid rgba(38,161,123,0.25);border-radius:12px;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#26a17b;">
                🪙 ${en ? 'What makes USDC different?' : '¿Qué hace diferente a USDC?'}
              </p>
              <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">
                ${en
                  ? '<b>1 USDC = 1 USD — always.</b> Unlike Bitcoin or other crypto, USDC doesn\'t swing in value. You buy $30 of USDC, you have $30 to spend. Simple.'
                  : '<b>1 USDC = 1 USD — siempre.</b> A diferencia del Bitcoin u otro cripto, USDC no varía de valor. Compras $30 de USDC, tienes $30 para gastar. Así de simple.'}
              </p>
            </td></tr>
          </table>

          <!-- Benefits grid -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? 'Why pay with USDC on PNPtv:' : 'Por qué pagar con USDC en PNPtv:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              <td width="50%" style="padding:0 6px 10px 0;">
                <div style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
                  <p style="margin:0 0 4px;font-size:18px;">🔒</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${en ? 'Zero trace' : 'Sin rastro'}</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'No bank statement, no name' : 'Sin estado de cuenta, sin nombre'}</p>
                </div>
              </td>
              <td width="50%" style="padding:0 0 10px 6px;">
                <div style="padding:14px;background:rgba(255,153,51,0.06);border:1px solid rgba(255,153,51,0.25);border-radius:10px;position:relative;">
                  <p style="margin:0 0 4px;font-size:18px;">💰</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ff9933;">${en ? '20% off' : '20% descuento'}</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'Yearly & lifetime plans' : 'Planes anuales y lifetime'}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td width="50%" style="padding:0 6px 0 0;">
                <div style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
                  <p style="margin:0 0 4px;font-size:18px;">🌎</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${en ? 'Any country' : 'Cualquier país'}</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'No card declines, no geo-blocks' : 'Sin rechazos de tarjeta'}</p>
                </div>
              </td>
              <td width="50%" style="padding:0 0 0 6px;">
                <div style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
                  <p style="margin:0 0 4px;font-size:18px;">⚡</p>
                  <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${en ? 'Instant checkout' : 'Checkout instantáneo'}</p>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">${en ? 'NOWPayments handles it' : 'NOWPayments lo gestiona'}</p>
                </div>
              </td>
            </tr>
          </table>

          <!-- Step by step -->
          <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#ffffff;">
            ${en ? '5-minute setup:' : 'Configúralo en 5 minutos:'}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${[
              en
                ? ['1️⃣', 'Download <b>Coinbase</b> (easiest for beginners)', 'Or Kraken / Binance — all free on iOS & Android']
                : ['1️⃣', 'Descarga <b>Coinbase</b> (el más fácil)', 'O Kraken / Binance — todos gratis en iOS y Android'],
              en
                ? ['2️⃣', 'Create a free account with your email', 'Takes about 2 minutes']
                : ['2️⃣', 'Crea una cuenta gratis con tu correo', 'Tarda unos 2 minutos'],
              en
                ? ['3️⃣', 'Buy USDC — costs exactly $1 per token', 'Buy the amount for your plan (e.g. $10/mo → buy 10 USDC)']
                : ['3️⃣', 'Compra USDC — cuesta exactamente $1 por token', 'Compra lo que necesitas (ej: $10/mes → compra 10 USDC)'],
              en
                ? ['4️⃣', 'Go to pnptv.app/subscribe → choose a plan → "Pay with USDC"', '20% discount applied automatically']
                : ['4️⃣', 'Ve a pnptv.app/subscribe → elige un plan → "Pagar con USDC"', 'El 20% de descuento se aplica solo'],
              en
                ? ['5️⃣', 'A secure NOWPayments page opens — send USDC', 'Membership activates automatically when confirmed']
                : ['5️⃣', 'Se abre una página segura de NOWPayments — envía USDC', 'Tu membresía se activa automáticamente al confirmar'],
            ].map(([num, title, sub]) => `
            <tr><td style="padding:0 0 8px;">
              <div style="padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                <span style="font-size:16px;">${num}</span>
                <p style="margin:4px 0 2px;font-size:13px;font-weight:700;color:#ffffff;">${title}</p>
                <p style="margin:0;font-size:12px;color:#9ca3af;">${sub}</p>
              </div>
            </td></tr>`).join('')}
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${CHECKOUT_URL}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#26a17b,#00d4aa);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.05em;">
                ${en ? 'Subscribe with USDC →' : 'Suscríbete con USDC →'}
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
  console.log(' Crypto Onboarding Broadcast — USDC');
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
