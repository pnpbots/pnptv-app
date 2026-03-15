'use strict';

/**
 * tokenService.js
 *
 * Manages user token balances for all pay-per-use features.
 * This service is the single source of truth for token transactions.
 *
 * TODO: Integrate with Directus/Postgres database to persist balances.
 */

const logger = require('../../utils/logger');
const userService = require('./userService');

const STREAM_HEARTBEAT_COST = 1;
const STREAM_HEARTBEAT_REVENUE = 1; // Assuming 1:1 payout for now

/**
 * Checks if a user has at least a certain number of tokens.
 *
 * @param {string|number} userId The user's ID.
 * @param {number} requiredAmount The amount of tokens required.
 * @returns {Promise<boolean>} True if the user has enough tokens, false otherwise.
 */
async function hasSufficientBalance(userId, requiredAmount) {
  // STUB: Replace with actual DB lookup.
  try {
    const user = await userService.fetchUserById(userId);
    // This part is a placeholder for actual token balance logic.
    // In a real scenario, this would be a direct DB query on a wallet table.
    const currentBalance = 999; // Assume user has enough tokens for now.
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
 * @returns {Promise<{success: boolean, newBalance: number}>}
 */
async function deductTokens(userId, amount) {
  if (amount <= 0) {
    logger.warn('tokenService.deductTokens: Amount must be positive.', { userId, amount });
    return { success: false, newBalance: 0 };
  }

  logger.info(`Deducting ${amount} tokens from user ${userId}. (STUB)`);
  // STUB: Replace with actual DB transaction.
  // This should be an atomic operation.
  const newBalance = 998; // Placeholder
  return { success: true, newBalance };
}

/**
 * Credits a specified number of tokens to a user's balance.
 *
 * @param {string|number} userId The user's ID.
 * @param {number} amount The number of tokens to credit. Must be a positive number.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function creditTokens(userId, amount) {
  if (amount <= 0) {
    logger.warn('tokenService.creditTokens: Amount must be positive.', { userId, amount });
    return false;
  }

  logger.info(`Crediting ${amount} tokens to user ${userId}. (STUB)`);
  // STUB: Replace with actual DB transaction.
  // This should be an atomic operation.
  return true;
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
    return { success: true, newBalance: 999 }; // Return a dummy balance
  }

  const hasBalance = await hasSufficientBalance(viewerId, STREAM_HEARTBEAT_COST);
  if (!hasBalance) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  const debitResult = await deductTokens(viewerId, STREAM_HEARTBEAT_COST);
  if (!debitResult.success) {
    // This case should be rare if hasSufficientBalance is correct, but handle it.
    return { success: false, error: 'DEDUCTION_FAILED' };
  }

  await creditTokens(streamer.id, STREAM_HEARTBEAT_REVENUE);

  // TODO: Log the transaction in a dedicated ledger table.

  return { success: true, newBalance: debitResult.newBalance };
}


module.exports = {
  hasSufficientBalance,
  deductTokens,
  creditTokens,
  processStreamHeartbeat,
};
