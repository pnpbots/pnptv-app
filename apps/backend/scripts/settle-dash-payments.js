#!/usr/bin/env node
/**
 * settle-dash-payments.js
 *
 * Reconciles the 9 stuck Dash/BTCPay payments (6 call_package + 3 creator_monthly)
 * that are `expired` in dash_subscription_orders but may have been paid.
 *
 * For each invoice:
 *   1. Poll BTCPay for current status
 *   2. If Settled (or PaidLate): reset order to pending → run the appropriate
 *      settlement function → the function handles payments table + entitlements
 *   3. Print a summary
 *
 * Idempotent — safe to re-run. All settlement functions have ON CONFLICT guards.
 *
 * Run from repo root:
 *   node apps/backend/scripts/settle-dash-payments.js
 */

'use strict';

require('dotenv').config();

const { query } = require('../config/postgres');

const INVOICE_IDS = [
  // call_package (6)
  'WsncYTzBAZQGonnRdprvHg',
  'QvAygqW8K72v3bLEHsGqC6',
  'RnqLded8dXSTXFsKc7EvZD',
  'WEq9q7a8cJEyLNky3qBDyr',
  'KMqhgqAT3ZEavg8Pkc89wZ',
  'dnTnEAy2ADvYboKAjrCbu',
  // creator_monthly (3)
  '2tLkMyZTGgKg1PowYQc6m5',
  '8a84jv3KbE2jvNWcj7zHvE',
  'PJz2AQNjoHFJbkcFpKESZ7',
];

async function main() {
  let getInvoice, isConfigured;
  try {
    ({ getInvoice, isConfigured } = require('../config/btcpay'));
  } catch (e) {
    console.error('❌  Could not load btcpay config:', e.message);
    process.exit(1);
  }
  if (!isConfigured) {
    console.error('❌  BTCPay not configured (BTCPAY_URL or BTCPAY_API_KEY missing)');
    process.exit(1);
  }

  const PaymentSettlementService = require('../services/paymentSettlementService');

  const results = { settled: 0, expired: 0, invalid: 0, skipped: 0, errors: 0 };

  for (const invoiceId of INVOICE_IDS) {
    process.stdout.write(`\n[${invoiceId}] polling BTCPay … `);

    // 1. Poll BTCPay
    let invoice;
    try {
      invoice = await getInvoice(invoiceId);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.errors++;
      continue;
    }

    const status = invoice?.status;
    const additionalStatus = invoice?.additionalStatus;
    const isPaid = status === 'Settled' || additionalStatus === 'PaidLate';

    if (!isPaid) {
      console.log(`${status}${additionalStatus ? `/${additionalStatus}` : ''} — skipping`);
      if (status === 'Expired') results.expired++;
      else if (status === 'Invalid') results.invalid++;
      else results.skipped++;
      continue;
    }

    console.log(`SETTLED ✓ (${status}/${additionalStatus || '-'})`);

    // 2. Load order from dash_subscription_orders
    const { rows: orderRows } = await query(
      `SELECT id, user_id, plan_id, status, creator_id, metadata, usd_amount
       FROM dash_subscription_orders WHERE btcpay_invoice_id = $1`,
      [invoiceId]
    );
    if (orderRows.length === 0) {
      console.log(`  ⚠️  No dash_subscription_orders row found — skipping`);
      results.skipped++;
      continue;
    }
    const order = orderRows[0];

    const orderMeta = typeof order.metadata === 'object'
      ? order.metadata
      : (() => { try { return JSON.parse(order.metadata); } catch { return {}; } })();

    // 3. Reset expired → pending so settlement guards work
    if (order.status === 'expired') {
      await query(
        `UPDATE dash_subscription_orders
            SET status = 'pending', notes = COALESCE(notes,'') || ' paid_late_reset_manual'
          WHERE id = $1 AND status = 'expired'`,
        [order.id]
      );
      order.status = 'pending';
      console.log(`  ↩  Reset to pending (was expired)`);
    } else if (order.status === 'completed') {
      console.log(`  ✅  Already completed — nothing to do`);
      results.settled++;
      continue;
    }

    // 4. Settle based on plan type
    let result;
    try {
      if (order.plan_id === 'call_package' && orderMeta?.resource === 'call_package') {
        console.log(`  📞  Settling call_package (paymentId=${orderMeta.paymentId})`);
        result = await PaymentSettlementService.settleCallPackage(order, invoiceId, orderMeta, query);
      } else if (order.plan_id === 'creator_monthly' && order.creator_id) {
        console.log(`  🎨  Settling creator_monthly (creatorId=${order.creator_id})`);
        result = await PaymentSettlementService.settleCreatorSubscription(order, invoiceId, query);
        // Mirror to payments table (creator auto-renewals)
        if (result?.ok && !result?.alreadyProcessed) {
          await query(
            `UPDATE payments SET status = 'completed', updated_at = NOW()
              WHERE provider IN ('dash','btcpay')
                AND metadata->>'btcpayInvoiceId' = $1
                AND status = 'pending'`,
            [invoiceId]
          );
        }
      } else {
        console.log(`  ⚠️  Unknown plan type (${order.plan_id}) — skipping`);
        results.skipped++;
        continue;
      }
    } catch (err) {
      console.log(`  ❌  Settlement threw: ${err.message}`);
      results.errors++;
      continue;
    }

    if (result?.alreadyProcessed) {
      console.log(`  ✅  Already processed`);
      results.settled++;
    } else if (result?.ok) {
      console.log(`  ✅  Settled OK`);
      results.settled++;
    } else if (result?.skipped) {
      console.log(`  ⚠️  Skipped: ${result.reason}`);
      results.skipped++;
    } else if (result?.error) {
      console.log(`  ❌  Settlement error: ${result.error}`);
      results.errors++;
    }
  }

  console.log('\n─── Summary ─────────────────────────────────────');
  console.log(`  settled:  ${results.settled}`);
  console.log(`  expired:  ${results.expired}  (never paid — ok)`);
  console.log(`  invalid:  ${results.invalid}  (ok)`);
  console.log(`  skipped:  ${results.skipped}`);
  console.log(`  errors:   ${results.errors}`);
  console.log('──────────────────────────────────────────────────\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });
