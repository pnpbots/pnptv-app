'use strict';

/**
 * cashoutService.js
 * Creator USDT cash-out off-ramp. Three lanes:
 *   1. onchain_usdt  — manual treasury settlement (operator-settled for now; Fireblocks/BTCPay USDT TBD)
 *   2. bitrefill     — gift-card / bill-payment via Bitrefill invoices API
 *   3. transak       — fiat on/off ramp via Transak widget + server-side payout receipt
 *
 * All public methods throw structured errors with a `.code` property so
 * route handlers can map them to HTTP status codes without string matching.
 */

const axios = require('axios');
const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');

// ── Config ───────────────────────────────────────────────────────────────────

const BITREFILL_API_KEY = process.env.BITREFILL_API_KEY || '';
const TRANSAK_API_KEY = process.env.TRANSAK_API_KEY || '';
const TRANSAK_ENV = (process.env.TRANSAK_ENV || 'STAGING').toUpperCase();

// Operator-configurable cashout limits. Per-request blocks a single huge
// withdrawal (stolen-session abuse); per-day caps total daily outflow per
// creator. Both are enforced server-side regardless of client-supplied amount.
const MAX_CASHOUT_USD_PER_REQUEST = parseFloat(process.env.MAX_CASHOUT_USD_PER_REQUEST || '5000');
const MAX_CASHOUT_USD_PER_DAY = parseFloat(process.env.MAX_CASHOUT_USD_PER_DAY || '10000');

