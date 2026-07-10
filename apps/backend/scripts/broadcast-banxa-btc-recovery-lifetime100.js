#!/usr/bin/env node
'use strict';

/**
 * broadcast-banxa-btc-recovery-lifetime100.js
 *
 * Two modes:
 *
 * RECOVERY MODE (default):
 *   Targets users who had a failed/abandoned/expired lifetime100 payment and
 *   still have no active entitlement.
 *
 * ALL-USERS MODE (--all-users):
 *   Targets every active user without an active PRIME/pnp-member entitlement,
 *   regardless of prior payment attempts. Excludes anyone already messaged by
 *   any prior banxa broadcast batch.
 *
 * For each user the script:
 *   1. Creates a personal NowPayments hosted invoice for $95 USD paid in BTC
 *   2. Stores the order in dash_subscription_orders (webhook auto-activates on payment)
 *   3. Sends an in-app DM from pnptv-official with step-by-step Banxa instructions
 *   4. Sends a Telegram DM (if telegram linked)
 *
 * The Banxa flow the user follows:
 *   a) Click the personal "Buy Now" link → NowPayments page shows a BTC address
 *   b) Copy that BTC address
 *   c) Open https://checkout.banxa.com/ → BTC is pre-selected
 *   d) Paste the BTC address as the destination, pay $95 with card
 *   e) Banxa sends BTC to that address → NowPayments fires IPN → account activates
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --all-users
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --all-users --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --skip-telegram
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --skip-dm
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --window-hours=48
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --batch-suffix=v2
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-banxa-btc-recovery-lifetime100.js --all-users --resend
 */

const path    = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const sendSystemDM                  = require(path.join(BACKEND, 'services/sendSystemDM'));
const { Telegram }                  = require('telegraf');
const axios                         = require('axios');

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_TG       = process.argv.includes('--skip-telegram');
const SKIP_DM       = process.argv.includes('--skip-dm');
const ALL_USERS     = process.argv.includes('--all-users');
const RESEND        = process.argv.includes('--resend');
const ANNUAL        = process.argv.includes('--annual');

const windowArg     = process.argv.find(a => a.startsWith('--window-hours='));
const WINDOW_HOURS  = windowArg ? parseInt(windowArg.split('=')[1], 10) : 168;

const suffixArg     = process.argv.find(a => a.startsWith('--batch-suffix='));
const BATCH_SUFFIX  = suffixArg ? `-${suffixArg.split('=')[1]}` : '';
const BATCH_PREFIX  = ANNUAL ? 'banxa-btc-annual50'
  : RESEND ? 'banxa-btc-resend'
  : ALL_USERS ? 'banxa-btc-allcast'
  : 'banxa-btc-lifetime100';
const BATCH_ID      = `${BATCH_PREFIX}-${new Date().toISOString().slice(0, 10)}${BATCH_SUFFIX}`;

const PLAN_ID       = ANNUAL ? 'prime-annual-50' : 'lifetime100';
const PLAN_AMOUNT   = ANNUAL ? 50.00 : 95.00;
const PLAN_NAME     = ANNUAL ? 'PRIME 1 Year — $50 (BTC via Banxa)' : 'Lifetime PRIME — $95 (BTC via Banxa)';
const WEBAPP_URL    = (process.env.WEBAPP_URL || 'https://pnptv.app').replace(/\/$/, '');
const SYSTEM_SENDER = '8552451957';

const NOWPAYMENTS_URL     = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';

const API_DELAY_MS = 300;
const TG_DELAY_MS  = 120;
const DM_DELAY_MS  = 80;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEs  = lang => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

// ── Messages: recovery mode ───────────────────────────────────────────────────

