#!/usr/bin/env node
'use strict';

/**
 * stripe-revocation-notify.js
 *
 * Revokes all active entitlements sourced from Stripe payments, then notifies
 * each affected user via Telegram DM and/or email that their payment was
 * refunded by Stripe and invites them to re-subscribe via ePayco or crypto.
 *
 * Stripe account was blocked; all payments refunded by Stripe ~2026-06-09.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/stripe-revocation-notify.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/stripe-revocation-notify.js
 */

const path = require('path');
const BACKEND = path.resolve(__dirname, '..');

try { require('dotenv').config({ path: path.join(BACKEND, '../../.env') }); } catch {}
try { require('dotenv').config({ path: path.join(BACKEND, '../../.env.production'), override: true }); } catch {}

const { query, getClient } = require(path.join(BACKEND, 'config/postgres'));
const nodemailer            = require('nodemailer');
const { Telegram }          = require('telegraf');

const DRY_RUN      = process.argv.includes('--dry-run');
const EMAIL_RETRY  = process.argv.includes('--email-retry');
const SUBSCRIBE_URL = 'https://pnptv.app/subscribe';
const LIFETIME_URL  = 'https://pnptv.app/subscribe#lifetime';
const TG_DELAY_MS   = 150;

// Users who had no Telegram and whose email failed (support@pnptv.app disabled).
// Retry via hello@easybots.store which is working.
const EMAIL_RETRY_TARGETS = [
  { first_name: 'Mjhkk',    email: 'fernandocampos2478@gmail.com', isLifetime: false },
  { first_name: 'ian',      email: 'ian@canyonhorizon.com',        isLifetime: false },
  { first_name: 'oddswaldo', email: 'adrianugonzalez8@gmail.com',  isLifetime: false },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Email-retry mode ──────────────────────────────────────────────────────────

async function runEmailRetry() {
  console.log('\n Retrying emails via hello@easybots.store\n');
  const transporter = nodemailer.createTransport({
    host:   'smtp.hostinger.com',
    port:   587,
    secure: false,
    auth:   { user: 'hello@easybots.store', pass: process.env.EASYBOTS_SMTP_PASS || process.env.PNPTV_SMTP_PASS },
  });
  for (const u of EMAIL_RETRY_TARGETS) {
    try {
      await transporter.sendMail({
        from:    '"PNPtv!" <hello@easybots.store>',
        replyTo: 'support@pnptv.app',
        to:      u.email,
        subject: emailSubject(),
        html:    buildEmailHtml(u.first_name, u.isLifetime),
      });
      console.log(`  ✓ ${u.email}`);
    } catch (err) {
      console.error(`  ✗ ${u.email}: ${err.message}`);
    }
    await sleep(1200);
  }
  transporter.close();
  console.log('\n Email retry done.\n');
  process.exit(0);
}

// ── Messages ──────────────────────────────────────────────────────────────────

function tgMessage(name, isLifetime) {
  const lifetimeNote = isLifetime
    ? `\n\n💎 We also have a <b>Lifetime PRIME $100</b> option:\n👉 <a href="${LIFETIME_URL}">pnptv.app/subscribe</a>`
    : '';

  return `⚠️ <b>Important notice about your PNPtv account</b>

Hey ${name || 'there'},

We're sorry to inform you that due to issues with Stripe, <b>your membership has been suspended</b> and your payment has been refunded to your original payment method. If you haven't received it yet, please allow a few business days.

We sincerely apologize — this was completely outside our control.

To continue enjoying PNPtv!, please re-subscribe using one of our current payment options:
💳 <b>ePayco</b> — Visa or Mastercard
🪙 <b>USDC</b> — stable coin, any country
🥷 <b>Dash</b> — private, no bank needed${lifetimeNote}

👉 <a href="${SUBSCRIBE_URL}">pnptv.app/subscribe</a>

Thank you for your understanding and continued support.
— The PNPtv Team`;
}

function emailSubject() {
  return '⚠️ Important notice about your PNPtv account';
}

function buildEmailHtml(name, isLifetime) {
  const lifetimeBlock = isLifetime ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
          <tr><td style="padding:18px 20px;background:rgba(38,161,123,0.06);border:1px solid rgba(38,161,123,0.25);border-radius:14px;">
            <p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#26a17b;">💎 Lifetime PRIME $100</p>
            <p style="margin:0 0 10px;font-size:13px;color:#d1d5db;line-height:1.6;">You previously purchased a Lifetime pass. Restore lifetime access:</p>
            <a href="${LIFETIME_URL}" style="display:inline-block;padding:10px 22px;background:rgba(38,161,123,0.15);color:#26a17b;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;border:1px solid rgba(38,161,123,0.4);">
              Get Lifetime PRIME $100 →
            </a>
          </td></tr>
        </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Important: Your PNPtv Membership</title></head>
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
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#ffffff;line-height:1.2;">
          ⚠️ Your Membership Has Been Suspended
        </h1>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr><td style="padding:16px 20px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:12px;">
            <p style="margin:0;font-size:14px;color:#fbbf24;line-height:1.6;">
              Due to issues with Stripe, your membership has been suspended and your payment has been
              <strong>refunded to your original payment method</strong>. If you haven't received it yet,
              please allow a few business days. We sincerely apologize — this was completely outside our control.
            </p>
          </td></tr>
        </table>

        <p style="margin:0 0 20px;font-size:15px;color:#d1d5db;line-height:1.5;">
          To continue enjoying PNPtv!, please re-subscribe using one of our current payment options:
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
          <tr><td style="padding:14px 18px;background:rgba(212,0,122,0.06);border:1px solid rgba(212,0,122,0.2);border-radius:12px;">
            <p style="margin:0;font-size:14px;font-weight:800;color:#D4007A;">💳 ePayco — Credit / Debit Card</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Visa or Mastercard. Wait 20–30s for 3D Secure verification.</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
          <tr><td style="padding:14px 18px;background:rgba(38,161,123,0.06);border:1px solid rgba(38,161,123,0.2);border-radius:12px;">
            <p style="margin:0;font-size:14px;font-weight:800;color:#26a17b;">🪙 USDC (stable, any country)</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">1 USDC = $1 USD. Buy on Coinbase or Binance.</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td style="padding:14px 18px;background:rgba(0,141,228,0.06);border:1px solid rgba(0,141,228,0.2);border-radius:12px;">
            <p style="margin:0;font-size:14px;font-weight:800;color:#008DE4;">🥷 Dash (most private)</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">No bank, no name required. Scan QR and send.</p>
          </td></tr>
        </table>

        ${lifetimeBlock}

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr><td align="center">
            <a href="${SUBSCRIBE_URL}" style="display:inline-block;padding:14px 32px;background:linear-gradient(90deg,#D4007A,#26a17b);color:#fff;font-size:15px;font-weight:800;text-decoration:none;border-radius:12px;">
              Re-subscribe Now →
            </a>
          </td></tr>
        </table>

        <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          Thank you for your patience and continued support.<br>
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

// ── Revocation ────────────────────────────────────────────────────────────────

async function revokeEntitlements(entries) {
  const lifetimeIds    = entries.filter(e => e.is_lifetime).map(e => e.entitlement_id);
  const nonLifetimeIds = entries.filter(e => !e.is_lifetime).map(e => e.entitlement_id);

  if (nonLifetimeIds.length) {
    await query(
      `UPDATE user_entitlements
         SET expires_at = NOW(), updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [nonLifetimeIds]
    );
  }

  // Lifetime rows require superadmin bypass inside a transaction.
  // Also flip is_lifetime → false so the check constraint (no expires_at on lifetime) allows the update.
  if (lifetimeIds.length) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL pnptv.superadmin_bypass = 'true'");
      await client.query(
        `UPDATE user_entitlements
           SET is_lifetime = false, expires_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::bigint[])`,
        [lifetimeIds]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Stripe Revocation + Notification');
  console.log('═══════════════════════════════════════════════════════');
  if (DRY_RUN)    console.log(' MODE: DRY RUN — no DB changes, no messages sent\n');
  if (EMAIL_RETRY) return runEmailRetry();

  const { rows: entitlements } = await query(`
    SELECT
      ue.id          AS entitlement_id,
      ue.user_id,
      ue.add_on_id,
      ue.is_lifetime,
      ue.expires_at,
      u.first_name,
      u.email,
      u.telegram,
      p.plan_id      AS stripe_plan,
      p.amount
    FROM user_entitlements ue
    JOIN payments p ON p.id::text = ue.source_payment_id
    JOIN users u ON u.id = ue.user_id
    WHERE p.provider = 'stripe'
      AND p.status   = 'completed'
      AND ue.is_consumed = false
      AND (ue.expires_at > NOW() OR ue.expires_at IS NULL)
    ORDER BY ue.is_lifetime DESC, ue.user_id, ue.add_on_id
  `);

  if (!entitlements.length) {
    console.log(' No active Stripe-sourced entitlements found. Nothing to do.\n');
    process.exit(0);
  }

  const byUser = {};
  for (const row of entitlements) {
    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        user_id:    row.user_id,
        first_name: row.first_name,
        email:      row.email,
        telegram:   row.telegram,
        isLifetime: false,
        entries:    [],
      };
    }
    if (row.is_lifetime) byUser[row.user_id].isLifetime = true;
    byUser[row.user_id].entries.push(row);
  }

  const users        = Object.values(byUser);
  const unreachable  = users.filter(u => !u.telegram && (!u.email || u.email.includes('@telegram.pnptv.app')));
  const emailTargets = users.filter(u => u.email && !u.email.includes('@telegram.pnptv.app'));
  const tgTargets    = users.filter(u => u.telegram);

  console.log(` Users affected:         ${users.length}`);
  console.log(` Entitlements to revoke: ${entitlements.length}`);
  console.log(` Lifetime (bypass req):  ${entitlements.filter(e => e.is_lifetime).length}`);
  console.log(` With Telegram:          ${tgTargets.length}`);
  console.log(` With email:             ${emailTargets.length}`);
  if (unreachable.length) {
    console.log(` Unreachable:            ${unreachable.length} (${unreachable.map(u => u.first_name || u.user_id).join(', ')})`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log(' Entitlements WOULD be revoked:');
    for (const e of entitlements) {
      const tag = e.is_lifetime ? ' [LIFETIME — bypass]' : '';
      console.log(`   ${(e.first_name || '(no name)').padEnd(18)} ${e.add_on_id.padEnd(12)} expires: ${e.expires_at || 'lifetime'}${tag}`);
    }
    console.log('\n Users WOULD be notified:');
    for (const u of users) {
      const channels = [];
      if (u.telegram) channels.push(`tg:${u.telegram}`);
      if (u.email && !u.email.includes('@telegram.pnptv.app')) channels.push(`email:${u.email}`);
      if (!channels.length) channels.push('UNREACHABLE');
      console.log(`   ${(u.first_name || '(no name)').padEnd(18)} ${channels.join(' | ')}${u.isLifetime ? ' [lifetime]' : ''}`);
    }
    console.log('\n DRY RUN complete — run without --dry-run to execute.\n');
    process.exit(0);
  }

  // ── 1. Revoke ─────────────────────────────────────────────────────────────
  console.log('Revoking entitlements...');
  let revokeOk = 0, revokeFail = 0;
  for (const u of users) {
    try {
      await revokeEntitlements(u.entries);
      revokeOk++;
      console.log(`  ✓ ${u.first_name || u.user_id} — ${u.entries.length} entitlement(s) revoked${u.isLifetime ? ' [lifetime]' : ''}`);
    } catch (err) {
      revokeFail++;
      console.error(`  ✗ FAILED for ${u.first_name || u.user_id}: ${err.message}`);
    }
  }
  console.log(`  Revoked: ${revokeOk} users / ${revokeFail} failed\n`);

  // ── 2. Telegram ───────────────────────────────────────────────────────────
  console.log(`Sending Telegram DMs → ${tgTargets.length} users`);
  const tg = new Telegram(process.env.BOT_TOKEN);
  const tgStats = { ok: 0, failed: 0 };
  for (const u of tgTargets) {
    try {
      await tg.sendMessage(
        u.telegram,
        tgMessage(u.first_name, u.isLifetime),
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
      tgStats.ok++;
      console.log(`  ✓ tg → ${u.telegram} (${u.first_name})`);
    } catch (err) {
      tgStats.failed++;
      console.error(`  ✗ tg → ${u.telegram} (${u.first_name}): ${err.message}`);
    }
    await sleep(TG_DELAY_MS);
  }
  console.log(`  Telegram: ${tgStats.ok} sent / ${tgStats.failed} failed\n`);

  // ── 3. Email ──────────────────────────────────────────────────────────────
  console.log(`Sending emails → ${emailTargets.length} users`);
  const transporter = nodemailer.createTransport({
    host:    process.env.PNPTV_SMTP_HOST,
    port:    parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
    secure:  process.env.PNPTV_SMTP_SECURE === 'true',
    auth:    { user: process.env.PNPTV_SMTP_USER, pass: process.env.PNPTV_SMTP_PASS },
    pool:    true, maxConnections: 1,
    rateDelta: 1200, rateLimit: 1,
  });

  const emailStats = { ok: 0, failed: 0 };
  for (const u of emailTargets) {
    try {
      await transporter.sendMail({
        from:    '"PNPtv!" <support@pnptv.app>',
        to:      u.email,
        subject: emailSubject(),
        html:    buildEmailHtml(u.first_name, u.isLifetime),
      });
      emailStats.ok++;
      console.log(`  ✓ email → ${u.email} (${u.first_name})`);
    } catch (err) {
      emailStats.failed++;
      console.error(`  ✗ email → ${u.email}: ${err.message}`);
    }
    await sleep(1200);
  }
  transporter.close();
  console.log(`  Email: ${emailStats.ok} sent / ${emailStats.failed} failed\n`);

  if (unreachable.length) {
    console.log('  Unreachable (no Telegram, no real email):');
    for (const u of unreachable) console.log(`    user_id=${u.user_id}  name=${u.first_name || '—'}`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(' COMPLETE');
  console.log(`  Entitlements revoked: ${revokeOk} users / ${revokeFail} failed`);
  console.log(`  Telegram DMs:         ${tgStats.ok} sent / ${tgStats.failed} failed`);
  console.log(`  Emails:               ${emailStats.ok} sent / ${emailStats.failed} failed`);
  if (unreachable.length) console.log(`  Unreachable:          ${unreachable.length} users`);
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
