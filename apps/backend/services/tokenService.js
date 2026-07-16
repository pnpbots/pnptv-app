'use strict';

/**
 * tokenService.js
 *
 * Manages user token balances for all pay-per-use features.
 * This service is the single source of truth for token transactions.
 * Integrates with user_token_wallets table.
 */

const logger = require('../utils/logger');
const userService = require('./userService');
const { query, getClient } = require('../config/postgres');
const { cache } = require('../config/redis');

const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE, EARNINGS_HOLD_HOURS, GIFTED_ALLOWED_PERFORMER_USER_IDS } = require('../config/monetizationConfig');

const STREAM_HEARTBEAT_COST = 100; // 100 Fichas = $1 USD; 1 Ficha per ~36 seconds
// STREAM_HEARTBEAT_REVENUE and STREAM_HEARTBEAT_PLATFORM derive from the canonical
// revenue-split constants. Their sum MUST equal STREAM_HEARTBEAT_COST at 70/30.
const STREAM_HEARTBEAT_REVENUE = Math.round(STREAM_HEARTBEAT_COST * CREATOR_REVENUE_RATE * 1000) / 1000;   // 70
const STREAM_HEARTBEAT_PLATFORM = Math.round(STREAM_HEARTBEAT_COST * PLATFORM_COMMISSION_RATE * 1000) / 1000; // 30

// ── Creator Weekend Bonus ─────────────────────────────────────────────────────
// July 18 2026 05:00 UTC → July 21 2026 11:00 UTC
// When pnpapp:creator_bonus:active Redis key exists AND current time is within window,
// creator earns 10% extra (capped so total never exceeds cost paid by viewer).
const CREATOR_BONUS_WINDOW_START = new Date('2026-07-18T05:00:00Z');
const CREATOR_BONUS_WINDOW_END = new Date('2026-07-21T11:00:00Z');

/**
 * Returns the creator earnings amount with bonus applied if active.
 * Uses raw Redis GET (not cache.get) to avoid JSON.parse turning '1' → 1 (number).
 * @param {number} baseCreatorAmount  Normal creator share (e.g. 70)
 * @param {number} totalCost  Total fichas spent by viewer (e.g. 100)
 * @returns {Promise<{ creatorAmount: number, platformAmount: number, bonusApplied: boolean }>}
 */
async function applyCreatorBonus(baseCreatorAmount, totalCost) {
  try {
    const now = new Date();
    if (now < CREATOR_BONUS_WINDOW_START || now > CREATOR_BONUS_WINDOW_END) {
      return { creatorAmount: baseCreatorAmount, platformAmount: totalCost - baseCreatorAmount, bonusApplied: false };
    }
    // Use raw Redis client — cache.get() runs JSON.parse which converts '1' → 1
    const { getRedis } = require('../config/redis');
    const redisClient = getRedis();
    const bonusFlag = await redisClient.get('pnpapp:creator_bonus:active').catch(() => null);
    if (bonusFlag !== '1') {
      return { creatorAmount: baseCreatorAmount, platformAmount: totalCost - baseCreatorAmount, bonusApplied: false };
    }
    // Apply 10% bonus, capped so creator never gets more than total paid
    const bonusedAmount = Math.min(Math.round(baseCreatorAmount * 1.1 * 1000) / 1000, totalCost);
    const platformAmount = Math.max(0, totalCost - bonusedAmount);
    return { creatorAmount: bonusedAmount, platformAmount, bonusApplied: true };
  } catch (_) {
    return { creatorAmount: baseCreatorAmount, platformAmount: totalCost - baseCreatorAmount, bonusApplied: false };
  }
}

/**
 * Checks if a user has at least a certain number of tokens.
 *
 * @param {string|number} userId The user's ID.
 * @param {number} requiredAmount The amount of tokens required.
 * @returns {Promise<boolean>} True if the user has enough tokens, false otherwise.
 */
async function hasSufficientBalance(userId, requiredAmount) {
  try {
    const res = await query(
      'SELECT balance_tokens FROM user_token_wallets WHERE user_id = $1',
      [String(userId)]
    );
    
    if (res.rows.length === 0) {
      // If no wallet exists, they have 0 tokens
      return requiredAmount <= 0;
    }
    
    const currentBalance = res.rows[0].balance_tokens;
    return currentBalance >= requiredAmount;
  } catch (error) {
    logger.error('tokenService.hasSufficientBalance error', { userId, error: error.message });
    return false; // Fail safe
  }
}

/**
 * Deducts a specified number of tokens from a user's balance.
 *
 * @param {string|number} userId The user's ID.
 * @param {number} amount The number of tokens to deduct. Must be a positive number.
 * @param {string} [reason] Optional reason for deduction.
 * @returns {Promise<{success: boolean, newBalance: number}>}
 */
