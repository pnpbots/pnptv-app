/**
 * Dash Token Service
 * Manages Fichas wallets — funded via BTCPay Server / NowPayments
 * 100 Fichas = $1 USD
 */

const { query, getClient } = require('../config/postgres');
const { cache } = require('../config/redis');
const logger = require('../utils/logger');

// Fichas packages — 100 Fichas = $1 USD base rate
// Bonus capped at 20% max: guarantees ≥16% platform margin even if 100% of Fichas are tipped
// (70% creator payout × 1.20 bonus = 84% max outflow vs $1 received)
const TOKEN_PACKAGES = [
  { id: 'pkg_20',   tokens: 2000,   usd: 20,   bonus: 0,  label: '2,000 Fichas — $20' },
  { id: 'pkg_50',   tokens: 5250,   usd: 50,   bonus: 5,  label: '5,250 Fichas — $50 (+5%)' },
  { id: 'pkg_100',  tokens: 11000,  usd: 100,  bonus: 10, label: '11,000 Fichas — $100 (+10%)' },
  { id: 'pkg_500',  tokens: 57500,  usd: 500,  bonus: 15, label: '57,500 Fichas — $500 (+15%)' },
  { id: 'pkg_1000', tokens: 120000, usd: 1000, bonus: 20, label: '120,000 Fichas — $1,000 (+20%)' },
  { id: 'pkg_5000', tokens: 600000, usd: 5000, bonus: 20, label: '600,000 Fichas — $5,000 (+20%)' },
];

class DashTokenService {
  static TOKEN_PACKAGES = TOKEN_PACKAGES;

  /**
   * Get or create a user's token wallet
   * @param {string} userId
   * @returns {Promise<{balance_tokens: number, dash_dpns: string|null}>}
   */
  static async getWallet(userId) {
    const cacheKey = `wallet:${userId}`;
    const cached = await cache.get(cacheKey).catch(() => null);
    if (cached) return cached;

    // Upsert ensures wallet exists
    const result = await query(
      `INSERT INTO user_token_wallets (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING balance_tokens, dash_dpns`,
      [userId]
    );
    const wallet = result.rows[0] || { balance_tokens: 0, dash_dpns: null };
    await cache.set(cacheKey, wallet, 30).catch(() => {});
    return wallet;
  }