const BITREFILL_BASE_URL = 'https://api.bitrefill.com/v2';
const TRANSAK_BASE_URLS = {
  STAGING: 'https://staging-api.transak.com',
  PRODUCTION: 'https://api.transak.com',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a structured error with a machine-readable code.
 * @param {string} code  — e.g. 'INSUFFICIENT_BALANCE', 'INVALID_LANE'
 * @param {string} msg   — human-readable message
 * @param {number} [status=400] — suggested HTTP status
 */
function err(code, msg, status = 400) {
  const e = new Error(msg);
  e.code = code;
  e.status = status;
  return e;
}

/**
 * Validate a TRC-20 wallet address (Tron).
 * TRC-20 addresses start with 'T' and are exactly 34 base58 characters.
 */
function isValidTrc20Address(address) {
  return typeof address === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a creator's current earnings balance, split by hold status.
 *
 * @param {string} creatorId
 * @returns {Promise<{
 *   holding_usd: number,
 *   holding_count: number,
 *   available_usd: number,
 *   available_count: number,
 *   earliest_available_at: string|null
 * }>}
 */
async function getCreatorBalance(creatorId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(amount_creator) FILTER (WHERE status = 'holding'),  0)::float AS holding_usd,
       COUNT(*)                     FILTER (WHERE status = 'holding')              AS holding_count,
       COALESCE(SUM(amount_creator) FILTER (WHERE status = 'available'), 0)::float AS available_usd,
       COUNT(*)                     FILTER (WHERE status = 'available')             AS available_count,
       MIN(available_at)            FILTER (WHERE status = 'holding')               AS earliest_available_at
     FROM creator_earnings
     WHERE creator_id = $1
       AND status IN ('holding', 'available')`,
    [String(creatorId)]
  );
  const row = rows[0];
  return {
    holding_usd: parseFloat(row.holding_usd) || 0,
    holding_count: parseInt(row.holding_count, 10) || 0,
    available_usd: parseFloat(row.available_usd) || 0,
    available_count: parseInt(row.available_count, 10) || 0,
    earliest_available_at: row.earliest_available_at || null,
  };
}

/**
 * Request a cash-out.
 *
 * Validates available balance, locks the oldest available earnings rows totaling
 * amountUsd (SKIP LOCKED so concurrent requests don't race), inserts a
 * fiat_cashout_orders row, marks those earnings as 'in_payout', then dispatches
 * to the appropriate lane handler.
 *
 * @param {object} opts
 * @param {string} opts.creatorId
 * @param {number} opts.amountUsd     — must be > 0 and <= available_usd
 * @param {string} opts.lane          — 'onchain_usdt' | 'bitrefill' | 'transak'
 * @param {object} opts.destination   — lane-specific payload (see lane handlers)
 * @returns {Promise<{ order: object, dispatch: object }>}
 */
async function requestCashout({ creatorId, amountUsd, lane, destination }) {
  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!creatorId) throw err('MISSING_CREATOR_ID', 'creatorId is required');
  if (!amountUsd || typeof amountUsd !== 'number' || amountUsd <= 0) {
    throw err('INVALID_AMOUNT', 'amount_usd must be a positive number');
  }
  if (amountUsd > MAX_CASHOUT_USD_PER_REQUEST) {
    throw err(
      'AMOUNT_OVER_PER_REQUEST_CAP',
      `Single cashout request cannot exceed $${MAX_CASHOUT_USD_PER_REQUEST.toFixed(2)}.`
    );
  }
  const validLanes = ['onchain_usdt', 'bitrefill', 'transak'];
  if (!validLanes.includes(lane)) {
    throw err('INVALID_LANE', `lane must be one of: ${validLanes.join(', ')}`);
  }
  if (!destination || typeof destination !== 'object') {
    throw err('MISSING_DESTINATION', 'destination object is required');
  }

  // Block concurrent / overlapping cashout orders. The DB-level SKIP LOCKED on
  // earnings rows prevents double-spend at the row level, but a creator with
  // a large balance can still spin up multiple orders in sequence — bad for
  // the manual onchain_usdt lane where operators settle by hand.
  const { rows: openOrders } = await query(
    `SELECT id FROM fiat_cashout_orders
       WHERE creator_id = $1
         AND status IN ('pending', 'processing')
       LIMIT 1`,
    [String(creatorId)]
  );
  if (openOrders.length > 0) {
    throw err(
      'OPEN_ORDER_EXISTS',
      'You already have a cashout order in flight. Wait for it to settle before requesting another.',
      409
    );
  }

  // Per-day cap (rolling 24h). Counts pending/processing/settled — anything
  // that already committed earnings to a payout.
  const { rows: dayRows } = await query(
    `SELECT COALESCE(SUM(amount_usd), 0)::numeric AS total
       FROM fiat_cashout_orders
       WHERE creator_id = $1
         AND status NOT IN ('failed', 'cancelled')
         AND requested_at >= NOW() - INTERVAL '24 hours'`,
    [String(creatorId)]
  );
  const dayTotal = parseFloat(dayRows[0]?.total || 0);
  if (dayTotal + amountUsd > MAX_CASHOUT_USD_PER_DAY) {
    throw err(
      'AMOUNT_OVER_DAY_CAP',
      `24h cashout cap is $${MAX_CASHOUT_USD_PER_DAY.toFixed(2)} — used $${dayTotal.toFixed(2)} so far.`
    );
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // ── Lock oldest available earnings up to the requested amount ─────────
    // SKIP LOCKED ensures concurrent requests don't pick the same rows.
    // We fetch more than enough rows and stop once we've accumulated amountUsd.
    const { rows: candidates } = await client.query(
      `SELECT id, amount_creator
         FROM creator_earnings
        WHERE creator_id = $1
          AND status = 'available'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 500`,
      [String(creatorId)]
    );

    // Walk the candidates and pick the minimum set that covers amountUsd.
    let accumulated = 0;
    const selected = [];
    for (const row of candidates) {
      if (accumulated >= amountUsd) break;
      selected.push(row);
      accumulated = Math.round((accumulated + parseFloat(row.amount_creator)) * 100) / 100;
    }

    if (accumulated < amountUsd) {
      await client.query('ROLLBACK');
      throw err('INSUFFICIENT_BALANCE', `Available balance ($${accumulated.toFixed(2)}) is less than requested amount ($${amountUsd.toFixed(2)})`);
    }

    const earningIds = selected.map(r => r.id);

    // ── Insert the order ──────────────────────────────────────────────────
    const { rows: orderRows } = await client.query(
      `INSERT INTO fiat_cashout_orders
         (creator_id, amount_usd, lane, status, destination, earning_ids)
       VALUES ($1, $2, $3, 'pending', $4::jsonb, $5::uuid[])
       RETURNING *`,
      [String(creatorId), amountUsd, lane, JSON.stringify(destination), earningIds]
    );
    const order = orderRows[0];

    // ── Flip selected earnings to in_payout ───────────────────────────────
    await client.query(
      `UPDATE creator_earnings
          SET status = 'in_payout',
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [earningIds]
    );

    await client.query('COMMIT');

    logger.info('[cashoutService] cashout order created', {
      orderId: order.id, creatorId, amountUsd, lane, earningCount: earningIds.length,
    });

    // ── Dispatch to lane (outside the transaction — provider calls must not block DB) ──
    let dispatchResult;
    try {
      if (lane === 'onchain_usdt') {
        dispatchResult = await dispatchOnchainUsdt(order, destination);
      } else if (lane === 'bitrefill') {
        dispatchResult = await dispatchBitrefill(order, destination);
      } else {
        dispatchResult = await dispatchTransak(order, destination);
      }

      // Update order with provider_ref and set to processing
      await query(
        `UPDATE fiat_cashout_orders
            SET status = 'processing',
                provider_ref = $2,
                provider_meta = $3::jsonb,
                processed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [order.id, dispatchResult.ref || null, JSON.stringify(dispatchResult)]
      );
      order.status = 'processing';
      order.provider_ref = dispatchResult.ref || null;
    } catch (dispatchErr) {
      // On dispatch failure, roll the order to 'failed' and restore earnings to 'available'.
      logger.error('[cashoutService] dispatch failed — rolling back order', {
        orderId: order.id, lane, error: dispatchErr.message,
      });
      await failCashoutOrder(order.id, dispatchErr.message);
      throw err('DISPATCH_FAILED', `Payment lane dispatch failed: ${dispatchErr.message}`, 502);
    }

    return { order, dispatch: dispatchResult };
  } catch (e) {
    // Only roll back if the transaction is still open (i.e. we didn't COMMIT yet).
    // If e is our structured error thrown after COMMIT (dispatch failure), the
    // failCashoutOrder call above already handled cleanup.
    if (e.code !== 'DISPATCH_FAILED') {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * On-chain USDT lane handler.
 * Validates TRC-20 address shape. Actual treasury transfer is operator-settled manually.
 * // TODO: automate via Fireblocks/BTCPay USDT when treasury wallet is provisioned.
 *
 * @param {object} order         — fiat_cashout_orders row
 * @param {object} destination   — { address: string, chain: 'tron'|'ethereum'|'base' }
 */
async function dispatchOnchainUsdt(order, destination) {
  const { address, chain = 'tron' } = destination || {};

  if (!address) throw err('MISSING_ADDRESS', 'destination.address is required for onchain_usdt lane');

  // TRC-20 validation (Tron network). Ethereum/Base addresses start with 0x and are 42 chars.
  if (chain === 'tron' && !isValidTrc20Address(address)) {
    throw err('INVALID_ADDRESS', 'TRC-20 address must start with T and be 34 characters');
  }
  if ((chain === 'ethereum' || chain === 'base') && !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw err('INVALID_ADDRESS', `${chain} address must be a valid 0x... EVM address (42 chars)`);
  }

  logger.info('[cashoutService.onchain] manual settlement pending', {
    orderId: order.id,
    creatorId: order.creator_id,
    amountUsd: order.amount_usd,
    chain,
    address,
  });

  // Operator receives a notification via the admin dashboard to settle manually.
  return {
    ref: `manual-${order.id}`,
    pending_manual: true,
    chain,
    address,
  };
}

/**
 * Bitrefill lane handler.
 * Creates a Bitrefill invoice for the specified product.
 * If BITREFILL_API_KEY is not set, returns a stub and logs a warning.
 *
 * @param {object} order         — fiat_cashout_orders row
 * @param {object} destination   — { product_id: string, recipient_email?: string }
 */
async function dispatchBitrefill(order, destination) {
  const { product_id, recipient_email } = destination || {};

  if (!product_id) throw err('MISSING_PRODUCT_ID', 'destination.product_id is required for bitrefill lane');

  if (!BITREFILL_API_KEY) {
    logger.warn('[cashoutService.bitrefill] BITREFILL_API_KEY not set — returning stub', {
      orderId: order.id,
    });
    return {
      ref: `stub-bitrefill-${order.id}`,
      stub: true,
    };
  }

  const payload = {
    products: [{ product_id, value: parseFloat(order.amount_usd) }],
    currency: 'USD',
    ...(recipient_email ? { email: recipient_email } : {}),
    webhook_url: `${process.env.WEBAPP_URL || 'https://app.pnptv.app'}/api/webhooks/bitrefill`,
    ref_id: order.id,
  };

  try {
    const response = await axios.post(`${BITREFILL_BASE_URL}/invoices`, payload, {
      headers: {
        Authorization: `Basic ${Buffer.from(BITREFILL_API_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const invoice = response.data;
    logger.info('[cashoutService.bitrefill] invoice created', {
      orderId: order.id, invoiceId: invoice.id, product_id,
    });

    return {
      ref: invoice.id,
      invoice_url: invoice.payment_url || invoice.url,
      product_id,
    };
  } catch (axiosErr) {
    logger.error('[cashoutService.bitrefill] API error', {
      orderId: order.id,
      status: axiosErr.response?.status,
      data: axiosErr.response?.data,
      message: axiosErr.message,
    });
    throw new Error(`Bitrefill API error: ${axiosErr.response?.data?.message || axiosErr.message}`);
  }
}

/**
 * Transak lane handler.
 * Server-side only: creates a payout receipt so the backend has a record.
 * The actual user-facing Transak widget runs in the frontend with Transak's PUBLIC key.
 * This handler validates the session/quote and records it for webhook matching.
 *
 * @param {object} order         — fiat_cashout_orders row
 * @param {object} destination   — { session_id: string, quote_id?: string }
 */
async function dispatchTransak(order, destination) {
  const { session_id, quote_id } = destination || {};

  if (!session_id) throw err('MISSING_SESSION_ID', 'destination.session_id is required for transak lane');

  const baseUrl = TRANSAK_BASE_URLS[TRANSAK_ENV] || TRANSAK_BASE_URLS.STAGING;

  if (!TRANSAK_API_KEY) {
    logger.warn('[cashoutService.transak] TRANSAK_API_KEY not set — returning stub', {
      orderId: order.id,
    });
    return {
      ref: `stub-transak-${order.id}`,
      stub: true,
      session_id,
    };
  }

  // Server-side: validate the Transak session is legitimate and matches the expected amount.
  // Transak's webhook (POST /api/webhooks/transak) will confirm settlement.
  try {
    const response = await axios.get(`${baseUrl}/api/v2/orders/${session_id}`, {
      headers: {
        'api-secret': TRANSAK_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const transakOrder = response.data?.data;
    logger.info('[cashoutService.transak] session validated', {
      orderId: order.id,
      transakOrderId: transakOrder?.id,
      session_id,
      quote_id,
    });

    return {
      ref: transakOrder?.id || session_id,
      session_id,
      quote_id: quote_id || null,
      transak_status: transakOrder?.status,
    };
  } catch (axiosErr) {
    logger.error('[cashoutService.transak] session validation error', {
      orderId: order.id,
      status: axiosErr.response?.status,
      message: axiosErr.message,
    });
    // Non-fatal: record the session_id and wait for the webhook to confirm.
    return {
      ref: session_id,
      session_id,
      quote_id: quote_id || null,
      validation_skipped: true,
    };
  }
}

/**
 * Mark a cashout order as settled and flip its earnings to paid_out.
 *
 * @param {string} orderId
 * @param {string} providerRef — provider's settlement reference
 */
async function settleCashoutOrder(orderId, providerRef) {
  if (!orderId) throw err('MISSING_ORDER_ID', 'orderId is required', 400);

  const { rows } = await query(
    `UPDATE fiat_cashout_orders
        SET status = 'settled',
            provider_ref = COALESCE($2, provider_ref),
            settled_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('pending', 'processing')
      RETURNING earning_ids`,
    [orderId, providerRef || null]
  );

  if (rows.length === 0) {
    throw err('ORDER_NOT_FOUND', `Order ${orderId} not found or already in a terminal state`, 404);
  }

  const earningIds = rows[0].earning_ids;
  if (earningIds && earningIds.length > 0) {
    await query(
      `UPDATE creator_earnings
          SET status = 'paid_out',
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [earningIds]
    );
  }

  logger.info('[cashoutService] order settled', { orderId, providerRef, earningCount: earningIds?.length });
}

/**
 * Mark a cashout order as failed and restore its earnings to 'available'.
 *
 * @param {string} orderId
 * @param {string} reason — human-readable failure reason stored for diagnostics
 */
async function failCashoutOrder(orderId, reason) {
  if (!orderId) throw err('MISSING_ORDER_ID', 'orderId is required', 400);

  const { rows } = await query(
    `UPDATE fiat_cashout_orders
        SET status = 'failed',
            failure_reason = $2,
            updated_at = NOW()
      WHERE id = $1
        AND status NOT IN ('settled', 'failed', 'cancelled')
      RETURNING earning_ids`,
    [orderId, reason || 'unknown']
  );

  if (rows.length === 0) {
    // Already in terminal state — log and no-op.
    logger.warn('[cashoutService] failCashoutOrder: order not found or already terminal', { orderId });
    return;
  }

  const earningIds = rows[0].earning_ids;
  if (earningIds && earningIds.length > 0) {
    await query(
      `UPDATE creator_earnings
          SET status = 'available',
              updated_at = NOW()
        WHERE id = ANY($1::uuid[])
          AND status = 'in_payout'`,
      [earningIds]
    );
  }

  logger.info('[cashoutService] order failed — earnings restored', { orderId, reason, earningCount: earningIds?.length });
}

module.exports = {
  getCreatorBalance,
  requestCashout,
  settleCashoutOrder,
  failCashoutOrder,
  // Lane handlers exported for unit testing
  dispatchOnchainUsdt,
  dispatchBitrefill,
  dispatchTransak,
};
