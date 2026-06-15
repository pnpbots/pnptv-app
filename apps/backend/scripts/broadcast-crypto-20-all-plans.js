#!/usr/bin/env node
'use strict';

/**
 * broadcast-crypto-20-all-plans.js
 *
 * Announces 20% off on ALL plans when paying with crypto (USDC/USDT).
 * Includes a direct link to the crypto checkout.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-20-all-plans.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-20-all-plans.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-20-all-plans.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-crypto-20-all-plans.js --skip-telegram
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

const ENTITY_ID          = 'crypto-20-all-plans-2026-06';
const APP_URL            = 'https://pnptv.app';
const CRYPTO_URL         = 'https://pnptv.app/subscribe?provider=usdc';
const TG_DELAY_MS        = 80;
const EMAIL_RATE_PER_SEC = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEn  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('en');

// ── Messages ──────────────────────────────────────────────────────────────────

const NOTIFICATION_MSG = {
  en: `🪙 20% OFF any plan when you pay with crypto (USDC/USDT). No bank needed. Instant. Anonymous. Tap to pay now →`,
  es: `🪙 20% DE DESCUENTO en cualquier plan pagando con cripto (USDC/USDT). Sin banco. Instantáneo. Anónimo. Toca para pagar →`,
};

const PUSH = {
  en: { title: '🪙 20% off — pay with crypto now', body: 'Any plan, 20% off with USDC or USDT. No bank required.' },
  es: { title: '🪙 20% de descuento — paga con cripto', body: 'Cualquier plan, 20% off con USDC o USDT. Sin banco.' },
};

const TG = {
  en: (name) =>
`🪙 <b>Hey ${name} — 20% OFF on ANY plan when you pay with crypto.</b>

Starting now, every single plan on PNPtv is 20% cheaper if you pay with USDC or USDT — that's a digital dollar that never changes in value.

━━━━━━━━━━━━━━━
💰 <b>HERE'S WHAT YOU SAVE</b>
━━━━━━━━━━━━━━━
• PRIME Week Pass ($15) → <b>$12 with crypto</b>
• PRIME Monthly ($25) → <b>$20 with crypto</b>
• PRIME Diamond ($99.99) → <b>$80 with crypto</b>
• Lifetime Pass ($250) → <b>$200 with crypto</b>

━━━━━━━━━━━━━━━
✅ <b>WHY USDC?</b>
━━━━━━━━━━━━━━━
• 1 USDC = $1 USD, always — no price swings
• No bank statement, 100% private
• Works with Coinbase, Binance, Trust Wallet
• Takes less than 5 minutes to set up

━━━━━━━━━━━━━━━

👉 <b>Pay now with 20% off:</b>
<a href="${CRYPTO_URL}">${CRYPTO_URL}</a>

Select any plan, choose Crypto (USDC/USDT), and save instantly. 🖤`,

  es: (name) =>
`🪙 <b>¡Hola ${name}! 20% DE DESCUENTO en CUALQUIER plan pagando con cripto.</b>

Desde ahora, todos los planes de PNPtv tienen 20% de descuento si pagas con USDC o USDT — un dólar digital que nunca cambia de valor.

━━━━━━━━━━━━━━━
💰 <b>LO QUE AHORRAS</b>
━━━━━━━━━━━━━━━
• PRIME Semana ($15) → <b>$12 con cripto</b>
• PRIME Mensual ($25) → <b>$20 con cripto</b>
• PRIME Diamond ($99.99) → <b>$80 con cripto</b>
• Pase Lifetime ($250) → <b>$200 con cripto</b>

━━━━━━━━━━━━━━━
✅ <b>¿POR QUÉ USDC?</b>
━━━━━━━━━━━━━━━
• 1 USDC = $1 USD, siempre — sin fluctuaciones
• Sin estado de cuenta bancario, 100% privado
• Funciona con Coinbase, Binance, Trust Wallet
• Se configura en menos de 5 minutos

━━━━━━━━━━━━━━━

👉 <b>Paga ahora con 20% de descuento:</b>
<a href="${CRYPTO_URL}">${CRYPTO_URL}</a>

Elige cualquier plan, selecciona Cripto (USDC/USDT), y ahorra al instante. 🖤`,
};

const EMAIL_SUBJECT = {
  en: '🪙 20% OFF any PNPtv plan — pay with crypto now',
  es: '🪙 20% de descuento en cualquier plan — paga con cripto ahora',
};

function buildEmailHtml(lang, name) {
  const en = lang === 'en';
  const greeting = en ? `Hey ${name}!` : `¡Hola ${name}!`;

  const plans = en ? [
    ['PRIME Week Pass', '$15', '$12'],
    ['PRIME Monthly', '$25', '$20'],
    ['PRIME Diamond (1 Year)', '$99.99', '$80'],
    ['Lifetime Pass', '$250', '$200'],
  ] : [
    ['PRIME Semana', '$15', '$12'],
    ['PRIME Mensual', '$25', '$20'],
    ['PRIME Diamond (1 Año)', '$99.99', '$80'],
    ['Pase Lifetime', '$250', '$200'],
  ];

  const benefits = en ? [
    ['🏦', '1 USDC = $1 USD always', 'No price swings. Stable as a bank account.'],
    ['🕵️', '100% private', 'No bank statement. Your business stays yours.'],
    ['⚡', 'Instant activation', 'Payment confirms in minutes, access unlocks immediately.'],
    ['📱', 'Easy to set up', 'Coinbase, Binance, or Trust Wallet — takes 5 minutes.'],
  ] : [
    ['🏦', '1 USDC = $1 USD siempre', 'Sin fluctuaciones. Estable como una cuenta bancaria.'],
    ['🕵️', '100% privado', 'Sin estado de cuenta bancario. Tu privacidad es tuya.'],
    ['⚡', 'Activación instantánea', 'El pago confirma en minutos, el acceso se activa de inmediato.'],
    ['📱', 'Fácil de configurar', 'Coinbase, Binance, o Trust Wallet — 5 minutos.'],
  ];

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${en ? '20% off — pay with crypto' : '20% descuento — paga con cripto'}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.10);">
        <tr><td style="height:4px;background:linear-gradient(90deg,#f59e0b,#26a17b);"></td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:24px;font-weight:900;color:#ffffff;">PNPtv!</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;">
          <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">${greeting}</p>
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#ffffff;line-height:1.2;">
            🪙 ${en ? '20% off any plan — pay with crypto.' : '20% de descuento en cualquier plan — paga con cripto.'}
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">
            ${en
              ? 'Every single PNPtv plan is now 20% cheaper when you pay with USDC or USDT. That\'s a digital dollar — 1 USDC = $1, always. No bank statement, no hassle.'
              : 'Todos los planes de PNPtv ahora tienen 20% de descuento si pagas con USDC o USDT. Un dólar digital — 1 USDC = $1, siempre. Sin banco, sin complicaciones.'}
          </p>

          <!-- Savings table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid rgba(245,158,11,0.3);border-radius:12px;overflow:hidden;">
            <tr style="background:rgba(245,158,11,0.12);">
              <td style="padding:10px 14px;font-size:12px;font-weight:800;color:#f59e0b;text-transform:uppercase;letter-spacing:0.05em;">${en ? 'Plan' : 'Plan'}</td>
              <td style="padding:10px 14px;font-size:12px;font-weight:800;color:#9ca3af;text-align:right;text-decoration:line-through;">${en ? 'Card' : 'Tarjeta'}</td>
              <td style="padding:10px 14px;font-size:12px;font-weight:800;color:#26a17b;text-align:right;">${en ? 'With Crypto' : 'Con Cripto'}</td>
            </tr>
            ${plans.map(([plan, orig, crypto], i) => `
            <tr style="${i % 2 === 0 ? 'background:rgba(255,255,255,0.02)' : ''}">
              <td style="padding:10px 14px;font-size:13px;color:#ffffff;">${plan}</td>
              <td style="padding:10px 14px;font-size:13px;color:#6b7280;text-align:right;text-decoration:line-through;">${orig}</td>
              <td style="padding:10px 14px;font-size:14px;font-weight:900;color:#26a17b;text-align:right;">${crypto}</td>
            </tr>`).join('')}
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="${CRYPTO_URL}" style="display:inline-block;padding:18px 48px;background:linear-gradient(90deg,#f59e0b,#26a17b);color:#000000;font-size:16px;font-weight:900;text-decoration:none;border-radius:12px;letter-spacing:0.03em;">
                ${en ? 'Pay with Crypto — Save 20% →' : 'Pagar con Cripto — Ahorra 20% →'}
              </a>
            </td></tr>
          </table>

          <!-- Why USDC -->
          <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#ffffff;">${en ? 'Why USDC?' : '¿Por qué USDC?'}</p>
          ${benefits.map(([emoji, title, body]) => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr><td style="padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;">
              <p style="margin:0 0 2px;font-size:13px;font-weight:800;color:#ffffff;">${emoji} ${title}</p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">${body}</p>
            </td></tr>
          </table>`).join('')}

          <p style="margin:20px 0 0;font-size:13px;color:#6b7280;text-align:center;line-height:1.6;">
            ${en
              ? 'Don\'t know how to get USDC? <a href="https://pnptv.app/crypto-guide" style="color:#26a17b;">Read our quick guide →</a>'
              : '¿No sabes cómo obtener USDC? <a href="https://pnptv.app/crypto-guide" style="color:#26a17b;">Lee nuestra guía rápida →</a>'}
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0;font-size:11px;color:#6b7280;">
            ${en ? 'You received this as a member of PNPtv!.' : 'Recibiste esto por ser miembro de PNPtv!.'}
            🔒 Encrypted · Discreet · pnptv.app
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
  console.log(' Crypto 20% All Plans Broadcast — June 2026');
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
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
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
        `, [ids, ENTITY_ID, msg, JSON.stringify({ url: CRYPTO_URL })]);
        stats.inApp += ids.length;
      }
      console.log(`     ✓ ${stats.inApp} inserted/upserted`);
    } catch (err) { console.error(`     ✗ ${err.message}`); }
  } else {
    console.log(`     [DRY] Would notify ${users.length} users`);
  }

  // 2. Web push
  console.log('2/4  Web push...');
  if (!DRY_RUN) {
    try {
      PushNotificationService.initialize();
      const enIds = users.filter(u =>  isEn(u.language)).map(u => u.id);
      const esIds = users.filter(u => !isEn(u.language)).map(u => u.id);
      let pushSent = 0;
      if (enIds.length) pushSent += await PushNotificationService.sendToUsers(enIds, { ...PUSH.en, url: CRYPTO_URL, tag: ENTITY_ID });
      if (esIds.length) pushSent += await PushNotificationService.sendToUsers(esIds, { ...PUSH.es, url: CRYPTO_URL, tag: ENTITY_ID });
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
      const msg = TG[lang](name);
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
    console.log(`     ✓ TG: ${stats.telegram} sent / ${stats.telegramFailed} failed`);
  } else if (DRY_RUN) {
    console.log(`     [DRY] Would send to ${withTelegram.length} users`);
    console.log('\n── Sample TG message (ES) ──\n');
    console.log(TG.es('Amigo'));
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
          from: `"PNPtv!" <${process.env.PNPTV_SMTP_USER}>`,
          to: u.email,
          subject: EMAIL_SUBJECT[lang],
          html: buildEmailHtml(lang, name),
        }, (err) => {
          completed++;
          if (err) {
            failed++;
            if (failed <= 5 || failed % 50 === 0) console.warn(`     Email err [${u.email}]: ${err.message}`);
          } else { sent++; }
          if (completed % 100 === 0) console.log(`     Email progress: ${completed}/${withEmail.length}`);
          if (completed === withEmail.length) {
            stats.email = sent;
            stats.emailFailed = failed;
            transporter.close();
            resolveAll();
          }
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