async function deductTokens(userId, amount, reason = 'deduction') {
  if (amount <= 0) {
    logger.warn('tokenService.deductTokens: Amount must be positive.', { userId, amount });
    return { success: false, newBalance: 0 };
  }

  try {
    const result = await query(
      `UPDATE user_token_wallets
       SET balance_tokens = balance_tokens - $2,
           updated_at = NOW()
       WHERE user_id = $1 AND balance_tokens >= $2
       RETURNING balance_tokens, gifted_balance`,
      [String(userId), amount]
    );

    if (result.rows.length === 0) {
      return { success: false, newBalance: 0, error: 'Insufficient tokens' };
    }

    const newBalance = (Number(result.rows[0].balance_tokens) || 0) + (Number(result.rows[0].gifted_balance) || 0);
    
    // Invalidate cache
    await cache.del(`wallet:${userId}`).catch(() => {});
    
    logger.info(`Deducted ${amount} tokens from user ${userId} for ${reason}. New balance: ${newBalance}`);
    return { success: true, newBalance };
  } catch (error) {
    logger.error('tokenService.deductTokens error', { userId, amount, error: error.message });
    return { success: false, newBalance: 0, error: 'Database error' };
  }
}

/**
 * Credits a specified number of tokens to a user's balance.
 *
 * @param {string|number} userId The user's ID.
 * @param {number} amount The number of tokens to credit. Must be a positive number.
 * @param {string} [reason] Optional reason for credit.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function creditTokens(userId, amount, reason = 'credit') {
  if (amount <= 0) {
    logger.warn('tokenService.creditTokens: Amount must be positive.', { userId, amount });
    return false;
  }

  try {
    const result = await query(
      `INSERT INTO user_token_wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = user_token_wallets.balance_tokens + $2,
             updated_at = NOW()
       RETURNING balance_tokens, gifted_balance`,
      [String(userId), amount]
    );

    const newBalance = (Number(result.rows[0].balance_tokens) || 0) + (Number(result.rows[0].gifted_balance) || 0);

    // Invalidate cache
    await cache.del(`wallet:${userId}`).catch(() => {});

    logger.info(`Credited ${amount} tokens to user ${userId} for ${reason}. New balance: ${newBalance}`);
    return newBalance; // truthy number — callers checking boolean still work
  } catch (error) {
    logger.error('tokenService.creditTokens error', { userId, amount, error: error.message });
    return false;
  }
}

/**
 * Processes a stream heartbeat, deducting tokens from the viewer and crediting the streamer.
 * @param {string|number} viewerId The ID of the user watching the stream.
 * @param {string} channelRef The channel reference of the stream being watched.
 * @returns {Promise<{success: boolean, error?: string, newBalance?: number}>}
 */
