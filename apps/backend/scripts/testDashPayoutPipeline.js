#!/usr/bin/env node
'use strict';

/**
 * testDashPayoutPipeline.js
 *
 * Walks the entire Dash creator-payout pipeline end-to-end against the running
 * services, against the real DB, with the real BTCPay client mocked or stubbed
 * by default so no money moves.
 *
 * What gets exercised:
 *   1. CreatorPayoutService.runMonthlyPayouts() — the cron entry point
 *   2. The aggregate query that picks creators with paid earnings
 *   3. The route selector (fiat / dash / skip-and-notify)
 *   4. The atomic 'available' → 'in_payout' reservation
 *   5. The creator_payouts row insert
 *   6. The settle path: settleDashPullPayment() flips creator_earnings to 'paid_out'
 *
 * Modes:
 *   --dry-run  (default)  Mocks createPullPayment to return a fake ID so no
 *                         real BTCPay API call is made. Verifies all DB state
 *                         transitions. Cleanup afterwards.
 *   --live                ACTUALLY hits BTCPay and creates a real $0.50 USD
 *                         pull payment. Prints the claim URL so an operator
 *                         can verify in the BTCPay dashboard. NOTE: leaves the
 *                         pull payment in BTCPay (you cancel it manually).
 *
 * Required env: DATABASE_URL, BTCPAY_API_KEY/STORE_ID/URL/WEBHOOK_SECRET
 *
 * Usage:
 *   docker exec pnptv-bot node apps/backend/scripts/testDashPayoutPipeline.js
 *   docker exec pnptv-bot node apps/backend/scripts/testDashPayoutPipeline.js --live
 */

const path = require('path');
const BACKEND_ROOT = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env') });
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '../../.env.production') });
} catch (_) { /* noop */ }

const DRY_RUN = !process.argv.includes('--live');
const TEST_AMOUNT_USD = DRY_RUN ? 1.50 : 0.50;
const TEST_DASH_ADDRESS = 'XaiAhk2N5wZw7Q1H7NYLkR9aBbBcAqGxxZ'; // valid format, not a real wallet
const SYNTHETIC_CREATOR_ID = `test-payout-${Date.now()}`;

const { query, getClient } = require(path.join(BACKEND_ROOT, 'config/postgres'));
const logger = require(path.join(BACKEND_ROOT, 'utils/logger'));

// ── Logger noise ────────────────────────────────────────────────────────────
// CreatorPayoutService logs at info; for the test we want a clean stdout so
// downgrade to warn for the duration of the run.
const ORIG_LEVEL = logger.level;
logger.level = 'warn';

// ── BTCPay mock (dry-run only) ─────────────────────────────────────────────
let _mockedPullPaymentId = null;
function installBtcpayMock() {
  const btcpayPath = require.resolve(path.join(BACKEND_ROOT, 'config/btcpay'));
  const btcpayMod = require(btcpayPath);
  const original = btcpayMod.createPullPayment;

  btcpayMod.createPullPayment = async ({ amountUsd, creatorId, description }) => {
    _mockedPullPaymentId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(`  [mock] createPullPayment(${amountUsd} USD, creator=${creatorId}) → ${_mockedPullPaymentId}`);
    return {
      pullPaymentId: _mockedPullPaymentId,
      viewUrl: `https://btcpay.example/pull-payments/${_mockedPullPaymentId}`,
    };
  };

  btcpayMod.archivePullPayment = async (id) => {
    console.log(`  [mock] archivePullPayment(${id})`);
  };

  return () => { btcpayMod.createPullPayment = original; };
}

// ── Setup ───────────────────────────────────────────────────────────────────
async function setupSyntheticCreator() {
  console.log(`\n[1/6] Creating synthetic creator id=${SYNTHETIC_CREATOR_ID}`);
  await query(`
    INSERT INTO users (
      id, telegram, username, first_name, language,
      creator_status, creator_type, creator_price_usd,
      creator_dash_address, payout_method,
      tier, subscription_status, terms_accepted, age_verified
    ) VALUES (
      $1, $1, 'test-payout', 'Test Payout', 'en',
      'active', 'ice', 9.99,
      $2, 'dash',
      'free', 'free', true, true
    ) ON CONFLICT (id) DO UPDATE SET
      creator_status = 'active',
      creator_dash_address = EXCLUDED.creator_dash_address,
      payout_method = 'dash'
  `, [SYNTHETIC_CREATOR_ID, TEST_DASH_ADDRESS]);

  console.log(`[2/6] Inserting creator_earnings row ($${TEST_AMOUNT_USD})`);
  const { rows: earningRows } = await query(`
    INSERT INTO creator_earnings (
      creator_id, amount_gross, amount_creator, amount_platform,
      status, period_month
    ) VALUES (
      $1, $2, $2, 0,
      'available', date_trunc('month', CURRENT_DATE)::date
    ) RETURNING id
  `, [SYNTHETIC_CREATOR_ID, TEST_AMOUNT_USD]);

  return earningRows[0].id;
}

// ── Run ─────────────────────────────────────────────────────────────────────
async function runPipeline() {
  const CreatorPayoutService = require(path.join(BACKEND_ROOT, 'services/creatorPayoutService'));
  console.log(`\n[3/6] Calling CreatorPayoutService.runMonthlyPayouts()...`);
  const result = await CreatorPayoutService.runMonthlyPayouts();
  console.log(`  ↳ ${JSON.stringify(result)}`);
  return result;
}

