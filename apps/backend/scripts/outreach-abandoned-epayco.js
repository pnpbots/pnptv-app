#!/usr/bin/env node
'use strict';

/**
 * outreach-abandoned-epayco.js
 *
 * Sends a recovery email to users who abandoned an ePayco payment 1–7 days ago.
 * Skips users already contacted. Logs every send to payment_recovery_log.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-abandoned-epayco.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/outreach-abandoned-epayco.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const nodemailer = require('nodemailer');

const DRY_RUN     = process.argv.includes('--dry-run');
const DELAY_MS    = 1200; // ~50 emails/min, well within Hostinger limits
const BATCH_ID    = `abandoned-epayco-${new Date().toISOString().slice(0, 10)}`;
const SUBSCRIBE   = 'https://pnptv.app/subscribe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

const PLAN_LABELS = {
  'lifetime80':              'Lifetime PRIME — $80',
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

function emailHtml(name, planId, lang) {
  const plan = planLabel(planId);
  const es = isEs(lang);
  if (es) {
    return `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
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
    También puedes pagar con <strong>USDC</strong> o <strong>Dash</strong> si la tarjeta sigue fallando.
    Ambas opciones están disponibles en la misma página de suscripción.
  </p>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; Para darte de baja de estos correos, contáctanos.
  </div>
</div>
</body></html>`;
  }
  return `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
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
    You can also pay with <strong>USDC</strong> or <strong>Dash</strong> if your card keeps failing —
    both options are available on the same subscribe page.
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

  const transporter = nodemailer.createTransport({
    host:   process.env.EASYBOTS_SMTP_HOST || 'smtp.hostinger.com',
    port:   parseInt(process.env.EASYBOTS_SMTP_PORT || '587', 10),
    secure: process.env.EASYBOTS_SMTP_SECURE === 'true',
    auth:   { user: process.env.EASYBOTS_SMTP_USER, pass: process.env.EASYBOTS_SMTP_PASS },
  });

  // Fetch recently abandoned ePayco payments (1–7 days old) with real email
  // Deduplicate by user — pick highest-value abandoned payment per user
  const { rows: targets } = await query(`
    SELECT DISTINCT ON (p.user_id)
      p.id as payment_id,
      p.user_id,
      p.amount,
      p.plan_id,
      p.created_at,
      u.username,
      u.email,
      u.language
    FROM payments p
    JOIN users u ON p.user_id = u.id
    WHERE p.status = 'abandoned'
      AND p.provider = 'epayco'
      AND p.created_at >= NOW() - INTERVAL '7 days'
      AND p.created_at < NOW() - INTERVAL '1 day'
      AND u.email IS NOT NULL
      AND u.email NOT LIKE '%@telegram.pnptv.app'
      AND u.email NOT LIKE '%@example.com'
      AND NOT EXISTS (
        SELECT 1 FROM payment_recovery_log prl
        WHERE prl.payment_id = p.id
          AND prl.action LIKE 'abandoned_outreach%'
          AND prl.status = 'success'
      )
    ORDER BY p.user_id, p.amount DESC
  `);

  console.log(`Found ${targets.length} users to contact`);

  let sent = 0, failed = 0, skipped = 0;

  for (const row of targets) {
    const name = row.username || 'there';
    const lang = row.language || 'en';
    const subject = isEs(lang)
      ? 'Tu pago en PNPtv no se completó — inténtalo de nuevo'
      : 'Your PNPtv payment didn\'t complete — try again';

    console.log(`[${row.email}] ${row.plan_id} $${row.amount} (${lang}) ${DRY_RUN ? '[DRY]' : ''}`);

    if (DRY_RUN) {
      skipped++;
      continue;
    }

    try {
      const result = await transporter.sendMail({
        to: row.email,
        subject,
        html: emailHtml(name, row.plan_id, lang),
        from: 'PNPtv! <hello@easybots.store>',
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

      sent++;
      console.log(`  ✓ sent (messageId: ${result?.messageId})`);
    } catch (err) {
      failed++;
      console.error(`  ✗ failed: ${err.message}`);
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

  console.log(`\nDone. sent=${sent} failed=${failed} skipped=${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