async function processStreamHeartbeat(viewerId, channelRef) {
  const streamer = await userService.findUserByChannelRef(channelRef);
  if (!streamer) {
    return { success: false, error: 'STREAMER_NOT_FOUND' };
  }

  // Ensure the streamer is an active creator before processing payment
  if (streamer.creator_status !== 'active') {
    logger.warn('Heartbeat for non-active creator.', { viewerId, channelRef, streamerId: streamer.id });
    const balRow = await query(
      `SELECT COALESCE(balance_tokens,0) + COALESCE(gifted_balance,0) AS total FROM user_token_wallets WHERE user_id = $1`,
      [String(viewerId)]
    );
    return { success: true, newBalance: Number(balRow.rows[0]?.total) || 0 };
  }

  // Don't charge the streamer for watching their own stream
  if (String(viewerId) === String(streamer.id)) {
    const balRow = await query(
      `SELECT COALESCE(balance_tokens,0) + COALESCE(gifted_balance,0) AS total FROM user_token_wallets WHERE user_id = $1`,
      [String(viewerId)]
    );
    return { success: true, newBalance: Number(balRow.rows[0]?.total) || 0 };
  }

  // Gifted tokens are accepted for Santino/PNPLatinoBoy streams; regular-only elsewhere.
  const isGiftedAllowed = GIFTED_ALLOWED_PERFORMER_USER_IDS.includes(String(streamer.id));

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Check and deduct from viewer — use gifted pool first for allowed performers.
    let debitResult;
    if (isGiftedAllowed) {
      debitResult = await client.query(
        `UPDATE user_token_wallets
         SET gifted_balance = GREATEST(0, gifted_balance - $2),
             balance_tokens = balance_tokens - GREATEST(0, $2 - gifted_balance),
             updated_at = NOW()
         WHERE user_id = $1 AND (gifted_balance + balance_tokens) >= $2
         RETURNING balance_tokens, gifted_balance`,
        [String(viewerId), STREAM_HEARTBEAT_COST]
      );
    } else {
      debitResult = await client.query(
        `UPDATE user_token_wallets
         SET balance_tokens = balance_tokens - $2,
             updated_at = NOW()
         WHERE user_id = $1 AND balance_tokens >= $2
         RETURNING balance_tokens, gifted_balance`,
        [String(viewerId), STREAM_HEARTBEAT_COST]
      );
    }

    if (debitResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'INSUFFICIENT_FUNDS' };
    }

    const { balance_tokens: reg, gifted_balance: gift } = debitResult.rows[0];
    const newBalance = (reg || 0) + (gift || 0);

    // 2. Check for creator weekend bonus and compute final amounts
    const { creatorAmount, platformAmount, bonusApplied } = await applyCreatorBonus(STREAM_HEARTBEAT_REVENUE, STREAM_HEARTBEAT_COST);

    // 3. Credit streamer (with bonus if active)
    await client.query(
      `INSERT INTO user_token_wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = user_token_wallets.balance_tokens + $2,
             updated_at = NOW()`,
      [String(streamer.id), creatorAmount]
    );

    // 4. Log the earning record (holding status — matures after EARNINGS_HOLD_HOURS)
    // creator_earnings stores USD; divide Fichas by 100.
    // Note: heartbeats are micro-transactions with no external payment ID; source_payment_id stays NULL.
    const FICHAS_PER_USD = 100;
    await client.query(
      `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, period_month)
       VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, date_trunc('month', CURRENT_DATE))`,
      [String(streamer.id), STREAM_HEARTBEAT_COST / FICHAS_PER_USD, creatorAmount / FICHAS_PER_USD, platformAmount / FICHAS_PER_USD, String(EARNINGS_HOLD_HOURS)]
    );
    if (bonusApplied) {
      logger.info('Creator weekend bonus applied on heartbeat', { streamerId: streamer.id, creatorAmount, platformAmount });
    }

    await client.query('COMMIT');

    // Invalidate caches
    await Promise.all([
      cache.del(`wallet:${viewerId}`),
      cache.del(`wallet:${streamer.id}`)
    ]).catch(() => {});

    // Emit real-time updates via Socket.IO
    try {
      const socketSingleton = require('./socketSingleton');
      const io = socketSingleton.get();
      if (io) {
        // Update viewer's wallet balance
        io.to(`user:${viewerId}`).emit('wallet:updated', { balance: newBalance });

        // Fetch and update streamer's wallet balance
        const streamerWallet = await query(
          'SELECT balance_tokens FROM user_token_wallets WHERE user_id = $1',
          [String(streamer.id)]
        );
        if (streamerWallet.rows.length > 0) {
          const streamerBalance = streamerWallet.rows[0].balance_tokens;
          io.to(`user:${streamer.id}`).emit('wallet:updated', { balance: streamerBalance });
          
          // Emit session earnings update for streamer's dashboard
          io.to(`user:${streamer.id}`).emit('stream:earnings_update', {
            amount: creatorAmount,
            reason: 'heartbeat',
            viewerId,
            bonusApplied: bonusApplied || false,
          });
        }
      }
    } catch (socketErr) {
      logger.warn('Failed to emit socket updates after heartbeat', { error: socketErr.message });
    }

    return { success: true, newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('processStreamHeartbeat error', { viewerId, channelRef, error: error.message });
    return { success: false, error: 'INTERNAL_ERROR' };
  } finally {
    client.release();
  }
}


/**
 * Returns the user's current token balance. Returns 0 if no wallet exists yet.
 *
 * @param {string|number} userId
 * @returns {Promise<number>}
 */
async function getBalance(userId) {
  try {
    const cached = await cache.get(`wallet:${userId}`).catch(() => null);
    if (cached != null) {
      const n = Number(cached);
      if (Number.isFinite(n)) return n;
    }
    const res = await query(
      'SELECT balance_tokens, gifted_balance FROM user_token_wallets WHERE user_id = $1',
      [String(userId)]
    );
    const balance = res.rows.length === 0 ? 0 : (Number(res.rows[0].balance_tokens) || 0) + (Number(res.rows[0].gifted_balance) || 0);
    await cache.set(`wallet:${userId}`, balance, 30).catch(() => {});
    return balance;
  } catch (error) {
    logger.error('tokenService.getBalance error', { userId, error: error.message });
    return 0;
  }
}

module.exports = {
  hasSufficientBalance,
  getBalance,
  deductTokens,
  creditTokens,
  processStreamHeartbeat,
};
