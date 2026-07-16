'use strict';

const axios = require('axios');
const { query, getClient } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

const NP_BASE = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';
const NP_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';
const NP_EMAIL   = process.env.NOWPAYMENTS_EMAIL || '';
const NP_PASS    = process.env.NOWPAYMENTS_PASSWORD || '';
const JWT_CACHE_KEY = 'nowpayments:payout_jwt';
const JWT_TTL_SEC   = 270;
const MIN_PAYOUT_USD = parseFloat(process.env.NOWPAYMENTS_PAYOUT_MIN_USD || '5');

async function getNowPaymentsJWT(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await cache.get(JWT_CACHE_KEY);
    if (cached) return cached;
  }

  const resp = await axios.post(
    `${NP_BASE}/auth`,
    { email: NP_EMAIL, password: NP_PASS },
    { headers: { 'x-api-key': NP_API_KEY }, timeout: 15000 }
  );

  const token = resp.data && resp.data.token;
  if (!token) throw new Error('NowPayments auth returned no token');

  await cache.set(JWT_CACHE_KEY, token, JWT_TTL_SEC);
  return token;
}

async function getCreatorPayoutBalance(userId) {
  const res = await query(
    `SELECT
      COALESCE(SUM(CASE WHEN status='available' AND (available_at IS NULL OR available_at <= NOW()) THEN amount_creator ELSE 0 END), 0) AS available_usd,
      COALESCE(SUM(CASE WHEN status='holding' OR (status='available' AND available_at > NOW()) THEN amount_creator ELSE 0 END), 0) AS holding_usd,
      COALESCE(SUM(CASE WHEN status='in_payout' THEN amount_creator ELSE 0 END), 0) AS in_payout_usd,
      COALESCE(SUM(CASE WHEN status='paid_out' THEN amount_creator ELSE 0 END), 0) AS paid_out_usd,
      COALESCE(SUM(amount_creator), 0) AS lifetime_usd,
      MIN(CASE WHEN status='holding' THEN available_at ELSE NULL END) AS earliest_available_at,
      COUNT(CASE WHEN status='holding' THEN 1 ELSE NULL END)::int AS holding_count
    FROM creator_earnings
    WHERE creator_id = $1`,
    [userId]
  );

  const row = res.rows[0];
  return {
    available_usd: parseFloat(row.available_usd),
    holding_usd: parseFloat(row.holding_usd),
    in_payout_usd: parseFloat(row.in_payout_usd),
    paid_out_usd: parseFloat(row.paid_out_usd),
    lifetime_usd: parseFloat(row.lifetime_usd),
    earliest_available_at: row.earliest_available_at || null,
    holding_count: parseInt(row.holding_count, 10),
  };
}

