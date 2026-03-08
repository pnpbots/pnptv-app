/**
 * TokenCheckoutService
 * Single source of truth for all token purchase checkout flows.
 * Handles ePayco (card), Daimo (crypto wallet), and Dash/BTCPay checkout creation,
 * plus unified idempotent crediting used by webhook handlers.
 *
 * Design decisions:
 *  - token_purchases is the authoritative record; no payments table entry is created.
 *  - The existing integer PK (`id`) is preserved; a new `purchase_uuid` UUID column
 *    (migration 120) is added as the external, URL-safe identifier.
 *  - btcpay_invoice_id doubles as a namespaced idempotency key for all providers:
 *      dash    → actual BTCPay invoice ID
 *      epayco  → "epayco:<purchaseUuid>"
 *      daimo   → "daimo:<purchaseUuid>"
 *  - Daimo session data is stored in a `checkout_data` JSONB column (migration 120).
 *    If that column is absent the service gracefully re-creates the Daimo session
 *    on demand inside getCheckoutData().
 *  - ePayco signature is generated on-the-fly in getCheckoutData() — never stored.
 *
 * Required migration (apps/backend/migrations/120_token_purchase_uuid.sql):
 *   ALTER TABLE token_purchases
 *     ADD COLUMN IF NOT EXISTS purchase_uuid UUID UNIQUE DEFAULT gen_random_uuid(),
 *     ADD COLUMN IF NOT EXISTS checkout_data JSONB;
 *   CREATE UNIQUE INDEX IF NOT EXISTS idx_token_purchases_purchase_uuid
 *     ON token_purchases(purchase_uuid);
 */

'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../../config/postgres');
const { createDaimoPayment } = require('../../config/daimo');
const { createDashInvoice } = require('../../config/btcpay');
const DashTokenService = require('./dashTokenService');
const logger = require('../../utils/logger');
const { cache } = require('../../config/redis');

// ─── Constants ───────────────────────────────────────────────────────────────

const WEB_APP_URL = process.env.WEB_APP_URL || 'https://app.pnptv.app';
const EPAYCO_WEBHOOK_DOMAIN = process.env.EPAYCO_WEBHOOK_DOMAIN || 'https://pnptv.app';
const BOT_WEBHOOK_DOMAIN = process.env.BOT_WEBHOOK_DOMAIN || 'https://pnptv.app';

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
 * @param {'epayco'|'daimo'} provider
 * @param {string} purchaseUuid
 * @returns {string}
 */
function idempotencyKey(provider, purchaseUuid) {
  return `${provider}:${purchaseUuid}`;
}

/**
 * Generate an ePayco checkout HMAC-SHA256 signature.
 * Mirrors PaymentService.generateEpaycoCheckoutSignature() without the import.
 * Returns null if credentials are not configured (non-production) or throws in production.
 * @param {{ invoice: string, amount: string, currencyCode: string }} params
 * @returns {string|null}
 */
