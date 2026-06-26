#!/usr/bin/env node
'use strict';

/**
 * rescue-lifetime100-2026-06-26-email-retry.js
 *
 * Follow-up email send for users who got a rescue invoice (run #1 + run #2)
 * but who were either email-only OR whose Telegram DM failed. Uses the
 * already-created NowPayments invoice URL stored in dash_subscription_orders
 * metadata. Does NOT create new invoices.
 *
 * Triggered because the main script read SMTP_PASS but the container provides
 * SMTP_PASSWORD, so all 33 email-fallback attempts in run #2 silently failed
 * with "Missing credentials for PLAIN".
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26-email-retry.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/rescue-lifetime100-2026-06-26-email-retry.js
 */

const path = require('path');
const fs   = require('fs');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const nodemailer = require('nodemailer');
const { query }  = require(path.join(BACKEND, 'config/postgres'));

const DRY_RUN     = process.argv.includes('--dry-run');
const SOURCE_TAG  = 'rescue-lifetime100-2026-06-26';
const EMAIL_DELAY = 1500;
const LOG_DIR     = fs.existsSync('/app/logs') ? '/app/logs' : '/opt/pnptvapp/logs';
const REPORT_PATH = path.join(LOG_DIR, `${SOURCE_TAG}-email-retry.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEs  = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

const EMAIL_SUBJECT = {
  es: '🔥 Tu acceso de por vida a PNPtv te espera — $95',
  en: '🔥 Your PNPtv lifetime access is waiting — $95',
};

function buildEmailHtml(lang, invoiceUrl) {
  const es = lang === 'es';
  const head = es ? 'ACCESO DE POR VIDA — $95' : 'LIFETIME ACCESS — $95';
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
        <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:#E69138;line-height:1.2;">🔥 ${head}</h1>
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
</body></html>`;
}

// ── Resolve known-TG-success uids from run #2 report ─────────────────────────
function loadRun2TgSuccessSet() {
  const reportPath = path.join(LOG_DIR, `${SOURCE_TAG}-live.json`);
  if (!fs.existsSync(reportPath)) {
    console.log(`  Run #2 report not found at ${reportPath} — assuming nobody got TG`);
    return new Set();
  }
  const d = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return new Set((d.entries || []).filter((e) => e.channel === 'telegram').map((e) => String(e.uid)));
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' Lifetime100 Rescue — Email Retry — 2026-06-26');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? ' MODE: DRY RUN' : ' MODE: LIVE — real emails');
  console.log();

  const smtpPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  if (!smtpPass && !DRY_RUN) {
    console.error('FATAL: SMTP_PASSWORD missing');
    process.exit(1);
  }

  const tgSuccessSet = loadRun2TgSuccessSet();
  console.log(`  Known TG successes from run #2: ${tgSuccessSet.size}`);

  // Pull all rescued users with real email; filter out anyone confirmed TG-delivered
  const { rows } = await query(`
    SELECT dso.user_id, dso.metadata->>'invoiceUrl' AS invoice_url,
           u.email, u.language
      FROM dash_subscription_orders dso
      JOIN users u ON u.id::text = dso.user_id
     WHERE dso.metadata->>'source' = $1
       AND u.email IS NOT NULL
       AND u.email NOT LIKE '%@telegram.pnptv.app'
       AND (dso.metadata->>'email_retry_at') IS NULL
  `, [SOURCE_TAG]);

  const targets = rows.filter((r) => !tgSuccessSet.has(String(r.user_id)));
  console.log(`  Eligible by email:               ${rows.length}`);
  console.log(`  After excluding TG successes:    ${targets.length}`);
  console.log();

  if (!targets.length) {
    console.log('No one to email — exiting.');
    process.exit(0);
  }

  const smtp = DRY_RUN ? null : nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: smtpPass },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });

  const report = [];
  const stats  = { sent: 0, failed: 0 };
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const lang = isEs(t.language) ? 'es' : 'en';
    const entry = { uid: t.user_id, lang, email: t.email, invoiceUrl: t.invoice_url };
    if (DRY_RUN) {
      entry.result = 'dry-run';
      report.push(entry);
      continue;
    }
    try {
      await smtp.sendMail({
        from: `Santino — PNPtv <${process.env.SMTP_USER}>`,
        to: t.email,
        subject: EMAIL_SUBJECT[lang],
        html: buildEmailHtml(lang, t.invoice_url),
      });
      await query(
        `UPDATE dash_subscription_orders
           SET metadata = jsonb_set(metadata, '{email_retry_at}', to_jsonb(NOW()::text), TRUE)
         WHERE metadata->>'source' = $1 AND user_id = $2`,
        [SOURCE_TAG, t.user_id]
      );
      stats.sent++;
      entry.result = 'sent';
    } catch (err) {
      stats.failed++;
      entry.result = 'failed';
      entry.error  = err.message;
    }
    report.push(entry);
    if ((i + 1) % 20 === 0) console.log(`  Progress: ${i + 1}/${targets.length} — sent ${stats.sent}, failed ${stats.failed}`);
    await sleep(EMAIL_DELAY);
  }

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    runAt: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    cohortSize: targets.length,
    stats,
    entries: report,
  }, null, 2));

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(` Email sent:    ${stats.sent}`);
  console.log(` Email failed:  ${stats.failed}`);
  console.log(` Report:        ${REPORT_PATH}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
