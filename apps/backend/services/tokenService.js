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

const STREAM_HEARTBEAT_COST = 1;
const STREAM_HEARTBEAT_REVENUE = 0.70; // 70% to creator, 30% platform
const STREAM_HEARTBEAT_PLATFORM = 0.30;

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
       RETURNING balance_tokens`,
      [String(userId), amount]
    );

    if (result.rows.length === 0) {
      return { success: false, newBalance: 0, error: 'Insufficient tokens' };
    }

    const newBalance = result.rows[0].balance_tokens;
    
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
       RETURNING balance_tokens`,
      [String(userId), amount]
    );

    const newBalance = result.rows[0].balance_tokens;
    
    // Invalidate cache
    await cache.del(`wallet:${userId}`).catch(() => {});
    
    logger.info(`Credited ${amount} tokens to user ${userId} for ${reason}. New balance: ${newBalance}`);
    return true;
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
    // Don't charge the viewer if the creator isn't active
    return { success: true };
  }

  // Don't charge the streamer for watching their own stream
  if (String(viewerId) === String(streamer.id)) {
    return { success: true };
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Check and deduct from viewer
    const debitResult = await client.query(
      `UPDATE user_token_wallets
       SET balance_tokens = balance_tokens - $2,
           updated_at = NOW()
       WHERE user_id = $1 AND balance_tokens >= $2
       RETURNING balance_tokens`,
      [String(viewerId), STREAM_HEARTBEAT_COST]
    );

    if (debitResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'INSUFFICIENT_FUNDS' };
    }

    const newBalance = debitResult.rows[0].balance_tokens;

    // 2. Credit streamer
    await client.query(
      `INSERT INTO user_token_wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = user_token_wallets.balance_tokens + $2,
             updated_at = NOW()`,
      [String(streamer.id), STREAM_HEARTBEAT_REVENUE]
    );

    // 3. Log the earning record
    // Using a simple earnings record for now. If a specific table for tip/heartbeat
    // exists, it should be used here.
    await client.query(
      `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, period_month)
       VALUES ($1, $2, $3, $4, 'available', date_trunc('month', CURRENT_DATE))`,
      [String(streamer.id), STREAM_HEARTBEAT_COST, STREAM_HEARTBEAT_REVENUE, STREAM_HEARTBEAT_PLATFORM]
    );

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
            amount: STREAM_HEARTBEAT_REVENUE,
            reason: 'heartbeat',
            viewerId
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
      'SELECT balance_tokens FROM user_token_wallets WHERE user_id = $1',
      [String(userId)]
    );
    const balance = res.rows.length === 0 ? 0 : Number(res.rows[0].balance_tokens) || 0;
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