function dmTextRecovery(invoiceUrl, lang) {
  if (isEs(lang)) {
    return `🎥 *PNP Live ya está aquí — y tú te lo estás perdiendo*

Acaban de llegar los streams en vivo a PNPtv: webcams en tiempo real de creadores de la comunidad, directamente en la app. Contenido explícito, sin filtros, desde la intimidad de sus cuartos — y tú puedes verlo ahora mismo como miembro PRIME.

Notamos que tu pago anterior no se completó. No hay problema — te preparamos una nueva forma de pagar con tarjeta que funciona sin criptomonedas propias.

*¡Solo 4 pasos y activas tu Lifetime PRIME por $95:*

*Paso 1 — Abre tu pago personal:*
👉 ${invoiceUrl}
Se abrirá una página con tu dirección de Bitcoin (BTC).

*Paso 2 — Copia la dirección BTC:*
Verás una dirección larga que empieza con bc1... Cópiala tal cual.

*Paso 3 — Ve a Banxa y paga con tarjeta:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) ya está seleccionado
• Pega la dirección BTC como destino
• Ingresa $95 USD y paga con tu tarjeta de crédito o débito

*Paso 4 — ¡Listo!*
En minutos tu cuenta se activa. Entra a PNPtv, ve a la sección Live y únete al stream. Para siempre, con un solo pago.

¿Algún problema en algún paso? Responde aquí y te ayudamos al instante. 🖤

— PNPtv`;
  }
  return `🎥 *PNP Live is here — and you're missing it*

Live webcam streams just launched on PNPtv: real-time cams from community creators, right inside the app. Explicit, unfiltered, straight from their rooms — and you can watch right now as a PRIME member.

We noticed your previous payment didn't go through. No worries — we set up a new way to pay with your card, no crypto wallet needed.

*4 steps to activate your Lifetime PRIME for $95:*

*Step 1 — Open your personal payment link:*
👉 ${invoiceUrl}
A page will open showing your Bitcoin (BTC) address.

*Step 2 — Copy the BTC address:*
You'll see a long address starting with bc1... Copy it exactly.

*Step 3 — Go to Banxa and pay with your card:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) is already selected by default
• Paste the BTC address as the destination
• Enter $95 USD and pay with your credit or debit card

*Step 4 — Done!*
Within minutes your account activates. Open PNPtv, go to Live, and jump in. Forever, one payment.

Any issues? Reply here and we'll sort it out immediately. 🖤

— PNPtv`;
}

function tgTextRecovery(name, invoiceUrl, lang) {
  const n = name ? ` ${name}` : '';
  if (isEs(lang)) {
    return (
      `🎥 <b>PNP Live ya está aquí — streams en vivo en PNPtv</b>\n\n` +
      `Hola${n}! Webcams en tiempo real de creadores de la comunidad, directo en la app. Solo los PRIME pueden verlos.\n\n` +
      `Tu pago anterior no se completó. Aquí la solución — sin necesidad de tener criptos propias:\n\n` +
      `<b>Paso 1.</b> Abre tu link personal:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
      `Verás una dirección Bitcoin (BTC). Cópiala.\n\n` +
      `<b>Paso 2.</b> Ve a <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
      `• BTC ya está seleccionado\n` +
      `• Pega la dirección BTC como destino\n` +
      `• Paga $95 con tu tarjeta\n\n` +
      `<b>Paso 3.</b> ¡Listo! Tu Lifetime PRIME se activa en minutos. Entra al Live y únete.\n\n` +
      `<i>¿Tienes dudas? Escríbenos aquí. 🖤</i>`
    );
  }
  return (
    `🎥 <b>PNP Live is here — live webcam streams on PNPtv</b>\n\n` +
    `Hi${n}! Real-time cams from community creators, live inside the app. PRIME members only.\n\n` +
    `Your previous payment didn't go through. Here's how to complete it — no crypto wallet needed:\n\n` +
    `<b>Step 1.</b> Open your personal payment link:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
    `You'll see a Bitcoin (BTC) address. Copy it.\n\n` +
    `<b>Step 2.</b> Go to <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
    `• BTC is already selected by default\n` +
    `• Paste the BTC address as the destination\n` +
    `• Pay $95 with your card\n\n` +
    `<b>Step 3.</b> Done! Your Lifetime PRIME activates within minutes. Go to Live and join.\n\n` +
    `<i>Need help? Reply here. 🖤</i>`
  );
}

// ── Messages: all-users mode ──────────────────────────────────────────────────

function dmTextAllUsers(invoiceUrl, lang) {
  if (isEs(lang)) {
    return `🌟 *Oferta especial — Hazte PRIME de por vida por solo $95 USD*

Hola, queremos darte la oportunidad de unirte a PNPtv como miembro Lifetime PRIME con un solo pago de $95.

¿No tienes criptomonedas? No te preocupes — puedes pagar con tu tarjeta de crédito o débito usando Banxa. Es simple:

*Paso 1 — Abre tu enlace personal:*
👉 ${invoiceUrl}
Se abrirá una página con tu dirección de Bitcoin (BTC).

*Paso 2 — Copia la dirección BTC:*
Verás una dirección larga que empieza con bc1... Cópiala tal cual.

*Paso 3 — Ve a Banxa y paga con tarjeta:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) ya está seleccionado
• Pega la dirección BTC como destino
• Ingresa $95 USD y paga con tu tarjeta

*Paso 4 — ¡Listo!*
En minutos tu membresía Lifetime PRIME se activa automáticamente. Acceso completo, para siempre.

¿Dudas? Escríbenos aquí y te ayudamos. 🖤

— PNPtv`;
  }
  return `🌟 *Special offer — Go Lifetime PRIME for just $95 USD*

Hey! We'd love to have you as a Lifetime PRIME member — one payment of $95, full access forever.

No crypto? No problem — you can pay with your credit or debit card using Banxa:

*Step 1 — Open your personal payment link:*
👉 ${invoiceUrl}
A page will open showing your Bitcoin (BTC) address.

*Step 2 — Copy the BTC address:*
You'll see a long address starting with bc1... Copy it exactly.

*Step 3 — Go to Banxa and pay with your card:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) is already selected
• Paste the BTC address as the destination
• Enter $95 USD and pay with your card

