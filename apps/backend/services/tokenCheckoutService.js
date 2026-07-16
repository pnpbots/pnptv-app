/**
 * TokenCheckoutService
 * Single source of truth for all token purchase checkout flows.
 * Handles Dash/BTCPay checkout creation, plus unified idempotent
 * crediting used by webhook handlers.
 *
 * Design decisions:
 *  - token_purchases is the authoritative record; no payments table entry is created.
 *  - The existing integer PK (`id`) is preserved; a new `purchase_uuid` UUID column
 *    (migration 120) is added as the external, URL-safe identifier.
 *  - btcpay_invoice_id doubles as a namespaced idempotency key for all providers:
 *      dash   → actual BTCPay invoice ID
 *      dash   → actual BTCPay invoice ID
 *
 * Required migration (apps/backend/migrations/120_token_purchase_uuid.sql):
 *   ALTER TABLE token_purchases
 *     ADD COLUMN IF NOT EXISTS purchase_uuid UUID UNIQUE DEFAULT gen_random_uuid(),
 *     ADD COLUMN IF NOT EXISTS checkout_data JSONB;
 *   CREATE UNIQUE INDEX IF NOT EXISTS idx_token_purchases_purchase_uuid
 *     ON token_purchases(purchase_uuid);
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { query, getClient } = require('../config/postgres');
const { createDashInvoice, createInvoice: createBtcInvoice } = require('../config/btcpay');
const DashTokenService = require('./dashTokenService');
const logger = require('../utils/logger');
const { cache } = require('../config/redis');

// ─── Constants ───────────────────────────────────────────────────────────────

const WEB_APP_URL = process.env.WEB_APP_URL || 'https://pnptv.app';

const NOWPAYMENTS_URL = process.env.NOWPAYMENTS_ENVIRONMENT === 'sandbox'
  ? 'https://api-sandbox.nowpayments.io/v1'
  : 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a validated token package from the shared catalogue.
 * @param {string} packageId
 * @returns {{ id: string, tokens: number, usd: number, label: string }|null}
 */
function resolvePackage(packageId) {
  return DashTokenService.TOKEN_PACKAGES.find((p) => p.id === packageId) || null;
}

/**
 * Build a namespaced idempotency key for non-BTCPay providers.
 * @param {string} provider
 * @param {string} purchaseUuid
 * @returns {string}
 */
function idempotencyKey(provider, purchaseUuid) {
  return `${provider}:${purchaseUuid}`;
}

/**
 * Insert a new pending purchase record.
 * Stores the externally-visible purchaseUuid in the `purchase_uuid` column and
 * the idempotency key in `btcpay_invoice_id`.
 *
 * Falls back gracefully if `purchase_uuid` or `checkout_data` columns are absent
 * (pre-migration state) so the service degrades rather than hard-fails.
 */