  /**
   * Credit tokens to a user's wallet (idempotent via btcpay_invoice_id)
   * @param {string} userId
   * @param {number} tokens
   * @param {string} invoiceId  — BTCPay invoice ID (idempotency key)
   * @param {object} [meta]     — { dashAmount, usdAmount }
   * @returns {Promise<{newBalance: number, alreadyProcessed: boolean}>}
   */
  static async creditTokens(userId, tokens, invoiceId, meta = {}) {
    const lockKey = `btcpay:credit:${invoiceId}`;

    // TC-C-03: distinguish a Redis failure (throw) from a genuine "already locked" (false).
    // A Redis failure must NOT silently block crediting — the DB RETURNING guard below is the
    // real idempotency fence. Only a clean false return means another process holds the lock.
    let acquired = false;
    try {
      acquired = await cache.acquireLock(lockKey, 120);
    } catch (lockErr) {
      logger.warn('creditTokens: Redis lock unavailable, proceeding without lock', { invoiceId, err: lockErr.message });
      acquired = null; // null = error path; skip the duplicate-check shortcut
    }

    if (acquired === false) {
      // A clean false means the lock is held by another in-flight request — genuine duplicate.
      logger.warn('creditTokens duplicate blocked by Redis lock', { invoiceId });
      return { newBalance: 0, alreadyProcessed: true };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Atomic idempotency: flip status 'pending' → 'paid' in one statement.
      // If rowCount === 0 the row was already paid (or never existed) — bail out without
      // crediting the wallet, eliminating the SELECT-then-UPDATE race condition.
      const updateResult = await client.query(
        `UPDATE token_purchases
         SET status = 'paid', settled_at = NOW()
         WHERE btcpay_invoice_id = $1 AND status = 'pending'
         RETURNING id`,
        [invoiceId]
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        logger.info('creditTokens: invoice already processed or not found', { invoiceId });
        return { newBalance: 0, alreadyProcessed: true };
      }

      // Credit wallet (atomic)
      const walletResult = await client.query(
        `INSERT INTO user_token_wallets (user_id, balance_tokens)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET balance_tokens = user_token_wallets.balance_tokens + $2,
               updated_at = NOW()
         RETURNING balance_tokens`,
        [userId, tokens]
      );

      await client.query('COMMIT');
      const newBalance = walletResult.rows[0]?.balance_tokens ?? tokens;

      // Invalidate cache
      await cache.del(`wallet:${userId}`).catch(() => {});
      logger.info('Tokens credited', { userId, tokens, invoiceId, newBalance });
      return { newBalance, alreadyProcessed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('creditTokens error:', error);
      throw error;
    } finally {
      client.release();
      if (acquired !== null) {
        await cache.releaseLock(lockKey).catch(() => {});
      }
    }
  }

  /**
   * Debit tokens from wallet for a tip (atomic — fails if balance insufficient)
   * @param {string} userId
   * @param {number} tokens
   * @returns {Promise<{success: boolean, newBalance: number, error?: string}>}
   */
  static async debitTokens(userId, tokens) {
    const result = await query(
      `UPDATE user_token_wallets
       SET balance_tokens = balance_tokens - $2,
           updated_at = NOW()
       WHERE user_id = $1 AND balance_tokens >= $2
       RETURNING balance_tokens`,
      [userId, tokens]
    );

    if (result.rows.length === 0) {
      return { success: false, newBalance: 0, error: 'Insufficient token balance' };
    }

    const newBalance = result.rows[0].balance_tokens;
    await cache.del(`wallet:${userId}`).catch(() => {});
    return { success: true, newBalance };
  }

  /**
   * Record a pending token purchase invoice (BTCPay/Dash)
   * @param {string} userId
   * @param {number} tokens
   * @param {number} usdAmount
   * @param {string} invoiceId
   * @returns {Promise<void>}
   */
  static async recordPurchase(userId, tokens, usdAmount, invoiceId) {
    await query(
      `INSERT INTO token_purchases
         (user_id, tokens_credited, usd_amount, btcpay_invoice_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
      [userId, tokens, usdAmount, invoiceId]
    );
  }

  /**
   * Record a pending token purchase for ePayco or Daimo
   * Uses a prefixed internal payment ID as the idempotency key stored in btcpay_invoice_id.
   * @param {string} userId
   * @param {number} tokens
   * @param {number} usdAmount
   * @param {string} paymentId   — internal UUID from the payments table
   * @param {string} paymentMethod — 'epayco' | 'daimo'
   * @returns {Promise<void>}
   */
  static async recordPurchaseForPayment(userId, tokens, usdAmount, paymentId, paymentMethod) {
    // Store the internal payment UUID prefixed with the provider as the idempotency key.
    // btcpay_invoice_id allows NULLs but has a UNIQUE constraint, so using a namespaced
    // prefix avoids collisions with real BTCPay invoice IDs.
    const idempotencyKey = `${paymentMethod}:${paymentId}`;
    await query(
      `INSERT INTO token_purchases
         (user_id, tokens_credited, usd_amount, btcpay_invoice_id, status, payment_method)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (btcpay_invoice_id) DO NOTHING`,
      [userId, tokens, usdAmount, idempotencyKey, paymentMethod]
    );
  }

  /**
   * Credit tokens for a payment-method purchase (ePayco or Daimo).
   * Uses the namespaced idempotency key stored during recordPurchaseForPayment.
   * @param {string} paymentId   — internal UUID from the payments table
   * @param {string} paymentMethod — 'epayco' | 'daimo'
   * @returns {Promise<{newBalance: number, alreadyProcessed: boolean, userId?: string, tokens?: number}>}
   */
  static async creditTokensByPaymentId(paymentId, paymentMethod) {
    const idempotencyKey = `${paymentMethod}:${paymentId}`;
    const lockKey = `token:credit:${idempotencyKey}`;

    // TC-C-03: same pattern as creditTokens — Redis error must not silently drop tokens.
    let acquired = false;
    try {
      acquired = await cache.acquireLock(lockKey, 120);
    } catch (lockErr) {
      logger.warn('creditTokensByPaymentId: Redis lock unavailable, proceeding without lock', { idempotencyKey, err: lockErr.message });
      acquired = null; // null = error path; skip the duplicate-check shortcut
    }

    if (acquired === false) {
      logger.warn('creditTokensByPaymentId duplicate blocked by Redis lock', { idempotencyKey });
      return { newBalance: 0, alreadyProcessed: true };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Atomic idempotency: fetch the pending row and flip it to 'paid' in one statement.
      // RETURNING gives us the user_id and tokens we need; rowCount === 0 means already paid
      // or not found — both are safe to bail on without double-crediting.
      const updateResult = await client.query(
        `UPDATE token_purchases
         SET status = 'paid', settled_at = NOW()
         WHERE btcpay_invoice_id = $1 AND status = 'pending'
         RETURNING id, user_id, tokens_credited, usd_amount`,
        [idempotencyKey]
      );

      if (updateResult.rowCount === 0) {
        // Check whether the row exists at all to distinguish notFound from alreadyProcessed.
        const existsResult = await client.query(
          `SELECT user_id, tokens_credited FROM token_purchases WHERE btcpay_invoice_id = $1`,
          [idempotencyKey]
        );
        await client.query('ROLLBACK');

        if (existsResult.rows.length === 0) {
          logger.warn('creditTokensByPaymentId: purchase record not found', { idempotencyKey });
          return { newBalance: 0, alreadyProcessed: false, notFound: true };
        }

        // Row exists but was not 'pending' — already paid.
        const existing = existsResult.rows[0];
        return { newBalance: 0, alreadyProcessed: true, userId: existing.user_id, tokens: existing.tokens_credited };
      }

      const purchase = updateResult.rows[0];

      // Credit wallet (atomic)
      const walletResult = await client.query(
        `INSERT INTO user_token_wallets (user_id, balance_tokens)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET balance_tokens = user_token_wallets.balance_tokens + $2,
               updated_at = NOW()
         RETURNING balance_tokens`,
        [purchase.user_id, purchase.tokens_credited]
      );

      await client.query('COMMIT');
      const newBalance = walletResult.rows[0]?.balance_tokens ?? purchase.tokens_credited;

      await cache.del(`wallet:${purchase.user_id}`).catch(() => {});
      logger.info('Tokens credited via payment', {
        userId: purchase.user_id,
        tokens: purchase.tokens_credited,
        idempotencyKey,
        newBalance,
      });

      return {
        newBalance,
        alreadyProcessed: false,
        userId: purchase.user_id,
        tokens: purchase.tokens_credited,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('creditTokensByPaymentId error:', error);
      throw error;
    } finally {
      client.release();
      if (acquired !== null) {
        await cache.releaseLock(lockKey).catch(() => {});
      }
    }
  }

  /**
   * Link a DPNS handle to a user wallet
   * @param {string} userId
   * @param {string} dpnsHandle  — e.g. "alice.dash"
   */
  static async linkDPNS(userId, dpnsHandle) {
    // Basic format validation
    if (!/^[a-z0-9_-]{3,63}(\.dash)?$/i.test(dpnsHandle)) {
      throw new Error('Invalid DPNS handle format');
    }
    await query(
      `INSERT INTO user_token_wallets (user_id, dash_dpns)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET dash_dpns = $2, updated_at = NOW()`,
      [userId, dpnsHandle.toLowerCase()]
    );
    await cache.del(`wallet:${userId}`).catch(() => {});
  }

  /**
   * Get purchase history for a user
   * @param {string} userId
   * @param {number} [limit=10]
   */
  static async getPurchaseHistory(userId, limit = 10) {
    const result = await query(
      `SELECT id, tokens_credited, usd_amount, dash_amount, btcpay_invoice_id,
              status, payment_method, created_at, settled_at
       FROM token_purchases
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

module.exports = DashTokenService;