function generateEpaycoSignature({ invoice, amount, currencyCode }) {
  const pKey = process.env.EPAYCO_P_KEY || process.env.EPAYCO_PRIVATE_KEY;
  const custId = process.env.EPAYCO_P_CUST_ID;

  if (!pKey || !custId) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ePayco signing credentials not configured in production');
    }
    return null;
  }

  if (!invoice || !amount || !currencyCode) {
    return null;
  }

  const raw = `${custId}^${pKey}^${invoice}^${amount}^${currencyCode}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
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
  /** The 5 canonical token packages (1 token = $1 USD). */
  static PACKAGES = DashTokenService.TOKEN_PACKAGES;

  // ── ePayco card checkout ──────────────────────────────────────────────────

  /**
   * Create an ePayco card checkout for a token package.
   * Records a pending purchase in token_purchases and returns the checkout page URL.
   *
   * @param {string} userId
   * @param {string} packageId  e.g. 'pkg_10'
   * @returns {Promise<{
   *   success: boolean,
   *   purchaseId: string,
   *   checkoutUrl: string,
   *   tokens: number,
   *   usd: number,
   * }>}
   */
  static async createCardCheckout(userId, packageId) {
    const pkg = resolvePackage(packageId);
    if (!pkg) {
      throw Object.assign(new Error('Invalid package ID'), { code: 'INVALID_PACKAGE', status: 400 });
    }

    const purchaseUuid = uuidv4();
    const invoiceKey = idempotencyKey('epayco', purchaseUuid);

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await insertPendingPurchase(client, {
        purchaseUuid,
        userId,
        tokens: pkg.tokens,
        usd: pkg.usd,
        invoiceKey,
        paymentMethod: 'epayco',
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('TokenCheckoutService.createCardCheckout DB error', {
        userId, packageId, error: err.message,
      });
      throw err;
    } finally {
      client.release();
    }

    const checkoutUrl = `${WEB_APP_URL}/token-checkout/${purchaseUuid}`;

    logger.info('Token card checkout created', { userId, packageId, purchaseUuid, tokens: pkg.tokens });

    return {
      success: true,
      purchaseId: purchaseUuid,
      checkoutUrl,
      tokens: pkg.tokens,
      usd: pkg.usd,
    };
  }

  // ── Daimo wallet checkout ─────────────────────────────────────────────────

  /**
   * Create a Daimo crypto-wallet checkout for a token package.
   * Creates the Daimo session immediately and stores session data in the purchase record.
   *
   * @param {string} userId
   * @param {string} packageId
   * @returns {Promise<{
   *   success: boolean,
   *   purchaseId: string,
   *   checkoutUrl: string,
   *   tokens: number,
   *   usd: number,
   * }>}
   */
  static async createWalletCheckout(userId, packageId) {
    const pkg = resolvePackage(packageId);
    if (!pkg) {
      throw Object.assign(new Error('Invalid package ID'), { code: 'INVALID_PACKAGE', status: 400 });
    }

    const purchaseUuid = uuidv4();
    const invoiceKey = idempotencyKey('daimo', purchaseUuid);

    // Create the Daimo session before writing to DB so we can store it atomically.
    const daimoResult = await createDaimoPayment({
      amount: pkg.usd,
      userId,
      planId: 'token_purchase',
      chatId: '',
      paymentId: purchaseUuid,
      description: `${pkg.tokens} PNP Tokens`,
    });

    if (!daimoResult.success) {
      logger.error('Daimo session creation failed', {
        userId, packageId, purchaseUuid, error: daimoResult.error,
      });
      throw Object.assign(
        new Error(daimoResult.error || 'Daimo payment creation failed'),
        { code: 'DAIMO_ERROR', status: 503 }
      );
    }

    const checkoutData = {
      daimo_session_id: daimoResult.daimoPaymentId,
      daimo_client_secret: daimoResult.clientSecret,
    };

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await insertPendingPurchase(client, {
        purchaseUuid,
        userId,
        tokens: pkg.tokens,
        usd: pkg.usd,
        invoiceKey,
        paymentMethod: 'daimo',
        checkoutData,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('TokenCheckoutService.createWalletCheckout DB error', {
        userId, packageId, error: err.message,
      });
      throw err;
    } finally {
      client.release();
    }

    const checkoutUrl = `${WEB_APP_URL}/token-checkout/${purchaseUuid}`;

    logger.info('Token wallet checkout created', {
      userId, packageId, purchaseUuid,
      daimoPaymentId: daimoResult.daimoPaymentId,
      tokens: pkg.tokens,
    });

    return {
      success: true,
      purchaseId: purchaseUuid,
      checkoutUrl,
      tokens: pkg.tokens,
      usd: pkg.usd,
    };
  }

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

    const invoice = await createDashInvoice({
      usdAmount: pkg.usd,
      userId,
      orderId: `pnptv-tokens-${userId}-${Date.now()}`,
      description: `${pkg.tokens} PNP Tokens`,
      redirectUrl: `${WEB_APP_URL}/wallet`,
    });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await insertPendingPurchase(client, {
        purchaseUuid,
        userId,
        tokens: pkg.tokens,
        usd: pkg.usd,
        invoiceKey: invoice.invoiceId,   // raw BTCPay invoice ID (no prefix for dash)
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

    logger.info('Token Dash checkout created', {
      userId, packageId, purchaseUuid, invoiceId: invoice.invoiceId, tokens: pkg.tokens,
    });

    return {
      success: true,
      purchaseId: purchaseUuid,
      invoiceId: invoice.invoiceId,
      checkoutUrl: invoice.checkoutUrl,
      tokens: pkg.tokens,
      usd: pkg.usd,
    };
  }

  // ── Checkout page data ────────────────────────────────────────────────────

  /**
   * Return all data needed to render the /token-checkout/:purchaseId page.
   * For ePayco: returns widget config including a fresh HMAC signature.
   * For Daimo:  returns session ID and client secret (re-creates if missing).
   * For Dash:   returns null (BTCPay has its own hosted page).
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
      provider,
      status: purchase.status,
      tokens,
      usd: usdAmount,
    };

    // ── ePayco ───────────────────────────────────────────────────────────────
    if (provider === 'epayco') {
      const priceInCOP = Math.round(usdAmount * 4000);
      const amountCOPString = String(priceInCOP);
      const currencyCode = 'COP';
      const paymentRef = `TOK-${purchaseUuid.substring(0, 8).toUpperCase()}`;

      const signature = generateEpaycoSignature({
        invoice: paymentRef,
        amount: amountCOPString,
        currencyCode,
      });

      if (!signature && process.env.NODE_ENV === 'production') {
        throw new Error('ePayco signature generation failed — credentials not configured');
      }

      return {
        ...base,
        epayco: {
          publicKey: process.env.EPAYCO_PUBLIC_KEY,
          amount: priceInCOP,
          currency: currencyCode,
          description: `${tokens} PNP Tokens`,
          invoice: paymentRef,
          signature: signature,
          extra1: String(userId),
          extra2: 'token_purchase',
          extra3: purchaseUuid,
          test: process.env.EPAYCO_TEST_MODE === 'true',
          response: `${WEB_APP_URL}/token-checkout/${purchaseUuid}?status=response`,
          confirmation: `${EPAYCO_WEBHOOK_DOMAIN}/api/webhooks/epayco`,
        },
      };
    }

    // ── Daimo ────────────────────────────────────────────────────────────────
    if (provider === 'daimo') {
      const stored = purchase.checkout_data || null;
      const storedSessionId = stored?.daimo_session_id || null;
      const storedClientSecret = stored?.daimo_client_secret || null;

      if (storedSessionId && storedClientSecret) {
        return {
          ...base,
          daimo: {
            sessionId: storedSessionId,
            clientSecret: storedClientSecret,
          },
        };
      }

      // Session missing — re-create it (idempotent: Daimo uses paymentId as correlation)
      logger.warn('Daimo session not stored for purchase, re-creating', { purchaseUuid });
      try {
        const daimoResult = await createDaimoPayment({
          amount: usdAmount,
          userId,
          planId: 'token_purchase',
          chatId: '',
          paymentId: purchaseUuid,
          description: `${tokens} PNP Tokens`,
        });

        if (!daimoResult.success) {
          logger.error('Failed to re-create Daimo session', {
            purchaseUuid, error: daimoResult.error,
          });
          return { ...base, daimo: { sessionId: null, clientSecret: null } };
        }

        // Best-effort: persist back for subsequent page loads
        await query(
          `UPDATE token_purchases
           SET checkout_data = $1
           WHERE purchase_uuid = $2`,
          [
            JSON.stringify({
              daimo_session_id: daimoResult.daimoPaymentId,
              daimo_client_secret: daimoResult.clientSecret,
            }),
            purchaseUuid,
          ]
        ).catch((updateErr) => {
          logger.warn('Could not persist re-created Daimo session (non-fatal)', {
            purchaseUuid, error: updateErr.message,
          });
        });

        return {
          ...base,
          daimo: {
            sessionId: daimoResult.daimoPaymentId,
            clientSecret: daimoResult.clientSecret,
          },
        };
      } catch (daimoErr) {
        logger.error('Error re-creating Daimo session', {
          purchaseUuid, error: daimoErr.message,
        });
        return { ...base, daimo: { sessionId: null, clientSecret: null } };
      }
    }

    // Dash (BTCPay) — BTCPay has its own checkout page; no internal page needed
    return null;
  }

  // ── Credit tokens from payment ────────────────────────────────────────────

  /**
   * Unified, idempotent token crediting used by webhook handlers.
   * Looks up the purchase by its btcpay_invoice_id idempotency key, credits the
   * wallet, and marks the purchase as paid — all in a single transaction.
   *
   * Callers:
   *   ePayco webhook: provider='epayco', referenceId=purchaseUuid
   *   Daimo webhook:  provider='daimo',  referenceId=purchaseUuid
   *   BTCPay webhook: provider='dash',   referenceId=btcpayInvoiceId (raw BTCPay ID)
   *
   * @param {string} referenceId
   *   For epayco/daimo: the purchaseUuid (the UUID, not the namespaced key).
   *   For dash: the raw BTCPay invoice ID string.
   * @param {'epayco'|'daimo'|'dash'} provider
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
    const acquired = await cache.acquireLock(lockKey, 120).catch(() => false);
    if (!acquired) {
      logger.warn('creditTokensFromPayment duplicate blocked', { lookupKey, provider });
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
}

module.exports = TokenCheckoutService;
