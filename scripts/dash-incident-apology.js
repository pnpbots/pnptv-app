#!/usr/bin/env node
/**
 * Apology + compensation flow for Dash payment recipients impacted by the
 * Apr 2026 webhook URL misconfiguration (BTCPay was sending to /webhook/btcpay,
 * bot listens at /api/webhooks/btcpay → 404, every payment stayed pending).
 *
 * Per-user actions:
 *   - Lifetime users        → flag for manual refund/contact, send special DM
 *   - Active subscribers    → extend PRIME entitlements + plan_expiry by
 *                              max(7, ceil(delay_days)) bonus days, send DM
 *   - Orphan (no users row) → send DM to TG ID with login instructions
 *
 * Run with: node dash-incident-apology.js [--dry-run]
 */
require('dotenv').config({ path: '/app/.env' });
require('dotenv').config({ path: '/app/.env.production' });

const { query } = require('/app/apps/backend/config/postgres');
const { Telegraf } = require('telegraf');
const EmailService = require('/app/apps/backend/services/emailservice');
const logger = require('/app/apps/backend/utils/logger');

const DRY = process.argv.includes('--dry-run');
const bot = new Telegraf(process.env.BOT_TOKEN);

function buildMessage({ lang, planName, paidAt, bonusDays, newExpiry, isLifetime, isOrphan }) {
  const date = (d) => new Date(d).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US');

  if (isOrphan) {
    if (lang === 'es') {
      return `🙏 *Disculpas — pago Dash pendiente*\n\n`
           + `Detectamos que pagaste $${planName ? '' : ''}por *${planName}* el ${date(paidAt)} vía Dash, ` +
             `pero por un error en la configuración de nuestro webhook tu pago nunca se procesó automáticamente.\n\n`
           + `✅ Tu pago ya está acreditado en nuestro sistema. Para reclamar tu membresía:\n\n`
           + `1. Inicia sesión en https://app.pnptv.app\n`
           + `2. Tu Telegram ID será reconocido y tu PRIME se aplicará al instante\n\n`
           + `Como compensación por la espera, te otorgaremos *días extra* al iniciar sesión.\n\n`
           + `Si tienes problemas, responde a este mensaje y un humano te ayudará.\n\n`
           + `Lo sentimos mucho. — Equipo PNPtv`;
    }
    return `🙏 *Apology — Dash payment pending*\n\n`
         + `We noticed you paid for *${planName}* on ${date(paidAt)} via Dash, ` +
           `but a misconfigured webhook on our side meant your payment never processed automatically.\n\n`
         + `✅ Your payment is now credited in our system. To claim your membership:\n\n`
         + `1. Log in at https://app.pnptv.app\n`
         + `2. Your Telegram ID will be recognized and PRIME applied instantly\n\n`
         + `As compensation for the wait, we'll grant you *bonus days* once you log in.\n\n`
         + `Reply to this message if you hit any trouble — a human will help.\n\n`
         + `We're sorry. — PNPtv team`;
  }

  if (isLifetime) {
    if (lang === 'es') {
      return `🙏 *Disculpas — pago Dash duplicado*\n\n`
           + `Pagaste $${planName ? '' : ''}por *${planName}* el ${date(paidAt)} vía Dash, pero ya tienes membresía *vitalicia* (lifetime). ` +
             `Por un error de configuración nuestro webhook nunca procesó tu pago a tiempo y no pudimos avisarte.\n\n`
           + `Como ya disfrutas de PRIME para siempre, te ofrecemos:\n\n`
           + `• 💰 *Reembolso completo en Dash* — responde a este mensaje con tu dirección Dash\n`
           + `• 🎁 O un *crédito de tienda* equivalente para futuras compras\n\n`
           + `Lo sentimos profundamente. — Equipo PNPtv`;
    }
    return `🙏 *Apology — duplicate Dash payment*\n\n`
         + `You paid for *${planName}* on ${date(paidAt)} via Dash, but you already hold a *lifetime* membership. ` +
           `A misconfigured webhook on our side meant your payment never processed and we couldn't flag it.\n\n`
         + `Since you already enjoy PRIME forever, we'd like to offer:\n\n`
         + `• 💰 *Full Dash refund* — reply to this message with your Dash address\n`
         + `• 🎁 Or equivalent *store credit* toward future purchases\n\n`
         + `We're truly sorry. — PNPtv team`;
  }

  if (lang === 'es') {
    return `🙏 *Disculpas — tu PRIME llegó tarde*\n\n`
         + `Pagaste *${planName}* el ${date(paidAt)} vía Dash. Tu pago se confirmó en blockchain, ` +
           `pero un error en la configuración del webhook hizo que tu PRIME no se activara hasta hoy.\n\n`
         + `✅ *Tu PRIME ya está activo* y como compensación por la espera te otorgamos:\n\n`
         + `🎁 *+${bonusDays} días extra* sobre tu plan original\n`
         + `📅 *Nuevo vencimiento:* ${date(newExpiry)}\n\n`
         + `Lamentamos profundamente la demora. Estamos trabajando para que esto no vuelva a pasar.\n\n`
         + `Disfruta tu acceso. — Equipo PNPtv 🔥`;
  }
  return `🙏 *Apology — your PRIME arrived late*\n\n`
       + `You paid for *${planName}* on ${date(paidAt)} via Dash. Your payment confirmed on-chain, ` +
         `but a misconfigured webhook on our side meant your PRIME wasn't activated until today.\n\n`
       + `✅ *Your PRIME is now active.* As compensation for the wait we've granted:\n\n`
       + `🎁 *+${bonusDays} bonus days* on top of your paid plan\n`
       + `📅 *New expiry:* ${date(newExpiry)}\n\n`
       + `We're deeply sorry for the delay. We've fixed the root cause so this won't happen again.\n\n`
       + `Enjoy your access. — PNPtv team 🔥`;
}

