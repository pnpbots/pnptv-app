'use strict';

const { getCreatorPayoutBalance, requestPayout, getPayoutHistory } = require('../../../services/nowpaymentsPayoutService');
const logger = require('../../../utils/logger');

exports.getPayoutBalance = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const balance = await getCreatorPayoutBalance(userId);
    return res.json({ success: true, ...balance });
  } catch (err) {
    logger.error('[creatorPayoutController.getPayoutBalance]', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch payout balance' });
  }
};

exports.requestPayout = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ success: false, error: 'USDT TRC-20 wallet address is required' });
    }

    const payout = await requestPayout({ userId, address });
    return res.json({
      success: true,
      payout: {
        id: payout.id,
        amount_usd: payout.amount_usd,
        currency: payout.currency,
        status: payout.status,
        nowpayments_payout_id: payout.nowpayments_payout_id,
        requested_at: payout.requested_at,
      },
    });
  } catch (err) {
    logger.error('[creatorPayoutController.requestPayout]', { error: err.message, code: err.code });
    // FIX 4: Only expose known safe error messages — never leak NowPayments internals
    const knownCodes = ['PAYOUT_IN_PROGRESS', 'INSUFFICIENT_BALANCE', 'BELOW_MINIMUM', 'INVALID_PAYOUT_METHOD', 'INVALID_ADDRESS', 'SERVICE_UNAVAILABLE'];
    const safeMessage = knownCodes.includes(err.code)
      ? err.message
      : 'Payout could not be processed. Please try again later or contact support.';
    const statusCode = err.code === 'PAYOUT_IN_PROGRESS' ? 409
      : (err.code === 'INSUFFICIENT_BALANCE' || err.code === 'BELOW_MINIMUM' || err.code === 'INVALID_PAYOUT_METHOD' || err.code === 'INVALID_ADDRESS') ? 400
      : 500;
    return res.status(statusCode).json({
      success: false,
      error: safeMessage,
      code: err.code || 'PAYOUT_FAILED',
    });
  }
};

exports.getPayoutHistory = async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = parseInt(req.query.offset, 10) || 0;

    const payouts = await getPayoutHistory(userId, limit, offset);
    return res.json({ success: true, payouts });
  } catch (err) {
    logger.error('[creatorPayoutController.getPayoutHistory]', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch payout history' });
  }
};