*Step 4 — Done!*
Within minutes your Lifetime PRIME membership activates automatically. Full access, forever.

Any questions? Reply here and we'll help you. 🖤

— PNPtv`;
}

function tgTextAllUsers(name, invoiceUrl, lang) {
  const n = name ? ` ${name}` : '';
  if (isEs(lang)) {
    return (
      `🌟 <b>Oferta especial — Lifetime PRIME por $95 con tarjeta</b>\n\n` +
      `Hola${n}! Un solo pago de $95 y tienes acceso completo a PNPtv para siempre.\n\n` +
      `Paga con tu tarjeta de crédito o débito vía Banxa:\n\n` +
      `<b>Paso 1.</b> Abre tu link personal:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
      `Verás una dirección Bitcoin (BTC). Cópiala.\n\n` +
      `<b>Paso 2.</b> Ve a <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
      `• BTC ya está seleccionado\n` +
      `• Pega la dirección BTC como destino\n` +
      `• Paga $95 con tu tarjeta\n\n` +
      `<b>Paso 3.</b> ¡Listo! Tu membresía PRIME se activa en minutos.\n\n` +
      `<i>¿Tienes dudas? Escríbenos aquí. 🖤</i>`
    );
  }
  return (
    `🌟 <b>Special offer — Lifetime PRIME for $95 with your card</b>\n\n` +
    `Hi${n}! One payment of $95 and you get full access to PNPtv forever.\n\n` +
    `Pay with your credit or debit card via Banxa:\n\n` +
    `<b>Step 1.</b> Open your personal payment link:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
    `You'll see a Bitcoin (BTC) address. Copy it.\n\n` +
    `<b>Step 2.</b> Go to <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
    `• BTC is already selected\n` +
    `• Paste the BTC address as the destination\n` +
    `• Pay $95 with your card\n\n` +
    `<b>Step 3.</b> Done! Your PRIME membership activates within minutes.\n\n` +
    `<i>Need help? Reply here. 🖤</i>`
  );
}

// ── Messages: annual $50 mode ─────────────────────────────────────────────────

function dmTextAnnual(invoiceUrl, lang) {
  if (isEs(lang)) {
    return `🌟 *Oferta exclusiva — 1 año de PRIME por solo $50 USD*

Hola, tenemos una oferta especial solo para ti: acceso PRIME completo durante 1 año entero, por un único pago de $50.

¿No tienes criptomonedas? Sin problema — puedes pagar con tu tarjeta de crédito o débito usando Banxa:

*Paso 1 — Abre tu enlace personal:*
👉 ${invoiceUrl}
Se abrirá una página con tu dirección de Bitcoin (BTC).

