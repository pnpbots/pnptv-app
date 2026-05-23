#!/usr/bin/env node
/**
 * settle-dash-payments.js — Comprehensive Dash/BTCPay abandoned payment recovery
 *
 * Queries the DB for expired dash_subscription_orders, polls BTCPay, and
 * settles any that were actually paid but never processed (due to the webhook
 * incident or any future delivery failure).
 *
 * Usage:
 *   node apps/backend/scripts/settle-dash-payments.js              # dry-run
 *   node apps/backend/scripts/settle-dash-payments.js --settle     # apply fixes
 *   node apps/backend/scripts/settle-dash-payments.js --before 2026-04-28
 *   node apps/backend/scripts/settle-dash-payments.js --settle --user 7572991692
 *
 * Options:
 *   --settle         Apply settlements (default: dry-run, no writes)
 *   --before DATE    Only orders created before DATE (ISO date)
 *   --after DATE     Only orders created after DATE
 *   --user UID       Only orders for this user_id
 *   --limit N        Cap how many invoices to poll (default: all)
 *   --delay MS       Pause between BTCPay API calls, ms (default: 350)
 *
 * Idempotent — the settlement guard is an atomic UPDATE WHERE status='pending'
 * at the DB level, so re-runs and concurrent webhooks cannot double-grant.
 */

'use strict';

require('dotenv').config();

const { query } = require('../config/postgres');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN   = !args.includes('--settle');
const _bi = args.indexOf('--before'); const BEFORE = _bi >= 0 ? args[_bi + 1] : null;
const _ai = args.indexOf('--after');  const AFTER  = _ai >= 0 ? args[_ai + 1] : null;
const _ui = args.indexOf('--user');   const USER   = _ui >= 0 ? args[_ui + 1] : null;
const _li = args.indexOf('--limit');  const LIMIT  = _li >= 0 ? parseInt(args[_li + 1], 10) : null;
const _di = args.indexOf('--delay');  const DELAY_MS = _di >= 0 ? parseInt(args[_di + 1], 10) : 350;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Settlement helpers ────────────────────────────────────────────────────────

async function resetExpiredToPending(orderId, label) {
  const res = await query(
    `UPDATE dash_subscription_orders
        SET status = 'pending',
            notes  = COALESCE(notes, '') || $2
      WHERE id = $1 AND status = 'expired'
      RETURNING id`,
    [orderId, ` paid_late_recovery_${label}`]
  );
  return res.rowCount > 0;
}

async function rollbackToPending(orderId) {
  await query(
    `UPDATE dash_subscription_orders
        SET status = 'expired',
            notes  = COALESCE(notes, '') || ' settlement_err_rolled_back'
      WHERE id = $1 AND status = 'pending'`,
    [orderId]
  );
}

