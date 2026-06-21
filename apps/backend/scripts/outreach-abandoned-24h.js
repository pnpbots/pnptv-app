#!/usr/bin/env node
'use strict';

/**
 * outreach-abandoned-24h.js
 *
 * Targeted recovery outreach for payments that failed/abandoned in the last 24 hours.
 * Covers all providers (ePayco, NowPayments, BTCPay). Marks remaining `pending` as `abandoned`.
 * Sends Telegram DM + email to each affected user (one per user, highest-value payment).
 * Logs every send to payment_recovery_log.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-abandoned-24h.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-abandoned-24h.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const nodemailer = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN     = process.argv.includes('--dry-run');
const DELAY_MS    = 1200;
const TG_DELAY_MS = 300;
const BATCH_ID    = `abandoned-24h-${new Date().toISOString().slice(0, 10)}`;
const SUBSCRIBE   = 'https://pnptv.app/subscribe';
const HOW_TO_PAY  = 'https://pnptv.app/how-to-pay';
const LIFETIME    = 'https://pnptv.app/lifetime100';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

const PLAN_LABELS = {
  'lifetime80':              'Lifetime PRIME — $100',
  'lifetime100':             'Lifetime PRIME — $99.99',
  'lifetime-pass':           'Lifetime PRIME — $250',
  'prime-diamond-pass-365d': 'PRIME Diamond (1 year) — $99.99',
  'monthly-pass':            'Monthly PRIME — $25',
  'prime-week-pass-7d':      'PRIME Week Pass — $15',
  'member_monthly':          'Community Member — $9.99',
};

function planLabel(planId) {
  return PLAN_LABELS[planId] || planId || 'your plan';
}

function tgMsg(name, planId, lang) {
  const plan = planLabel(planId);
  const es = isEs(lang);
  if (es) {
    return `<b>PNPtv!</b> — Tu pago no se completó\n\n` +
      `Hola ${name}, intentaste pagar <b>${plan}</b> pero el proceso no terminó.\n\n` +
      `Esto suele pasar por la verificación 3D Secure del banco — no es tu culpa. Puedes intentarlo de nuevo cuando quieras:\n\n` +
      `<b>💳 Opción 1 — Tarjeta de crédito o débito</b>\n` +
      `Después de ingresar tu tarjeta, espera 20–30 segundos al popup 3D Secure. <b>No cierres la pestaña.</b>\n\n` +
      `<b>🪙 Opción 2 — Cripto vía NowPayments</b>\n` +
      `BTC, ETH, USDC, LTC y +100 monedas. Sin banco, sin rechazos.\n\n` +
      `👉 <a href="${HOW_TO_PAY}">Guía paso a paso → pnptv.app/how-to-pay</a>\n\n` +
      `──────────────────\n` +
      `Suscribirme: <a href="${SUBSCRIBE}">pnptv.app/subscribe</a>\n` +
      `Lifetime PRIME $100: <a href="${LIFETIME}">pnptv.app/lifetime100</a>`;
  }
  return `<b>PNPtv!</b> — Your payment didn't complete\n\n` +
    `Hi ${name}, you tried to get <b>${plan}</b> but the payment didn't go through.\n\n` +
    `This is usually a 3D Secure bank timeout — not your fault. You can try again anytime:\n\n` +
    `<b>💳 Option 1 — Credit or debit card</b>\n` +
    `After submitting your card, wait 20–30 seconds for the 3D Secure popup. <b>Don't close the tab.</b>\n\n` +
    `<b>🪙 Option 2 — Crypto via NowPayments</b>\n` +
    `BTC, ETH, USDC, LTC and 100+ coins. No bank, no declines.\n\n` +
    `👉 <a href="${HOW_TO_PAY}">Full step-by-step guide → pnptv.app/how-to-pay</a>\n\n` +
    `──────────────────\n` +
    `Subscribe: <a href="${SUBSCRIBE}">pnptv.app/subscribe</a>\n` +
    `Lifetime PRIME $100: <a href="${LIFETIME}">pnptv.app/lifetime100</a>`;
}

function emailHtml(name, planId, lang) {
  const plan = planLabel(planId);
  const es = isEs(lang);
  if (es) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">pnptv.app</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">Hola <strong>${name}</strong>,</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    Vimos que intentaste pagar <strong style="color:#fff;">${plan}</strong> pero el pago no se completó.
    Puede haber sido un problema temporal con tu banco o con la verificación 3D Secure.
  </p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    <strong style="color:#fff;">Consejo:</strong> Si tu tarjeta fue rechazada, prueba con otra tarjeta Visa o Mastercard.
    Si el problema fue la verificación del banco, asegúrate de no cerrar la ventana durante el proceso.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${SUBSCRIBE}" style="display:inline-block;background:#D4007A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Intentar de nuevo →</a>
  </div>
  <p style="color:#666;font-size:13px;line-height:1.5;">
    También puedes pagar con <strong>USDC</strong>, <strong>BTC</strong> u otras criptos si la tarjeta sigue fallando.
    Todas las opciones están disponibles en la misma página de suscripción.
  </p>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; Para darte de baja de estos correos, contáctanos.
  </div>
</div>
</body></html>`;
  }
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">pnptv.app</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">Hi <strong>${name}</strong>,</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    We noticed you tried to subscribe to <strong style="color:#fff;">${plan}</strong> but the payment didn't complete.
    This is usually a temporary bank issue or a 3D Secure verification timeout — not your fault.
  </p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    <strong style="color:#fff;">Tip:</strong> If your card was declined, try a different Visa or Mastercard.
    If it was a 3D Secure issue, make sure not to close the browser window while your bank verifies.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${SUBSCRIBE}" style="display:inline-block;background:#D4007A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Try Again →</a>
  </div>
  <p style="color:#666;font-size:13px;line-height:1.5;">
    You can also pay with <strong>USDC</strong>, <strong>BTC</strong>, or other crypto if your card keeps failing —
    all options are available on the same subscribe page.
  </p>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; To unsubscribe from these emails, contact us.
  </div>
</div>
</body></html>`;
}

async function main() {
  await initializePostgres();
  console.log(`[${BATCH_ID}] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // 1. Fetch all pending/abandoned/failed payments from last 24h with user details
  const { rows: payments } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.id         AS payment_id,
      p.user_id,
      p.plan_id,
      p.amount,
      p.status,
      p.provider,
      p.created_at,
      u.username,
      u.first_name,
      u.email,
      u.telegram,
      u.language,
      u.role
    FROM payments p
    JOIN users u ON p.user_id = u.id
    WHERE p.created_at >= NOW() - INTERVAL '24 hours'
      AND p.status IN ('pending', 'abandoned', 'failed')
      AND COALESCE(u.is_deleted, false) = false
      AND u.role != 'banned'
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = p.user_id
          AND ue.is_consumed = false
          AND (ue.expires_at IS NULL OR ue.expires_at > NOW())
      )
      AND NOT EXISTS (
        SELECT 1 FROM payment_recovery_log prl
        WHERE prl.payment_id = p.id
          AND prl.action LIKE 'abandoned_24h_outreach%'
          AND prl.status = 'success'
      )
    ORDER BY p.user_id, p.amount DESC
  `);

  console.log(`\nFound ${payments.length} unique user(s) to contact`);
  if (payments.length === 0) { console.log('Nothing to do.'); process.exit(0); }

  // 2. Mark any remaining `pending` as `abandoned`
  const pendingIds = payments.filter(r => r.status === 'pending').map(r => r.payment_id);
  if (pendingIds.length) {
    if (!DRY_RUN) {
      await query(
        `UPDATE payments SET status = 'abandoned', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [pendingIds]
      );
      console.log(`✓ Marked ${pendingIds.length} payment(s) pending → abandoned`);
    } else {
      console.log(`[DRY] Would mark ${pendingIds.length} pending → abandoned`);
    }
  }

  // 3. Partition channels
  const withTg    = payments.filter(r => r.telegram);
  const withEmail = payments.filter(r => r.email && !r.email.includes('@telegram.pnptv.app') && !r.email.includes('@example.com'));

  console.log(`\nTelegram DM targets:  ${withTg.length}`);
  console.log(`Email targets:        ${withEmail.length}\n`);

  const tg = process.env.BOT_TOKEN ? new Telegram(process.env.BOT_TOKEN) : null;

  const transporter = nodemailer.createTransport({
    host:   process.env.EASYBOTS_SMTP_HOST || process.env.PNPTV_SMTP_HOST || 'smtp.hostinger.com',
    port:   parseInt(process.env.EASYBOTS_SMTP_PORT || process.env.PNPTV_SMTP_PORT || '587', 10),
    secure: (process.env.EASYBOTS_SMTP_SECURE || process.env.PNPTV_SMTP_SECURE) === 'true',
    auth:   {
      user: process.env.EASYBOTS_SMTP_USER || process.env.PNPTV_SMTP_USER,
      pass: process.env.EASYBOTS_SMTP_PASS || process.env.PNPTV_SMTP_PASS,
    },
  });

  // ── Telegram DMs ──────────────────────────────────────────────────────────────
  console.log(`── TELEGRAM DMs ──`);
  let tgSent = 0, tgFailed = 0;

  for (const row of withTg) {
    const name = row.first_name || row.username || 'there';
    const lang = row.language || 'en';
    console.log(`[TG:${row.telegram}] @${row.username} — ${row.plan_id} $${row.amount} (${row.status}/${row.provider}) ${DRY_RUN ? '[DRY]' : ''}`);

    if (DRY_RUN) { tgSent++; continue; }

    try {
      await tg.sendMessage(row.telegram, tgMsg(name, row.plan_id, lang), {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      await query(
        `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.payment_id, 'abandoned_24h_outreach_telegram', 'success',
         JSON.stringify({ telegram: row.telegram, batchId: BATCH_ID }), BATCH_ID]
      );

      tgSent++;
      console.log(`  ✓ TG sent`);
    } catch (err) {
      tgFailed++;
      console.error(`  ✗ TG failed: ${err.message}`);
      try {
        await query(
          `INSERT INTO payment_recovery_log (payment_id, action, status, error_message, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.payment_id, 'abandoned_24h_outreach_telegram', 'failed', err.message, BATCH_ID]
        );
      } catch {}
    }

    await sleep(TG_DELAY_MS);
  }

  // ── Email ─────────────────────────────────────────────────────────────────────
  console.log(`\n── EMAIL ──`);
  let emailSent = 0, emailFailed = 0;

  for (const row of withEmail) {
    const name = row.first_name || row.username || 'there';
    const lang = row.language || 'en';
    const es   = isEs(lang);
    const subject = es
      ? 'Tu pago en PNPtv no se completó — inténtalo de nuevo'
      : 'Your PNPtv payment didn\'t complete — try again';

    console.log(`[${row.email}] @${row.username} — ${row.plan_id} $${row.amount} (${row.status}/${row.provider}) ${DRY_RUN ? '[DRY]' : ''}`);

    if (DRY_RUN) { emailSent++; continue; }

    try {
      const result = await transporter.sendMail({
        from: 'PNPtv! <hello@easybots.store>',
        to:   row.email,
        subject,
        html: emailHtml(name, row.plan_id, lang),
      });

      await query(
        `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.payment_id, 'abandoned_24h_outreach_email', 'success',
         JSON.stringify({ email: row.email, messageId: result?.messageId, batchId: BATCH_ID }), BATCH_ID]
      );

      emailSent++;
      console.log(`  ✓ email sent (${result?.messageId})`);
    } catch (err) {
      emailFailed++;
      console.error(`  ✗ email failed: ${err.message}`);
      try {
        await query(
          `INSERT INTO payment_recovery_log (payment_id, action, status, error_message, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.payment_id, 'abandoned_24h_outreach_email', 'failed', err.message, BATCH_ID]
        );
      } catch {}
    }

    await sleep(DELAY_MS);
  }

  console.log(`
═══════════════════════════════════════════
 DONE — ${BATCH_ID}
═══════════════════════════════════════════
 Users targeted:  ${payments.length}
 Telegram:        ${tgSent} sent / ${tgFailed} failed
 Email:           ${emailSent} sent / ${emailFailed} failed
═══════════════════════════════════════════
`);
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
