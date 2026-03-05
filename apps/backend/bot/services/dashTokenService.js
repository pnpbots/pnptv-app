/**
 * Dash Token Service
 * Manages PNP Token wallets — funded via Dash Pay (BTCPay Server)
 * 1 token = $1 USD equivalent
 */

const { query, getClient } = require('../../config/postgres');
const { cache } = require('../../config/redis');
const logger = require('../../utils/logger');

// Token package options  (tokens === USD amount)
const TOKEN_PACKAGES = [
  { id: 'pkg_5',   tokens: 5,   usd: 5,   label: '5 tokens — $5' },
  { id: 'pkg_10',  tokens: 10,  usd: 10,  label: '10 tokens — $10' },
  { id: 'pkg_20',  tokens: 20,  usd: 20,  label: '20 tokens — $20' },
  { id: 'pkg_50',  tokens: 50,  usd: 50,  label: '50 tokens — $50' },
  { id: 'pkg_100', tokens: 100, usd: 100, label: '100 tokens — $100' },
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
    if (cached) return JSON.parse(cached);

    // Upsert ensures wallet exists
    const result = await query(
      `INSERT INTO user_token_wallets (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING balance_tokens, dash_dpns`,
      [userId]
    );
    const wallet = result.rows[0] || { balance_tokens: 0, dash_dpns: null };
    await cache.setex(cacheKey, 30, JSON.stringify(wallet)).catch(() => {});
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
    const acquired = await cache.acquireLock(lockKey, 120).catch(() => false);
    if (!acquired) {
      logger.warn('creditTokens duplicate blocked', { invoiceId });
      return { newBalance: 0, alreadyProcessed: true };
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Idempotency: check if this invoice was already credited
      const existing = await client.query(
        `SELECT id FROM token_purchases WHERE btcpay_invoice_id = $1 AND status = 'paid'`,
        [invoiceId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { newBalance: 0, alreadyProcessed: true };
      }

      // Mark purchase as paid
      await client.query(
        `UPDATE token_purchases
         SET status = 'paid', settled_at = NOW()
         WHERE btcpay_invoice_id = $1 AND status = 'pending'`,
        [invoiceId]
      );

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
      await cache.releaseLock(lockKey).catch(() => {});
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
   * Record a pending token purchase invoice
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
