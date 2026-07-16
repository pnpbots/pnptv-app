/**
 * PNP Live Tips Service
 * Handles tip management for PNP Television Live system
 */

const { query, getClient } = require('../config/postgres');
const logger = require('../utils/logger');
const { getRedis, cache } = require('../config/redis');
const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE, EARNINGS_HOLD_HOURS, GIFTED_ALLOWED_PERFORMER_USER_IDS } = require('../config/monetizationConfig');
const { applyCreatorBonus } = require('./tokenService');

class PNPLiveTipsService {
  // Standard tip amounts in Tokens (100 Tokens = $1 USD)
  static TIP_AMOUNTS = [500, 1000, 2000, 5000, 10000];

  /**
   * Create a new tip
   * @param {string} userId - User ID (Telegram)
   * @param {number} modelId - Model ID
   * @param {number} bookingId - Booking ID (optional)
   * @param {number} amount - Tip amount in USD
   * @param {string} message - Optional message
   * @param {string|null} performerId - Performer ID (optional)
   * @returns {Promise<Object>} Created tip
   */
  static async createTip(userId, modelId, bookingId, amount, message = '', performerId = null) {
    // SVC-M2: Validate amount — must be a positive integer within reasonable bounds
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
      const err = new Error('Tip amount must be a positive integer and cannot exceed 1,000,000');
      err.name = 'ValidationError';
      throw err;
    }

    // Block tips while the target performer/model is in the temporary
    // onboarding-lock state — they cannot monetize their content yet.
    const lockTarget = performerId || modelId;
    if (lockTarget) {
      const CreatorService = require('./creatorService');
      await CreatorService.assertCreatorUnlocked(lockTarget);
    }

