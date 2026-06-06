#!/usr/bin/env node
'use strict';

/**
 * notify-pending-abandoned.js
 *
 * 1. Marks all `pending` payments as `abandoned`
 * 2. Sends each affected user (once) the how-to-pay instructions
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/notify-pending-abandoned.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/notify-pending-abandoned.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query }    = require(path.join(BACKEND, 'config/postgres'));
const nodemailer   = require('nodemailer');
const { Telegram } = require('telegraf');

const DRY_RUN    = process.argv.includes('--dry-run');
const TG_DELAY   = 80;
const HOW_TO_PAY = 'https://pnptv.app/how-to-pay';
const SUBSCRIBE  = 'https://pnptv.app/subscribe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN_LABELS = {
  'lifetime80':              'Lifetime Access — $80',
  'lifetime-pass':           'Lifetime Access — $249.99',
  'prime-diamond-pass-365d': 'PRIME Diamond (1 year) — $99.99',
  'monthly-pass':            'Monthly Pass — $25.00',
  'prime-week-pass-7d':      'PRIME Week Pass — $15.00',
  'week-trial-pass':         'Week Trial — $14.99',
};

function planLabel(planId) {
  return PLAN_LABELS[planId] || planId || 'your plan';
}

function tgMessage(firstName, planId) {
  const name = firstName || 'there';
  const plan = planLabel(planId);
  return (
    `Hey ${name}! 👋\n\n` +
    `Your payment for *${plan}* didn't complete — no worries, it happens.\n\n` +
    `Here's how to pay successfully:\n` +
    `👉 ${HOW_TO_PAY}\n\n` +
    `Ready to try again? → ${SUBSCRIBE}`
  );
}

function emailHtml(firstName, planId) {
  const name = firstName || 'there';
  const plan = planLabel(planId);
  return `
<p>Hey ${name},</p>
<p>Your payment for <strong>${plan}</strong> on PNPtv didn't go through — but that's okay!</p>
<p>Check out our quick guide on how to pay successfully:<br>
<a href="${HOW_TO_PAY}">${HOW_TO_PAY}</a></p>
<p>When you're ready to try again:<br>
<a href="${SUBSCRIBE}">${SUBSCRIBE}</a></p>
<p>— PNPtv Team</p>
`;
}

function emailText(firstName, planId) {
  const name = firstName || 'there';
  const plan = planLabel(planId);
  return (
    `Hey ${name},\n\n` +
    `Your payment for ${plan} on PNPtv didn't go through.\n\n` +
    `How to pay: ${HOW_TO_PAY}\n\n` +
    `Try again: ${SUBSCRIBE}\n\n` +
    `— PNPtv Team`
  );
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes\n' : '🚀 LIVE RUN\n');

  // 1. Fetch all pending payments with user details
  const { rows: pending } = await query(`
    SELECT
      p.id         AS payment_id,
      p.user_id,
      p.plan_id,
      p.amount,
      p.created_at,
      u.telegram   AS telegram_id,
      u.first_name,
      u.email,
      u.tier,
      u.is_deleted,
      u.deleted_at
    FROM payments p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.status = 'pending'
    ORDER BY p.created_at DESC
  `);

  console.log(`Found ${pending.length} pending payment(s)\n`);

  if (pending.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  // 2. Mark all as abandoned
  if (!DRY_RUN) {
    const ids = pending.map((r) => r.payment_id);
    await query(
      `UPDATE payments SET status = 'abandoned', updated_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    console.log(`✓ Marked ${ids.length} payment(s) as abandoned\n`);
  } else {
    console.log(`[DRY] Would mark ${pending.length} payment(s) as abandoned\n`);
  }

  // 3. Deduplicate — one notification per user, most recent plan wins
  const byUser = new Map();
  for (const row of pending) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, row);
  }
  const users = [...byUser.values()].filter(
    (u) => u.tier !== 'banned' && !u.is_deleted && !u.deleted_at
  );

  console.log(`Unique users to notify: ${users.length}\n`);

  // 4. Send notifications
  const tg     = new Telegram(process.env.BOT_TOKEN);
  const withTg = users.filter((u) => u.telegram_id);
  const withEmail = users.filter((u) => u.email && !u.telegram_id);

  // email transporter (Resend first, SMTP fallback)
  let transporter;
  if (process.env.RESEND_API_KEY) {
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: process.env.PNPTV_SMTP_HOST || process.env.SMTP_HOST,
      port: parseInt(process.env.PNPTV_SMTP_PORT || process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.PNPTV_SMTP_USER || process.env.SMTP_USER,
        pass: process.env.PNPTV_SMTP_PASS || process.env.SMTP_PASSWORD,
      },
    });
  }

  // Telegram
  let tgSent = 0, tgFailed = 0;
  console.log(`Sending Telegram to ${withTg.length} users...`);
  for (const u of withTg) {
    const msg = tgMessage(u.first_name, u.plan_id);
    if (DRY_RUN) {
      console.log(`  [DRY] TG → ${u.telegram_id} (${u.first_name}): ${planLabel(u.plan_id)}`);
      tgSent++;
    } else {
      try {
        await tg.sendMessage(u.telegram_id, msg, { parse_mode: 'Markdown' });
        tgSent++;
      } catch (e) {
        tgFailed++;
        console.warn(`  ✗ TG ${u.telegram_id}: ${e.message}`);
      }
      await sleep(TG_DELAY);
    }
  }

  // Email (users with email but no Telegram, + users with both email + Telegram as bonus)
  const emailTargets = users.filter((u) => u.email);
  let emailSent = 0, emailFailed = 0;
  console.log(`\nSending email to ${emailTargets.length} users...`);
  for (const u of emailTargets) {
    if (DRY_RUN) {
      console.log(`  [DRY] Email → ${u.email} (${u.first_name}): ${planLabel(u.plan_id)}`);
      emailSent++;
      continue;
    }
    try {
      await transporter.sendMail({
        from: `"PNPtv" <${process.env.PNPTV_FROM_EMAIL || process.env.SMTP_FROM}>`,
        to: u.email,
        subject: 'Your PNPtv payment — here\'s how to complete it',
        text: emailText(u.first_name, u.plan_id),
        html: emailHtml(u.first_name, u.plan_id),
      });
      emailSent++;
      console.log(`  ✓ Email → ${u.email}`);
    } catch (e) {
      emailFailed++;
      console.warn(`  ✗ Email ${u.email}: ${e.message}`);
    }
    await sleep(300);
  }

  console.log(`
═══════════════════════════════════════════
 DONE
═══════════════════════════════════════════
 Payments abandoned: ${pending.length}
 Telegram:  ${tgSent} sent / ${tgFailed} failed
 Email:     ${emailSent} sent / ${emailFailed} failed
═══════════════════════════════════════════
`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