async function requestPayout({ userId, address, method }) {
  // FIX 3: Email payouts are unsupported — only crypto wallet addresses accepted
  if (method === 'email') {
    throw Object.assign(
      new Error('Email payouts are not supported. Please provide a crypto wallet address.'),
      { code: 'INVALID_PAYOUT_METHOD' }
    );
  }

  if (!address || !address.trim()) throw new Error('Address is required');
  const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  if (!TRC20_RE.test(address.trim())) {
    throw Object.assign(
      new Error('Invalid USDT TRC-20 address — must start with T and be exactly 34 characters (base58).'),
      { code: 'INVALID_ADDRESS' }
    );
  }

  // FIX 2: Fail-closed on Redis lock acquisition
  let lockAcquired;
  try {
    lockAcquired = await cache.acquireLock(`np_payout_lock:${userId}`, 120);
    if (!lockAcquired) {
      throw Object.assign(
        new Error('A payout is already in progress for your account.'),
        { code: 'PAYOUT_IN_PROGRESS' }
      );
    }
  } catch (lockErr) {
    if (lockErr.code === 'PAYOUT_IN_PROGRESS') throw lockErr;
    logger.error('[requestPayout] Redis lock error', { userId, error: lockErr.message });
    throw Object.assign(
      new Error('Service temporarily unavailable. Please try again.'),
      { code: 'SERVICE_UNAVAILABLE' }
    );
  }

  const client = await getClient();
  let committed = false;
  try {
    await client.query('BEGIN');

    const earningsRes = await client.query(
      `UPDATE creator_earnings
       SET status = 'in_payout'
       WHERE creator_id = $1
         AND status = 'available'
         AND (available_at IS NULL OR available_at <= NOW())
         AND paid_at IS NULL
       RETURNING id, amount_creator`,
      [userId]
    );

    const rows = earningsRes.rows;
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});
      throw Object.assign(new Error('No available earnings to pay out.'), { code: 'INSUFFICIENT_BALANCE' });
    }

    const totalUsd = rows.reduce((sum, r) => sum + parseFloat(r.amount_creator), 0);
    if (totalUsd < MIN_PAYOUT_USD) {
      await client.query('ROLLBACK');
      await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});
      throw Object.assign(
        new Error(`Minimum payout is $${MIN_PAYOUT_USD.toFixed(2)}. Your available balance is $${totalUsd.toFixed(2)}.`),
        { code: 'BELOW_MINIMUM' }
      );
    }

    const earningIds = rows.map(r => r.id);
    const webAppUrl = process.env.WEB_APP_URL || process.env.APP_PUBLIC_URL || 'https://pnptv.app';
    const ipnCallbackUrl = `${webAppUrl}/api/webhooks/nowpayments/payout`;

    const jwt = await getNowPaymentsJWT();

    const _callNpPayoutApi = async (jwtToken) => axios.post(
      `${NP_BASE}/payout`,
      {
        withdrawals: [{
          address: address.trim(),
          currency: 'usdttrc20',
          amount: parseFloat(totalUsd.toFixed(2)),
          ipn_callback_url: ipnCallbackUrl,
        }],
      },
      {
        headers: {
          'x-api-key': NP_API_KEY,
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    let npResp;
    try {
      npResp = await _callNpPayoutApi(jwt);
    } catch (npErr) {
      // FIX 13: On 401, clear stale JWT cache and retry once with a fresh token
      if (npErr.response?.status === 401) {
        logger.warn('[NowPayments Payout] 401 on payout API — clearing cached JWT and retrying', { userId });
        await cache.del(JWT_CACHE_KEY).catch(() => {});
        try {
          const freshJwt = await getNowPaymentsJWT(true);
          npResp = await _callNpPayoutApi(freshJwt);
        } catch (retryErr) {
          await client.query('ROLLBACK');
          await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});
          logger.error('[NowPayments Payout] API call failed after JWT refresh', { userId, error: retryErr.message, data: retryErr.response?.data });
          throw Object.assign(
            new Error('NowPayments authentication failed. Please try again later.'),
            { code: 'SERVICE_UNAVAILABLE', _payoutApiCalled: true }
          );
        }
      } else {
        await client.query('ROLLBACK');
        await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});
        logger.error('[NowPayments Payout] API call failed', { userId, error: npErr.message, data: npErr.response?.data });
        throw Object.assign(
          new Error('NowPayments payout API error. Please try again later.'),
          { code: 'SERVICE_UNAVAILABLE', _payoutApiCalled: true }
        );
      }
    }

    const npData = npResp.data;
    const batchId = npData.id || npData.batch_withdrawal_id || null;
    const payoutId = (npData.withdrawals && npData.withdrawals[0] && npData.withdrawals[0].id)
      ? String(npData.withdrawals[0].id)
      : null;

    const insertRes = await client.query(
      `INSERT INTO creator_payouts
         (creator_id, amount_usd, currency, method, address, nowpayments_batch_id, nowpayments_payout_id, status, earning_ids, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8::uuid[], NOW())
       RETURNING *`,
      [
        userId,
        parseFloat(totalUsd.toFixed(2)),
        'usdttrc20',
        'crypto',
        address.trim(),
        batchId ? String(batchId) : null,
        payoutId,
        earningIds,
      ]
    );

    await client.query('COMMIT');
    committed = true;
    await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});

    logger.info('[NowPayments Payout] Payout created', { userId, totalUsd, batchId, payoutId });
    return insertRes.rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    await cache.releaseLock(`np_payout_lock:${userId}`).catch(() => {});

    if (!err._payoutApiCalled && !committed) {
      await query(
        `UPDATE creator_earnings SET status = 'available' WHERE creator_id = $1 AND status = 'in_payout' AND paid_at IS NULL`,
        [userId]
      ).catch(rollbackErr => logger.error('[NowPayments Payout] Failed to roll back earnings status', { userId, error: rollbackErr.message }));
    }

    throw err;
  } finally {
    client.release();
  }
}