// ── Verify ──────────────────────────────────────────────────────────────────
async function verifyState(earningId) {
  console.log(`\n[4/6] Verifying DB state after payout creation`);

  const { rows: payoutRows } = await query(
    `SELECT id, status, amount_usd, btcpay_pull_payment_id, view_url, earning_ids
     FROM creator_payouts WHERE creator_id = $1`,
    [SYNTHETIC_CREATOR_ID]
  );
  if (payoutRows.length !== 1) {
    throw new Error(`Expected 1 creator_payouts row, got ${payoutRows.length}`);
  }
  const payout = payoutRows[0];
  console.log(`  ✓ creator_payouts row created: id=${payout.id} status=${payout.status} pullId=${payout.btcpay_pull_payment_id}`);
  if (payout.status !== 'pending') throw new Error(`Expected status=pending, got ${payout.status}`);
  if (parseFloat(payout.amount_usd) !== TEST_AMOUNT_USD) {
    throw new Error(`Expected amount=${TEST_AMOUNT_USD}, got ${payout.amount_usd}`);
  }
  if (!payout.earning_ids.includes(earningId)) {
    throw new Error(`creator_payouts.earning_ids missing the original earning id`);
  }

  const { rows: earningRows } = await query(
    `SELECT id, status, paid_at, metadata FROM creator_earnings WHERE id = $1`,
    [earningId]
  );
  const earning = earningRows[0];
  console.log(`  ✓ creator_earnings reserved: status=${earning.status} paid_at=${earning.paid_at} pullId=${earning.metadata?.pullPaymentId}`);
  if (earning.status !== 'in_payout') throw new Error(`Expected status=in_payout, got ${earning.status}`);
  if (earning.paid_at !== null) throw new Error(`Expected paid_at=null at this stage, got ${earning.paid_at}`);

  return payout;
}

// ── Settle ──────────────────────────────────────────────────────────────────
async function simulateSettlement(payout) {
  console.log(`\n[5/6] Simulating BTCPay PayoutCompleted webhook`);
  const CreatorPayoutService = require(path.join(BACKEND_ROOT, 'services/creatorPayoutService'));
  const settleResult = await CreatorPayoutService.settleDashPullPayment(
    payout.btcpay_pull_payment_id,
    { txHash: '0xMOCKEDTXHASH', payoutId: 'mocked-payout' }
  );
  console.log(`  ↳ settleDashPullPayment: ${JSON.stringify(settleResult)}`);
  if (!settleResult.settled) throw new Error(`Settle failed: ${JSON.stringify(settleResult)}`);

  // Re-check final state
  const { rows: finalPayoutRows } = await query(
    `SELECT status, completed_at FROM creator_payouts WHERE id = $1`,
    [payout.id]
  );
  const finalPayout = finalPayoutRows[0];
  console.log(`  ✓ creator_payouts final: status=${finalPayout.status} completed_at=${finalPayout.completed_at}`);
  if (finalPayout.status !== 'completed') throw new Error(`Expected status=completed, got ${finalPayout.status}`);

  const { rows: finalEarningRows } = await query(
    `SELECT status, paid_at, metadata FROM creator_earnings WHERE id = ANY($1)`,
    [payout.earning_ids]
  );
  const finalEarning = finalEarningRows[0];
  console.log(`  ✓ creator_earnings final: status=${finalEarning.status} paid_at=${finalEarning.paid_at} payoutMethod=${finalEarning.metadata?.payoutMethod}`);
  if (finalEarning.status !== 'paid_out') throw new Error(`Expected status=paid_out, got ${finalEarning.status}`);
  if (!finalEarning.paid_at) throw new Error(`Expected paid_at to be set`);

  // Idempotency: a second settle should be a no-op
  const second = await CreatorPayoutService.settleDashPullPayment(payout.btcpay_pull_payment_id, {});
  console.log(`  ✓ Idempotency: second settle returned ${JSON.stringify(second)}`);
  if (second.settled !== false || second.reason !== 'already_settled') {
    throw new Error(`Idempotency broken: second settle should report already_settled, got ${JSON.stringify(second)}`);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log(`\n[6/6] Cleaning up synthetic data`);
  await query(`DELETE FROM creator_earnings WHERE creator_id = $1`, [SYNTHETIC_CREATOR_ID]);
  await query(`DELETE FROM creator_payouts WHERE creator_id = $1`, [SYNTHETIC_CREATOR_ID]);
  await query(`DELETE FROM users WHERE id = $1`, [SYNTHETIC_CREATOR_ID]);
  console.log(`  ✓ creator_earnings, creator_payouts, users rows deleted`);
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== Dash payout pipeline test ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (BTCPay mocked)' : 'LIVE (real BTCPay pull payment will be created)'}`);
  console.log(`Test amount: $${TEST_AMOUNT_USD}`);
  console.log(`Synthetic creator id: ${SYNTHETIC_CREATOR_ID}`);

  let restoreBtcpay = () => {};
  if (DRY_RUN) restoreBtcpay = installBtcpayMock();

  let earningId;
  try {
    earningId = await setupSyntheticCreator();
    const result = await runPipeline();
    if (!(result.paid >= 1)) {
      throw new Error(`Expected at least 1 paid creator, got: ${JSON.stringify(result)}`);
    }
    const payout = await verifyState(earningId);
    if (DRY_RUN) {
      await simulateSettlement(payout);
    } else {
      console.log(`\n[5/6] LIVE mode — skipping webhook simulation. Visit ${payout.view_url} to claim manually.`);
    }
    await cleanup();
    console.log(`\n✅ All assertions passed. Pipeline is healthy.\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Test FAILED: ${err.message}`);
    console.error(err.stack);
    try { await cleanup(); } catch (cleanupErr) {
      console.error(`  cleanup also failed: ${cleanupErr.message}`);
    }
    process.exit(1);
  } finally {
    restoreBtcpay();
    logger.level = ORIG_LEVEL;
  }
})();
