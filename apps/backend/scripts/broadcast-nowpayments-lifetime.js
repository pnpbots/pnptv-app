#!/usr/bin/env node
'use strict';

/**
 * broadcast-nowpayments-lifetime.js
 *
 * Sends a personal NowPayments checkout link (Lifetime PRIME — $80) to every
 * user who abandoned an ePayco payment in the last 30 days and has no active
 * prime/pnp-member entitlement.
 *
 * For each user the script:
 *   1. Creates a hosted NowPayments invoice (unique URL per user)
 *   2. Stores the order in dash_subscription_orders
 *   3. Fires an in-app push notification
 *   4. Sends a Telegram DM (if telegram ID present)
 *   5. Logs every action to payment_recovery_log
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-nowpayments-lifetime.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/broadcast-nowpayments-lifetime.js
 */

const path     = require('path');
const BACKEND  = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const PushNotificationService       = require(path.join(BACKEND, 'services/pushNotificationService'));
const { Telegram }                  = require('telegraf');
const axios                         = require('axios');

const DRY_RUN    = process.argv.includes('--dry-run');
const BATCH_ID   = `nowpayments-lifetime-2026-06-13`;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://pnptv.app';

const NOWPAYMENTS_URL     = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';

const PLAN_ID     = 'lifetime80';  // Active lifetime plan — $80 crypto price
const PLAN_AMOUNT = 80.00;
const PLAN_NAME   = 'Lifetime PRIME – PNPtv!';
const LIFETIME_URL = `${WEBAPP_URL}/lifetime100`;

const API_DELAY_MS = 150;  // between NowPayments API calls
const TG_DELAY_MS  = 100;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEs  = lang => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

// ── Messages ──────────────────────────────────────────────────────────────────

const PUSH = {
  en: {
    title: '🪙 Lifetime PRIME — $80 via crypto',
    body:  'Pay with USDC, BTC, ETH, or 100+ coins. No card needed. Your personal checkout is ready.',
  },
  es: {
    title: '🪙 Lifetime PRIME — $80 en cripto',
    body:  'Paga con USDC, BTC, ETH o +100 monedas. Sin tarjeta. Tu checkout personal está listo.',
  },
};

