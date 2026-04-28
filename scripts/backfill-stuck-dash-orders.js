#!/usr/bin/env node
/**
 * One-shot backfill for Dash/BTCPay orders stranded in `pending` after the
 * webhook URL mismatch (Apr 21–28, 2026). For each pending order:
 *   - Settled in BTCPay → run the same code path the webhook would have
 *   - Expired/Invalid in BTCPay → mark order accordingly
 *
 * Run with: node scripts/backfill-stuck-dash-orders.js [--dry-run]
 */
require('dotenv').config({ path: '/app/.env' });
require('dotenv').config({ path: '/app/.env.production' });

const { query } = require('/app/apps/backend/config/postgres');
const { cache } = require('/app/apps/backend/config/redis');
const { getInvoice } = require('/app/apps/backend/config/btcpay');
const PaymentService = require('/app/apps/backend/services/paymentService');
const PlanModel = require('/app/apps/backend/models/planModel');
const logger = require('/app/apps/backend/utils/logger');

const DRY = process.argv.includes('--dry-run');

async function settleSubscription(order) {
  const { id, user_id, plan_id, btcpay_invoice_id: invoiceId, creator_id, metadata } = order;

  const meta = metadata && typeof metadata === 'object'
    ? metadata
    : (typeof metadata === 'string' ? (() => { try { return JSON.parse(metadata); } catch { return null; } })() : null);

  if (meta && (meta.resource === 'live_show_ticket' || meta.resource === 'private_call_booking' || meta.resource === 'call_package')) {
    logger.warn('Skipping non-subscription order — manual review needed', { invoiceId, resource: meta.resource });
    return { skipped: true, reason: meta.resource };
  }

  if (meta && (meta.hangoutGroupId || meta.channelId)) {
    if (DRY) return { wouldGrant: 'scoped', meta };
    const upd = await query(
      `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id]
    );
    if (upd.rowCount === 0) return { alreadyProcessed: true };
    const grantResult = await PaymentService.grantEntitlementsForPlan(user_id, plan_id, 'dash', meta);
    return { type: 'scoped', grantResult };
  }

  const isCreatorSub = plan_id === 'creator_monthly' && creator_id;
  let plan;
  if (isCreatorSub) {
    plan = { id: 'creator_monthly', name: 'Creator Subscription', display_name: 'Creator Subscription', tier: null, duration_days: 30 };
  } else {
    plan = await PlanModel.getById(plan_id);
    if (!plan) {
      logger.error('Plan not found — leaving as-is for manual review', { invoiceId, planId: plan_id });
      return { error: 'plan_not_found' };
    }
  }

  const durationDays = plan.duration_days || plan.duration || 30;
  const isLifetime = durationDays >= 36500;
  const expiryDate = isLifetime ? null : new Date(Date.now() + durationDays * 86400000);
  const newTier = (plan.tier === 'member' || plan_id.startsWith('member_')) ? 'member' : 'PRIME';

  if (DRY) return { wouldGrant: 'subscription', tier: newTier, expiry: expiryDate };

  const settleRes = await query(
    `UPDATE dash_subscription_orders SET status = 'completed', completed_at = NOW()
     WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id]
  );
  if (settleRes.rowCount === 0) return { alreadyProcessed: true };

  if (isCreatorSub) {
    const CreatorService = require('/app/apps/backend/services/creatorService');
    await CreatorService.subscribeToCreator(user_id, creator_id, null);
    return { type: 'creator_subscription', creatorId: creator_id };
  }

  await query(
    `UPDATE users SET tier = $2, subscription_status = 'active', plan_id = $3, plan_expiry = $4, updated_at = NOW()
     WHERE id = $1 OR telegram = $1`,
    [user_id, newTier, plan_id, expiryDate]
  );

  let grantResult = null;
  try {
    grantResult = await PaymentService.grantEntitlementsForPlan(user_id, plan_id, 'btcpay');
  } catch (e) {
    logger.error('grantEntitlementsForPlan failed (tier already set)', { userId: user_id, planId: plan_id, error: e.message });
  }

  try { await cache.del(`user:${user_id}`); } catch {}

  return { type: 'subscription', tier: newTier, expiryDate, grantResult };
}

(async () => {
  const { rows } = await query(
    `SELECT id, user_id, plan_id, btcpay_invoice_id, creator_id, metadata, usd_amount, created_at
     FROM dash_subscription_orders
     WHERE status = 'pending' AND btcpay_invoice_id IS NOT NULL
     ORDER BY created_at ASC`
  );

  console.log(`[${DRY ? 'DRY-RUN' : 'LIVE'}] Found ${rows.length} pending dash orders.\n`);

  const summary = { settled: 0, expired: 0, invalid: 0, stillNew: 0, processing: 0, error: 0, skipped: 0 };

  for (const order of rows) {
    let inv;
    try {
      inv = await getInvoice(order.btcpay_invoice_id);
    } catch (e) {
      const code = e.response?.status;
      if (code === 404) {
        if (!DRY) {
          await query(
            `UPDATE dash_subscription_orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
            [order.id]
          );
        }
        summary.expired++;
        console.log(`[${order.btcpay_invoice_id}] 404 → expired`);
      } else {
        summary.error++;
        console.log(`[${order.btcpay_invoice_id}] error: ${e.message}`);
      }
      continue;
    }

    const status = inv?.status;
    if (status === 'Settled') {
      try {
        const result = await settleSubscription(order);
        summary.settled++;
        console.log(`[${order.btcpay_invoice_id}] Settled → user=${order.user_id} plan=${order.plan_id} → ${JSON.stringify(result)}`);
      } catch (e) {
        summary.error++;
        console.log(`[${order.btcpay_invoice_id}] Settled but grant failed: ${e.message}`);
      }
    } else if (status === 'Expired') {
      if (!DRY) {
        await query(
          `UPDATE dash_subscription_orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
          [order.id]
        );
      }
      summary.expired++;
    } else if (status === 'Invalid') {
      if (!DRY) {
        await query(
          `UPDATE dash_subscription_orders SET status = 'invalid' WHERE id = $1 AND status = 'pending'`,
          [order.id]
        );
      }
      summary.invalid++;
    } else if (status === 'New') {
      summary.stillNew++;
    } else if (status === 'Processing') {
      summary.processing++;
    } else {
      summary.error++;
      console.log(`[${order.btcpay_invoice_id}] unknown status: ${status}`);
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\nSummary:', JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});