    try {
      const result = await query(
        `INSERT INTO pnp_tips
         (user_id, model_id, performer_id, booking_id, amount, message, payment_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [userId, modelId || null, performerId, bookingId, amount, message, 'pending']
      );

      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      if (error.name === 'ValidationError') throw error;
      logger.error('Error creating tip:', error);
      throw new Error('Failed to create tip');
    }
  }

  /**
   * SVC-C4: Process a token-funded tip atomically.
   * Debits the user wallet, inserts the tip record, and marks it paid — all in one transaction.
   * If any step fails the entire operation rolls back (no tokens lost, no ghost tip created).
   *
   * @param {string} userId - User ID
   * @param {number} amount - Tip amount (positive integer, max 1,000,000)
   * @param {string} message - Optional tip message
   * @param {string} performerId - Performer ID
   * @param {string|null} idempotencyKey - Optional caller-supplied dedup key
   * @returns {Promise<{tip: Object, newBalance: number}>}
   */
  static async processTipWithTokens(userId, amount, message = '', performerId, idempotencyKey = null) {
    // Validate amount before touching DB
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
      const err = new Error('Tip amount must be a positive integer and cannot exceed 1,000,000');
      err.name = 'ValidationError';
      throw err;
    }

    // Gifted-token restriction gate — resolved inside the if(performerId) block below.
    let isGiftedAllowed = false;

    // Block tips while the performer is in the temporary onboarding-lock
    // state. Tokens must not be debited from the sender if the recipient
    // cannot receive — fail fast before BEGIN.
    if (performerId) {
      const CreatorService = require('./creatorService');
      await CreatorService.assertCreatorUnlocked(performerId);

      // Block tips when the performer has blocked the tipper. The platform
      // already blocks DMs and other interactions for blocked users; allowing
      // a blocked tipper to keep funneling tokens to the creator who blocked
      // them is a real abuse vector (and confusing to creators who think
      // their block was effective). The reverse check (tipper blocked the
      // performer) is intentionally NOT enforced — if a viewer tipped someone
      // they later blocked, that's their choice.
      const { rows: blocks } = await query(
        `SELECT 1 FROM blocked_users
         WHERE user_id = $1 AND blocked_user_id = $2 LIMIT 1`,
        [String(performerId), String(userId)]
      );
      if (blocks.length > 0) {
        const err = new Error('You cannot tip this performer');
        err.name = 'BlockedByPerformerError';
        err.status = 403;
        throw err;
      }

      // CRIT-03: Defense-in-depth self-tip prevention.
      // The route handler checks this first, but we re-check here because
      // processTipWithTokens can be called from any context (tests, admin tools,
      // future routes). A creator tipping themselves produces phantom earnings.
      const { rows: selfRows } = await query(
        'SELECT user_id FROM performers WHERE id::text = $1 OR user_id = $1 LIMIT 1',
        [String(performerId)]
      );
      if (selfRows.length > 0 && String(selfRows[0].user_id) === String(userId)) {
        const err = new Error('self_tip_forbidden');
        err.name = 'SelfTipError';
        err.status = 400;
        throw err;
      }

      // Gifted-token restriction: tokens gifted before public launch can only be
      // spent on Santino / PNPLatinoBoy live shows. Capture performer user_id here
      // (already fetched by the self-tip check above) so we can choose the right pool.
      const perfUserId = selfRows.length > 0
        ? String(selfRows[0].user_id)
        : String(performerId);
      isGiftedAllowed = GIFTED_ALLOWED_PERFORMER_USER_IDS.includes(perfUserId);
    }

    let client;
    try {
      client = await getClient();
      await client.query('BEGIN');

      // Debit tokens atomically — pool selection depends on performer:
      // • Allowed performers (Santino/PNPLatinoBoy): gifted_balance first, then regular.
      // • All others: regular balance_tokens only (gifted tokens are not accepted).
      let debitResult;
      if (isGiftedAllowed) {
        debitResult = await client.query(
          `UPDATE user_token_wallets
           SET gifted_balance = GREATEST(0, gifted_balance - $2),
               balance_tokens = balance_tokens - GREATEST(0, $2 - gifted_balance),
               updated_at = NOW()
           WHERE user_id = $1 AND (gifted_balance + balance_tokens) >= $2
           RETURNING balance_tokens, gifted_balance`,
          [userId, amount]
        );
      } else {
        debitResult = await client.query(
          `UPDATE user_token_wallets
           SET balance_tokens = balance_tokens - $2,
               updated_at = NOW()
           WHERE user_id = $1 AND balance_tokens >= $2
           RETURNING balance_tokens, gifted_balance`,
          [userId, amount]
        );
      }

      if (debitResult.rows.length === 0) {
        const err = new Error('Insufficient token balance');
        err.name = 'InsufficientFundsError';
        throw err;
      }

      const { balance_tokens: reg, gifted_balance: gift } = debitResult.rows[0];
      const newBalance = (reg || 0) + (gift || 0);

      // Insert tip record as already paid. transaction_id uses crypto.randomUUID
      // (collision-resistant) instead of `TOKEN-${userId}-${Date.now()}` which
      // collides if two tips are sent in the same millisecond by the same user
      // and breaks the idempotency contract of source_payment_id on creator_earnings.
      const txId = `TOKEN-${require('crypto').randomUUID()}`;
      // ON CONFLICT on idempotency_key (partial unique index WHERE NOT NULL) makes the
      // INSERT idempotent — concurrent retries with the same key yield exactly one row.
      const tipResult = await client.query(
        `INSERT INTO pnp_tips
         (user_id, model_id, performer_id, booking_id, amount, message, payment_status, payment_method, transaction_id, idempotency_key, created_at, completed_at)
         VALUES ($1, NULL, $2, NULL, $3, $4, 'completed', 'tokens', $5, $6, NOW(), NOW())
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [userId, String(performerId), amount, (message || '').slice(0, 200), txId, idempotencyKey || null]
      );

      // If ON CONFLICT fired (duplicate key), fetch the existing tip and return it
      // without debiting the wallet again — the wallet UPDATE above will be rolled back.
      if (tipResult.rows.length === 0 && idempotencyKey) {
        await client.query('ROLLBACK');
        const existing = await query(
          `SELECT * FROM pnp_tips WHERE idempotency_key = $1 LIMIT 1`,
          [idempotencyKey]
        );
        if (existing.rows.length > 0) {
          const existingTip = existing.rows[0];
          return { tip: existingTip, newBalance: null, duplicate: true };
        }
        // Key not found after conflict — should not happen, but fail safe
        const dupErr = new Error('Duplicate tip detected');
        dupErr.name = 'DuplicateTipError';
        throw dupErr;
      }

      const tip = tipResult.rows[0];

      // Record earnings split for the performer (holding — matures after EARNINGS_HOLD_HOURS).
      // Applies creator weekend bonus (+10%) if the Redis key is active and within window.
      // creator_earnings stores USD; amount is in Tokens, divide by 100.
      // creator_earnings.creator_id references users(id), not performers(id) — resolve user_id.
      const TOKENS_PER_USD = 100;
      const amountUsd = amount / TOKENS_PER_USD;
      const baseCreatorTokens = Math.round(amount * CREATOR_REVENUE_RATE * 1000) / 1000;
      const { creatorAmount: creatorTokens, platformAmount: platformTokens, bonusApplied } =
        await applyCreatorBonus(baseCreatorTokens, amount);
      const amountCreator = Math.round(creatorTokens / TOKENS_PER_USD * 100) / 100;
      const amountPlatform = Math.round(platformTokens / TOKENS_PER_USD * 100) / 100;
      if (bonusApplied) {
        logger.info('Creator weekend bonus applied on tip', { performerId, amount, creatorTokens, platformTokens });
      }
      const perfLookup = await client.query(
        'SELECT user_id FROM performers WHERE id::text = $1 OR user_id = $1 LIMIT 1',
        [String(performerId)]
      );
      const creatorUserId = perfLookup.rows.length > 0 ? String(perfLookup.rows[0].user_id) : String(performerId);
      await client.query(
        `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
         VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, $6, date_trunc('month', CURRENT_DATE))`,
        [creatorUserId, amountUsd, amountCreator, amountPlatform, String(EARNINGS_HOLD_HOURS), tip.transaction_id || null]
      );

      await client.query('COMMIT');

      // Invalidate wallet cache outside the transaction (best-effort)
      try {
        const { cache } = require('../config/redis');
        await cache.del(`wallet:${userId}`);
      } catch (cacheErr) {
        logger.warn('Failed to invalidate wallet cache after token tip:', { userId, error: cacheErr.message });
      }

      // Emit real-time updates via Socket.IO
      try {
        const socketSingleton = require('./socketSingleton');
        const io = socketSingleton.get();
        if (io) {
          // 1. Update tipper's wallet balance
          io.to(`user:${userId}`).emit('wallet:updated', { balance: newBalance });

          // 2. Resolve performer details and update their wallet
          const { rows: performerRows } = await query(
            'SELECT user_id, display_name FROM performers WHERE id::text = $1 LIMIT 1',
            [String(performerId)]
          );

          if (performerRows.length > 0) {
            const performerUserId = performerRows[0].user_id;
            const performerName = performerRows[0].display_name;

            // Fetch performer's new balance
            const performerWallet = await query(
              'SELECT balance_tokens FROM user_token_wallets WHERE user_id = $1',
              [String(performerUserId)]
            );

            if (performerWallet.rows.length > 0) {
              const pBalance = performerWallet.rows[0].balance_tokens;
              io.to(`user:${performerUserId}`).emit('wallet:updated', { balance: pBalance });

              // Emit session earnings update for streamer's dashboard
              io.to(`user:${performerUserId}`).emit('stream:earnings_update', {
                amount: amount,
                reason: 'tip',
                viewerId: userId,
                message: message,
                bonusApplied: bonusApplied || false,
              });
            }

            // 3. Resolve streamId (channelRef) and tipper info for public broadcast
            const [performerUserRes, tipperUserRes] = await Promise.all([
              query('SELECT live_channel FROM users WHERE id = $1', [String(performerUserId)]),
              query('SELECT username FROM users WHERE id = $1', [String(userId)])
            ]);

            const streamId = performerUserRes.rows[0]?.live_channel;
            const tipperUsername = tipperUserRes.rows[0]?.username || 'Someone';

            if (streamId) {
              io.to(`live:${streamId}`).emit('live:tip', {
                id: tip.id,
                amount: amount,
                username: tipperUsername,
                performerName: performerName,
                message: message,
                createdAt: tip.created_at,
                paymentMethod: 'tokens'
              });

              // Update tip goal progress. Goals live in Redis at
              // stream:goal:<channelRef> (see routes.js POST /api/webapp/live/goal).
              // We HINCRBY progress atomically, then HMGET the full state to
              // decide completion and broadcast. The legacy live_streams UPDATE
              // still fires below as a fallback for any goals set before the
              // Redis migration — the two writes are independent.
              try {
                const redis = getRedis();
                const gKey = `stream:goal:${streamId}`;
                const amt = await redis.hget(gKey, 'amount');
                if (amt) {
                  const goalAmount = parseFloat(amt);
                  await redis.hincrby(gKey, 'progress', Math.round(amount));
                  const [rawProgress, label] = await redis.hmget(gKey, 'progress', 'label');
                  let progress = parseFloat(rawProgress || '0');
                  const completed = Number.isFinite(goalAmount) && progress >= goalAmount;
                  if (completed && progress > goalAmount) {
                    // Cap progress at the goal to match the old LEAST() behavior.
                    await redis.hset(gKey, 'progress', String(goalAmount));
                    progress = goalAmount;
                  }
                  await redis.hset(gKey, 'completed', completed ? '1' : '0');
                  // Bust the 30s public read cache so viewers see progress live.
                  try { await cache.del(`live:goal:${streamId}`); } catch (_) { /* best-effort */ }
                  io.to(`live:${streamId}`).emit('live:goal_update', {
                    goalAmount,
                    goalLabel: label || null,
                    progress,
                    completed,
                  });
                }
              } catch (goalErr) {
                logger.warn('Failed to update Redis tip goal progress (non-fatal)', { error: goalErr.message });
              }
              // Legacy DB path — no-op for OBS creators (no live_streams row),
              // still updates the row for any pre-migration goals in flight.
              try {
                await query(
                  `UPDATE live_streams
                     SET tip_goal_progress = LEAST(tip_goal_progress + $1, tip_goal_amount),
                         tip_goal_completed = (tip_goal_progress + $1 >= tip_goal_amount)
                   WHERE channel_name = $2 AND status = 'live' AND tip_goal_amount IS NOT NULL`,
                  [amount, streamId]
                );
              } catch (goalErr) {
                logger.warn('Failed to update legacy DB tip goal (non-fatal)', { error: goalErr.message });
              }
            }

            // Tip alert event for the performer's own UI (audio ding, overlay)
            io.to(`user:${performerUserId}`).emit('live:tip_alert', {
              amount,
              username: tipperUsername,
              message,
              paymentMethod: 'tokens',
            });
          }
        }
      } catch (socketErr) {
        logger.warn('Failed to emit socket updates after token tip', { error: socketErr.message });
      }

      logger.info('Token tip processed atomically', { userId, performerId, amount, tipId: tip.id });

      return { tip, newBalance };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          logger.warn('Failed to rollback processTipWithTokens transaction:', rollbackErr);
        }
      }
      if (error.name === 'ValidationError' || error.name === 'InsufficientFundsError') {
        throw error;
      }
      logger.error('Error processing token tip:', error);
      throw new Error('Failed to process token tip');
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Confirm tip payment and record the 70/30 creator earnings split.
   * Idempotent: the WHERE payment_status='pending' clause guarantees at-most-once
   * earnings recording even if BTCPay redelivers the webhook.
   * @param {number} tipId - Tip ID
   * @param {string} transactionId - Payment transaction ID (BTCPay invoiceId for Dash tips)
   * @returns {Promise<Object>} Updated tip
   */
  static async confirmTipPayment(tipId, transactionId) {
    let client;
    try {
      client = await getClient();
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE pnp_tips
         SET payment_status = 'completed',
             transaction_id = $1,
             completed_at = NOW()
         WHERE id = $2 AND payment_status = 'pending'
         RETURNING *`,
        [transactionId, tipId]
      );

      const updatedRows = Array.isArray(result.rows) ? result.rows : [];
      const updatedCount = typeof result.rowCount === 'number' ? result.rowCount : updatedRows.length;

      if (updatedCount === 0) {
        await client.query('ROLLBACK');
        logger.info('confirmTipPayment: already confirmed or not found — idempotent no-op', { tipId });
        return null;
      }

      const tip = updatedRows[0];

      // Record 70/30 earnings for the performer if not already recorded
      // (token-tip path inserts earnings inline at tip creation; Dash-tip path
      // arrives here after webhook settlement). Use transaction_id as the
      // source_payment_id so a future invoice invalidation can void the row.
      // creator_earnings stores USD; tip.amount is in Tokens, divide by 100.
      const performerId = tip.performer_id || (tip.model_id != null ? String(tip.model_id) : null);
      const tipAmount = parseFloat(tip.amount);
      if (performerId && Number.isFinite(tipAmount) && tipAmount > 0) {
        const TOKENS_PER_USD = 100;
        const tipAmountUsd = tipAmount / TOKENS_PER_USD;
        const amountCreator = Math.round(tipAmountUsd * CREATOR_REVENUE_RATE * 100) / 100;
        const amountPlatform = Math.round(tipAmountUsd * PLATFORM_COMMISSION_RATE * 100) / 100;
        const sourcePaymentId = transactionId || tip.transaction_id || null;
        // Skip if an earnings row for this exact source_payment_id already exists
        // (defense-in-depth on top of the WHERE-pending guard above).
        const existing = await client.query(
          `SELECT id FROM creator_earnings WHERE source_payment_id = $1 AND creator_id = $2 LIMIT 1`,
          [sourcePaymentId, performerId]
        );
        if (existing.rowCount === 0) {
          await client.query(
            `INSERT INTO creator_earnings (creator_id, amount_gross, amount_creator, amount_platform, status, available_at, source_payment_id, period_month)
             VALUES ($1, $2, $3, $4, 'holding', NOW() + ($5 || ' hours')::interval, $6, date_trunc('month', CURRENT_DATE))`,
            [performerId, tipAmountUsd, amountCreator, amountPlatform, String(EARNINGS_HOLD_HOURS), sourcePaymentId]
          );
          logger.info('Tip earnings recorded (70/30, holding)', {
            tipId, performerId, tipAmountUsd, amountCreator, sourcePaymentId,
          });
        } else {
          logger.info('Tip earnings already recorded — idempotent no-op', { tipId, sourcePaymentId });
        }
      }

      await client.query('COMMIT');
      return tip;
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch (_) { /* best effort */ }
      }
      logger.error('Error confirming tip payment:', error);
      throw new Error('Failed to confirm tip payment');
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Get tips for a model
   * @param {number} modelId - Model ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Array>} Tips for the model
   */
  static async getModelTips(modelId, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const result = await query(
        `SELECT t.*, u.username as user_username
         FROM pnp_tips t
         LEFT JOIN users u ON t.user_id = u.id
         WHERE (t.model_id = $1 OR t.performer_id = $1::text) AND t.created_at >= $2
         ORDER BY t.created_at DESC`,
        [modelId, startDate]
      );
      
      return result.rows || [];
    } catch (error) {
      logger.error('Error getting model tips:', error);
      throw new Error('Failed to get model tips');
    }
  }

  /**
   * Get tip statistics for a model
   * @param {number} modelId - Model ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Tip statistics
   */
  static async getTipStatistics(modelId, startDate, endDate) {
    try {
      const result = await query(
        `SELECT
          COUNT(*) as total_tips,
          SUM(amount) as total_amount,
          COUNT(*) FILTER (WHERE payment_status = 'completed') as completed_tips,
          SUM(amount) FILTER (WHERE payment_status = 'completed') as completed_amount
         FROM pnp_tips
         WHERE (model_id = $1 OR performer_id = $1::text)
           AND created_at >= $2
           AND created_at <= $3`,
        [modelId, startDate, endDate]
      );
      
      return result.rows && result.rows[0] ? result.rows[0] : {
        total_tips: 0,
        total_amount: 0,
        completed_tips: 0,
        completed_amount: 0
      };
    } catch (error) {
      logger.error('Error getting tip statistics:', error);
      throw new Error('Failed to get tip statistics');
    }
  }

  /**
   * Get recent tips across all models
   * @param {number} limit - Maximum number of tips to return
   * @param {number} days - Number of days to look back
   * @returns {Promise<Array>} Recent tips
   */
  static async getRecentTips(limit = 10, days = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const result = await query(
        `SELECT t.*,
                COALESCE(p.display_name, 'Performer') as model_name,
                u.username as user_username
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
         LEFT JOIN users u ON t.user_id = u.id
         WHERE t.created_at >= $1
           AND t.payment_status = 'completed'
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [startDate, limit]
      );

      return result.rows || [];
    } catch (error) {
      logger.error('Error getting recent tips:', error);
      throw new Error('Failed to get recent tips');
    }
  }

  /**
   * Get tips by user
   * @param {string} userId - User ID (Telegram)
   * @param {number} limit - Maximum number of tips to return
   * @returns {Promise<Array>} Tips by user
   */
  static async getTipsByUser(userId, limit = 10) {
    try {
      const result = await query(
        `SELECT t.*, COALESCE(p.display_name, 'Performer') as model_name
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows || [];
    } catch (error) {
      logger.error('Error getting tips by user:', error);
      throw new Error('Failed to get tips by user');
    }
  }

  /**
   * Get tip by ID
   * @param {number} tipId - Tip ID
   * @returns {Promise<Object>} Tip details
   */
  static async getTipById(tipId) {
    try {
      const result = await query(
        `SELECT t.*, COALESCE(p.display_name, 'Performer') as model_name, u.username as user_username
         FROM pnp_tips t
         LEFT JOIN performers p ON p.id::text = t.performer_id
         LEFT JOIN users u ON t.user_id = u.id
         WHERE t.id = $1`,
        [tipId]
      );

      return result.rows && result.rows[0] ? result.rows[0] : null;
    } catch (error) {
      logger.error('Error getting tip by ID:', error);
      throw new Error('Failed to get tip');
    }
  }

  /**
   * Cancel a tip
   * @param {number} tipId - Tip ID
   * @returns {Promise<Object>} Updated tip
   */
  static async cancelTip(tipId) {
    try {
      const result = await query(
        `UPDATE pnp_tips 
         SET payment_status = 'cancelled',
             cancelled_at = NOW()
         WHERE id = $1 AND payment_status = 'pending'
         RETURNING *`,
        [tipId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Tip not found or already processed');
      }
      
      return result.rows[0];
    } catch (error) {
      logger.error('Error cancelling tip:', error);
      throw new Error('Failed to cancel tip');
    }
  }
}

module.exports = PNPLiveTipsService;
