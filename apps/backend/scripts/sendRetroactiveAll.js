#!/usr/bin/env node
'use strict';

/**
 * sendRetroactiveAll.js
 *
 * Sends ONE invoice email + ONE welcome email per unique paying customer.
 * Picks the most significant (highest amount) completed payment per user.
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/sendRetroactiveAll.js --dry-run
 *   docker exec pnptv-bot node apps/backend/scripts/sendRetroactiveAll.js
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
} catch (_) {}

const { getPool, query } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const InvoiceService = require(path.join(BACKEND_ROOT, 'services/invoiceservice'));
const emailService = require(path.join(BACKEND_ROOT, 'services/emailservice'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 3000; // 3s between emails to avoid rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Retroactive Invoice + Welcome Email Sender (1 per user) ===');
  if (DRY_RUN) console.log('>>> DRY RUN — no emails will be sent <<<\n');

  // Get ONE payment per user: the highest-amount completed payment
  const { rows: users } = await query(`
    SELECT DISTINCT ON (u.email)
      p.id AS payment_id,
      p.user_id,
      p.plan_id,
      p.plan_name,
      p.amount,
      p.currency,
      p.provider,
      p.reference,
      p.transaction_id,
      p.created_at,
      u.email,
      u.first_name,
      u.username,
      u.language,
      pl.display_name AS plan_display_name,
      pl.name AS plan_db_name,
      pl.duration_days,
      pl.duration,
      pl.is_lifetime
    FROM payments p
    JOIN users u ON p.user_id::text = u.id::text
    JOIN plans pl ON p.plan_id = pl.id
    WHERE p.status = 'completed'
      AND u.email IS NOT NULL
      AND u.email != ''
    ORDER BY u.email, p.amount DESC, p.created_at DESC
  `);

  console.log(`Unique paying users with email: ${users.length}\n`);

  let invoicesSent = 0;
  let welcomesSent = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const email = u.email.trim();
    const customerName = u.first_name || u.username || 'Valued Customer';
    const planName = u.plan_display_name || u.plan_db_name || u.plan_name || 'Subscription';
    const amount = parseFloat(u.amount) || 0;
    const currency = u.currency || 'USD';
    const provider = u.provider || 'epayco';
    const reference = u.reference || u.transaction_id || u.payment_id;
    const purchaseDate = new Date(u.created_at);
    const durationDays = u.is_lifetime ? 36500 : (u.duration_days || u.duration || 30);
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    const language = u.language || 'es';

    const label = `[${i + 1}/${users.length}]`;

    if (DRY_RUN) {
      console.log(`${label} DRY RUN: ${email} — Invoice: ${planName} $${amount.toFixed(2)} (${provider}) + Welcome email`);
      invoicesSent++;
      welcomesSent++;
      continue;
    }

    // 1. Send invoice email with PDF
    try {
      const { buffer: invoicePdf } = await InvoiceService.generateInvoice({
        invoiceNumber: reference,
        customerName,
        planName,
        amount,
        currency,
        provider,
        transactionId: reference,
        purchaseDate,
        expiryDate,
        language,
      });

      const invoiceResult = await emailService.sendInvoiceEmail({
        to: email,
        customerName,
        invoiceNumber: reference,
        amount,
        planName,
        invoicePdf,
      });

      if (invoiceResult.success) {
        invoicesSent++;
        console.log(`${label} INVOICE OK: ${email} — ${planName} $${amount.toFixed(2)}`);
      } else {
        console.error(`${label} INVOICE FAILED: ${email} — ${invoiceResult.error}`);
        failed++;
      }
    } catch (err) {
      console.error(`${label} INVOICE ERROR: ${email} — ${err.message}`);
      failed++;
    }

    await sleep(1000);

    // 2. Send welcome email with onboarding guide PDF
    try {
      const { buffer: guidePdf } = await InvoiceService.generateOnboardingGuide({
        customerName,
        planName,
        language,
      });

      const welcomeResult = await emailService.sendWelcomeEmail({
        to: email,
        customerName,
        planName,
        duration: durationDays,
        expiryDate,
        language,
        onboardingGuidePdf: guidePdf,
      });

      if (welcomeResult.success) {
        welcomesSent++;
        console.log(`${label} WELCOME OK: ${email}`);
      } else {
        console.error(`${label} WELCOME FAILED: ${email} — ${welcomeResult.error}`);
      }
    } catch (err) {
      console.error(`${label} WELCOME ERROR: ${email} — ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(`Total users:     ${users.length}`);
  console.log(`Invoices sent:   ${invoicesSent}`);
  console.log(`Welcomes sent:   ${welcomesSent}`);
  console.log(`Failed:          ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 5 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
