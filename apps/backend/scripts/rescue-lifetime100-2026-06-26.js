#!/usr/bin/env node
'use strict';

/**
 * rescue-lifetime100-2026-06-26.js
 *
 * Lifetime100 abandoned-cart rescue. Targets users who attempted a payment
 * (NowPayments / Dash-BTCPay / ePayco / Meru) in the last 30 days but do NOT
 * currently hold an active `pnp-member` or `prime` entitlement.
 *
 * Per recipient:
 *   1. Create a unique NowPayments BTC invoice for $95 (you eat ~$5 Banxa fee
 *      buffer so the user pays a round $100 on Banxa and the $95 lands clean).
 *   2. Pre-insert a dash_subscription_orders row with plan_id='lifetime100' and
 *      btcpay_invoice_id = order_id, so the NowPayments IPN handler
 *      (routes.js:/api/webhooks/nowpayments) auto-grants entitlements on
 *      confirmation. Without this row the webhook fires but no grant happens.
 *   3. DM the user (Telegram preferred, email fallback) with their unique
 *      payment URL and a Banxa walkthrough. Sign-off: Santino.
 *
 * Cohort exclusions:
 *   - Already has active pnp-member or prime entitlement
 *   - is_deleted = TRUE or is_active = FALSE
 *   - Email is a placeholder (@telegram.pnptv.app) AND no Telegram chat id
 *   - Already received a rescue invoice from THIS script (idempotent rerun)
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26.js
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26.js --skip-email
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26.js --skip-telegram
 */

const path = require('path');
const fs   = require('fs');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const axios       = require('axios');
const nodemailer  = require('nodemailer');
const { Telegram } = require('telegraf');
const { query }   = require(path.join(BACKEND, 'config/postgres'));

const DRY_RUN       = process.argv.includes('--dry-run');
const SKIP_EMAIL    = process.argv.includes('--skip-email');
const SKIP_TELEGRAM = process.argv.includes('--skip-telegram');

