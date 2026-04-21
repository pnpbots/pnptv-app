#!/usr/bin/env node
'use strict';

/**
 * send-recovery-emails.js — one-shot recovery outreach for the 2026-04-21
 * ensureEmailCredentials / TOKENIZED_CHARGE_ERROR incident.
 *
 * 4 ePayco 3DS checkouts on 2026-04-21 hit HTTP 500 because of a missing
 * service export (`ensureEmailCredentials`). No money was captured. This
 * script emails each affected customer a bilingual apology + a single-use
 * 30% promo code valid 14 days, redeemable in the webapp at
 *   https://app.pnptv.app/subscribe?promo=<CODE>
 *
 * Usage (from inside pnptv-bot container):
 *   node apps/backend/scripts/send-recovery-emails.js
 */

require('dotenv').config();
require('dotenv').config({ path: '.env.production' });

const { query } = require('../config/postgres');
const EmailService = require('../services/emailservice');
const logger = require('../utils/logger');

const WEBAPP_DOMAIN = process.env.WEBAPP_DOMAIN || 'https://app.pnptv.app';
const FROM = process.env.PNPTV_FROM_EMAIL || 'support@pnptv.app';

const RECIPIENTS = [
  {
    paymentId: '625161a4-a2c9-4ced-a3c9-937bac0a4805',
    email: 'mechamrichard@gmail.com',
    language: 'en',
    plan: 'Prime Week Pass (7 days)',
    promoCode: 'SORRY-5BBC5AE5',
    originalAmount: 14.99,
    discountedAmount: 10.49,
  },
  {
    paymentId: '85c9434b-2841-4269-b14d-69c11636f8ad',
    email: 'radiopasta21@gmail.com',
    language: 'en',
    plan: 'Prime Diamond Pass (365 days)',
    promoCode: 'SORRY-E9A25826',
    originalAmount: 99.99,
    discountedAmount: 69.99,
  },
  {
    paymentId: 'a9774d11-b460-48fd-9503-0321f1fb7776',
    email: 'paparazziprince@gmail.com',
    language: 'en',
    plan: 'any plan (Prime Week or Crystal Pass)',
    promoCode: 'SORRY-E7B0C83D',
    originalAmount: null,
    discountedAmount: null,
  },
];

function buildHtml({ language, plan, promoCode, originalAmount, discountedAmount }) {
  const deepLink = `${WEBAPP_DOMAIN}/subscribe?promo=${promoCode}`;
  const es = language === 'es';

  const priceLine = originalAmount != null
    ? (es
      ? `<p style="font-size:13px;color:#A1A1A6;margin:4px 0 0;">Precio normal: <s>$${originalAmount.toFixed(2)}</s> &nbsp;→&nbsp; Con descuento: <strong style="color:#D4007A;">$${discountedAmount.toFixed(2)}</strong></p>`
      : `<p style="font-size:13px;color:#A1A1A6;margin:4px 0 0;">Normal price: <s>$${originalAmount.toFixed(2)}</s> &nbsp;→&nbsp; With discount: <strong style="color:#D4007A;">$${discountedAmount.toFixed(2)}</strong></p>`)
    : '';

  if (es) {
    return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
      <h2 style="color:#D4007A;margin-top:0;">Lo sentimos.</h2>
      <p>Hoy 21 de abril intentaste suscribirte en PNPtv y nuestro sistema falló. <strong>No se realizó ningún cargo a tu tarjeta</strong>, pero no pudiste completar tu compra — y eso es culpa nuestra.</p>
      <p>Para compensarte, aquí tienes un código de descuento del <strong>30%</strong> válido durante 14 días:</p>
      <div style="background:rgba(212,0,122,0.1);border-left:4px solid #D4007A;padding:16px;margin:16px 0;border-radius:4px;">
        <p style="margin:0;font-size:14px;color:#A1A1A6;">Código para ${plan}:</p>
        <p style="margin:4px 0 0;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:1px;">${promoCode}</p>
        ${priceLine}
      </div>
      <p style="margin:24px 0 8px;">Para canjearlo, toca el botón:</p>
      <a href="${deepLink}" style="display:inline-block;padding:14px 28px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Canjear 30% de descuento</a>
      <p style="font-size:12px;color:#A1A1A6;margin-top:16px;">El enlace abre la página de suscripción con el descuento ya aplicado. Válido hasta el 5 de mayo de 2026.</p>
      <p style="font-size:13px;margin-top:24px;">Gracias por tu paciencia — si tienes cualquier duda, responde este correo.</p>
      <p style="font-size:13px;">— Equipo PNPtv</p>
    </div>`;
  }

  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
    <h2 style="color:#D4007A;margin-top:0;">We're sorry.</h2>
    <p>Today (April 21) you tried to subscribe to PNPtv and our system failed. <strong>No charge was made to your card</strong> — but you couldn't complete your purchase, and that's on us.</p>
    <p>To make it right, here's a <strong>30% off</strong> code valid for 14 days:</p>
    <div style="background:rgba(212,0,122,0.1);border-left:4px solid #D4007A;padding:16px;margin:16px 0;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#A1A1A6;">Code for ${plan}:</p>
      <p style="margin:4px 0 0;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:1px;">${promoCode}</p>
      ${priceLine}
    </div>
    <p style="margin:24px 0 8px;">To redeem, tap the button:</p>
    <a href="${deepLink}" style="display:inline-block;padding:14px 28px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Redeem 30% off</a>
    <p style="font-size:12px;color:#A1A1A6;margin-top:16px;">The link opens your subscription page with the discount already applied. Valid through May 5, 2026.</p>
    <p style="font-size:13px;margin-top:24px;">Thanks for your patience — if anything's unclear, just reply to this email.</p>
    <p style="font-size:13px;">— The PNPtv team</p>
  </div>`;
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));

  const transporter = EmailService.transporters?.pnptv;
  if (!transporter) {
    console.error('✖ PNPtv SMTP transporter not available — check PNPTV_SMTP_* env vars.');
    process.exit(1);
  }

  const results = [];
  for (const r of RECIPIENTS) {
    try {
      const subject = r.language === 'es'
        ? 'Disculpas por el error de checkout — 30% de descuento para ti'
        : 'Sorry about the checkout error — 30% off on us';
      const html = buildHtml(r);
      const info = await transporter.sendMail({
        from: FROM,
        to: r.email,
        subject,
        html,
      });
      console.log(`✓ Sent to ${r.email} (code ${r.promoCode}) — messageId=${info.messageId}`);
      results.push({ ...r, sent: true, messageId: info.messageId });
    } catch (err) {
      console.error(`✖ Failed to send to ${r.email}: ${err.message}`);
      results.push({ ...r, sent: false, error: err.message });
    }
  }

  for (const r of results.filter((x) => x.sent)) {
    try {
      await query(
        `INSERT INTO payment_recovery_log (payment_id, action, status, result, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          r.paymentId,
          'apology_email_sent',
          'success',
          JSON.stringify({
            email: r.email,
            promoCode: r.promoCode,
            messageId: r.messageId,
            incident: '2026-04-21_ensureEmailCredentials_typeerror',
          }),
          'system-recovery-2026-04-21',
        ]
      );
    } catch (err) {
      logger.warn('Failed to log recovery action (non-critical)', { paymentId: r.paymentId, error: err.message });
    }
  }

  console.log(`\nSummary: ${results.filter((r) => r.sent).length}/${results.length} emails sent.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
