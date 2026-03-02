#!/usr/bin/env node
'use strict';

/**
 * sendBulkCredentials.js
 *
 * One-time script: generates login credentials (email + random password)
 * for every user who has an email on file but no password_hash yet,
 * then sends them a branded bilingual email with their login info.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/sendBulkCredentials.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendBulkCredentials.js --limit 5
 *   docker exec pnptv-bot node apps/backend/scripts/sendBulkCredentials.js
 *   docker exec pnptv-bot node apps/backend/scripts/sendBulkCredentials.js --start-from 12345
 *
 * Flags:
 *   --dry-run        List what would be sent without writing DB or sending emails
 *   --limit N        Process only first N users
 *   --start-from ID  Resume from a specific user ID (for crash recovery)
 */

const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));

// --- CLI flags ---
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : 0;
})();
const START_FROM = (() => {
  const idx = process.argv.indexOf('--start-from');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

const DELAY_MS = parseInt(process.env.BULK_DELAY_MS || '5000', 10);
const MEMBER_PLAN_IDS = new Set(['member_monthly']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))))
  );
  return `${salt}:${hash}`;
}

function getTierLabel(tier, isEs) {
  const labels = {
    free: isEs ? 'Gratuito' : 'Free',
    member: isEs ? 'Miembro' : 'Member',
    PRIME: isEs ? 'PRIME' : 'PRIME',
    banned: isEs ? 'Suspendido' : 'Suspended',
  };
  return labels[tier] || tier;
}

function getTierColor(tier) {
  const colors = { free: '#A1A1A6', member: '#34C759', PRIME: '#D4007A', banned: '#FF3B30' };
  return colors[tier] || '#A1A1A6';
}