const SOURCE_TAG       = 'rescue-lifetime100-2026-06-26';
const PRICE_USD        = 95;
const PLAN_ID          = 'lifetime100';
const PAY_CURRENCY     = 'btc';
const WEBAPP_URL       = process.env.WEBAPP_URL || 'https://pnptv.app';
const NOWPAYMENTS_URL  = 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_KEY  = process.env.NOWPAYMENTS_API_KEY;
const NP_INVOICE_DELAY = 600;   // 1.7/sec — under NP rate limit
const TG_DELAY_MS      = 80;    // ~12 msg/sec — well under TG global 30/sec
const EMAIL_DELAY_MS   = 120;
// Container sees /app/logs (bind-mounted to host /opt/pnptvapp/logs)
const LOG_DIR          = fs.existsSync('/app/logs') ? '/app/logs' : '/opt/pnptvapp/logs';
const DRY_REPORT_PATH  = path.join(LOG_DIR, `${SOURCE_TAG}-dryrun.json`);
const LIVE_REPORT_PATH = path.join(LOG_DIR, `${SOURCE_TAG}-live.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

// ── Message templates ────────────────────────────────────────────────────────

function buildTelegramMessage(lang, invoiceUrl) {
  if (lang === 'es') {
    return (
`Hey 👋 soy Santino.

Vi que intentaste suscribirte a PNPtv pero el pago no se completó. Antes de que se te olvide, te tengo algo:

🔥 <b>ACCESO DE POR VIDA — $95</b> (regular $100)
Pagas una vez. Acceso para siempre. Todo lo que viene en PNPtv ya está incluido.

<b>Esta semana en PNPtv:</b>
• 🎬 Video exclusivo nuevo recién subido al área PRIME
• 👋 2 creadores nuevos se unieron — <b>MR_8502</b> y <b>Martin_jhosep</b>, ya con contenido fresco

👉 <b>TU LINK PERSONAL DE PAGO:</b>
${invoiceUrl}

¿No tienes Bitcoin todavía? Es de verdad fácil:
1. Abre https://checkout.banxa.com
2. Compra $100 de Bitcoin (BTC) — el extra cubre la comisión de Banxa
3. Copia la dirección que verás en tu link arriba y pégala como destino
4. Listo. Tu PRIME se activa automático cuando llega el pago.

Si te trabas en algún paso, escríbeme aquí mismo.

— Santino
PNPtv`
    );
  }
  return (
`Hey 👋 it's Santino.

I noticed you tried to subscribe to PNPtv but the payment didn't go through. Before you forget about it, here's what I've got for you:

🔥 <b>LIFETIME ACCESS — $95</b> (regular $100)
Pay once. Yours forever. Everything coming to PNPtv is already included.

<b>This week on PNPtv:</b>
• 🎬 Fresh exclusive video just dropped in the PRIME area
• 👋 2 new creators joined — <b>MR_8502</b> and <b>Martin_jhosep</b>, already posting

👉 <b>YOUR PERSONAL PAYMENT LINK:</b>
${invoiceUrl}

No Bitcoin yet? Honestly it's easy:
1. Open https://checkout.banxa.com
2. Buy $100 of Bitcoin (BTC) — the extra covers Banxa's fee
3. Copy the wallet address shown on your link above and paste it as the destination
4. Done. Your PRIME activates automatically when the payment lands.

If you get stuck at any step, just reply here.

— Santino
PNPtv`
  );
}

const EMAIL_SUBJECT = {
  es: '🔥 Tu acceso de por vida a PNPtv te espera — $95',
  en: '🔥 Your PNPtv lifetime access is waiting — $95',
};

function buildEmailHtml(lang, invoiceUrl) {
  const es = lang === 'es';
  const head = es ? 'ACCESO DE POR VIDA — $95' : 'LIFETIME ACCESS — $95';
  const reg  = es ? '(regular $100)' : '(regular $100)';
  const lead = es
    ? 'Vi que intentaste suscribirte a PNPtv pero el pago no se completó. Antes de que se te olvide, te dejo abierto algo:'
    : "I noticed you tried to subscribe to PNPtv but the payment didn't go through. Before you forget about it, here's what I've got for you:";
  const onceLine = es ? 'Pagas una vez. Acceso para siempre.' : 'Pay once. Yours forever.';
  const weekTitle = es ? 'Esta semana en PNPtv:' : 'This week on PNPtv:';
  const bullet1 = es
    ? '🎬 Video exclusivo nuevo recién subido al área PRIME'
    : '🎬 Fresh exclusive video just dropped in the PRIME area';
  const bullet2 = es
    ? '👋 2 creadores nuevos — <b>MR_8502</b> y <b>Martin_jhosep</b>, ya con contenido'
    : '👋 2 new creators — <b>MR_8502</b> and <b>Martin_jhosep</b>, already posting';
  const ctaLabel = es ? 'Pagar ahora — $95' : 'Pay now — $95';
  const banxaTitle = es ? '¿No tienes Bitcoin?' : 'No Bitcoin yet?';
  const banxaSteps = es
    ? [
        'Abre <a href="https://checkout.banxa.com" style="color:#5ED1C4;">checkout.banxa.com</a>',
        'Compra $100 de Bitcoin (BTC) — el extra cubre la comisión de Banxa',
        'Copia la dirección que verás en tu link y pégala como destino',
        'Listo. Tu PRIME se activa automático cuando llega el pago.',
      ]
    : [
        'Open <a href="https://checkout.banxa.com" style="color:#5ED1C4;">checkout.banxa.com</a>',
        "Buy $100 of Bitcoin (BTC) — the extra covers Banxa's fee",
        'Copy the wallet address shown on your link and paste it as the destination',
        'Done. Your PRIME activates automatically when the payment lands.',
      ];
  const signOff = es ? 'Si te trabas, escríbenos.' : 'If you get stuck, just reply.';
  const footer  = es
    ? 'Recibes este correo porque intentaste suscribirte a PNPtv en los últimos 30 días.'
    : 'You receive this email because you attempted to subscribe to PNPtv in the last 30 days.';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${head}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;"><tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.2);">
      <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#E69138);"></td></tr>
      <tr><td style="padding:28px 32px 16px;">
        <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;">— Santino</p>
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:#E69138;line-height:1.2;">🔥 ${head} <span style="font-size:14px;color:#9ca3af;font-weight:500;">${reg}</span></h1>
        <p style="margin:0 0 16px;font-size:15px;color:#d1d5db;line-height:1.6;">${lead}</p>
        <p style="margin:0 0 20px;font-size:15px;color:#ffffff;font-weight:700;">${onceLine}</p>

        <p style="margin:18px 0 8px;font-size:13px;font-weight:700;color:#ffffff;">${weekTitle}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="padding:5px 0;font-size:14px;color:#d1d5db;">${bullet1}</td></tr>
          <tr><td style="padding:5px 0;font-size:14px;color:#d1d5db;">${bullet2}</td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td align="center">
          <a href="${invoiceUrl}" style="display:inline-block;padding:16px 40px;background:linear-gradient(90deg,#D4007A,#E69138);color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;letter-spacing:0.04em;">${ctaLabel} →</a>
        </td></tr></table>

        <p style="margin:8px 0 10px;font-size:13px;font-weight:700;color:#ffffff;">${banxaTitle}</p>
        <ol style="margin:0 0 22px 18px;padding:0;font-size:14px;color:#d1d5db;line-height:1.7;">
          ${banxaSteps.map((s) => `<li>${s}</li>`).join('')}
        </ol>

        <p style="margin:0;font-size:13px;color:#9ca3af;">${signOff}</p>
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.5;">${footer}</p>
        <p style="margin:6px 0 0;font-size:11px;color:#6b7280;">🔒 PNPtv · pnptv.app</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}

// ── NowPayments ──────────────────────────────────────────────────────────────

async function createNpInvoice(userId, customerEmail) {
  const orderId = `pnptv-nowp-life100-rescue-${userId}-${Date.now()}`;
  if (DRY_RUN) {
    // Pretend invoice id for dry-run preview
    return { orderId, invoiceUrl: `https://nowpayments.io/payment/?iid=DRYRUN-${orderId.slice(-12)}`, nowpaymentsInvoiceId: null };
  }
  const resp = await axios.post(`${NOWPAYMENTS_URL}/invoice`, {
    price_amount: PRICE_USD,
    price_currency: 'usd',
    pay_currency: PAY_CURRENCY,
    order_id: orderId,
    order_description: 'PNPtv Lifetime Access — Santino rescue',
    ipn_callback_url: `${WEBAPP_URL}/api/webhooks/nowpayments`,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
  }, {
    headers: { 'x-api-key': NOWPAYMENTS_KEY, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  const invoiceId = resp.data.id;
  if (!invoiceId) throw new Error('NowPayments: no invoice id in response');
  return {
    orderId,
    invoiceUrl: `https://nowpayments.io/payment/?iid=${invoiceId}`,
    nowpaymentsInvoiceId: String(invoiceId),
  };
}

async function insertOrderRow({ userId, orderId, invoiceUrl, nowpaymentsInvoiceId, customerEmail }) {
  if (DRY_RUN) return;
  await query(
    `INSERT INTO dash_subscription_orders
       (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
    [
      userId,
      PLAN_ID,
      customerEmail,
      PRICE_USD,
      orderId,
      JSON.stringify({
        provider: 'nowpayments',
        flow: 'lifetime100',
        source: SOURCE_TAG,
        invoiceUrl,
        nowpaymentsInvoiceId,
        payCurrency: PAY_CURRENCY,
      }),
    ]
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Lifetime100 Rescue — Santino — 2026-06-26');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? ' MODE: DRY RUN — no invoices created, no DMs sent' : ' MODE: LIVE — real invoices + real DMs');
  if (SKIP_TELEGRAM) console.log(' --skip-telegram');
  if (SKIP_EMAIL)    console.log(' --skip-email');
  console.log();

  if (!NOWPAYMENTS_KEY) {
    console.error('FATAL: NOWPAYMENTS_API_KEY env var missing');
    process.exit(1);
  }

  // ── Cohort ────────────────────────────────────────────────────────────────
  console.log('Loading cohort...');
  const { rows: cohort } = await query(`
    WITH attempted AS (
      SELECT DISTINCT user_id::text AS uid FROM payments
       WHERE created_at > NOW() - INTERVAL '30 days'
      UNION
      SELECT DISTINCT user_id::text FROM dash_subscription_orders
       WHERE created_at > NOW() - INTERVAL '30 days'
    ),
    eligible AS (
      SELECT a.uid FROM attempted a
      LEFT JOIN user_entitlements ue
        ON ue.user_id = a.uid
        AND ue.add_on_id IN ('pnp-member','prime')
        AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
      WHERE ue.user_id IS NULL
    ),
    already_rescued AS (
      SELECT DISTINCT user_id::text AS uid FROM dash_subscription_orders
       WHERE metadata->>'source' = $1
    )
    SELECT u.id::text AS uid,
           u.first_name, u.username, u.email, u.telegram, u.language
      FROM eligible e
      JOIN users u ON u.id::text = e.uid
      LEFT JOIN already_rescued ar ON ar.uid = e.uid
     WHERE ar.uid IS NULL
       AND COALESCE(u.is_deleted, FALSE) = FALSE
       AND COALESCE(u.is_active,   TRUE) = TRUE
       AND (
            (u.telegram IS NOT NULL AND u.telegram::text ~ '^[0-9]+$')
         OR (u.email IS NOT NULL AND u.email NOT LIKE '%@telegram.pnptv.app')
       )
  `, [SOURCE_TAG]);

  console.log(`  Cohort size: ${cohort.length}`);
  const withTg     = cohort.filter((u) => u.telegram && /^[0-9]+$/.test(String(u.telegram)));
  const withEmail  = cohort.filter((u) => u.email && !u.email.includes('@telegram.pnptv.app'));
  const tgOnly     = cohort.filter((u) => u.telegram && /^[0-9]+$/.test(String(u.telegram)));
  const emailOnly  = cohort.filter((u) => (!u.telegram || !/^[0-9]+$/.test(String(u.telegram))) && u.email && !u.email.includes('@telegram.pnptv.app'));
  console.log(`    Reachable via Telegram: ${withTg.length}`);
  console.log(`    Reachable via Email:    ${withEmail.length}`);
  console.log(`    Telegram-first:         ${tgOnly.length}`);
  console.log(`    Email-only fallback:    ${emailOnly.length}`);
  console.log(`    Spanish:                ${cohort.filter((u) => isEs(u.language)).length}`);
  console.log();

  if (!cohort.length) {
    console.log('No eligible users — exiting.');
    process.exit(0);
  }

  // ── Per-user: invoice + DB row + send ────────────────────────────────────
  const report = [];
  const stats  = {
    invoiceOk: 0, invoiceFail: 0,
    tgSent: 0, tgFail: 0,
    emailSent: 0, emailFail: 0,
    skipped: 0,
  };

  const tg = SKIP_TELEGRAM ? null : new Telegram(process.env.BOT_TOKEN);
  const smtp = SKIP_EMAIL ? null : nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  for (let i = 0; i < cohort.length; i++) {
    const u = cohort[i];
    const lang = isEs(u.language) ? 'es' : 'en';
    const usePersonalEmail = u.email && !u.email.includes('@telegram.pnptv.app') ? u.email : null;

    // Step 1: create unique NowPayments invoice
    let inv;
    try {
      inv = await createNpInvoice(u.uid, usePersonalEmail);
      stats.invoiceOk++;
    } catch (err) {
      stats.invoiceFail++;
      console.warn(`  [${i + 1}/${cohort.length}] invoice fail for ${u.uid}: ${err.response?.data?.message || err.message}`);
      report.push({ uid: u.uid, lang, error: `invoice_failed: ${err.message}` });
      await sleep(NP_INVOICE_DELAY);
      continue;
    }

    // Step 2: pre-insert dash_subscription_orders row so webhook auto-grants
    try {
      await insertOrderRow({
        userId: u.uid,
        orderId: inv.orderId,
        invoiceUrl: inv.invoiceUrl,
        nowpaymentsInvoiceId: inv.nowpaymentsInvoiceId,
        customerEmail: usePersonalEmail,
      });
    } catch (err) {
      console.warn(`  [${i + 1}/${cohort.length}] DB insert fail for ${u.uid}: ${err.message}`);
      report.push({ uid: u.uid, lang, invoiceUrl: inv.invoiceUrl, error: `db_insert_failed: ${err.message}` });
      await sleep(NP_INVOICE_DELAY);
      continue;
    }

    // Step 3: send DM (Telegram preferred, email fallback)
    const tgChatId = u.telegram && /^[0-9]+$/.test(String(u.telegram)) ? String(u.telegram) : null;
    const entry = { uid: u.uid, lang, invoiceUrl: inv.invoiceUrl, orderId: inv.orderId, channel: null };

    if (!SKIP_TELEGRAM && tgChatId) {
      const msg = buildTelegramMessage(lang, inv.invoiceUrl);
      if (DRY_RUN) {
        entry.channel = 'telegram-dryrun';
        entry.preview = msg;
      } else {
        try {
          await tg.sendMessage(tgChatId, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
          stats.tgSent++;
          entry.channel = 'telegram';
        } catch (err) {
          stats.tgFail++;
          entry.tgError = err.message;
          // Fallback to email if available
          if (!SKIP_EMAIL && usePersonalEmail) {
            try {
              await smtp.sendMail({
                from: `Santino — PNPtv <${process.env.SMTP_USER}>`,
                to: usePersonalEmail,
                subject: EMAIL_SUBJECT[lang],
                html: buildEmailHtml(lang, inv.invoiceUrl),
              });
              stats.emailSent++;
              entry.channel = 'email-fallback';
              await sleep(EMAIL_DELAY_MS);
            } catch (mailErr) {
              stats.emailFail++;
              entry.emailError = mailErr.message;
            }
          }
        }
      }
      await sleep(TG_DELAY_MS);
    } else if (!SKIP_EMAIL && usePersonalEmail) {
      if (DRY_RUN) {
        entry.channel = 'email-dryrun';
        entry.subject = EMAIL_SUBJECT[lang];
      } else {
        try {
          await smtp.sendMail({
            from: `Santino — PNPtv <${process.env.SMTP_USER}>`,
            to: usePersonalEmail,
            subject: EMAIL_SUBJECT[lang],
            html: buildEmailHtml(lang, inv.invoiceUrl),
          });
          stats.emailSent++;
          entry.channel = 'email';
        } catch (mailErr) {
          stats.emailFail++;
          entry.emailError = mailErr.message;
        }
      }
      await sleep(EMAIL_DELAY_MS);
    } else {
      stats.skipped++;
      entry.channel = 'unreachable';
    }

    report.push(entry);

    // Pace invoice creation
    await sleep(NP_INVOICE_DELAY);

    if ((i + 1) % 25 === 0) {
      console.log(`  Progress: ${i + 1}/${cohort.length}  — TG ${stats.tgSent}, email ${stats.emailSent}, invoice fails ${stats.invoiceFail}`);
    }
  }

  // ── Write report ──────────────────────────────────────────────────────────
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const reportPath = DRY_RUN ? DRY_REPORT_PATH : LIVE_REPORT_PATH;
  fs.writeFileSync(reportPath, JSON.stringify({
    runAt: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    sourceTag: SOURCE_TAG,
    priceUsd: PRICE_USD,
    cohortSize: cohort.length,
    stats,
    entries: report,
  }, null, 2));

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(' Summary');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(` Invoices created:  ${stats.invoiceOk} (failed: ${stats.invoiceFail})`);
  console.log(` Telegram sent:     ${stats.tgSent} (failed: ${stats.tgFail})`);
  console.log(` Email sent:        ${stats.emailSent} (failed: ${stats.emailFail})`);
  console.log(` Unreachable:       ${stats.skipped}`);
  console.log(` Report:            ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