function tgMsg(name, invoiceUrl, lang) {
  const es = isEs(lang);
  if (es) {
    return (
      `🪙 <b>Lifetime PRIME — $80. Tu checkout personal ya está listo.</b>\n\n` +
      `Hola${name ? ` ${name}` : ''}, vimos que intentaste suscribirte pero el pago no se completó.\n\n` +
      `Te preparamos un link directo para pagar con <b>cripto — sin tarjeta, sin banco, sin burocracia</b>:\n\n` +
      `✅ USDC, BTC, ETH, LTC, Dash y +100 monedas más\n` +
      `✅ Sin registro extra — solo escanea y paga\n` +
      `✅ Acceso PRIME inmediato al confirmar\n\n` +
      `👉 <a href="${invoiceUrl}">Ir a tu checkout → ${invoiceUrl}</a>\n\n` +
      `<i>Este link es personal y expira en 48 h. Si tienes problemas, escríbenos.</i>`
    );
  }
  return (
    `🪙 <b>Lifetime PRIME — $80. Your personal checkout is ready.</b>\n\n` +
    `Hi${name ? ` ${name}` : ''}, we noticed you tried to subscribe but the payment didn't complete.\n\n` +
    `We created a direct crypto checkout link for you — <b>no card, no bank, no hassle</b>:\n\n` +
    `✅ USDC, BTC, ETH, LTC, Dash + 100 more coins\n` +
    `✅ No extra signup — just scan and pay\n` +
    `✅ PRIME access granted instantly on confirmation\n\n` +
    `👉 <a href="${invoiceUrl}">Go to your checkout → ${invoiceUrl}</a>\n\n` +
    `<i>This link is personal and expires in 48 h. Reply here if you need help.</i>`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await initializePostgres();

  if (!NOWPAYMENTS_API_KEY) {
    console.error('NOWPAYMENTS_API_KEY not set — aborting');
    process.exit(1);
  }

  const tg = process.env.BOT_TOKEN ? new Telegram(process.env.BOT_TOKEN) : null;

  // Fetch target users
  const { rows: targets } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      u.username,
      u.telegram,
      u.email,
      u.language
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.status IN ('abandoned', 'failed')
      AND p.provider = 'epayco'
      AND p.created_at >= NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = p.user_id
          AND ue.add_on_id IN ('prime', 'pnp-member')
          AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
          AND ue.is_consumed = false
      )
      AND (
        u.telegram IS NOT NULL
        OR (u.email IS NOT NULL AND u.email NOT LIKE '%@telegram.pnptv.app' AND u.email NOT LIKE '%@example.com')
      )
      AND NOT EXISTS (
        SELECT 1 FROM payment_recovery_log prl2
        WHERE prl2.created_by = $1
          AND prl2.result::jsonb->>'userId' = p.user_id
          AND prl2.status = 'success'
      )
    ORDER BY p.user_id, p.amount DESC
  `, [BATCH_ID]);

  console.log(`[${BATCH_ID}]${DRY_RUN ? ' DRY RUN —' : ''} ${targets.length} users to reach`);

  let invoiceCreated = 0, pushSent = 0, tgSent = 0, tgFailed = 0, skipped = 0;

  for (const row of targets) {
    const { user_id, username, telegram, email, language } = row;
    const name = username || null;
    const lang = language || 'en';
    const es   = isEs(lang);

    console.log(`\n→ ${user_id} @${username || 'anon'} TG:${telegram || '-'} email:${email || '-'}`);

    if (DRY_RUN) { skipped++; continue; }

    // 1. Create NowPayments hosted invoice
    const orderId   = `pnptv-nowp-${user_id}-${Date.now()}`;
    let invoiceUrl;

    try {
      const invoiceResp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
        price_amount:      PLAN_AMOUNT,
        price_currency:    'usd',
        order_id:          orderId,
        order_description: PLAN_NAME,
        ipn_callback_url:  `${WEBAPP_URL}/api/webhooks/nowpayments`,
        success_url:       `${WEBAPP_URL}/subscribe?nowpayments=success&order=${encodeURIComponent(orderId)}`,
        cancel_url:        LIFETIME_URL,
        ...(email && !email.includes('@telegram.pnptv.app') ? { customer_email: email } : {}),
      }, {
        headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
        timeout: 12000,
      });

      invoiceUrl = invoiceResp.data?.invoice_url;
      if (!invoiceUrl) throw new Error('No invoice_url in response');

      console.log(`  ✓ invoice created: ${invoiceUrl}`);
      invoiceCreated++;
    } catch (err) {
      console.error(`  ✗ invoice failed: ${err.message}`);
      await sleep(API_DELAY_MS);
      continue;
    }

    // 2. Store in dash_subscription_orders so webhook can settle it
    try {
      await query(`
        INSERT INTO dash_subscription_orders
          (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        ON CONFLICT (btcpay_invoice_id) DO NOTHING
      `, [
        String(user_id),
        PLAN_ID,
        (email && !email.includes('@telegram.pnptv.app')) ? email : null,
        PLAN_AMOUNT,
        orderId,
        JSON.stringify({ provider: 'nowpayments', flow: 'hosted', invoiceUrl, batchId: BATCH_ID }),
      ]);
    } catch (err) {
      console.error(`  ✗ order insert failed: ${err.message}`);
    }

    // 3. In-app push notification
    try {
      const push = es ? PUSH.es : PUSH.en;
      await PushNotificationService.sendToUser(String(user_id), {
        title: push.title,
        body:  push.body,
        url:   invoiceUrl,
      });
      pushSent++;
      console.log(`  ✓ push sent`);
    } catch (err) {
      console.error(`  ✗ push failed: ${err.message}`);
    }

    // 4. Telegram DM
    if (tg && telegram) {
      try {
        await tg.sendMessage(telegram, tgMsg(name, invoiceUrl, lang), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        tgSent++;
        console.log(`  ✓ TG sent`);
      } catch (err) {
        tgFailed++;
        console.error(`  ✗ TG failed: ${err.message}`);
      }
      await sleep(TG_DELAY_MS);
    }

    // 5. Log to payment_recovery_log (use a dummy payment_id — log by userId in result)
    try {
      await query(`
        INSERT INTO payment_recovery_log
          (payment_id, action, status, result, created_by)
        SELECT p.id, 'nowpayments_lifetime_outreach', 'success', $2::jsonb, $3
        FROM payments p
        WHERE p.user_id = $1 AND p.status IN ('abandoned','failed') AND p.provider = 'epayco'
        ORDER BY p.created_at DESC
        LIMIT 1
      `, [
        String(user_id),
        JSON.stringify({ userId: user_id, orderId, invoiceUrl, tgSent: !!(tg && telegram), batchId: BATCH_ID }),
        BATCH_ID,
      ]);
    } catch (err) {
      console.error(`  ✗ log failed: ${err.message}`);
    }

    await sleep(API_DELAY_MS);
  }

  console.log(`\n══ Done ══`);
  console.log(`  Targets:  ${targets.length}`);
  console.log(`  Invoices: ${invoiceCreated}`);
  console.log(`  Push:     ${pushSent}`);
  console.log(`  Telegram: ${tgSent} sent / ${tgFailed} blocked`);
  if (DRY_RUN) console.log(`  (dry run — nothing was sent or created)`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
