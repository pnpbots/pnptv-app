#!/usr/bin/env node
'use strict';

/**
 * sendRetroactiveInvoices.js
 *
 * One-time script: generates and sends PDF invoices to every client
 * who has completed a payment through ePayco or Daimo but never
 * received a PDF invoice.
 *
 * Usage (inside Docker):
 *   docker exec pnptv-bot node apps/backend/scripts/sendRetroactiveInvoices.js
 *   docker exec pnptv-bot node apps/backend/scripts/sendRetroactiveInvoices.js --dry-run
 *
 * Flags:
 *   --dry-run   List what would be sent without actually sending
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
const DELAY_MS = 2000; // 2s between emails to avoid rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Retroactive Invoice Sender ===');
  if (DRY_RUN) console.log('>>> DRY RUN — no emails will be sent <<<\n');

  // Fetch all completed payments with user email info
  const { rows: payments } = await query(`
    SELECT
      p.id,
      p.user_id,
      p.plan_id,
      p.plan_name,
      p.amount,
      p.currency,
      p.provider,
      p.reference,
      p.transaction_id,
      p.created_at,
      p.metadata,
      u.email AS user_email,
      u.first_name,
      u.username,
      u.language,
      pl.display_name AS plan_display_name,
      pl.name AS plan_db_name,
      pl.duration_days,
      pl.duration
    FROM payments p
    LEFT JOIN users u ON p.user_id::text = u.id::text
    LEFT JOIN plans pl ON p.plan_id = pl.id
    WHERE p.status = 'completed'
    ORDER BY p.created_at ASC
  `);

  console.log(`Total completed payments: ${payments.length}`);

  let sent = 0;
  let skippedNoEmail = 0;
  let skippedDup = 0;
  let failed = 0;

  // Track emails we've already sent to in this run (dedup per user+plan combo)
  const sentTracker = new Set();

  // emailService is a singleton imported above

  for (const p of payments) {
    const email = p.user_email;
    const customerName = p.first_name || p.username || 'Valued Customer';
    const planName = p.plan_display_name || p.plan_db_name || p.plan_name || 'Subscription';
    const amount = parseFloat(p.amount) || 0;
    const currency = p.currency || 'USD';
    const provider = p.provider || 'epayco';
    const reference = p.reference || p.transaction_id || p.id;
    const purchaseDate = new Date(p.created_at);
    const durationDays = p.duration_days || p.duration || 30;
    const expiryDate = new Date(purchaseDate);
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    const language = p.language || 'es';

    const label = `[${sent + skippedNoEmail + skippedDup + failed + 1}/${payments.length}]`;

    if (!email || !email.trim()) {
      skippedNoEmail++;
      continue;
    }

    // Dedup: don't send multiple invoices for the same payment
    const dedupKey = `${email.toLowerCase()}:${p.id}`;
    if (sentTracker.has(dedupKey)) {
      skippedDup++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`${label} DRY RUN: Would send invoice to ${email} — ${planName} $${amount.toFixed(2)} (${provider}, ${purchaseDate.toISOString().slice(0, 10)})`);
      sentTracker.add(dedupKey);
      sent++;
      continue;
    }

    try {
      // Generate branded PDF invoice
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

      // Send invoice email with PDF attached
      const result = await emailService.sendInvoiceEmail({
        to: email,
        customerName,
        invoiceNumber: reference,
        amount,
        planName,
        invoicePdf,
      });

      if (result.success) {
        sent++;
        sentTracker.add(dedupKey);
        console.log(`${label} OK: ${email} — ${planName} $${amount.toFixed(2)} (${provider})`);
      } else {
        failed++;
        console.error(`${label} FAILED: ${email} — ${result.error}`);
      }
    } catch (err) {
      failed++;
      console.error(`${label} ERROR: ${email} — ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(`Total payments:       ${payments.length}`);
  console.log(`Invoices sent:        ${sent}`);
  console.log(`Skipped (no email):   ${skippedNoEmail}`);
  console.log(`Skipped (duplicate):  ${skippedDup}`);
  console.log(`Failed:               ${failed}`);

  const pool = getPool();
  await pool.end();
  process.exit(failed > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