async function sendDM(telegramId, message) {
  if (DRY) {
    console.log(`[DRY] would DM ${telegramId}:\n${message.slice(0, 200)}…\n`);
    return { ok: true, dry: true };
  }
  try {
    await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function buildEmailHtml({ lang, planName, paidAt, bonusDays, newExpiry, isLifetime }) {
  const date = (d) => new Date(d).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US');
  if (isLifetime) {
    if (lang === 'es') {
      return `<p>Hola,</p><p>Pagaste por <strong>${planName}</strong> el ${date(paidAt)} vía Dash, pero ya tienes membresía <strong>vitalicia</strong>. Por un error en la configuración de nuestro webhook, tu pago no se procesó a tiempo y no pudimos notificarte.</p><p>Te ofrecemos:</p><ul><li>💰 <strong>Reembolso completo en Dash</strong> — responde a este correo con tu dirección Dash</li><li>🎁 O <strong>crédito equivalente</strong> para futuras compras</li></ul><p>Lamentamos profundamente la situación.</p><p>— Equipo PNPtv</p>`;
    }
    return `<p>Hi,</p><p>You paid for <strong>${planName}</strong> on ${date(paidAt)} via Dash, but you already hold a <strong>lifetime</strong> membership. A misconfigured webhook meant your payment didn't process in time and we couldn't flag it.</p><p>We'd like to offer:</p><ul><li>💰 <strong>Full Dash refund</strong> — reply to this email with your Dash address</li><li>🎁 Or equivalent <strong>store credit</strong> for future purchases</li></ul><p>We're truly sorry.</p><p>— PNPtv team</p>`;
  }
  if (lang === 'es') {
    return `<p>Hola,</p><p>Pagaste <strong>${planName}</strong> el ${date(paidAt)} vía Dash. Tu pago se confirmó en blockchain, pero un error en la configuración de nuestro webhook hizo que tu PRIME no se activara hasta hoy.</p><p>✅ <strong>Tu PRIME ya está activo</strong> y como compensación te otorgamos:</p><ul><li>🎁 <strong>+${bonusDays} días extra</strong></li><li>📅 <strong>Nuevo vencimiento:</strong> ${date(newExpiry)}</li></ul><p>Lamentamos profundamente la demora. Estamos trabajando para que esto no vuelva a pasar.</p><p>Disfruta tu acceso. — Equipo PNPtv 🔥</p>`;
  }
  return `<p>Hi,</p><p>You paid for <strong>${planName}</strong> on ${date(paidAt)} via Dash. Your payment confirmed on-chain, but a misconfigured webhook on our side meant your PRIME wasn't activated until today.</p><p>✅ <strong>Your PRIME is now active.</strong> As compensation we've granted:</p><ul><li>🎁 <strong>+${bonusDays} bonus days</strong></li><li>📅 <strong>New expiry:</strong> ${date(newExpiry)}</li></ul><p>We're deeply sorry for the delay. The root cause is fixed so this won't happen again.</p><p>Enjoy your access. — PNPtv team 🔥</p>`;
}

async function sendApologyEmail(to, ctx) {
  if (DRY) {
    console.log(`[DRY] would EMAIL ${to} (${ctx.isLifetime ? 'lifetime-refund-offer' : 'extension'})`);
    return { ok: true, dry: true };
  }
  const transporter = EmailService.transporters.pnptv;
  if (!transporter) {
    return { ok: false, error: 'pnptv_transporter_not_configured' };
  }
  const subject = ctx.lang === 'es'
    ? (ctx.isLifetime ? '🙏 Disculpas — pago Dash duplicado' : '🙏 Disculpas — tu PRIME llegó tarde')
    : (ctx.isLifetime ? '🙏 Apology — duplicate Dash payment' : '🙏 Apology — your PRIME arrived late');
  try {
    const result = await transporter.sendMail({
      from: '"PNPtv Support" <support@pnptv.app>',
      to,
      subject,
      html: buildEmailHtml(ctx),
    });
    return { ok: true, messageId: result.messageId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

(async () => {
  // Pull the 17 backfilled orders + dedupe per user (multiple orders → use longest delay)
  const { rows: orders } = await query(`
    SELECT user_id, plan_id, btcpay_invoice_id, created_at, completed_at,
           EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0 AS delay_days
    FROM dash_subscription_orders
    WHERE status = 'completed'
      AND completed_at > NOW() - INTERVAL '24 hours'
      AND completed_at - created_at > INTERVAL '1 hour'
    ORDER BY user_id, created_at DESC
  `);

  // Group by user, summing delay days across multiple delayed orders
  const byUser = new Map();
  for (const o of orders) {
    const cur = byUser.get(o.user_id) || { user_id: o.user_id, orders: [], total_delay: 0 };
    cur.orders.push(o);
    cur.total_delay += parseFloat(o.delay_days);
    byUser.set(o.user_id, cur);
  }

  console.log(`[${DRY ? 'DRY' : 'LIVE'}] ${orders.length} orders across ${byUser.size} users\n`);

  const summary = { extended: 0, lifetime: 0, orphan: 0, dm_ok: 0, dm_fail: 0, email_ok: 0, email_fail: 0, no_contact: 0 };

  for (const [userId, agg] of byUser) {
    const latest = agg.orders[0];
    const planName = latest.plan_id;
    const paidAt = agg.orders[agg.orders.length - 1].created_at; // earliest paid
    const bonusDays = Math.max(7, Math.ceil(agg.total_delay));

    // Look up user (by id or telegram)
    const { rows: userRows } = await query(
      `SELECT u.id, u.telegram, u.email, u.language, u.tier, u.plan_id, u.plan_expiry,
              (SELECT COUNT(*) FROM user_entitlements WHERE user_id = u.id::text AND is_lifetime = true) AS lifetime_count
       FROM users u
       WHERE u.id::text = $1 OR u.telegram = $1
       LIMIT 1`,
      [userId]
    );

    if (userRows.length === 0) {
      // Orphan — paid via Dash but never created users row
      summary.orphan++;
      console.log(`\n→ ORPHAN ${userId} (paid ${planName} ${paidAt}, delay ${agg.total_delay.toFixed(1)}d)`);
      const msg = buildMessage({ lang: 'en', planName, paidAt, isOrphan: true });
      const r = await sendDM(userId, msg);
      if (r.ok) summary.dm_ok++; else summary.dm_fail++;
      console.log(`   DM: ${r.ok ? 'sent' : 'failed: ' + r.error}`);
      continue;
    }

    const u = userRows[0];
    const lang = u.language || 'en';
    const isLifetime = parseInt(u.lifetime_count, 10) > 0;

    if (isLifetime) {
      summary.lifetime++;
      console.log(`\n→ LIFETIME ${userId} ${u.email || ''} (paid ${planName}, delay ${agg.total_delay.toFixed(1)}d)`);
      // No extension — they're already lifetime. Send refund offer DM.
      // Mark in DB notes for audit.
      if (!DRY) {
        await query(
          `UPDATE dash_subscription_orders
             SET notes = COALESCE(notes,'') || ' refund_pending_lifetime_user'
           WHERE user_id = $1 AND status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'`,
          [userId]
        );
      }
      if (u.telegram) {
        const msg = buildMessage({ lang, planName, paidAt, isLifetime: true });
        const r = await sendDM(u.telegram, msg);
        if (r.ok) summary.dm_ok++; else summary.dm_fail++;
        console.log(`   DM (${lang}): ${r.ok ? 'sent' : 'failed: ' + r.error}`);
      } else if (u.email) {
        const r = await sendApologyEmail(u.email, { lang, planName, paidAt, isLifetime: true });
        if (r.ok) summary.email_ok++; else summary.email_fail++;
        console.log(`   EMAIL (${lang}): ${r.ok ? 'sent' : 'failed: ' + r.error}`);
      } else {
        summary.no_contact++;
        console.log(`   no telegram + no email — manual outreach required`);
      }
      continue;
    }

    // Active subscriber — extend their PRIME entitlements + plan_expiry by bonusDays
    summary.extended++;
    console.log(`\n→ EXTEND ${userId} ${u.email || ''} (${planName}, delay ${agg.total_delay.toFixed(1)}d → +${bonusDays}d)`);

    let newExpiry = null;
    if (!DRY) {
      // Extend non-lifetime PRIME + member entitlements
      const upd = await query(
        `UPDATE user_entitlements
           SET expires_at = expires_at + ($2 || ' days')::interval, updated_at = NOW()
         WHERE user_id = $1
           AND is_lifetime = false
           AND is_consumed = false
           AND expires_at IS NOT NULL
           AND add_on_id IN ('prime', 'pnp-member')
         RETURNING add_on_id, expires_at`,
        [u.id, bonusDays]
      );
      // Update users.plan_expiry to match the longest entitlement
      const ent = upd.rows.find(r => r.add_on_id === 'prime') || upd.rows[0];
      newExpiry = ent?.expires_at || null;
      if (newExpiry) {
        await query(
          `UPDATE users SET plan_expiry = $2, updated_at = NOW() WHERE id = $1`,
          [u.id, newExpiry]
        );
      }
      console.log(`   extended ${upd.rowCount} entitlements; new prime expiry: ${newExpiry}`);
    } else {
      // Calculate dry-run preview expiry
      newExpiry = u.plan_expiry ? new Date(new Date(u.plan_expiry).getTime() + bonusDays * 86400000) : new Date(Date.now() + bonusDays * 86400000);
    }

    if (u.telegram) {
      const msg = buildMessage({ lang, planName, paidAt, bonusDays, newExpiry });
      const r = await sendDM(u.telegram, msg);
      if (r.ok) summary.dm_ok++; else summary.dm_fail++;
      console.log(`   DM (${lang}): ${r.ok ? 'sent' : 'failed: ' + r.error}`);
    } else if (u.email) {
      const r = await sendApologyEmail(u.email, { lang, planName, paidAt, bonusDays, newExpiry });
      if (r.ok) summary.email_ok++; else summary.email_fail++;
      console.log(`   EMAIL (${lang}): ${r.ok ? 'sent' : 'failed: ' + r.error}`);
    } else {
      summary.no_contact++;
      console.log(`   no telegram + no email — manual outreach required`);
    }

    // Telegraf rate limit safety — 1 msg/sec max to a given user is fine, but
    // bot-wide is ~30/sec. Keep a 1.5s gap to be safe.
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n────────── Summary ──────────');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});