*Paso 2 — Copia la dirección BTC:*
Verás una dirección larga que empieza con bc1... Cópiala tal cual.

*Paso 3 — Ve a Banxa y paga con tarjeta:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) ya está seleccionado
• Pega la dirección BTC como destino
• Ingresa $50 USD y paga con tu tarjeta

*Paso 4 — ¡Listo!*
En minutos tu membresía PRIME de 1 año se activa automáticamente.

¿Dudas? Escríbenos aquí. 🖤

— PNPtv`;
  }
  return `🌟 *Exclusive offer — 1 year of PRIME for just $50 USD*

Hey! We have a special offer just for you: full PRIME access for an entire year, for a single payment of $50.

No crypto? No problem — pay with your credit or debit card via Banxa:

*Step 1 — Open your personal payment link:*
👉 ${invoiceUrl}
A page will open showing your Bitcoin (BTC) address.

*Step 2 — Copy the BTC address:*
You'll see a long address starting with bc1... Copy it exactly.

*Step 3 — Go to Banxa and pay with your card:*
🌐 https://checkout.banxa.com/
• Bitcoin (BTC) is already selected
• Paste the BTC address as the destination
• Enter $50 USD and pay with your card

*Step 4 — Done!*
Within minutes your 1-year PRIME membership activates automatically.

Any questions? Reply here. 🖤

