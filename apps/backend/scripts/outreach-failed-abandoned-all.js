#!/usr/bin/env node
'use strict';

/**
 * outreach-failed-abandoned-all.js
 *
 * Recovery outreach for ALL failed/abandoned payment attempts in the last 30 days,
 * across all providers (ePayco, Dash, NowPayments). Skips users who already have a
 * successful recovery outreach logged in payment_recovery_log.
 *
 * Deduplicates per user — one message each (most recent unresolved payment).
 * Email for users with a real email; Telegram for the rest.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-failed-abandoned-all.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-failed-abandoned-all.js
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
const TG_DELAY_MS = 350;
const BATCH_ID    = `failed-abandoned-all-${new Date().toISOString().slice(0, 10)}`;
const SUBSCRIBE   = 'https://pnptv.app/subscribe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs  = (lang) => !lang || lang.toLowerCase().startsWith('es');

const PLAN_LABELS = {
  'lifetime80':              'Lifetime PRIME — $80',
  'lifetime100':             'Lifetime PRIME — $99.99',
  'lifetime-pass':           'Lifetime PRIME — $250',
  'prime-diamond-pass-365d': 'PRIME Diamond (1 año / 1 year) — $99.99',
  'monthly-pass':            'PRIME Mensual / Monthly PRIME',
  'prime-week-pass-7d':      'PRIME Semanal / Week Pass',
  'member_monthly':          'Miembro Comunidad / Community Member',
  'creator_monthly':         'Suscripción Creador / Creator Subscription',
  'token_purchase':          'Tokens de Llamadas / Call Tokens',
  'donation-5':              'Donación / Donation',
  'donation-50':             'Donación / Donation',
};

function planLabel(planId, amount) {
  if (planId && PLAN_LABELS[planId]) return PLAN_LABELS[planId];
  // Fallback: derive from amount for nowpayments rows with no plan_id
  if (!planId) {
    if (amount >= 200) return 'Lifetime PRIME — $250';
    if (amount >= 90)  return 'Lifetime PRIME — $99.99';
    if (amount >= 70)  return 'Lifetime PRIME — $80';
    if (amount >= 40)  return 'PRIME Diamond (1 año)';
    if (amount >= 20)  return 'PRIME Mensual / Monthly PRIME';
    return `Plan $${parseFloat(amount).toFixed(2)}`;
  }
  return planId;
}

function isToken(planId) {
  return planId === 'token_purchase';
}

function isDonation(planId) {
  return planId && planId.startsWith('donation-');
}

// ── Email HTML ────────────────────────────────────────────────────────────────

function emailHtml(name, planId, amount, status, lang) {
  const plan = planLabel(planId, amount);
  const es   = isEs(lang);
  const wasDeclined = status === 'failed';

  const reasonEs = wasDeclined
    ? 'tu tarjeta fue rechazada al intentar procesar el pago'
    : 'el proceso de pago no se completó (posiblemente por un timeout de 3D Secure)';
  const reasonEn = wasDeclined
    ? 'your card was declined when we tried to process the payment'
    : 'the payment wasn\'t completed — this is usually a 3D Secure timeout, not your fault';

  const tipEs = wasDeclined
    ? '<strong>Consejo:</strong> Prueba con otra tarjeta Visa o Mastercard, o paga con <strong>USDC</strong> o <strong>Dash</strong> sin complicaciones.'
    : '<strong>Consejo:</strong> Si el problema fue la verificación del banco, asegúrate de no cerrar la ventana durante el proceso. También puedes pagar con crypto.';
  const tipEn = wasDeclined
    ? '<strong>Tip:</strong> Try a different Visa or Mastercard, or pay with <strong>USDC</strong> or <strong>Dash</strong> instead — no card needed.'
    : '<strong>Tip:</strong> If it was a 3D Secure issue, keep the browser window open while your bank verifies. You can also pay with crypto.';

  const tokenNoteEs = isToken(planId) ? '<p style="color:#ccc;font-size:14px;">Tus tokens de llamadas estarán disponibles tan pronto como el pago se complete.</p>' : '';
  const tokenNoteEn = isToken(planId) ? '<p style="color:#ccc;font-size:14px;">Your call tokens will be available as soon as payment goes through.</p>' : '';

  if (es) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">pnptv.app</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">Hola <strong>${name}</strong>,</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    Vimos que intentaste pagar <strong style="color:#fff;">${plan}</strong> pero ${reasonEs}.
  </p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">${tipEs}</p>
  ${tokenNoteEs}
  <div style="text-align:center;margin:28px 0;">
    <a href="${SUBSCRIBE}" style="display:inline-block;background:#D4007A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Intentar de nuevo →</a>
  </div>
  <p style="color:#666;font-size:13px;line-height:1.5;">
    Aceptamos tarjeta (Visa/Mastercard), <strong>USDC</strong> y <strong>Dash</strong>. Todas las opciones están en la misma página.
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
    We noticed you tried to get <strong style="color:#fff;">${plan}</strong> but ${reasonEn}.
  </p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">${tipEn}</p>
  ${tokenNoteEn}
  <div style="text-align:center;margin:28px 0;">
    <a href="${SUBSCRIBE}" style="display:inline-block;background:#D4007A;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Try Again →</a>
  </div>
  <p style="color:#666;font-size:13px;line-height:1.5;">
    We accept card (Visa/Mastercard), <strong>USDC</strong>, and <strong>Dash</strong> — all available on the same page.
  </p>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; To unsubscribe from these emails, contact us.
  </div>
</div>
</body></html>`;
}

// ── Telegram message ──────────────────────────────────────────────────────────

function tgMsg(name, planId, amount, status, lang) {
  const plan = planLabel(planId, amount);
  const es   = isEs(lang);
  const wasDeclined = status === 'failed';

  if (es) {
    const reason = wasDeclined
      ? 'tu tarjeta fue rechazada'
      : 'el pago no se completó (timeout de 3D Secure)';
    return `<b>PNPtv!</b> — Tu pago no se completó\n\n` +
      `Hola ${name} 👋 intentaste pagar <b>${plan}</b> pero ${reason}.\n\n` +
      `Puedes intentarlo de nuevo — también aceptamos <b>USDC</b> y <b>Dash</b> si la tarjeta sigue fallando:\n\n` +
      `👉 <a href="${SUBSCRIBE}">pnptv.app/subscribe</a>`;
  }

  const reason = wasDeclined
    ? 'your card was declined'
    : 'the payment didn\'t complete (3D Secure timeout)';
  return `<b>PNPtv!</b> — Your payment didn't go through\n\n` +
    `Hi ${name} 👋 you tried to get <b>${plan}</b> but ${reason}.\n\n` +
    `You can try again — we also accept <b>USDC</b> and <b>Dash</b> if your card keeps failing:\n\n` +
    `👉 <a href="${SUBSCRIBE}">pnptv.app/subscribe</a>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await initializePostgres();
  console.log(`[${BATCH_ID}] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  const transporter = nodemailer.createTransport({
    host:   process.env.EASYBOTS_SMTP_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com',
    port:   parseInt(process.env.EASYBOTS_SMTP_PORT || process.env.SMTP_PORT || '587', 10),
    secure: (process.env.EASYBOTS_SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
    auth: {
      user: process.env.EASYBOTS_SMTP_USER || process.env.SMTP_USER,
      pass: process.env.EASYBOTS_SMTP_PASS || process.env.SMTP_PASSWORD,
    },
  });

  const tg = process.env.BOT_TOKEN ? new Telegram(process.env.BOT_TOKEN) : null;

  // ── Email targets: real email, not yet recovered ───────────────────────────
  const { rows: emailTargets } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.id          AS payment_id,
      p.user_id,
      p.amount,
      p.plan_id,
      p.status,
      p.provider,
      p.created_at,
      u.username,
      u.email,
      u.language
    FROM payments p
    JOIN users u ON p.user_id = u.id
    WHERE p.status IN ('failed', 'abandoned')
      AND p.provider IN ('epayco', 'dash', 'nowpayments')
      AND p.created_at > NOW() - INTERVAL '30 days'
      AND u.email IS NOT NULL
      AND u.email NOT LIKE '%@telegram.pnptv.app'
      AND u.email NOT LIKE '%@example.com'
      AND NOT EXISTS (
        SELECT 1 FROM payments p2
        WHERE p2.user_id = p.user_id
          AND p2.status = 'completed'
          AND p2.created_at > p.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM payment_recovery_log prl
        WHERE prl.payment_id = p.id
          AND prl.action LIKE 'abandoned_outreach%'
          AND prl.status = 'success'
      )
    ORDER BY p.user_id, p.created_at DESC
  `);

  console.log(`\n── EMAIL outreach: ${emailTargets.length} users ──`);
  let emailSent = 0, emailFailed = 0, emailSkipped = 0;

  for (const row of emailTargets) {
    const name = row.username || 'there';
    const lang = row.language || 'es';
    const es   = isEs(lang);
    const subject = es
      ? 'Tu pago en PNPtv! no se completó — inténtalo de nuevo'
      : 'Your PNPtv! payment didn\'t go through — try again';

    console.log(
      `[${row.email}] @${row.username} | ${row.plan_id || 'no-plan'} $${row.amount} ` +
      `${row.status} via ${row.provider} (${lang}) ${DRY_RUN ? '[DRY]' : ''}`
    );

    if (DRY_RUN) { emailSkipped++; continue; }

    try {
      const result = await transporter.sendMail({
        to:      row.email,
        subject,
        html:    emailHtml(name, row.plan_id, row.amount, row.status, lang),
        from:    'PNPtv! <hello@easybots.store>',
      });

      await query(
        `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.payment_id,
          'abandoned_outreach_email',
          'success',
          JSON.stringify({ email: row.email, messageId: result?.messageId, batchId: BATCH_ID }),
          BATCH_ID,
        ]
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
          [row.payment_id, 'abandoned_outreach_email', 'failed', err.message, BATCH_ID]
        );
      } catch {}
    }

    await sleep(DELAY_MS);
  }

  // ── Telegram targets: no real email, has telegram, not yet recovered ────────
  const { rows: tgTargets } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.id          AS payment_id,
      p.user_id,
      p.amount,
      p.plan_id,
      p.status,
      p.provider,
      p.created_at,
      u.username,
      u.telegram,
      u.language
    FROM payments p
    JOIN users u ON p.user_id = u.id
    WHERE p.status IN ('failed', 'abandoned')
      AND p.provider IN ('epayco', 'dash', 'nowpayments')
      AND p.created_at > NOW() - INTERVAL '30 days'
      AND u.telegram IS NOT NULL
      AND (
        u.email IS NULL
        OR u.email LIKE '%@telegram.pnptv.app'
        OR u.email LIKE '%@example.com'
      )
      AND NOT EXISTS (
        SELECT 1 FROM payments p2
        WHERE p2.user_id = p.user_id
          AND p2.status = 'completed'
          AND p2.created_at > p.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM payment_recovery_log prl
        WHERE prl.payment_id = p.id
          AND prl.action LIKE 'abandoned_outreach%'
          AND prl.status = 'success'
      )
    ORDER BY p.user_id, p.created_at DESC
  `);

  console.log(`\n── TELEGRAM outreach: ${tgTargets.length} users ──`);
  let tgSent = 0, tgFailed = 0, tgSkipped = 0;

  if (!tg) {
    console.log('BOT_TOKEN not set — skipping Telegram outreach');
    tgSkipped = tgTargets.length;
  } else {
    for (const row of tgTargets) {
      const name = row.username || 'there';
      const lang = row.language || 'es';

      console.log(
        `[TG:${row.telegram}] @${row.username} | ${row.plan_id || 'no-plan'} $${row.amount} ` +
        `${row.status} via ${row.provider} ${DRY_RUN ? '[DRY]' : ''}`
      );

      if (DRY_RUN) { tgSkipped++; continue; }

      try {
        await tg.sendMessage(
          row.telegram,
          tgMsg(name, row.plan_id, row.amount, row.status, lang),
          { parse_mode: 'HTML', disable_web_page_preview: true }
        );

        await query(
          `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            row.payment_id,
            'abandoned_outreach_telegram',
            'success',
            JSON.stringify({ telegram: row.telegram, batchId: BATCH_ID }),
            BATCH_ID,
          ]
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
            [row.payment_id, 'abandoned_outreach_telegram', 'failed', err.message, BATCH_ID]
          );
        } catch {}
      }

      await sleep(TG_DELAY_MS);
    }
  }

  const totalSent = emailSent + tgSent;
  console.log(`\n── Summary ──`);
  console.log(`  Email  : sent=${emailSent}  failed=${emailFailed}  skipped=${emailSkipped}`);
  console.log(`  Telegram: sent=${tgSent}  failed=${tgFailed}  skipped=${tgSkipped}`);
  console.log(`  Total sent: ${totalSent}`);
  if (DRY_RUN) console.log(`\n  (Dry run — nothing was actually sent)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
