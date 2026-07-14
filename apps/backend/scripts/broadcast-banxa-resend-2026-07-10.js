#!/usr/bin/env node
'use strict';

/**
 * broadcast-banxa-resend-2026-07-10.js
 *
 * Re-sends the Banxa/BTC recovery message to the 3,736 users from the
 * morning batch (banxa-btc-lifetime100-2026-07-10) via THREE channels:
 *   1. Telegram DM
 *   2. Email (users with a real email address — 837 users)
 *   3. Web Push notification
 *
 * Reuses the existing NowPayments invoice URL from each user's pending order.
 * Skips users who have already activated (active prime/pnp-member entitlement).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-resend-2026-07-10.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-resend-2026-07-10.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-resend-2026-07-10.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-resend-2026-07-10.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-resend-2026-07-10.js --skip-push
 */

const path    = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService       = require(path.join(BACKEND, 'services/pushNotificationService'));
const EmailService                  = require(path.join(BACKEND, 'services/emailservice'));
const { Telegram }                  = require('telegraf');

const DRY_RUN    = process.argv.includes('--dry-run');
const SKIP_TG    = process.argv.includes('--skip-telegram');
const SKIP_EMAIL = process.argv.includes('--skip-email');
const SKIP_PUSH  = process.argv.includes('--skip-push');

const SOURCE_BATCH = 'banxa-btc-lifetime100-2026-07-10';
const WEBAPP_URL   = (process.env.WEBAPP_URL || 'https://pnptv.app').replace(/\/$/, '');

const TG_DELAY_MS    = 150;
const EMAIL_DELAY_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEs  = lang => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

// ── Telegram message ─────────────────────────────────────────────────────────

