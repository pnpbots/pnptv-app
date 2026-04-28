#!/usr/bin/env node
/**
 * heal-stuck-epayco-payments.js
 *
 * One-shot heal for ePayco payments that are stuck in `pending` because the
 * activation block silently skipped (broken normalizePlanId converted hyphens
 * → underscores and PlanModel.getById missed). After fixing normalizePlanId
 * at paymentService.js:1283, replay each stuck payment through the now-correct
 * webhook handler. The handler is idempotent (status='pending' guard) and the
 * notifications are gated on _recovery=false, so the heal won't spam operators.
 *
 * Usage:
 *   node apps/backend/scripts/heal-stuck-epayco-payments.js              # dry run
 *   node apps/backend/scripts/heal-stuck-epayco-payments.js --execute    # really replay
 *
 * Safety: dry run prints what it WOULD do. --execute actually invokes the
 * webhook handler. Each replay is logged and reports per-payment outcome.
 */

const path = require('path');
const backendPath = path.join(__dirname, '..');

const { query } = require(path.join(backendPath, 'config/postgres'));
const PaymentService = require(path.join(backendPath, 'services/paymentService'));
const PlanModel = require(path.join(backendPath, 'models/planModel'));
const logger = require(path.join(backendPath, 'utils/logger'));

const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(`\n=== Heal stuck ePayco payments ===`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (will replay)' : 'DRY RUN (no changes)'}`);
  console.log('');

  const stuck = await query(`
    SELECT id, user_id, plan_id, reference, amount, currency, created_at
    FROM payments
    WHERE status = 'pending'
      AND provider = 'epayco'
      AND created_at > NOW() - INTERVAL '30 days'
      AND plan_id LIKE '%-%'
    ORDER BY created_at ASC
  `);

  if (stuck.rowCount === 0) {
    console.log('No stuck payments found. Done.');
    return;
  }

  console.log(`Found ${stuck.rowCount} stuck payments with hyphenated plan_id.\n`);

  const summary = { ok: 0, skipped: 0, failed: 0, noPlan: 0 };

  for (const payment of stuck.rows) {
    const tag = `[${payment.id.slice(0, 8)}…/${payment.plan_id}/$${payment.amount}]`;
    const plan = await PlanModel.getById(payment.plan_id);
    if (!plan) {
      console.log(`${tag} SKIP — plan not in DB even with as-is lookup`);
      summary.noPlan++;
      continue;
    }
    if (!EXECUTE) {
      console.log(`${tag} would replay → user ${payment.user_id}, plan ${plan.display_name || plan.name}`);
      summary.ok++;
      continue;
    }

    // Build synthetic webhook. _recovery=true bypasses Postgres idempotency claim
    // (we want this replay to be processed). Notifications are now gated on
    // _recovery so no operator spam during heal.
    const syntheticWebhook = {
      x_ref_payco: payment.reference,
      x_transaction_id: payment.reference,
      x_transaction_state: 'Aceptada',
      x_cod_transaction_state: '1',
      x_amount: payment.amount,
      x_currency_code: payment.currency || 'COP',
      x_extra1: payment.user_id,
      x_extra2: payment.plan_id,
      x_extra3: payment.id,
      _recovery: true,
      _heal_origin: 'heal-stuck-epayco-payments.js',
    };

    try {
      const result = await PaymentService.processEpaycoWebhook(syntheticWebhook);
      if (result?.success) {
        console.log(`${tag} OK — ${result.alreadyProcessed ? 'already-completed' : 'activated'}`);
        summary.ok++;
      } else {
        console.log(`${tag} FAIL — ${result?.code || result?.error || 'unknown'}`);
        summary.failed++;
      }
    } catch (err) {
      console.log(`${tag} THREW — ${err.message}`);
      logger.error('heal-stuck-epayco-payments: replay threw', {
        paymentId: payment.id, error: err.message, stack: err.stack,
      });
      summary.failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Replayed OK:  ${summary.ok}`);
  console.log(`  Failed:       ${summary.failed}`);
  console.log(`  No plan:      ${summary.noPlan}`);
  console.log(`  Skipped:      ${summary.skipped}`);
  if (!EXECUTE) {
    console.log(`\nThis was a DRY RUN. Re-run with --execute to actually replay.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Heal script failed:', err);
    process.exit(1);
  });
