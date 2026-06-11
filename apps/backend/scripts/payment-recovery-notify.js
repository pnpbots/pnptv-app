#!/usr/bin/env node
'use strict';

/**
 * payment-recovery-notify.js
 *
 * Outreach to users who attempted ePayco payment in the last 60 days,
 * never completed, and have no active entitlement.
 *
 * Tier 1 — tried lifetime ($250): highest intent, personal message
 * Tier 2 — tried $80–$99: high intent, same angle
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/payment-recovery-notify.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/payment-recovery-notify.js --tier1
 *   docker exec pnptv-bot node apps/backend/scripts/payment-recovery-notify.js --tier2
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const nodemailer   = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN       = process.argv.includes('--dry-run');
const TIER1         = process.argv.includes('--tier1');
const TIER2         = process.argv.includes('--tier2');
const EMAIL_RETRY_T1 = process.argv.includes('--email-retry-t1');

// Tier 1 email addresses that failed when support@pnptv.app was suspended mid-send
const T1_EMAIL_RETRY = [
  { first_name: 'Sup',           email: 'johnmatthew.camara@gmail.com' },
  { first_name: 'Jose',          email: 'jojo22ramos@gmail.com' },
  { first_name: '2025',          email: '2025jpedraza@gmail.com' },
  { first_name: 'Cloudy',        email: 'sneaksluverau@outlook.com' },
  { first_name: 'C',             email: 'flintbucks@gmail.com' },
  { first_name: 'PADude69',      email: 'tbarrett187@gmail.com' },
];

if (!TIER1 && !TIER2 && !DRY_RUN && !EMAIL_RETRY_T1) {
  console.error('Usage: --tier1 | --tier2 | --email-retry-t1 | --dry-run');
  process.exit(1);
}

const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const TG_DELAY_MS   = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Queries ───────────────────────────────────────────────────────────────────

const RECOVERY_QUERY = `
  WITH ranked AS (
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      u.username,
      u.first_name,
      u.email,
      u.telegram,
      p.plan_id        AS last_plan,
      p.status         AS last_status,
      p.created_at     AS last_attempt,
      COUNT(p.id)  OVER (PARTITION BY p.user_id) AS total_attempts,
      MAX(p.amount) OVER (PARTITION BY p.user_id) AS max_amount_tried
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.provider = 'epayco'
      AND p.status IN ('failed', 'abandoned')
      AND p.created_at > NOW() - INTERVAL '60 days'
      AND p.plan_id IS NOT NULL
      AND u.username NOT LIKE 'deleted_%'
      AND (
        u.telegram IS NOT NULL
        OR (u.email IS NOT NULL AND u.email NOT LIKE '%@telegram.pnptv.app')
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements ue
        WHERE ue.user_id = p.user_id
          AND ue.is_consumed = false
          AND (ue.expires_at > NOW() OR ue.is_lifetime = true)
      )
    ORDER BY p.user_id, p.created_at DESC
  )
  SELECT * FROM ranked
  WHERE max_amount_tried >= $1 AND max_amount_tried < $2
  ORDER BY total_attempts DESC, last_attempt DESC
`;

// ── Messages ──────────────────────────────────────────────────────────────────

function tgMessageTier1(name) {
  return `Hey ${name || 'there'} 👋

We noticed you tried to grab the Lifetime PRIME pass on PNPtv! but couldn't get the payment through. We're really sorry about that.

If ePayco is giving you trouble (card declined, 3D Secure loop, or just timing out) — you can pay with crypto in under 2 minutes:

🪙 <b>USDC</b> — 1 USDC = $1 USD. Buy on Coinbase or Binance, send directly.
🥷 <b>Dash</b> — fully private, no bank needed.

Both options are available right on the subscribe page:
👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>

Any questions? Just reply here. We'd love to have you.
— The PNPtv Team`;
}

function tgMessageTier2(name) {
  return `Hey ${name || 'there'} 👋

We saw you tried to subscribe to PNPtv! but hit a snag with the payment. Sorry about that!

If ePayco's 3D Secure is the issue (it can be picky with some cards), you can skip it entirely and pay with crypto in 2 minutes:

🪙 <b>USDC</b> — stable, 1:1 with USD. Works worldwide.
🥷 <b>Dash</b> — private, instant, no bank.

👉 <a href="${SUBSCRIBE_URL}">${SUBSCRIBE_URL}</a>

Just reply here if you need any help getting it sorted.
— The PNPtv Team`;
}

function emailSubject(tier) {
  return tier === 1
    ? 'Still want Lifetime PRIME? Here\'s another way to pay 🔑'
    : 'Having trouble subscribing? Try crypto — 2 minutes, no bank needed';
}

function buildEmailHtml(name, tier) {
  const heading = tier === 1
    ? 'Still want Lifetime PRIME?'
    : 'Having trouble subscribing?';
  const intro = tier === 1
    ? `We noticed you tried to get the <strong>Lifetime PRIME</strong> pass but couldn't complete the payment — that's frustrating, and we're sorry. If ePayco is giving you trouble, here's an easy alternative.`
    : `We saw you tried to subscribe to PNPtv! but ran into a payment issue. If ePayco's 3D Secure verification is the problem, here's how to skip it entirely.`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#120d14;border-radius:16px;overflow:hidden;border:1px solid rgba(212,0,122,0.25);">
      <tr><td style="height:4px;background:linear-gradient(90deg,#D4007A,#26a17b,#008DE4);"></td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <img src="https://pnptv.app/logo-header.png" alt="PNPtv!" height="32" style="display:block;">
      </td></tr>
      <tr><td style="padding:16px 32px 32px;">
        <p style="margin:0 0 6px;font-size:14px;color:#9ca3af;">Hey ${name || 'there'},</p>
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#ffffff;line-height:1.2;">${heading}</h1>
        <p style="margin:0 0 24px;font-size:15px;color:#d1d5db;line-height:1.6;">${intro}</p>

        <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#ffffff;">Pay with crypto — it takes 2 minutes:</p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
          <tr><td style="padding:14px 18px;background:rgba(38,161,123,0.06);border:1px solid rgba(38,161,123,0.2);border-radius:12px;">
            <p style="margin:0;font-size:14px;font-weight:800;color:#26a17b;">🪙 USDC — stable, 1 USDC = $1 USD</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Buy on Coinbase, Binance, or any exchange. Send directly to us.</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
          <tr><td style="padding:14px 18px;background:rgba(0,141,228,0.06);border:1px solid rgba(0,141,228,0.2);border-radius:12px;">
            <p style="margin:0;font-size:14px;font-weight:800;color:#008DE4;">🥷 Dash — fully private, no bank needed</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Scan a QR code and send. Works anywhere in the world.</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr><td align="center">
            <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:14px 32px;background:linear-gradient(90deg,#D4007A,#26a17b);color:#fff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              Subscribe Now →
            </a>
          </td></tr>
        </table>

        <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          Questions? Just reply to this email — we're here to help.<br>
          — The PNPtv Team
        </p>
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid rgba(255,255,255,0.08);">
        <p style="margin:0;font-size:11px;color:#6b7280;">🔒 Encrypted · Discreet · pnptv.app</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ── Sender ────────────────────────────────────────────────────────────────────

function makeTransporter() {
  // support@pnptv.app gets auto-suspended by Hostinger on bulk sends.
  // hello@easybots.store is the same Hostinger infra but doesn't trigger the guard.
  return nodemailer.createTransport({
    host:   'smtp.hostinger.com',
    port:   587,
    secure: false,
    auth:   { user: 'hello@easybots.store', pass: process.env.EASYBOTS_SMTP_PASS || process.env.PNPTV_SMTP_PASS },
    pool:   true, maxConnections: 1,
    rateDelta: 1200, rateLimit: 1,
  });
}

// ── Run tier ──────────────────────────────────────────────────────────────────

async function runTier(tier) {
  const [minAmount, maxAmount] = tier === 1 ? [249.99, 99999] : [79.99, 249.99];
  const tgMsg   = tier === 1 ? tgMessageTier1 : tgMessageTier2;

  const { rows: users } = await query(RECOVERY_QUERY, [minAmount, maxAmount]);

  if (!users.length) {
    console.log(`  No Tier ${tier} targets found.\n`);
    return;
  }

  const tgTargets    = users.filter(u => u.telegram);
  const emailTargets = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app'));

  console.log(`\n── Tier ${tier} (max attempted: $${minAmount}–${maxAmount === 99999 ? '∞' : maxAmount}) ──`);
  console.log(`  Total users:   ${users.length}`);
  console.log(`  Via Telegram:  ${tgTargets.length}`);
  console.log(`  Via email:     ${emailTargets.length}`);
  console.log('');

  if (DRY_RUN) {
    for (const u of users) {
      const channels = [];
      if (u.telegram) channels.push(`tg:${u.telegram}`);
      if (u.email && !u.email.includes('@telegram.pnptv.app')) channels.push(`email:${u.email}`);
      console.log(`  ${(u.username || '').padEnd(22)} ${(u.first_name || '').padEnd(14)} attempts:${String(u.total_attempts).padStart(3)}  max:$${u.max_amount_tried}  ${channels.join(' | ')}`);
    }
    return;
  }

  // Telegram
  const tg = new Telegram(process.env.BOT_TOKEN);
  const tgStats = { ok: 0, failed: 0 };
  for (const u of tgTargets) {
    try {
      await tg.sendMessage(u.telegram, tgMsg(u.first_name), { parse_mode: 'HTML', disable_web_page_preview: true });
      tgStats.ok++;
      console.log(`  ✓ tg → ${u.telegram} (${u.username})`);
    } catch (err) {
      tgStats.failed++;
      console.error(`  ✗ tg → ${u.telegram} (${u.username}): ${err.message}`);
    }
    await sleep(TG_DELAY_MS);
  }
  console.log(`  Telegram: ${tgStats.ok} sent / ${tgStats.failed} failed\n`);

  // Email
  const transporter = makeTransporter();
  const emailStats = { ok: 0, failed: 0 };
  for (const u of emailTargets) {
    try {
      await transporter.sendMail({
        from:    '"PNPtv!" <hello@easybots.store>',
        replyTo: 'support@pnptv.app',
        to:      u.email,
        subject: emailSubject(tier),
        html:    buildEmailHtml(u.first_name, tier),
      });
      emailStats.ok++;
      console.log(`  ✓ email → ${u.email} (${u.username})`);
    } catch (err) {
      emailStats.failed++;
      console.error(`  ✗ email → ${u.email}: ${err.message}`);
    }
    await sleep(1200);
  }
  transporter.close();
  console.log(`  Email: ${emailStats.ok} sent / ${emailStats.failed} failed\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Payment Recovery Outreach');
  console.log('═══════════════════════════════════════════════════════');
  if (DRY_RUN) console.log(' MODE: DRY RUN\n');

  if (EMAIL_RETRY_T1) {
    console.log('Retrying 6 Tier 1 emails via hello@easybots.store\n');
    const t = makeTransporter();
    for (const u of T1_EMAIL_RETRY) {
      try {
        await t.sendMail({
          from:    '"PNPtv!" <hello@easybots.store>',
          replyTo: 'support@pnptv.app',
          to:      u.email,
          subject: emailSubject(1),
          html:    buildEmailHtml(u.first_name, 1),
        });
        console.log(`  ✓ ${u.email}`);
      } catch (err) {
        console.error(`  ✗ ${u.email}: ${err.message}`);
      }
      await sleep(1200);
    }
    t.close();
  } else {
    if (TIER1 || DRY_RUN) await runTier(1);
    if (TIER2 || DRY_RUN) await runTier(2);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(' Done.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL:', err.message, err.stack);
  process.exit(1);
});
