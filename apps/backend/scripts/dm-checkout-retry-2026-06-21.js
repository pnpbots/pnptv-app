#!/usr/bin/env node
'use strict';
/**
 * dm-checkout-retry-2026-06-21.js
 *
 * One-shot outreach to users who started checkout today but never
 * completed card entry (no_tokenization_attempt + did not later complete).
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/dm-checkout-retry-2026-06-21.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/dm-checkout-retry-2026-06-21.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, initializePostgres } = require(path.join(BACKEND, 'config/postgres'));
const nodemailer = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN = process.argv.includes('--dry-run');
const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isEs = (lang) => typeof lang === 'string' && lang.toLowerCase().startsWith('es');

// ── Outreach targets (from today's abandoned no_tokenization_attempt, excluding
//    users who already completed a payment today) ──────────────────────────────
const TARGET_QUERY = `
  WITH abandoned AS (
    SELECT DISTINCT ON (user_id) user_id, plan_id, amount, created_at
    FROM payments
    WHERE created_at >= '2026-06-21 00:00:00'
      AND status = 'abandoned'
      AND metadata->>'reason' = 'no_tokenization_attempt'
    ORDER BY user_id, amount DESC
  ),
  completed_today AS (
    SELECT DISTINCT user_id FROM payments
    WHERE created_at >= '2026-06-21 00:00:00'
      AND status = 'completed'
  )
  SELECT a.user_id, a.plan_id, a.amount,
         u.username, u.first_name, u.email, u.telegram, u.language
  FROM abandoned a
  JOIN users u ON u.id = a.user_id
  LEFT JOIN completed_today c ON c.user_id = a.user_id
  WHERE c.user_id IS NULL
    AND COALESCE(u.is_deleted, false) = false
  ORDER BY a.amount DESC;
`;

function tgMsg(firstName, lang, planId, amount) {
  const name = firstName || 'there';
  const es = isEs(lang);
  const planHint = planId && planId.includes('week') ? (es ? 'el pase semanal' : 'the weekly pass')
    : planId && planId.includes('month') ? (es ? 'el pase mensual' : 'the monthly pass')
    : planId && planId.includes('diamond') ? (es ? 'el pase anual PRIME' : 'the annual PRIME pass')
    : planId && planId.includes('lifetime') ? (es ? 'el pase de por vida' : 'the lifetime pass')
    : planId && planId.includes('token') ? (es ? 'tokens PNP' : 'PNP tokens')
    : (es ? 'tu suscripción' : 'your subscription');
  const amtStr = `$${Number(amount).toFixed(2)}`;

  if (es) {
    return `👋 <b>Hola ${name}!</b>\n\n` +
      `Notamos que intentaste completar el pago de <b>${planHint} (${amtStr})</b> en PNPtv! hoy, pero parece que hubo un problema al cargar el formulario de pago.\n\n` +
      `Corregimos un problema en el checkout que podía hacer que la página se viera confusa — el precio ahora se muestra claramente en USD y el formulario carga más rápido.\n\n` +
      `👉 <a href="${SUBSCRIBE_URL}">Intenta de nuevo → pnptv.app/subscribe</a>\n\n` +
      `Si tienes algún problema, responde aquí y te ayudamos.`;
  }
  return `👋 <b>Hey ${name}!</b>\n\n` +
    `We noticed you started checkout for <b>${planHint} (${amtStr})</b> on PNPtv! today, but it looks like the payment form had trouble loading.\n\n` +
    `We just fixed an issue in the checkout — the price now shows clearly in USD and the form loads faster.\n\n` +
    `👉 <a href="${SUBSCRIBE_URL}">Try again → pnptv.app/subscribe</a>\n\n` +
    `If you run into any issues, just reply here and we'll help you out.`;
}

function emailHtml(firstName, lang, planId, amount) {
  const name = firstName || (isEs(lang) ? 'Miembro' : 'Member');
  const es = isEs(lang);
  const amtStr = `$${Number(amount).toFixed(2)}`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0D0D0F;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#1C1C1E;border-radius:16px;padding:36px 28px;border:1px solid rgba(212,0,122,0.2);">
  <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px;">PNPtv<span style="color:#D4007A;">!</span></div>
  <div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:28px;">${es ? 'Tu comunidad' : 'Your community'}</div>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">${es ? `Hola <strong>${name}</strong>,` : `Hey <strong>${name}</strong>,`}</p>
  <p style="color:#ccc;font-size:15px;line-height:1.6;">
    ${es
      ? `Notamos que empezaste el proceso de pago hoy <strong style="color:#fff;">(${amtStr})</strong> pero parece que el formulario de pago tuvo problemas al cargar.`
      : `We noticed you started checkout today <strong style="color:#fff;">(${amtStr})</strong> but the payment form seems to have had trouble loading.`
    }
  </p>
  <p style="color:#ccc;font-size:14px;line-height:1.6;">
    ${es
      ? 'Corregimos el checkout: el precio ahora se muestra claramente en USD y el formulario carga más rápido en móviles.'
      : 'We just fixed the checkout: the price now shows clearly in USD and the form loads faster on mobile.'}
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${SUBSCRIBE_URL}" style="display:inline-block;background:linear-gradient(135deg,#D4007A,#E69138);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">${es ? 'Intentar de nuevo →' : 'Try again →'}</a>
  </div>
  <p style="color:#666;font-size:12px;">${es ? '¿Necesitas ayuda? Responde a este correo.' : 'Need help? Just reply to this email.'}</p>
  <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);color:#555;font-size:11px;">
    PNPtv! — pnptv.app &nbsp;·&nbsp; support@pnptv.app
  </div>
</div>
</body></html>`;
}

async function main() {
  await initializePostgres();
  const { rows: targets } = await query(TARGET_QUERY);

  console.log(`\nTargets: ${targets.length}`);
  targets.forEach(t => console.log(`  @${t.username} — ${t.plan_id} $${t.amount} — TG:${t.telegram || '—'} email:${t.email || '—'}`));

  if (!targets.length) { console.log('Nothing to do.'); process.exit(0); }

  const tg = process.env.BOT_TOKEN ? new Telegram(process.env.BOT_TOKEN) : null;
  let tgSent = 0, tgFailed = 0, emailSent = 0, emailFailed = 0;

  // ── Telegram ──────────────────────────────────────────────────────────────
  const withTg = targets.filter(t => t.telegram);
  if (withTg.length) {
    console.log(`\nTelegram DMs to ${withTg.length} users...`);
    for (const t of withTg) {
      const msg = tgMsg(t.first_name, t.language, t.plan_id, t.amount);
      console.log(`  [TG:${t.telegram}] @${t.username} ${DRY_RUN ? '[DRY]' : ''}`);
      if (DRY_RUN) { tgSent++; continue; }
      try {
        await tg.sendMessage(t.telegram, msg, { parse_mode: 'HTML', disable_web_page_preview: false });
        tgSent++;
        console.log('    ✓');
      } catch (err) {
        tgFailed++;
        console.warn(`    ✗ ${err.message}`);
      }
      await sleep(400);
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  const withEmail = targets.filter(t => t.email && !t.email.includes('@telegram.pnptv.app'));
  if (withEmail.length) {
    console.log(`\nEmail to ${withEmail.length} users...`);
    const transporter = nodemailer.createTransport({
      host:   process.env.PNPTV_SMTP_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com',
      port:   parseInt(process.env.PNPTV_SMTP_PORT || process.env.SMTP_PORT || '587', 10),
      secure: (process.env.PNPTV_SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
      auth: {
        user: process.env.PNPTV_SMTP_USER || process.env.SMTP_USER,
        pass: process.env.PNPTV_SMTP_PASS || process.env.SMTP_PASS,
      },
    });

    for (const t of withEmail) {
      const es = isEs(t.language);
      const subject = es
        ? 'PNPtv! — Tu pago no se completó, aquí te ayudamos'
        : 'PNPtv! — Your checkout had a hiccup — try again';
      console.log(`  [email:${t.email}] @${t.username} ${DRY_RUN ? '[DRY]' : ''}`);
      if (DRY_RUN) { emailSent++; continue; }
      try {
        await transporter.sendMail({
          from: '"PNPtv!" <support@pnptv.app>',
          to: t.email,
          subject,
          html: emailHtml(t.first_name, t.language, t.plan_id, t.amount),
        });
        emailSent++;
        console.log('    ✓');
      } catch (err) {
        emailFailed++;
        console.warn(`    ✗ ${err.message}`);
      }
      await sleep(1500);
    }
  }

  console.log(`
════════════════════════════════════
 DONE
  Telegram: ${tgSent} sent / ${tgFailed} failed
  Email:    ${emailSent} sent / ${emailFailed} failed
════════════════════════════════════`);
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
