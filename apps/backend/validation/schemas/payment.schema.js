const Joi = require('joi');

/**
 * Payment validation schemas
 * Centralized validation rules for payment-related data
 */
const schemas = {
  /**
   * Payment amount validation
   * Must be positive number with max 2 decimal places
   */
  amount: Joi.number()
    .positive()
    .precision(2)
    .max(1000000)
    .required()
    .messages({
      'number.positive': 'Amount must be a positive number',
      'number.max': 'Amount cannot exceed 1,000,000',
      'any.required': 'Amount is required',
    }),

  /**
   * Plan ID validation
   */
  planId: Joi.string()
    .pattern(/^[a-z0-9_-]+$/)
    .max(50)
    .required()
    .messages({
      'string.pattern.base': 'Plan ID must contain only lowercase letters, numbers, hyphens, and underscores',
      'any.required': 'Plan ID is required',
    }),

  /**
   * Payment provider validation
   * Active rails: btcpay/dash (BTCPay), nowpayments (crypto).
   * ePayco retired 2026-06-24; daimo retired 2026-04-21.
   */
  provider: Joi.string()
    .valid('btcpay', 'dash', 'nowpayments')
    .required()
    .messages({
      'any.only': 'Payment provider must be one of: btcpay, dash, nowpayments',
      'any.required': 'Payment provider is required',
    }),

  /**
   * Payment status validation
   */
  status: Joi.string()
    .valid('pending', 'completed', 'failed', 'refunded', 'cancelled')
    .required()
    .messages({
      'any.only': 'Invalid payment status',
      'any.required': 'Payment status is required',
    }),

  /**
   * Payment ID validation (external provider ID)
   */
  paymentId: Joi.string()
    .min(1)
    .max(255)
    .required()
    .messages({
      'any.required': 'Payment ID is required',
    }),

  /**
   * Transaction hash validation (for blockchain payments)
   */
  txHash: Joi.string()
    .pattern(/^0x[a-fA-F0-9]{64}$/)
    .messages({
      'string.pattern.base': 'Transaction hash must be a valid Ethereum transaction hash',
    }),

  /**
   * Webhook signature validation
   */
  signature: Joi.string()
    .min(1)
    .required()
    .messages({
      'any.required': 'Webhook signature is required',
    }),

  /**
   * Create payment request validation
   */
  createPayment: Joi.object({
    userId: Joi.string().pattern(/^\d+$/).required(),
    planId: Joi.string().pattern(/^[a-z0-9_-]+$/).required(),
    amount: Joi.number().positive().precision(2).required(),
    provider: Joi.string().valid('btcpay', 'dash', 'nowpayments').required(),
    currency: Joi.string().valid('USD', 'USDC').default('USD'),
    metadata: Joi.object().optional(),
  }),

  /**
   * Daimo webhook payload validation
   */
  daimoWebhook: Joi.object({
    type: Joi.string().valid(
      'payment_started',
      'payment_completed',
      'payment_bounced',
      'payment_refunded',
    ).optional(),
    paymentId: Joi.string().optional(),
    chainId: Joi.number().optional(),
    txHash: Joi.string().optional(),
    payment: Joi.object({
      id: Joi.string().required(),
      status: Joi.string().valid(
        'payment_unpaid',
        'payment_started',
        'payment_completed',
        'payment_bounced',
        'payment_refunded',
      ).required(),
      source: Joi.object().allow(null).optional(),
      destination: Joi.object().optional(),
      metadata: Joi.object().optional(),
    }).optional(),
    // Legacy flat format fields
    id: Joi.string().optional(),
    status: Joi.string().optional(),
    source: Joi.object().allow(null).optional(),
    metadata: Joi.object().optional(),
  }).unknown(true),

  /**
   * Payment query filters validation
   */
  paymentQuery: Joi.object({
    userId: Joi.string().pattern(/^\d+$/).optional(),
    status: Joi.string().valid('pending', 'completed', 'failed', 'refunded', 'cancelled').optional(),
    provider: Joi.string().valid('btcpay', 'dash', 'nowpayments').optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    minAmount: Joi.number().positive().optional(),
    maxAmount: Joi.number().positive().min(Joi.ref('minAmount')).optional(),
    limit: Joi.number().integer().min(1).max(100)
      .default(10),
    offset: Joi.number().integer().min(0).default(0),
  }),

  /**
   * Refund request validation
   */
  refundRequest: Joi.object({
    paymentId: Joi.string().required(),
    reason: Joi.string().min(10).max(500).required(),
    amount: Joi.number().positive().precision(2).optional(), // Partial refund
  }),
};

module.exports = { schemas };