async function insertPendingPurchase(client, {
  purchaseUuid,
  userId,
  tokens,
  usd,
  invoiceKey,
  paymentMethod,
  checkoutData = null,
}) {
  // Attempt full insert with new columns first
  try {
    if (checkoutData !== null) {
      await client.query(
        `INSERT INTO token_purchases
           (purchase_uuid, user_id, tokens_credited, usd_amount, btcpay_invoice_id,
            status, payment_method, checkout_data)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
        [purchaseUuid, userId, tokens, usd, invoiceKey, paymentMethod, JSON.stringify(checkoutData)]
      );
    } else {
      await client.query(
        `INSERT INTO token_purchases
           (purchase_uuid, user_id, tokens_credited, usd_amount, btcpay_invoice_id,
            status, payment_method)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)
         ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
        [purchaseUuid, userId, tokens, usd, invoiceKey, paymentMethod]
      );
    }
  } catch (colErr) {
    // Migration 120 not yet applied — fall back to legacy columns only
    if (
      colErr.message &&
      (colErr.message.includes('purchase_uuid') || colErr.message.includes('checkout_data'))
    ) {
      logger.warn('TokenCheckoutService: migration 120 not applied, using legacy insert', { purchaseUuid });
      await client.query(
        `INSERT INTO token_purchases
           (user_id, tokens_credited, usd_amount, btcpay_invoice_id, status, payment_method)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
        [userId, tokens, usd, invoiceKey, paymentMethod]
      );
    } else {
      throw colErr;
    }
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class TokenCheckoutService {
  /** The canonical Fichas packages (100 Fichas = $1 USD). Defined in DashTokenService.TOKEN_PACKAGES. */
  static PACKAGES = DashTokenService.TOKEN_PACKAGES;

  // ── Dash / BTCPay checkout ────────────────────────────────────────────────

  /**
   * Create a BTCPay/Dash invoice for a token package.
   * BTCPay has its own hosted checkout page so no internal checkout page is needed.
   *
   * @param {string} userId
   * @param {string} packageId
   * @returns {Promise<{
   *   success: boolean,
   *   purchaseId: string,
   *   invoiceId: string,
   *   checkoutUrl: string,
   *   tokens: number,
   *   usd: number,
   * }>}
   */
  static async createDashCheckout(userId, packageId) {
    const pkg = resolvePackage(packageId);
    if (!pkg) {
      throw Object.assign(new Error('Invalid package ID'), { code: 'INVALID_PACKAGE', status: 400 });
    }

    const purchaseUuid = uuidv4();
    // Use the UUID as a placeholder invoice key so the row exists before we call BTCPay.
    // The real BTCPay invoice ID will overwrite this once the invoice is created.
    const placeholderKey = idempotencyKey('dash-pending', purchaseUuid);

    const amountUsd = pkg.usd;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await insertPendingPurchase(client, {
        purchaseUuid,
        userId,
        tokens: pkg.tokens,
        usd: amountUsd,
        invoiceKey: placeholderKey,
        paymentMethod: 'dash',
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('TokenCheckoutService.createDashCheckout DB error', {
        userId, packageId, error: err.message,
      });
      throw err;
    } finally {
      client.release();
    }

    // Row committed — now create the BTCPay invoice. If this fails we mark the row failed.
    let invoice;
    try {
      invoice = await createDashInvoice({
        usdAmount: amountUsd,
        userId,
        orderId: `pnptv-tokens-${userId}-${Date.now()}`,
        description: `${pkg.tokens} Digital Credits`,
        redirectUrl: `${WEB_APP_URL}/wallet`,
      });
    } catch (btcpayErr) {
      await query(
        `UPDATE token_purchases SET status = 'failed' WHERE purchase_uuid = $1`,
        [purchaseUuid]
      ).catch(() => {});
      logger.error('TokenCheckoutService.createDashCheckout BTCPay error', {
        userId, packageId, purchaseUuid, error: btcpayErr.message,
      });
      throw btcpayErr;
    }

    // Overwrite the placeholder key with the real BTCPay invoice ID.
    // The webhook uses btcpay_invoice_id for lookup — if this fails, the webhook
    // can never route the payment, so we must throw so the caller returns 500.
    await query(
      `UPDATE token_purchases SET btcpay_invoice_id = $1 WHERE purchase_uuid = $2`,
      [invoice.invoiceId, purchaseUuid]
    ).catch((updateErr) => {
      logger.error('TokenCheckoutService.createDashCheckout: failed to write real invoiceId', {
        purchaseUuid, invoiceId: invoice.invoiceId, error: updateErr.message,
      });
      throw updateErr;
    });

    logger.info('Token Dash checkout created', {
      userId, packageId, purchaseUuid, invoiceId: invoice.invoiceId, tokens: pkg.tokens,
    });

    return {
      success: true,
      purchaseId: purchaseUuid,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      tokens: pkg.tokens,
      usd: amountUsd,
    };
  }

  // ── BTC / Lightning checkout ──────────────────────────────────────────────

  /**
   * Create a BTCPay BTC+Lightning invoice for a token package.
   * Identical flow to createDashCheckout but uses paymentMethods=['BTC-LightningNetwork','BTC'].
   *
   * @param {string} userId
   * @param {string} packageId
   * @returns {Promise<{
   *   success: boolean,
   *   purchaseId: string,
   *   invoiceId: string,
   *   checkoutUrl: string,
   *   tokens: number,
   *   usd: number,
   * }>}
   */
  static async createBtcCheckout(userId, packageId) {
    const pkg = resolvePackage(packageId);
    if (!pkg) {
      throw Object.assign(new Error('Invalid package ID'), { code: 'INVALID_PACKAGE', status: 400 });
    }

    const purchaseUuid = uuidv4();
    const placeholderKey = idempotencyKey('btc-pending', purchaseUuid);

    const amountUsd = pkg.usd;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await insertPendingPurchase(client, {
        purchaseUuid,
        userId,
        tokens: pkg.tokens,
        usd: amountUsd,
        invoiceKey: placeholderKey,
        paymentMethod: 'btc',
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('TokenCheckoutService.createBtcCheckout DB error', {
        userId, packageId, error: err.message,
      });
      throw err;
    } finally {
      client.release();
    }

    let invoice;
    try {
      invoice = await createBtcInvoice({
        amount: amountUsd,
        currency: 'USD',
        userId,
        orderId: `pnptv-tokens-btc-${userId}-${Date.now()}`,
        planId: 'token_purchase',
        redirectUrl: `${WEB_APP_URL}/wallet`,
        paymentMethods: ['BTC-LightningNetwork', 'BTC'],
      });
    } catch (btcpayErr) {
      await query(
        `UPDATE token_purchases SET status = 'failed' WHERE purchase_uuid = $1`,
        [purchaseUuid]
      ).catch(() => {});
      logger.error('TokenCheckoutService.createBtcCheckout BTCPay error', {
        userId, packageId, purchaseUuid, error: btcpayErr.message,
      });
      throw btcpayErr;
    }

    await query(
      `UPDATE token_purchases SET btcpay_invoice_id = $1 WHERE purchase_uuid = $2`,
      [invoice.invoiceId, purchaseUuid]
    ).catch((updateErr) => {
      logger.error('TokenCheckoutService.createBtcCheckout: failed to write real invoiceId', {
        purchaseUuid, invoiceId: invoice.invoiceId, error: updateErr.message,
      });
      throw updateErr;
    });

    logger.info('Token BTC checkout created', {
      userId, packageId, purchaseUuid, invoiceId: invoice.invoiceId, tokens: pkg.tokens,
    });

    return {
      success: true,
      purchaseId: purchaseUuid,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutLink,
      tokens: pkg.tokens,
      usd: amountUsd,
    };
  }

  // ── Checkout page data ────────────────────────────────────────────────────

  /**
   * Return all data needed to render the /token-checkout/:purchaseId page.
   * For Dash: returns null (BTCPay has its own hosted page).
   *
   * @param {string} purchaseUuid  UUID stored in purchase_uuid column
   * @returns {Promise<object|null>}  null if not found or Dash purchase
   */
  static async getCheckoutData(purchaseUuid) {
    let purchase;
    try {
      const result = await query(
        `SELECT id, purchase_uuid, user_id, tokens_credited, usd_amount,
                payment_method, status, btcpay_invoice_id, checkout_data
         FROM token_purchases
         WHERE purchase_uuid = $1`,
        [purchaseUuid]
      );
      purchase = result.rows[0] || null;
    } catch (colErr) {
      if (
        colErr.message &&
        (colErr.message.includes('purchase_uuid') || colErr.message.includes('checkout_data'))
      ) {
        // Migration 120 not applied — fall back: look up by idempotency key pattern (best-effort)
        logger.warn('getCheckoutData: migration 120 not applied, cannot look up by UUID', { purchaseUuid });
        return null;
      }
      throw colErr;
    }

    if (!purchase) {
      return null;
    }

    const {
      payment_method: provider,
      tokens_credited: tokens,
      usd_amount: usd,
      user_id: userId,
    } = purchase;
    const usdAmount = parseFloat(usd);

    const base = {
      purchaseId: purchase.purchase_uuid || String(purchase.id),
      userId,
      provider,
      status: purchase.status,
      tokens,
      usd: usdAmount,
    };

    // Dash (BTCPay) — BTCPay has its own checkout page; no internal page needed
    // Legacy purchases (epayco/daimo) return null so callers surface an error.
    return null;
  }

  // ── Credit tokens from payment ────────────────────────────────────────────

  /**
   * Unified, idempotent token crediting used by webhook handlers.
   * Looks up the purchase by its btcpay_invoice_id idempotency key, credits the
   * wallet, and marks the purchase as paid — all in a single transaction.
   *
   * Callers:
   *   BTCPay webhook: provider='dash',   referenceId=btcpayInvoiceId (raw BTCPay ID)
   *
   * @param {string} referenceId
   *   For dash: the raw BTCPay invoice ID string.
   * @param {'dash'} provider
   * @param {object} [txData]  optional extra data to log (txHash, amount, etc.)
   * @returns {Promise<{
   *   success: boolean,
   *   alreadyProcessed: boolean,
   *   notFound?: boolean,
   *   userId?: string,
   *   tokens?: number,
   *   newBalance?: number,
   * }>}
   */
  static async creditTokensFromPayment(referenceId, provider, txData = {}) {
    const lookupKey = provider === 'dash'
      ? referenceId
      : idempotencyKey(provider, referenceId);

    const lockKey = `token:credit:${lookupKey}`;
    let acquired;
    try {
      acquired = await cache.acquireLock(lockKey, 120);
    } catch (lockErr) {
      // Redis is unavailable — log and continue without the lock.
      // The DB `WHERE status = 'pending' RETURNING id` guard provides real idempotency.
      logger.warn('creditTokensFromPayment: Redis lock unavailable, proceeding without lock', {
        lockKey, provider, error: lockErr.message,
      });
      acquired = true; // treat as acquired so we do not false-positive on alreadyProcessed
    }
    if (!acquired) {
      // acquireLock resolved to false — genuine duplicate in flight
      logger.warn('creditTokensFromPayment duplicate blocked by Redis lock', { lookupKey, provider });
      return { success: false, alreadyProcessed: true };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const purchaseResult = await client.query(
        `SELECT id, user_id, tokens_credited, usd_amount, status
         FROM token_purchases
         WHERE btcpay_invoice_id = $1`,
        [lookupKey]
      );

      if (purchaseResult.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.warn('creditTokensFromPayment: purchase not found', { lookupKey, provider });
        return { success: false, alreadyProcessed: false, notFound: true };
      }

      const purchase = purchaseResult.rows[0];

      if (purchase.status === 'paid') {
        await client.query('ROLLBACK');
        logger.info('creditTokensFromPayment: already paid (idempotent skip)', { lookupKey });
        return {
          success: true,
          alreadyProcessed: true,
          userId: purchase.user_id,
          tokens: purchase.tokens_credited,
        };
      }

      // Mark purchase as paid — RETURNING guards against concurrent webhook double-credit
      const updateResult = await client.query(
        `UPDATE token_purchases
         SET status = 'paid', settled_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [purchase.id]
      );

      if (updateResult.rowCount === 0) {
        // Another concurrent transaction already processed this purchase
        await client.query('ROLLBACK');
        logger.info('creditTokensFromPayment: concurrent update guard triggered (idempotent skip)', { lookupKey });
        return { success: true, alreadyProcessed: true };
      }

      // Credit wallet atomically
      const walletResult = await client.query(
        `INSERT INTO user_token_wallets (user_id, balance_tokens)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET balance_tokens = user_token_wallets.balance_tokens + EXCLUDED.balance_tokens,
               updated_at = NOW()
         RETURNING balance_tokens`,
        [purchase.user_id, purchase.tokens_credited]
      );

      await client.query('COMMIT');

      const newBalance = walletResult.rows[0]?.balance_tokens ?? purchase.tokens_credited;

      await cache.del(`wallet:${purchase.user_id}`).catch(() => {});

      logger.info('Tokens credited via TokenCheckoutService', {
        userId: purchase.user_id,
        tokens: purchase.tokens_credited,
        lookupKey,
        provider,
        newBalance,
        ...txData,
      });

      return {
        success: true,
        alreadyProcessed: false,
        userId: purchase.user_id,
        tokens: purchase.tokens_credited,
        newBalance,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('creditTokensFromPayment error', { lookupKey, provider, error: err.message });
      throw err;
    } finally {
      client.release();
      await cache.releaseLock(lockKey).catch(() => {});
    }
  }

  // ── NowPayments checkout ─────────────────────────────────────────────────

  /**
   * Create a NowPayments hosted invoice for a token package purchase (20% crypto discount).
   * Uses the same dash_subscription_orders table as other NowPayments flows so the
   * existing webhook handler routes payment confirmation automatically.
   *
   * @param {string} userId
   * @param {string} packageId
   * @param {string|null} [payCurrency]  Optional NowPayments pay_currency (e.g. 'btc', 'btcln')
   * @returns {Promise<{ invoiceId: string, checkoutUrl: string, tokens: number, usdAmount: number }>}
   */
  static async createNowPaymentsCheckout(userId, packageId, payCurrency = null) {
    const pkg = resolvePackage(packageId);
    if (!pkg) {
      throw Object.assign(new Error(`Token package '${packageId}' not found`), { code: 'PACKAGE_NOT_FOUND', status: 404 });
    }

    if (!NOWPAYMENTS_API_KEY) {
      throw Object.assign(new Error('Crypto payments are not configured'), { code: 'NOWPAYMENTS_NOT_CONFIGURED', status: 503 });
    }

    const usdAmount = pkg.usd;
    const orderId = `pnptv-tokens-nowp-${userId}-${Date.now()}`;
    const successUrl = `${WEB_APP_URL}/wallet?nowpayments=success&order=${encodeURIComponent(orderId)}`;
    const cancelUrl = `${WEB_APP_URL}/wallet`;

    let invoiceUrl;
    let npPayInfo = {};
    try {
      const paymentResp = await axios.post(
        `${NOWPAYMENTS_URL}/invoice`,
        {
          price_amount: usdAmount,
          price_currency: 'usd',
          pay_currency: payCurrency || 'usdcsol',
          order_id: orderId,
          order_description: `${pkg.tokens} PNP Tokens`,
          ipn_callback_url: `${WEB_APP_URL}/api/webhooks/nowpayments`,
        },
        { headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      const { id: nowpaymentsInvoiceId } = paymentResp.data;
      if (!nowpaymentsInvoiceId) throw new Error('No invoice id in response');
      invoiceUrl = `https://nowpayments.io/payment?iid=${nowpaymentsInvoiceId}`;
      npPayInfo = { nowpaymentsInvoiceId: String(nowpaymentsInvoiceId), payCurrency: payCurrency || 'usdcsol' };
    } catch (invoiceErr) {
      logger.error('TokenCheckoutService.createNowPaymentsCheckout: NowPayments error', {
        userId, packageId, payCurrency, error: invoiceErr.response?.data || invoiceErr.message,
      });
      const err = Object.assign(new Error('Could not reach NowPayments. Please try again.'), { code: 'NOWPAYMENTS_ERROR', status: 502 });
      throw err;
    }

    // Store in dash_subscription_orders so the NowPayments IPN webhook can
    // find and fulfill this order (same path as subscription/plan payments).
    const { query: pgQuery } = require('../config/postgres');
    await pgQuery(
      `INSERT INTO dash_subscription_orders
         (user_id, plan_id, email, usd_amount, btcpay_invoice_id, status, metadata)
       VALUES ($1, 'token_purchase', NULL, $2, $3, 'pending', $4)
       ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
      [
        userId,
        usdAmount,
        orderId,
        JSON.stringify({
          provider: 'nowpayments',
          flow: 'token_purchase',
          packageId: pkg.id,
          tokens: pkg.tokens,
          invoiceUrl,
          ...(payCurrency ? { payCurrency } : {}),
        }),
      ]
    );

    logger.info('TokenCheckoutService.createNowPaymentsCheckout: invoice created', {
      userId, packageId, orderId, usdAmount, payCurrency, tokens: pkg.tokens,
    });

    return {
      invoiceId: orderId,
      checkoutUrl: invoiceUrl,
      tokens: pkg.tokens,
      usdAmount,
      ...npPayInfo,
    };
  }

  /**
   * Mark a pending token purchase terminal without crediting tokens.
   * Used for non-success webhook outcomes in non-BTCPay providers.
   *
   * @param {string} referenceId
   * @param {'dash'} provider
   * @param {'expired'|'invalid'} status
   * @param {object} [txData]
   * @returns {Promise<{success: boolean, updated: boolean}>}
   */
  static async markPurchaseTerminalStatus(referenceId, provider, status, txData = {}) {
    if (!referenceId || !provider) {
      return { success: false, updated: false };
    }
    if (!['expired', 'invalid'].includes(status)) {
      throw new Error(`Unsupported token purchase status: ${status}`);
    }

    const lookupKey = provider === 'dash'
      ? referenceId
      : idempotencyKey(provider, referenceId);

    const result = await query(
      `UPDATE token_purchases
       SET status = $2
       WHERE btcpay_invoice_id = $1
         AND status = 'pending'`,
      [lookupKey, status]
    );

    logger.info('Token purchase terminal status updated', {
      lookupKey,
      provider,
      status,
      updated: (result.rowCount || 0) > 0,
      ...txData,
    });

    return { success: true, updated: (result.rowCount || 0) > 0 };
  }
}

module.exports = TokenCheckoutService;