async function settleOrder(order, invoiceId, PaymentSettlementService) {
  const orderMeta = typeof order.metadata === 'object'
    ? (order.metadata || {})
    : (() => { try { return JSON.parse(order.metadata); } catch { return {}; } })();

  const planId = order.plan_id;

  // call_package
  if (orderMeta?.resource === 'call_package' || planId === 'call_package') {
    if (!orderMeta?.paymentId && !orderMeta?.resource) {
      return { skipped: true, reason: 'call_package missing paymentId in metadata' };
    }
    return await PaymentSettlementService.settleCallPackage(order, invoiceId, orderMeta, query);
  }

  // creator_monthly
  if (planId === 'creator_monthly' && order.creator_id) {
    const result = await PaymentSettlementService.settleCreatorSubscription(order, invoiceId, query);
    if (result?.ok && !result?.alreadyProcessed) {
      await query(
        `UPDATE payments SET status = 'completed', updated_at = NOW()
          WHERE provider IN ('dash','btcpay')
            AND metadata->>'btcpayInvoiceId' = $1
            AND status = 'pending'`,
        [invoiceId]
      );
    }
    return result;
  }

  // Standard subscription plan
  const { rows: planRows } = await query(
    `SELECT id, duration_days, is_lifetime, tier FROM plans WHERE id = $1`,
    [planId]
  );
  if (!planRows.length) {
    return { skipped: true, reason: `plan '${planId}' not found in plans table` };
  }
  return await PaymentSettlementService.settleSubscription(order, invoiceId, planRows[0], query);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  Dash/BTCPay Abandoned Payment Recovery');
  console.log(DRY_RUN
    ? '  MODE: DRY RUN — safe, no DB writes'
    : '  MODE: SETTLE — will apply grants');
  if (BEFORE) console.log(`  Filter: created_at < ${BEFORE}`);
  if (AFTER)  console.log(`  Filter: created_at >= ${AFTER}`);
  if (USER)   console.log(`  Filter: user_id = ${USER}`);
  if (LIMIT)  console.log(`  Limit:  ${LIMIT}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Verify BTCPay is configured
  let getInvoice, isConfigured;
  try {
    ({ getInvoice, isConfigured } = require('../config/btcpay'));
  } catch (e) {
    console.error('ERROR: Could not load btcpay config:', e.message);
    process.exit(1);
  }
  if (!isConfigured) {
    console.error('ERROR: BTCPay not configured (BTCPAY_API_KEY or BTCPAY_STORE_ID missing)');
    process.exit(1);
  }

  const PaymentSettlementService = require('../services/paymentSettlementService');

  // ── Build DB query ────────────────────────────────────────────────────────
  const where = [`status = 'expired'`, `btcpay_invoice_id IS NOT NULL`];
  const params = [];
  let n = 1;
  if (BEFORE) { where.push(`created_at < $${n++}`); params.push(BEFORE); }
  if (AFTER)  { where.push(`created_at >= $${n++}`); params.push(AFTER); }
  if (USER)   { where.push(`user_id = $${n++}`); params.push(USER); }

  const sql = `
    SELECT id, user_id, plan_id, btcpay_invoice_id, usd_amount,
           created_at, creator_id, metadata, status
    FROM dash_subscription_orders
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `;
  const { rows: orders } = await query(sql, params);

  console.log(`Orders to check: ${orders.length}\n`);
  if (!orders.length) { console.log('Nothing to do.'); process.exit(0); }

  // ── Poll + settle ─────────────────────────────────────────────────────────
  const stats = { paid: 0, settled: 0, alreadyProcessed: 0, genuineExpiry: 0, errors: 0, skipped: 0, btcpayErrors: 0 };
  const paidList = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const { id, btcpay_invoice_id: invoiceId, plan_id: planId, user_id: userId, usd_amount: amount, created_at: createdAt } = order;
    const prefix = `[${String(i + 1).padStart(orders.length.toString().length)}/${orders.length}]`;

    process.stdout.write(`${prefix} ${invoiceId}  ${planId}  $${amount}  user=${userId} … `);

    // Poll BTCPay
    let invoice;
    try {
      invoice = await getInvoice(invoiceId);
    } catch (err) {
      if (err.response?.status === 404) {
        console.log('404 (not in BTCPay — genuine expire)');
        stats.genuineExpiry++;
      } else {
        console.log(`POLL ERROR: ${err.message}`);
        stats.btcpayErrors++;
      }
      await sleep(DELAY_MS);
      continue;
    }

    const btcStatus     = invoice?.status;
    const btcAdditional = invoice?.additionalStatus;
    const isPaid        = btcStatus === 'Settled' || btcAdditional === 'PaidLate';

    if (!isPaid) {
      console.log(`${btcStatus}${btcAdditional ? `/${btcAdditional}` : ''}`);
      stats.genuineExpiry++;
      await sleep(DELAY_MS);
      continue;
    }

    // PAID — needs settlement
    const payTag = `${btcStatus}${btcAdditional ? `/${btcAdditional}` : ''}`;
    console.log(`PAID (${payTag})`);
    stats.paid++;
    paidList.push({ invoiceId, planId, userId, amount, createdAt: new Date(createdAt).toISOString().slice(0, 10), payTag });

    if (DRY_RUN) { await sleep(DELAY_MS); continue; }

    // Reset to pending
    const date = new Date().toISOString().slice(0, 10);
    const reset = await resetExpiredToPending(id, date);
    if (!reset) {
      // Could have been completed by a concurrent run
      const { rows: chk } = await query(`SELECT status FROM dash_subscription_orders WHERE id = $1`, [id]);
      if (chk[0]?.status === 'completed') {
        console.log(`  ✅  Already completed (concurrent)`);
        stats.alreadyProcessed++;
      } else {
        console.log(`  ⚠️  Could not reset to pending (current: ${chk[0]?.status})`);
        stats.skipped++;
      }
      await sleep(DELAY_MS);
      continue;
    }
    console.log('  ↩  Reset expired → pending');

    // Settle
    let result;
    try {
      result = await settleOrder({ ...order, status: 'pending' }, invoiceId, PaymentSettlementService);
    } catch (err) {
      console.log(`  ❌  Settlement threw: ${err.message}`);
      await rollbackToPending(id);
      stats.errors++;
      await sleep(DELAY_MS);
      continue;
    }

    if (result?.alreadyProcessed) {
      console.log('  ✅  Already processed (idempotent)');
      stats.alreadyProcessed++;
    } else if (result?.skipped) {
      console.log(`  ⚠️  Skipped: ${result.reason}`);
      // Roll back so it remains recoverable
      await rollbackToPending(id);
      stats.skipped++;
    } else if (result?.error) {
      console.log(`  ❌  Settlement error: ${result.error}`);
      stats.errors++;
    } else {
      // settleSubscription returns { type: 'subscription', ... }, settleCreator { ok: true }
      console.log('  ✅  Settled OK');
      stats.settled++;
    }

    await sleep(DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(` SUMMARY${DRY_RUN ? ' — DRY RUN (nothing written)' : ' — LIVE RUN'}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` Checked:          ${orders.length}`);
  console.log(` Paid in BTCPay:   ${stats.paid}`);
  if (!DRY_RUN) {
    console.log(` Settled now:      ${stats.settled}`);
    console.log(` Already done:     ${stats.alreadyProcessed}`);
  }
  console.log(` Genuine expiries: ${stats.genuineExpiry}`);
  console.log(` Skipped:          ${stats.skipped}`);
  console.log(` BTCPay errors:    ${stats.btcpayErrors}`);
  console.log(` Settlement errors:${stats.errors}`);

  if (paidList.length > 0) {
    console.log('\n── Paid invoices ────────────────────────────────────────────');
    for (const p of paidList) {
      console.log(`  ${p.invoiceId}  ${p.planId}  $${p.amount}  user=${p.userId}  date=${p.createdAt}  status=${p.payTag}`);
    }
  }

  if (DRY_RUN && stats.paid > 0) {
    console.log(`\n  Run with --settle to apply ${stats.paid} settlement(s).`);
  }
  if (stats.errors > 0) {
    console.log(`\n  ${stats.errors} error(s) — check logs for details.`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('Fatal:', err); process.exit(1); });