function tgText(name, invoiceUrl, lang) {
  const n = name ? ` ${name}` : '';
  if (isEs(lang)) {
    return (
      `🔔 <b>Recordatorio — Tu enlace de pago Banxa sigue activo</b>\n\n` +
      `Hola${n}! Tu enlace personal para activar <b>Lifetime PRIME</b> por <b>$95</b> todavía está disponible.\n\n` +
      `<b>Paso 1.</b> Abre tu enlace personal:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
      `Verás una dirección Bitcoin (BTC). Cópiala.\n\n` +
      `<b>Paso 2.</b> Ve a <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
      `• Bitcoin (BTC) ya está seleccionado\n` +
      `• Pega la dirección BTC como destino\n` +
      `• Paga $95 USD con tu tarjeta de crédito o débito\n\n` +
      `<b>Paso 3.</b> ¡Listo! Tu Lifetime PRIME se activa en minutos — para siempre.\n\n` +
      `<i>¿Tienes dudas? Responde aquí y te ayudamos. 🖤</i>`
    );
  }
  return (
    `🔔 <b>Reminder — Your Banxa payment link is still active</b>\n\n` +
    `Hi${n}! Your personal link to activate <b>Lifetime PRIME</b> for <b>$95</b> is still available.\n\n` +
    `<b>Step 1.</b> Open your personal payment link:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
    `You'll see a Bitcoin (BTC) address. Copy it.\n\n` +
    `<b>Step 2.</b> Go to <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
    `• Bitcoin (BTC) is already selected\n` +
    `• Paste the BTC address as the destination\n` +
    `• Pay $95 USD with your credit or debit card\n\n` +
    `<b>Step 3.</b> Done! Your Lifetime PRIME activates within minutes — forever.\n\n` +
    `<i>Need help? Reply here. 🖤</i>`
  );
}

// ── Email HTML ────────────────────────────────────────────────────────────────

function emailHtml(invoiceUrl, lang) {
  const es = isEs(lang);
  if (es) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#111;">
<div style="font-family:Arial,sans-serif;max-width:540px;margin:32px auto;padding:28px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
  <h2 style="color:#D4007A;margin-top:0;">🔔 Tu enlace de pago Banxa sigue activo</h2>
  <p>Hola, te enviamos un recordatorio: tu enlace personal para activar <strong>Lifetime PRIME en PNPtv</strong> por <strong>$95 USD</strong> todavía está disponible.</p>
  <p>Puedes pagar con tu tarjeta de crédito o débito usando Banxa — sin necesidad de tener Bitcoin.</p>
  <div style="background:rgba(212,0,122,0.12);border-left:4px solid #D4007A;padding:18px;margin:20px 0;border-radius:6px;">
    <p style="margin:0 0 10px;font-size:14px;color:#ccc;"><strong>Paso 1</strong> — Abre tu enlace personal:</p>
    <a href="${invoiceUrl}" style="display:inline-block;padding:13px 22px;background:#D4007A;color:#fff;text-decoration:none;border-radius:7px;font-weight:bold;font-size:15px;">Abrir mi enlace de pago →</a>
    <p style="margin:10px 0 0;font-size:12px;color:#A1A1A6;">Verás una dirección Bitcoin (BTC). Cópiala.</p>
  </div>
  <p><strong>Paso 2</strong> — Ve a <a href="https://checkout.banxa.com/" style="color:#D4007A;">checkout.banxa.com</a>:<br>
  &nbsp;&nbsp;• Bitcoin (BTC) ya está seleccionado<br>
  &nbsp;&nbsp;• Pega la dirección BTC como destino<br>
  &nbsp;&nbsp;• Ingresa $95 USD y paga con tu tarjeta</p>
  <p><strong>Paso 3</strong> — ¡Listo! Tu membresía Lifetime PRIME se activa automáticamente en minutos.</p>
  <hr style="border:none;border-top:1px solid #333;margin:24px 0;">
  <p style="font-size:12px;color:#A1A1A6;">¿Tienes dudas? Responde este correo y te ayudamos de inmediato.</p>
  <p style="font-size:13px;color:#ccc;">— Equipo PNPtv 🖤</p>
</div></body></html>`;
  }
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#111;">
<div style="font-family:Arial,sans-serif;max-width:540px;margin:32px auto;padding:28px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
  <h2 style="color:#D4007A;margin-top:0;">🔔 Your Banxa payment link is still active</h2>
  <p>Hey! A quick reminder: your personal link to activate <strong>Lifetime PRIME on PNPtv</strong> for <strong>$95 USD</strong> is still available.</p>
  <p>Pay with your credit or debit card via Banxa — no crypto wallet needed.</p>
  <div style="background:rgba(212,0,122,0.12);border-left:4px solid #D4007A;padding:18px;margin:20px 0;border-radius:6px;">
    <p style="margin:0 0 10px;font-size:14px;color:#ccc;"><strong>Step 1</strong> — Open your personal link:</p>
    <a href="${invoiceUrl}" style="display:inline-block;padding:13px 22px;background:#D4007A;color:#fff;text-decoration:none;border-radius:7px;font-weight:bold;font-size:15px;">Open my payment link →</a>
    <p style="margin:10px 0 0;font-size:12px;color:#A1A1A6;">You'll see a Bitcoin (BTC) address. Copy it.</p>
  </div>
  <p><strong>Step 2</strong> — Go to <a href="https://checkout.banxa.com/" style="color:#D4007A;">checkout.banxa.com</a>:<br>
  &nbsp;&nbsp;• Bitcoin (BTC) is already selected<br>
  &nbsp;&nbsp;• Paste the BTC address as the destination<br>
  &nbsp;&nbsp;• Enter $95 USD and pay with your card</p>
  <p><strong>Step 3</strong> — Done! Your Lifetime PRIME membership activates automatically within minutes.</p>
  <hr style="border:none;border-top:1px solid #333;margin:24px 0;">
  <p style="font-size:12px;color:#A1A1A6;">Questions? Reply to this email and we'll help right away.</p>
  <p style="font-size:13px;color:#ccc;">— The PNPtv team 🖤</p>
</div></body></html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await initializePostgres();
  await PushNotificationService.initialize();

  const transporter = EmailService.transporters?.pnptv;
  if (!SKIP_EMAIL && !DRY_RUN && !transporter) {
    console.error('❌  PNPtv SMTP transporter not available — check PNPTV_SMTP_* env vars. Use --skip-email to bypass.');
    process.exit(1);
  }

  const tg = (!DRY_RUN && !SKIP_TG && process.env.BOT_TOKEN)
    ? new Telegram(process.env.BOT_TOKEN)
    : null;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PNPtv — Banxa re-broadcast — Telegram + Email + Push');
  console.log(`  Source batch : ${SOURCE_BATCH}`);
  if (DRY_RUN) console.log('  MODE         : DRY RUN — nothing will be sent');
  if (SKIP_TG)    console.log('  Telegram     : SKIPPED');
  if (SKIP_EMAIL) console.log('  Email        : SKIPPED');
  if (SKIP_PUSH)  console.log('  Push         : SKIPPED');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Fetch all morning-batch users with their existing invoice URL
  const { rows: targets } = await query(`
    SELECT DISTINCT ON (n.target_user_id)
      n.target_user_id                   AS user_id,
      u.username,
      u.first_name,
      u.telegram,
      u.email,
      u.language,
      dso.metadata->>'invoiceUrl'        AS invoice_url
    FROM notifications n
    JOIN users u ON u.id::text = n.target_user_id::text
    LEFT JOIN dash_subscription_orders dso
           ON dso.user_id::text    = n.target_user_id::text
          AND dso.metadata->>'batchId' = $1
    WHERE n.entity_type = 'broadcast'
      AND n.entity_id   = $1
      AND COALESCE(u.is_active, true) = true
      AND (u.username IS NULL OR u.username NOT LIKE 'deleted_%')
      AND COALESCE(u.tier, 'free') <> 'banned'
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id::text    = n.target_user_id::text
          AND ue.add_on_id  IN ('prime', 'pnp-member')
          AND ue.is_consumed = false
          AND (ue.is_lifetime = true OR ue.expires_at > NOW())
      )
    ORDER BY n.target_user_id, dso.created_at DESC
  `, [SOURCE_BATCH]);

  const withEmail = targets.filter(r => r.email && !r.email.includes('@telegram.pnptv.app'));

  console.log(`  Found ${targets.length} users from morning batch`);
  console.log(`  With Telegram : ${targets.filter(r => r.telegram).length}`);
  console.log(`  With email    : ${withEmail.length}`);
  console.log(`  With inv URL  : ${targets.filter(r => r.invoice_url).length}\n`);

  if (targets.length === 0) {
    console.log('  No targets — done.');
    process.exit(0);
  }

  const stats = { tg: 0, tgFail: 0, email: 0, emailFail: 0, push: 0, noInvoice: 0 };

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const { user_id, username, first_name, telegram, email, language, invoice_url } = row;
    const name      = first_name || username || null;
    const lang      = language || 'es';
    const realEmail = email && !email.includes('@telegram.pnptv.app') ? email : null;

    if ((i + 1) % 500 === 0 || i === 0) {
      console.log(`\n[${i + 1}/${targets.length}] user=${user_id} @${username || 'anon'} telegram=${telegram || '-'}`);
    }

    if (!invoice_url) {
      stats.noInvoice++;
      continue;
    }

    if (DRY_RUN) continue;

    // 1. Telegram DM
    if (!SKIP_TG && tg && telegram) {
      try {
        await tg.sendMessage(telegram, tgText(name, invoice_url, lang), { parse_mode: 'HTML' });
        stats.tg++;
      } catch (err) {
        stats.tgFail++;
      }
      await sleep(TG_DELAY_MS);
    }

    // 2. Email
    if (!SKIP_EMAIL && transporter && realEmail) {
      const es = isEs(lang);
      try {
        await transporter.sendMail({
          from: `"PNPtv" <${process.env.PNPTV_SMTP_USER || 'support@pnptv.app'}>`,
          to: realEmail,
          subject: es
            ? '🔔 Tu enlace de pago Banxa — Lifetime PRIME $95'
            : '🔔 Your Banxa payment link — Lifetime PRIME $95',
          html: emailHtml(invoice_url, lang),
        });
        stats.email++;
      } catch (err) {
        stats.emailFail++;
      }
      await sleep(EMAIL_DELAY_MS);
    }

    // 3. Push notification
    if (!SKIP_PUSH) {
      try {
        const sent = await PushNotificationService.sendToUser(user_id, {
          title: isEs(lang) ? '🔔 Tu enlace de Banxa sigue activo' : '🔔 Your Banxa link is still active',
          body: isEs(lang)
            ? 'Lifetime PRIME por $95 — paga con tarjeta vía Banxa. ¡Toca aquí!'
            : 'Lifetime PRIME for $95 — pay with your card via Banxa. Tap here!',
          url: '/lifetime100',
          icon: '/logo-192.png',
        });
        stats.push += sent;
      } catch (_) {}
    }
  }

  console.log('\n── Summary ──────────────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(`   DRY RUN — would have processed ${targets.length} user(s)`);
    console.log(`   Telegram-eligible : ${targets.filter(r => r.telegram).length}`);
    console.log(`   Email-eligible    : ${withEmail.length}`);
    console.log(`   No invoice URL    : ${targets.filter(r => !r.invoice_url).length}`);
  } else {
    console.log(`   Telegram sent     : ${stats.tg}  (failed: ${stats.tgFail})`);
    console.log(`   Emails sent       : ${stats.email}  (failed: ${stats.emailFail})`);
    console.log(`   Push deliveries   : ${stats.push}`);
    console.log(`   Skipped (no URL)  : ${stats.noInvoice}`);
  }
  console.log('─────────────────────────────────────────────────────────────────\n');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