— PNPtv`;
}

function tgTextAnnual(name, invoiceUrl, lang) {
  const n = name ? ` ${name}` : '';
  if (isEs(lang)) {
    return (
      `🌟 <b>Oferta exclusiva — 1 año de PRIME por $50 con tarjeta</b>\n\n` +
      `Hola${n}! Acceso PRIME completo durante todo un año por solo $50 — un único pago con tu tarjeta.\n\n` +
      `<b>Paso 1.</b> Abre tu link personal:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
      `Verás una dirección Bitcoin (BTC). Cópiala.\n\n` +
      `<b>Paso 2.</b> Ve a <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
      `• BTC ya está seleccionado\n` +
      `• Pega la dirección BTC como destino\n` +
      `• Paga $50 con tu tarjeta\n\n` +
      `<b>Paso 3.</b> ¡Listo! Tu membresía PRIME de 1 año se activa en minutos.\n\n` +
      `<i>¿Tienes dudas? Escríbenos aquí. 🖤</i>`
    );
  }
  return (
    `🌟 <b>Exclusive offer — 1 year PRIME for $50 with your card</b>\n\n` +
    `Hi${n}! Full PRIME access for an entire year — just $50, one payment with your card.\n\n` +
    `<b>Step 1.</b> Open your personal payment link:\n👉 <a href="${invoiceUrl}">${invoiceUrl}</a>\n` +
    `You'll see a Bitcoin (BTC) address. Copy it.\n\n` +
    `<b>Step 2.</b> Go to <a href="https://checkout.banxa.com/">checkout.banxa.com</a>\n` +
    `• BTC is already selected\n` +
    `• Paste the BTC address as the destination\n` +
    `• Pay $50 with your card\n\n` +
    `<b>Step 3.</b> Done! Your 1-year PRIME membership activates within minutes.\n\n` +
    `<i>Need help? Reply here. 🖤</i>`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await initializePostgres();

  if (!NOWPAYMENTS_API_KEY) {
    console.error('❌  NOWPAYMENTS_API_KEY not set — aborting');
    process.exit(1);
  }

  const tg = (!DRY_RUN && !SKIP_TG && process.env.BOT_TOKEN)
    ? new Telegram(process.env.BOT_TOKEN)
    : null;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  PNPtv — Banxa/BTC broadcast — ${ALL_USERS ? 'ALL USERS' : 'recovery'}`);
  console.log(`  Batch   : ${BATCH_ID}`);
  if (!ALL_USERS) console.log(`  Window  : last ${WINDOW_HOURS} hours`);
  console.log(`  Amount  : $${PLAN_AMOUNT} USD in BTC via NowPayments → Banxa`);
  if (DRY_RUN) console.log('  MODE    : DRY RUN — nothing will be sent or created');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let targets;

  if (ALL_USERS) {
    // All active users without prime, excluding anyone already messaged by ANY banxa batch
    const { rows } = await query(`
      SELECT DISTINCT ON (u.id)
        u.id        AS user_id,
        u.username,
        u.first_name,
        u.telegram,
        u.email,
        u.language
      FROM users u
      WHERE COALESCE(u.is_active, true) = true
        AND (u.username IS NULL OR u.username NOT LIKE 'deleted_%')
        AND COALESCE(u.tier, 'free') <> 'banned'
        AND NOT EXISTS (
          SELECT 1 FROM user_entitlements ue
          WHERE ue.user_id::text = u.id::text
            AND ue.add_on_id IN ('prime', 'pnp-member')
            AND ue.is_consumed = false
            AND (ue.is_lifetime = true OR ue.expires_at > NOW())
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.entity_type = 'broadcast'
            AND n.entity_id LIKE '${RESEND ? BATCH_ID + '%' : ANNUAL ? 'banxa-btc-annual50%' : 'banxa-btc-%'}'
            AND n.target_user_id::text = u.id::text
        )
      ORDER BY u.id
    `);
    targets = rows;
  } else {
    const { rows } = await query(`
      SELECT DISTINCT ON (dso.user_id)
        dso.user_id,
        dso.id                            AS order_id,
        dso.btcpay_invoice_id             AS original_order_id,
        dso.metadata->>'provider'         AS provider,
        dso.status                        AS payment_status,
        dso.created_at                    AS last_attempt,
        u.username,
        u.first_name,
        u.telegram,
        u.email,
        u.language
      FROM dash_subscription_orders dso
      JOIN users u ON u.id::text = dso.user_id::text
      WHERE dso.plan_id      = 'lifetime100'
        AND dso.status       IN ('expired', 'failed', 'pending', 'cancelled')
        AND dso.created_at   > NOW() - ($1 || ' hours')::interval
        AND COALESCE(dso.metadata->>'flow', 'original') NOT IN ('banxa_btc_allcast', 'banxa_btc_recovery')
        AND COALESCE(u.is_active, true) = true
        AND (u.username IS NULL OR u.username NOT LIKE 'deleted_%')
        AND COALESCE(u.tier, 'free') <> 'banned'
        AND NOT EXISTS (
          SELECT 1 FROM user_entitlements ue
          WHERE ue.user_id::text    = dso.user_id::text
            AND ue.add_on_id  IN ('prime', 'pnp-member')
            AND ue.is_consumed = false
            AND (ue.is_lifetime = true OR ue.expires_at > NOW())
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.entity_type = 'broadcast'
            AND n.entity_id   LIKE $2
            AND n.target_user_id::text = dso.user_id::text
        )
      ORDER BY dso.user_id, dso.created_at DESC
    `, [String(WINDOW_HOURS), BATCH_ID + '%']);
    targets = rows;
  }

  console.log(`  Found ${targets.length} user(s) to reach\n`);

  if (targets.length === 0) {
    console.log('  No targets — done.');
    process.exit(0);
  }

  const stats = { invoices: 0, dm: 0, tg: 0, failed: 0 };

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const { user_id, original_order_id, provider, payment_status, username, first_name, telegram, email, language } = row;
    const name      = first_name || username || null;
    const lang      = language || 'es';
    const realEmail = email && !email.includes('@telegram.pnptv.app') ? email : null;

    console.log(`\n[${i + 1}/${targets.length}] user=${user_id} @${username || 'anon'}${provider ? ` provider=${provider} status=${payment_status}` : ''}`);
    console.log(`  telegram=${telegram || '-'}  email=${realEmail || '-'}  lang=${lang}`);

    if (DRY_RUN) {
      console.log('  [DRY] Would create NowPayments BTC invoice and send messages');
      continue;
    }

    // 1. Create NowPayments hosted invoice (BTC, $95)
    const orderId = `pnptv-banxa-${user_id}-${Date.now()}`;
    let invoiceUrl;

    try {
      const resp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
        price_amount:      PLAN_AMOUNT,
        price_currency:    'usd',
        pay_currency:      'btc',
        order_id:          orderId,
        order_description: PLAN_NAME,
        ipn_callback_url:  `${WEBAPP_URL}/api/webhooks/nowpayments`,
        success_url:       `${WEBAPP_URL}/lifetime100?nowpayments=success&order=${encodeURIComponent(orderId)}`,
        cancel_url:        `${WEBAPP_URL}/lifetime100`,
        ...(realEmail ? { customer_email: realEmail } : {}),
      }, {
        headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      invoiceUrl = resp.data?.invoice_url;
      if (!invoiceUrl) throw new Error(`No invoice_url in response: ${JSON.stringify(resp.data)}`);

      console.log(`  ✓ invoice: ${invoiceUrl}`);
      stats.invoices++;
    } catch (err) {
      console.error(`  ✗ invoice failed: ${err.response?.data?.message || err.message}`);
      stats.failed++;
      await sleep(API_DELAY_MS);
      continue;
    }

    // 2. Register order so the NowPayments IPN webhook auto-activates the account
    try {
      await query(`
        INSERT INTO dash_subscription_orders
          (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb)
        ON CONFLICT (btcpay_invoice_id) DO NOTHING
      `, [
        String(user_id),
        PLAN_ID,
        realEmail,
        PLAN_AMOUNT,
        orderId,
        JSON.stringify({
          provider:        'nowpayments',
          flow:            ANNUAL ? 'banxa_btc_annual50' : ALL_USERS ? 'banxa_btc_allcast' : 'banxa_btc_recovery',
          pay_currency:    'btc',
          invoiceUrl,
          batchId:         BATCH_ID,
          originalOrderId: original_order_id || null,
        }),
      ]);
    } catch (err) {
      console.error(`  ✗ order insert failed: ${err.message}`);
    }

    // 3. Log to notifications for dedup
    try {
      await query(`
        INSERT INTO notifications
          (type, category, priority, actor_id, target_user_id, entity_type, entity_id, message)
        VALUES ('broadcast', 'system', 'normal', $1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        SYSTEM_SENDER,
        String(user_id),
        'broadcast',
        BATCH_ID,
        `banxa-btc-broadcast:${orderId}`,
      ]);
    } catch (err) {
      console.warn(`  ⚠ dedup log insert failed: ${err.message}`);
    }

    // 4. In-app DM
    if (!SKIP_DM) {
      const msg = ANNUAL ? dmTextAnnual(invoiceUrl, lang)
        : ALL_USERS ? dmTextAllUsers(invoiceUrl, lang)
        : dmTextRecovery(invoiceUrl, lang);
      try {
        await sendSystemDM(SYSTEM_SENDER, user_id, msg, query);
        console.log(`  ✓ in-app DM sent`);
        stats.dm++;
      } catch (err) {
        console.warn(`  ✗ in-app DM failed: ${err.message}`);
      }
      await sleep(DM_DELAY_MS);
    }

    // 5. Telegram DM
    if (tg && telegram) {
      const msg = ANNUAL ? tgTextAnnual(name, invoiceUrl, lang)
        : ALL_USERS ? tgTextAllUsers(name, invoiceUrl, lang)
        : tgTextRecovery(name, invoiceUrl, lang);
      try {
        await tg.sendMessage(telegram, msg, { parse_mode: 'HTML' });
        console.log(`  ✓ Telegram DM sent → ${telegram}`);
        stats.tg++;
      } catch (err) {
        console.warn(`  ✗ Telegram DM failed [${telegram}]: ${err.message}`);
      }
      await sleep(TG_DELAY_MS);
    } else if (!tg && telegram && !SKIP_TG) {
      console.warn(`  ⚠ Telegram skipped — BOT_TOKEN not set`);
    }

    await sleep(API_DELAY_MS);
  }

  console.log('\n── Summary ──────────────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(`   DRY RUN — would have processed ${targets.length} user(s)`);
  } else {
    console.log(`   Invoices created : ${stats.invoices}`);
    console.log(`   In-app DMs sent  : ${stats.dm}`);
    console.log(`   Telegram DMs sent: ${stats.tg}`);
    console.log(`   Failures         : ${stats.failed}`);
  }
  console.log('─────────────────────────────────────────────────────────────────\n');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