function buildEmailHtml(email, password, tier, isEs) {
  const safeEmail = escapeHtml(email);
  const tierLabel = getTierLabel(tier, isEs);
  const tierColor = getTierColor(tier);

  if (isEs) {
    return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
  <h2 style="color:#D4007A;margin-top:0;">¡Bienvenido a PNPtv!</h2>
  <p>Ahora puedes iniciar sesi&oacute;n en la web con estas credenciales:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
    <tr><td style="padding:8px 0;color:#A1A1A6;">Contrase&ntilde;a:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${escapeHtml(password)}</td></tr>
    <tr><td style="padding:8px 0;color:#A1A1A6;">Membres&iacute;a:</td><td style="padding:8px 0;font-weight:bold;color:${tierColor};">${tierLabel}</td></tr>
  </table>
  <p style="font-size:13px;color:#A1A1A6;">Puedes cambiar tu contrase&ntilde;a y actualizar tu email desde tu perfil.</p>
  <div style="margin-top:20px;">
    <a href="https://app.pnptv.app/login" style="display:inline-block;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Iniciar sesi&oacute;n</a>
  </div>
  <div style="margin-top:12px;">
    <a href="https://app.pnptv.app/profile" style="display:inline-block;padding:10px 20px;background:#2C2C2E;color:#D4007A;text-decoration:none;border-radius:8px;font-weight:bold;border:1px solid #D4007A;">Actualizar email</a>
  </div>
</div>`;
  }

  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#1C1C1E;color:#F5F5F7;border-radius:12px;">
  <h2 style="color:#D4007A;margin-top:0;">Welcome to PNPtv!</h2>
  <p>You can now log in to the web app with these credentials:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px 0;color:#A1A1A6;">Email:</td><td style="padding:8px 0;font-weight:bold;">${safeEmail}</td></tr>
    <tr><td style="padding:8px 0;color:#A1A1A6;">Password:</td><td style="padding:8px 0;font-weight:bold;font-family:monospace;font-size:16px;">${escapeHtml(password)}</td></tr>
    <tr><td style="padding:8px 0;color:#A1A1A6;">Membership:</td><td style="padding:8px 0;font-weight:bold;color:${tierColor};">${tierLabel}</td></tr>
  </table>
  <p style="font-size:13px;color:#A1A1A6;">You can change your password and update your email from your profile.</p>
  <div style="margin-top:20px;">
    <a href="https://app.pnptv.app/login" style="display:inline-block;padding:12px 24px;background:#D4007A;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Log in</a>
  </div>
  <div style="margin-top:12px;">
    <a href="https://app.pnptv.app/profile" style="display:inline-block;padding:10px 20px;background:#2C2C2E;color:#D4007A;text-decoration:none;border-radius:8px;font-weight:bold;border:1px solid #D4007A;">Update email</a>
  </div>
</div>`;
}

/**
 * Determine expected tier based on subscription_status and plan_id
 */
function getExpectedTier(subscriptionStatus, planId) {
  const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'prime';
  if (!isActive) return 'free';
  return MEMBER_PLAN_IDS.has(planId) ? 'member' : 'PRIME';
}

async function main() {
  console.log('=== Bulk Credential Generator & Sender ===');
  if (DRY_RUN) console.log('>>> DRY RUN — no DB writes or emails will be sent <<<');
  if (LIMIT) console.log(`>>> LIMIT: processing only first ${LIMIT} users <<<`);
  if (START_FROM) console.log(`>>> START FROM: user ID ${START_FROM} <<<`);
  console.log('');

  // Initialize SMTP transporter
  let transporter = null;
  if (!DRY_RUN) {
    const smtpHost = process.env.PNPTV_SMTP_HOST;
    const smtpPort = parseInt(process.env.PNPTV_SMTP_PORT || '587', 10);
    const smtpUser = process.env.PNPTV_SMTP_USER;
    const smtpPass = process.env.PNPTV_SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error('ERROR: PNPTV_SMTP_HOST, PNPTV_SMTP_USER, or PNPTV_SMTP_PASS not set');
      process.exit(1);
    }

    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    // Verify SMTP connection
    try {
      await transporter.verify();
      console.log('SMTP connection verified OK\n');
    } catch (err) {
      console.error('SMTP connection failed:', err.message);
      process.exit(1);
    }
  }

  const fromEmail = process.env.PNPTV_FROM_EMAIL || 'noreply@pnptv.app';

  // Query users who need credentials
  let sql = `
    SELECT id, email, language, tier, subscription_status, plan_id
    FROM users
    WHERE email IS NOT NULL AND email != '' AND password_hash IS NULL
  `;
  const params = [];

  if (START_FROM) {
    params.push(START_FROM);
    sql += ` AND id >= $${params.length}`;
  }

  sql += ' ORDER BY id ASC';

  if (LIMIT) {
    params.push(LIMIT);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows: users } = await query(sql, params);
  console.log(`Users to process: ${users.length}\n`);

  if (users.length === 0) {
    console.log('No users need credentials. Done.');
    const pool = getPool();
    await pool.end();
    process.exit(0);
  }

  // Stats
  let sent = 0;
  let skipped = 0;
  let tierFixed = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const label = `[${i + 1}/${users.length}]`;
    const isEs = (user.language || 'es').startsWith('es');

    // Check tier correctness
    const expectedTier = getExpectedTier(user.subscription_status, user.plan_id);
    const needsTierFix = user.tier !== expectedTier && user.tier !== 'banned';

    if (needsTierFix) {
      console.log(`${label} TIER FIX: user ${user.id} (${user.email}) — ${user.tier} → ${expectedTier} (status=${user.subscription_status}, plan=${user.plan_id})`);
    }

    // Generate password
    const plainPassword = crypto.randomBytes(9).toString('base64url');
    const hashedPassword = await hashPassword(plainPassword);

    if (DRY_RUN) {
      console.log(`${label} DRY RUN: ${user.email} — tier=${user.tier}${needsTierFix ? ` → ${expectedTier}` : ''} (${user.subscription_status || 'free'})`);
      sent++;
      if (needsTierFix) tierFixed++;
      continue;
    }

    try {
      // Atomic DB update: set password_hash (and fix tier if needed)
      let updateSql, updateParams;
      if (needsTierFix) {
        updateSql = `UPDATE users SET password_hash = $2, email_verified = true, tier = $3 WHERE id = $1 AND password_hash IS NULL RETURNING id`;
        updateParams = [user.id, hashedPassword, expectedTier];
      } else {
        updateSql = `UPDATE users SET password_hash = $2, email_verified = true WHERE id = $1 AND password_hash IS NULL RETURNING id`;
        updateParams = [user.id, hashedPassword];
      }

      const { rowCount } = await query(updateSql, updateParams);
      if (rowCount === 0) {
        console.log(`${label} SKIP: ${user.email} — password already set by concurrent process`);
        skipped++;
        continue;
      }

      if (needsTierFix) tierFixed++;

      // Send credentials email
      const effectiveTier = needsTierFix ? expectedTier : user.tier;
      const html = buildEmailHtml(user.email, plainPassword, effectiveTier, isEs);

      await transporter.sendMail({
        from: fromEmail,
        to: user.email,
        subject: isEs
          ? 'Tus credenciales de acceso — PNPtv!'
          : 'Your Login Credentials — PNPtv!',
        html,
      });

      sent++;
      console.log(`${label} OK: ${user.email} — tier=${effectiveTier} (${user.subscription_status || 'free'})`);
    } catch (err) {
      failed++;
      const errMsg = `${user.email} (id=${user.id}): ${err.message}`;
      errors.push(errMsg);
      console.error(`${label} ERROR: ${errMsg}`);
    }

    await sleep(DELAY_MS);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total users queried:  ${users.length}`);
  console.log(`Credentials sent:     ${sent}`);
  console.log(`Skipped (race):       ${skipped}`);
  console.log(`Tier corrections:     ${tierFixed}`);
  console.log(`Failed:               ${failed}`);

  if (errors.length > 0) {
    console.log('\n--- Errors ---');
    errors.forEach((e) => console.log(`  ${e}`));
  }

  const pool = getPool();
  await pool.end();
  process.exit(failed > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