async function getPayoutHistory(userId, limit = 20, offset = 0) {
  const res = await query(
    `SELECT id, amount_usd, currency, method, status,
            requested_at, created_at, completed_at, processed_at,
            outcome_amount, outcome_currency, notes
     FROM creator_payouts WHERE creator_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return res.rows;
}

async function handlePayoutWebhook(npPayoutId, npStatus, body) {
  if (!npPayoutId) {
    logger.warn('[NowPayments Payout Webhook] Missing payout ID');
    return;
  }

  const payoutRes = await query(
    `SELECT id, creator_id, amount_usd, currency, status, earning_ids, processed_at
     FROM creator_payouts WHERE nowpayments_payout_id = $1 OR nowpayments_batch_id = $1 LIMIT 1`,
    [String(npPayoutId)]
  );

  const payout = payoutRes.rows[0];
  if (!payout) {
    logger.warn('[NowPayments Payout Webhook] No matching payout record', { npPayoutId, npStatus });
    return;
  }

  const outcomeCurrency = body.outcome_currency ? String(body.outcome_currency).toLowerCase() : null;
  const outcomeAmount = body.outcome_amount != null ? parseFloat(body.outcome_amount) : null;

  let mappedStatus;
  if (npStatus === 'FINISHED' || npStatus === 'finished') {
    // Hard-fail if outcome currency doesn't match — wrong asset sent
    if (outcomeCurrency && payout.currency && outcomeCurrency !== payout.currency.toLowerCase()) {
      logger.error('[NowPayments Payout Webhook] CRITICAL: outcome_currency mismatch — rolling back', {
        payoutId: payout.id, expected: payout.currency, got: outcomeCurrency,
      });
      mappedStatus = 'failed';
    } else {
      mappedStatus = 'sent';
      // Warn if outcome_amount is more than 5% below requested (unexpected fee deduction)
      if (outcomeAmount != null && payout.amount_usd != null) {
        const requested = parseFloat(payout.amount_usd);
        if (requested <= 0) return;
        const shortfall = (requested - outcomeAmount) / requested;
        if (shortfall > 0.05) {
          logger.warn('[NowPayments Payout Webhook] outcome_amount more than 5% below requested', {
            payoutId: payout.id, requested, outcomeAmount, shortfallPct: (shortfall * 100).toFixed(1),
          });
        }
      }
    }
  } else if (['FAILED', 'EXPIRED', 'failed', 'expired'].includes(npStatus)) {
    mappedStatus = 'failed';
  } else {
    mappedStatus = 'processing';
  }

  // FIX 1: Idempotency guard — skip if already settled (sent or failed)
  const { rowCount } = await query(
    `UPDATE creator_payouts
       SET status=$1, processed_at=$2, outcome_amount=$3, outcome_currency=$4
     WHERE id=$5 AND status NOT IN ('sent','failed')`,
    [mappedStatus, mappedStatus !== 'processing' ? new Date() : payout.processed_at,
     outcomeAmount, outcomeCurrency, payout.id]
  );
  if (rowCount === 0) {
    logger.info('[NP Payout Webhook] already settled — idempotent skip', { payoutId: payout.id, npStatus });
    return { alreadyProcessed: true };
  }

  if (mappedStatus === 'sent' && payout.earning_ids && payout.earning_ids.length > 0) {
    await query(
      `UPDATE creator_earnings SET status = 'paid_out', paid_at = NOW() WHERE id = ANY($1::uuid[])`,
      [payout.earning_ids]
    );
    logger.info('[NowPayments Payout Webhook] Earnings marked paid_out', { payoutId: payout.id, count: payout.earning_ids.length });
  }

  if (mappedStatus === 'failed' && payout.earning_ids && payout.earning_ids.length > 0) {
    await query(
      `UPDATE creator_earnings SET status = 'available' WHERE id = ANY($1::uuid[]) AND status = 'in_payout'`,
      [payout.earning_ids]
    );
    logger.info('[NowPayments Payout Webhook] Earnings rolled back to available after failed payout', { payoutId: payout.id });
  }

  logger.info('[NowPayments Payout Webhook] Processed', { payoutId: payout.id, npPayoutId, mappedStatus, outcomeAmount, outcomeCurrency });
}

// FIX 9: Reconcile creator_earnings rows stuck in 'in_payout' with no active payout record
async function reconcileStuckPayouts() {
  const { rows } = await query(`
    SELECT DISTINCT e.creator_id
    FROM creator_earnings e
    WHERE e.status = 'in_payout'
      AND e.created_at < NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM creator_payouts p
        WHERE p.creator_id = e.creator_id
          AND p.status IN ('processing', 'sent')
          AND p.created_at > NOW() - INTERVAL '48 hours'
      )
  `);
  for (const row of rows) {
    logger.warn('[reconcileStuckPayouts] Rolling back stuck in_payout earnings', { creatorId: row.creator_id });
    await query(
      `UPDATE creator_earnings SET status='available'
       WHERE creator_id=$1 AND status='in_payout' AND created_at < NOW() - INTERVAL '48 hours'`,
      [row.creator_id]
    );
  }
  return rows.length;
}

module.exports = { getNowPaymentsJWT, getCreatorPayoutBalance, requestPayout, getPayoutHistory, handlePayoutWebhook, reconcileStuckPayouts };
